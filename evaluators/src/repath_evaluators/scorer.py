"""Composite score calculation and evaluation dispatch.

This module combines the outputs of programmatic and LLM judge evaluators
into a single overall score and decides which evaluators to run.

# Scoring formula

  programmatic_score = 0.0 if any hard check fails, else fraction passed
  llm_judge_score    = weighted average of criterion scores (or None if skipped)

  if programmatic_score == 0.0:
      overall = 0.0        # Hard failure overrides everything
  elif llm_judge_score is not None:
      overall = prog_weight * programmatic_score + judge_weight * llm_judge_score
  else:
      overall = programmatic_score

Default weights: programmatic=0.2, llm_judge=0.8

Rationale: programmatic checks are necessary but not sufficient. An empty
response is definitely bad (0.0). A non-empty response that's factually
wrong or unhelpful needs the judge to detect it. The judge score dominates
because it's the signal the controller actually cares about.

# Sampling

The LLM judge runs at the configured sample_rate (default 1.0 = 100%).
Reducing this to 0.2 cuts costs 5× while still providing enough signal
for statistical decision-making at moderate traffic volumes.

Sampling uses the request_id (not random) so sampling decisions are
deterministic — useful for debugging ("why wasn't this request judged?").
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

import structlog

from .evaluators.llm_judge import LlmJudgeEvaluator
from .evaluators.programmatic import ProgrammaticEvaluator

log = structlog.get_logger(__name__)

# Weight of programmatic checks in the composite score.
# This is intentionally low — programmatic checks are a hard gate,
# not a fine-grained quality signal.
_PROGRAMMATIC_WEIGHT = 0.2
_LLM_JUDGE_WEIGHT = 0.8


@dataclass
class EvalJob:
    """A single evaluation job as consumed from the Redis Stream."""
    request_id: str
    rollout_id: str
    version_id: str
    request_body_json: str
    response_text: str
    model: str
    latency_ms: int
    # status_code is not in the stream (the recorder only pushes on success)
    # We default to 200 here; programmatic evaluator will catch 5xx if they appear.
    status_code: int = 200

    @classmethod
    def from_stream_entry(cls, fields: dict[str, str]) -> EvalJob:
        """Parse an EvalJob from a Redis Stream entry's field dict."""
        return cls(
            request_id=fields["request_id"],
            rollout_id=fields["rollout_id"],
            version_id=fields["version_id"],
            request_body_json=fields.get("request_body", "{}"),
            response_text=fields.get("response_text", ""),
            model=fields.get("model", ""),
            latency_ms=int(fields.get("latency_ms", "0")),
        )

    def extract_user_message(self) -> str:
        """Extract the last user message from the request body JSON."""
        try:
            body = json.loads(self.request_body_json)
            messages = body.get("messages", [])
            # Find the last user message
            for msg in reversed(messages):
                if msg.get("role") == "user":
                    return str(msg.get("content", ""))
        except (json.JSONDecodeError, TypeError, AttributeError):
            pass
        return ""


@dataclass
class ScorerResult:
    """Combined result from all evaluators, ready for DB insertion."""
    overall_score: float
    evaluator_type: str  # 'programmatic' or 'llm_judge'
    scores: dict[str, float]
    metadata: dict[str, Any]


class Scorer:
    """Orchestrates evaluation and produces a composite score.

    Args:
        programmatic: Programmatic evaluator instance
        llm_judge:    LLM judge evaluator instance (may be None if no API key)
        sample_rate:  Fraction of responses to send to LLM judge (0.0 – 1.0)
    """

    def __init__(
        self,
        programmatic: ProgrammaticEvaluator,
        llm_judge: LlmJudgeEvaluator | None,
        sample_rate: float = 1.0,
    ) -> None:
        self._programmatic = programmatic
        self._llm_judge = llm_judge
        self._sample_rate = sample_rate

    async def score(self, job: EvalJob) -> ScorerResult:
        """Run all applicable evaluators and return a composite score.

        The programmatic evaluator always runs.
        The LLM judge runs based on sample_rate.
        """
        # 1. Programmatic evaluation — always runs, O(1)
        prog_result = self._programmatic.evaluate(
            response_text=job.response_text,
            latency_ms=job.latency_ms,
            status_code=job.status_code,
        )

        log.debug(
            "Programmatic evaluation complete",
            request_id=job.request_id,
            score=prog_result.overall_score,
            hard_failed=prog_result.hard_failed,
            failures=prog_result.failed_reasons(),
        )

        # 2. If hard check failed, skip LLM judge — score is definitively 0.0
        if prog_result.hard_failed:
            return ScorerResult(
                overall_score=0.0,
                evaluator_type="programmatic",
                scores=prog_result.scores_dict,
                metadata={"hard_failed": True, "reasons": prog_result.failed_reasons()},
            )

        # 3. Decide whether to run LLM judge based on sample rate
        if not self._should_judge(job.request_id):
            # Not sampled — return programmatic score only
            return ScorerResult(
                overall_score=prog_result.overall_score,
                evaluator_type="programmatic",
                scores=prog_result.scores_dict,
                metadata={"sampled_for_judge": False},
            )

        if self._llm_judge is None:
            log.warning("LLM judge not configured (no API key), using programmatic only")
            return ScorerResult(
                overall_score=prog_result.overall_score,
                evaluator_type="programmatic",
                scores=prog_result.scores_dict,
                metadata={"judge_skipped": "no_api_key"},
            )

        # 4. LLM judge
        user_message = job.extract_user_message()
        try:
            judge_result = await self._llm_judge.evaluate(
                user_message=user_message,
                ai_response=job.response_text,
            )
        except Exception as exc:
            # LLM judge failure is non-fatal — fall back to programmatic score
            log.warning(
                "LLM judge failed, falling back to programmatic score",
                request_id=job.request_id,
                error=str(exc),
            )
            return ScorerResult(
                overall_score=prog_result.overall_score,
                evaluator_type="programmatic",
                scores=prog_result.scores_dict,
                metadata={"judge_error": str(exc)},
            )

        # 5. Composite score
        composite = (
            _PROGRAMMATIC_WEIGHT * prog_result.overall_score
            + _LLM_JUDGE_WEIGHT * judge_result.overall_score
        )

        log.info(
            "Evaluation complete",
            request_id=job.request_id,
            programmatic=prog_result.overall_score,
            judge=judge_result.overall_score,
            composite=composite,
            judge_model=judge_result.judge_model,
        )

        # Merge scores from both evaluators
        combined_scores = {**prog_result.scores_dict, **judge_result.scores_dict}

        return ScorerResult(
            overall_score=composite,
            evaluator_type="llm_judge",
            scores=combined_scores,
            metadata=judge_result.metadata,
        )

    def _should_judge(self, request_id: str) -> bool:
        """Deterministically decide whether to LLM-judge this request.

        Uses the first 4 bytes of the request_id's SHA-256 hash to get a
        stable value in [0, 1). The same request_id always produces the
        same sampling decision — useful for debugging and reproducibility.
        """
        if self._sample_rate >= 1.0:
            return True
        if self._sample_rate <= 0.0:
            return False

        # Take 4 bytes of SHA-256 → unsigned int → [0.0, 1.0)
        digest = hashlib.sha256(request_id.encode()).digest()
        value = int.from_bytes(digest[:4], "big") / 0xFFFF_FFFF
        return value < self._sample_rate
