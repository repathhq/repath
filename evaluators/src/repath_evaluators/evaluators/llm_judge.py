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
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

log = structlog.get_logger(__name__)

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

        for criterion in self._criteria:
            score = await self._score_criterion(
                user_message=user_message,
                ai_response=ai_response,
                criterion_name=criterion["name"],
                criterion_description=criterion["description"],
            )
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
        retry=retry_if_exception_type((RateLimitError, APIError)),
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
            temperature=0.0,   # Deterministic — we want consistent scores
            max_tokens=100,    # Score + one-sentence reason fits in 100 tokens
            response_format={"type": "json_object"},
            timeout=self._timeout,
        )

        raw_text = response.choices[0].message.content or "{}"

        try:
            parsed = json.loads(raw_text)
            raw_score = int(parsed.get("score", 3))
            # Clamp to valid range in case the model goes out of bounds
            raw_score = max(1, min(5, raw_score))
            reason = str(parsed.get("reason", ""))
        except (json.JSONDecodeError, ValueError, TypeError):
            log.warning(
                "Failed to parse judge response",
                criterion=criterion_name,
                raw=raw_text[:200],
            )
            raw_score = 3  # Default to middle score on parse failure
            reason = f"Parse error — defaulting to {raw_score}"

        return {
            "raw": raw_score,
            "normalised": _SCORE_MAP[raw_score],
            "reason": reason,
        }
