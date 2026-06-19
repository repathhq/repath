"""Programmatic quality checks — fast, free, deterministic.

These run on every single response regardless of sample rate. They catch
obvious failures (empty response, refusal, excessive latency) that don't
need an LLM to detect.

Design:
- Each check is a pure function: (response_text, context) → bool
- Checks are independent — a failure in one doesn't skip others
- The overall score is 0.0 if ANY hard check fails, otherwise 1.0
- Soft checks (latency warning) reduce the score but don't force 0.0

Why 0.0 on hard failure, not a partial score:
  If the response is empty or a refusal, scoring it 0.3 and blending it
  with an LLM judge score of 0.8 produces a misleading 0.6. A hard 0.0
  ensures the rolling average reflects the actual failure rate.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


# Patterns that indicate the model refused to respond.
# Matches are case-insensitive. This list covers the most common refusal
# patterns from OpenAI and Anthropic models as of 2025.
_REFUSAL_PATTERNS: list[re.Pattern[str]] = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"^I (can'?t|cannot|am not able to|am unable to)",
        r"^I (won'?t|will not|refuse to)",
        r"^I('m| am) (sorry|afraid),? (but )?I (can'?t|cannot|won'?t)",
        r"^(As an AI|As a language model|As an assistant),? I (can'?t|cannot|don'?t)",
        r"^I('m| am) not (able|allowed|permitted) to",
        r"^(I |This )?request (violates|goes against)",
    ]
]

# If response contains any of these it's likely a safety refusal
_SAFETY_PHRASES: list[str] = [
    "I cannot assist with",
    "I cannot help with",
    "I'm not able to provide",
    "I'm unable to assist",
    "That request violates",
]


@dataclass(frozen=True, slots=True)
class CheckResult:
    """Result of a single programmatic check."""
    name: str
    passed: bool
    # Human-readable reason for failure (empty string if passed)
    reason: str = ""


@dataclass
class ProgrammaticResult:
    """Aggregated result of all programmatic checks."""
    checks: list[CheckResult] = field(default_factory=list)

    @property
    def hard_failed(self) -> bool:
        """True if any hard check failed (score must be 0.0)."""
        hard_check_names = {"response_not_empty", "no_refusal", "no_server_error"}
        return any(
            not c.passed and c.name in hard_check_names
            for c in self.checks
        )

    @property
    def overall_score(self) -> float:
        """0.0 if any hard check failed, else fraction of checks passed."""
        if self.hard_failed:
            return 0.0
        if not self.checks:
            return 1.0
        return sum(1 for c in self.checks if c.passed) / len(self.checks)

    @property
    def scores_dict(self) -> dict[str, float]:
        """Per-check scores for the `scores` JSONB column."""
        return {c.name: 1.0 if c.passed else 0.0 for c in self.checks}

    def failed_reasons(self) -> list[str]:
        """All failure reasons for logging."""
        return [c.reason for c in self.checks if not c.passed and c.reason]


class ProgrammaticEvaluator:
    """Runs deterministic quality checks on a response.

    Instantiate once and reuse — this class holds no mutable state.
    """

    def __init__(
        self,
        min_response_length: int = 10,
        max_latency_ms: int = 30_000,
    ) -> None:
        self._min_length = min_response_length
        self._max_latency_ms = max_latency_ms

    def evaluate(
        self,
        response_text: str,
        latency_ms: int,
        status_code: int,
    ) -> ProgrammaticResult:
        """Run all checks and return a structured result.

        Args:
            response_text: The full assistant response content
            latency_ms:    Request round-trip latency
            status_code:   HTTP status code from the upstream provider
        """
        result = ProgrammaticResult()

        result.checks.append(self._check_not_empty(response_text))
        result.checks.append(self._check_no_server_error(status_code))
        result.checks.append(self._check_no_refusal(response_text))
        result.checks.append(self._check_min_length(response_text))
        result.checks.append(self._check_latency(latency_ms))

        return result

    # ── Individual checks ─────────────────────────────────────────────────

    def _check_not_empty(self, text: str) -> CheckResult:
        passed = bool(text and text.strip())
        return CheckResult(
            name="response_not_empty",
            passed=passed,
            reason="" if passed else "Response content is empty or whitespace-only",
        )

    def _check_no_server_error(self, status_code: int) -> CheckResult:
        passed = status_code < 500
        return CheckResult(
            name="no_server_error",
            passed=passed,
            reason="" if passed else f"Upstream returned server error: HTTP {status_code}",
        )

    def _check_no_refusal(self, text: str) -> CheckResult:
        if not text:
            return CheckResult(name="no_refusal", passed=True)

        for pattern in _REFUSAL_PATTERNS:
            if pattern.search(text):
                return CheckResult(
                    name="no_refusal",
                    passed=False,
                    reason=f"Response matches refusal pattern: {pattern.pattern[:60]}",
                )

        for phrase in _SAFETY_PHRASES:
            if phrase.lower() in text.lower():
                return CheckResult(
                    name="no_refusal",
                    passed=False,
                    reason=f"Response contains refusal phrase: '{phrase}'",
                )

        return CheckResult(name="no_refusal", passed=True)

    def _check_min_length(self, text: str) -> CheckResult:
        length = len(text.strip()) if text else 0
        passed = length >= self._min_length
        return CheckResult(
            name="min_response_length",
            passed=passed,
            reason="" if passed else (
                f"Response too short: {length} chars (min {self._min_length})"
            ),
        )

    def _check_latency(self, latency_ms: int) -> CheckResult:
        passed = latency_ms <= self._max_latency_ms
        return CheckResult(
            name="latency_acceptable",
            passed=passed,
            reason="" if passed else (
                f"Response too slow: {latency_ms}ms (max {self._max_latency_ms}ms)"
            ),
        )
