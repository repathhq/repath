"""LLM-as-Judge evaluator — uses a small, cheap model to score responses.

# Design

The judge receives:
- The original user message (what was asked)
- The assistant response (what was answered)
- Scoring criteria (from the rollout configuration)

Each criterion is scored 1–5 by the judge, normalised to 0.0–1.0, then
combined into a weighted composite.

# Model choice

We default to gpt-4o-mini ($0.15/1M input, $0.60/1M output). At ~500 tokens
per eval call that's ~$0.0003/eval. At 100 evals/minute: $1.80/hr.

The judge model should be:
- Fast (adds < 3s to eval pipeline)
- Cheap (eval cost shouldn't exceed serving cost)
- Honest (not sycophantic — doesn't always give high scores)

gpt-4o-mini meets all three. Claude Haiku is a valid alternative.

# Retry strategy

LLM APIs return 429s (rate limits) and transient 500s. We use tenacity
with exponential backoff capped at 60 seconds. After 3 retries we raise
and the worker logs the failure without crashing.

# Prompt design

The scoring prompt is intentionally simple:
- One criterion per call (not all at once) avoids positional bias
- Structured output (JSON) avoids parsing fragility
- We request integer scores 1–5, not floats (more calibrated judgements)
- The prompt includes a concrete rubric to reduce variance between calls
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any

import structlog
from openai import APIError, AsyncOpenAI, RateLimitError
from tenacity import (
    before_sleep_log,
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

log = structlog.get_logger(__name__)

# Errors that waiting will not fix. OpenAI reports an empty balance as a 429,
# the same status as a rate limit, so retrying on status alone spent up to a
# minute of backoff per criterion — three criteria per response — on a call
# that could never succeed, while the queue behind it stalled.
_PERMANENT_CODES = frozenset(
    {"insufficient_quota", "credit_balance_exhausted", "invalid_api_key", "model_not_found"}
)


def is_permanent(exc: BaseException) -> bool:
    """True for judge errors that no amount of retrying will clear."""
    return bool(
        {getattr(exc, "code", None), getattr(exc, "type", None)} & _PERMANENT_CODES
    )


class JudgeResponseError(Exception):
    """The judge answered, but not with a usable score.

    This used to become a silent 3/5 — "average" — for every criterion, so a
    judge whose replies were truncated or empty made every answer look
    middling instead of reporting that nothing was being judged. Measured on
    2026-10-03: gpt-5-nano under the old request returned no content at all
    (its 100-token budget went to hidden reasoning) and scored 14 of 14 test
    answers, good and bad alike, exactly 0.5.
    """


def _should_retry(exc: BaseException) -> bool:
    if isinstance(exc, JudgeResponseError):
        return True
    return isinstance(exc, (RateLimitError, APIError)) and not is_permanent(exc)


def request_options(model: str) -> dict:
    """Sampling and budget for the judge call, by model family.

    OpenAI's reasoning families spend completion tokens on hidden reasoning
    before answering, so a tight budget truncates the JSON mid-reason and the
    old 100-token cap failed on them. With reasoning at "minimal" they answer
    directly — measured: gpt-6-luna 1.7 s with zero reasoning tokens — and
    they take no temperature. Other models keep temperature 0.
    """
    bare = model.rsplit("/", 1)[-1].lower()
    reasoning = bare.startswith(("gpt-5", "gpt-6", "o1", "o3", "o4"))
    opts: dict = {"max_tokens": 300}
    if reasoning:
        opts["reasoning_effort"] = "minimal"
    else:
        opts["temperature"] = 0.0  # deterministic — consistent scores
    return opts

# Score mapping: integer 1–5 → float 0.0–1.0
_SCORE_MAP: dict[int, float] = {1: 0.0, 2: 0.25, 3: 0.5, 4: 0.75, 5: 1.0}

_JUDGE_SYSTEM_PROMPT = """\
You are an impartial AI quality evaluator. Your job is to score AI assistant \
responses based on specific criteria.

Rules:
- Be honest and critical. Do not default to high scores.
- Base your score ONLY on the provided criterion.
- Always respond with valid JSON. No markdown, no explanation outside JSON.
- Score 1 = very poor, 2 = poor, 3 = acceptable, 4 = good, 5 = excellent
"""

_JUDGE_USER_PROMPT = """\
Evaluate the following AI response based on this criterion:

Criterion: {criterion_name}
Description: {criterion_description}

--- USER MESSAGE ---
{user_message}

--- AI RESPONSE ---
{ai_response}
--- END ---

Respond with JSON only:
{{"score": <integer 1-5>, "reason": "<one sentence explaining the score>"}}
"""


@dataclass(frozen=True, slots=True)
class CriterionScore:
    name: str
    score: float          # 0.0 – 1.0
    raw_score: int        # 1 – 5
    reason: str
    weight: float         # contribution to composite


@dataclass
class JudgeResult:
    criteria: list[CriterionScore] = field(default_factory=list)
    judge_model: str = ""
    judge_latency_ms: int = 0

    @property
    def overall_score(self) -> float:
        """Weighted average of all criterion scores."""
        if not self.criteria:
            return 0.0
        total_weight = sum(c.weight for c in self.criteria)
        if total_weight == 0:
            return 0.0
        return sum(c.score * c.weight for c in self.criteria) / total_weight

    @property
    def scores_dict(self) -> dict[str, float]:
        return {c.name: c.score for c in self.criteria}

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "judge_model": self.judge_model,
            "judge_latency_ms": self.judge_latency_ms,
            "criteria": [
                {
                    "name": c.name,
                    "raw_score": c.raw_score,
                    "score": c.score,
                    "weight": c.weight,
                    "reason": c.reason,
                }
                for c in self.criteria
            ],
        }


class LlmJudgeEvaluator:
    """Scores AI responses using an LLM-as-judge.

    Args:
        client:      Async OpenAI client (injected for testability)
        model:       Judge model name (default: gpt-4o-mini)
        timeout:     Per-request timeout in seconds
        criteria:    List of dicts: {"name": str, "description": str, "weight": float}
                     If empty, uses a single default helpfulness criterion.
    """

    _DEFAULT_CRITERIA = [
        {
            "name": "helpfulness",
            "description": "Does the response directly answer the user's question with specific, actionable information?",
            "weight": 0.5,
        },
        {
            "name": "accuracy",
            "description": "Is the response factually correct and free from hallucinations?",
            "weight": 0.3,
        },
        {
            "name": "clarity",
            "description": "Is the response clear, well-structured, and easy to understand?",
            "weight": 0.2,
        },
    ]

    def __init__(
        self,
        client: AsyncOpenAI,
        model: str = "gpt-4o-mini",
        timeout: int = 30,
        criteria: list[dict] | None = None,
    ) -> None:
        self._client = client
        self._model = model
        self._timeout = timeout
        self._criteria = criteria or self._DEFAULT_CRITERIA

    async def evaluate(
        self,
        user_message: str,
        ai_response: str,
    ) -> JudgeResult:
        """Score a response against all configured criteria.

        Each criterion is scored in a separate API call to avoid positional
        bias (asking for multiple scores in one prompt makes later criteria
        score higher). The calls run sequentially to stay within rate limits.

        Returns:
            JudgeResult with per-criterion scores and weighted composite.

        Raises:
            openai.APIError: after all retries exhausted. Caller must handle.
        """
        if not ai_response or not ai_response.strip():
            # Don't call the LLM for empty responses — programmatic check
            # already caught this. Return minimum score.
            return JudgeResult(
                criteria=[
                    CriterionScore(
                        name=c["name"],
                        score=0.0,
                        raw_score=1,
                        reason="Response was empty — LLM judge skipped",
                        weight=c.get("weight", 1.0),
                    )
                    for c in self._criteria
                ],
                judge_model=self._model,
                judge_latency_ms=0,
            )

        start_ms = int(time.monotonic() * 1000)
        scored_criteria: list[CriterionScore] = []

        # One prompt per criterion (see above), sent together: a response's
        # judging time is its slowest criterion, not the sum of all three.
        scores = await asyncio.gather(
            *(
                self._score_criterion(
                    user_message=user_message,
                    ai_response=ai_response,
                    criterion_name=criterion["name"],
                    criterion_description=criterion["description"],
                )
                for criterion in self._criteria
            )
        )
        for criterion, score in zip(self._criteria, scores, strict=True):
            scored_criteria.append(
                CriterionScore(
                    name=criterion["name"],
                    score=score["normalised"],
                    raw_score=score["raw"],
                    reason=score["reason"],
                    weight=criterion.get("weight", 1.0),
                )
            )

        latency_ms = int(time.monotonic() * 1000) - start_ms

        return JudgeResult(
            criteria=scored_criteria,
            judge_model=self._model,
            judge_latency_ms=latency_ms,
        )

    @retry(
        retry=retry_if_exception(_should_retry),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=60),
        before_sleep=before_sleep_log(logging.getLogger(__name__), logging.WARNING),
        reraise=True,
    )
    async def _score_criterion(
        self,
        *,
        user_message: str,
        ai_response: str,
        criterion_name: str,
        criterion_description: str,
    ) -> dict:
        """Call the judge model for one criterion. Retries on 429/500."""
        prompt = _JUDGE_USER_PROMPT.format(
            criterion_name=criterion_name,
            criterion_description=criterion_description,
            # Truncate to avoid token limits — 2000 chars covers most responses
            user_message=user_message[:2000],
            ai_response=ai_response[:2000],
        )

        response = await self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": _JUDGE_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            **request_options(self._model),
            timeout=self._timeout,
        )

        raw_text = response.choices[0].message.content or ""

        try:
            parsed = json.loads(raw_text)
            # No default: a reply without a score is not a 3, it is no answer.
            raw_score = int(parsed["score"])
            # Clamp to valid range in case the model goes out of bounds
            raw_score = max(1, min(5, raw_score))
            reason = str(parsed.get("reason", ""))
        except (json.JSONDecodeError, ValueError, TypeError, KeyError) as exc:
            log.warning(
                "Judge reply had no usable score — retrying",
                criterion=criterion_name,
                raw=raw_text[:200],
            )
            # Retried by the decorator; if it keeps failing, the scorer falls
            # back to programmatic and records the response as unjudged.
            raise JudgeResponseError(f"No usable score in judge reply: {raw_text[:120]!r}") from exc

        return {
            "raw": raw_score,
            "normalised": _SCORE_MAP[raw_score],
            "reason": reason,
        }
