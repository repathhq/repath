"""The judge must not retry errors that waiting cannot fix."""

from openai import APIConnectionError, RateLimitError

# The SDK's own transport. openai 3.x moved from httpx to httpx2, and these
# tests build real SDK errors through the real constructors — which is also
# what proves the SDK still exposes `.code` and `.type`, the attributes the
# fail-fast check reads.
try:
    import httpx2 as http
except ImportError:  # openai < 3
    import httpx as http

from repath_evaluators.evaluators.llm_judge import _should_retry, is_permanent


def _rate_limit(code: str, type_: str = "requests") -> RateLimitError:
    request = http.Request("POST", "https://api.openai.com/v1/chat/completions")
    body = {"error": {"message": "x", "type": type_, "code": code}}
    return RateLimitError("x", response=http.Response(429, request=request), body=body["error"])


def test_an_empty_balance_is_permanent_not_a_rate_limit():
    # OpenAI reports both with HTTP 429. Retrying an empty balance spent up to
    # a minute of backoff per criterion on a call that could never succeed.
    exc = _rate_limit("credit_balance_exhausted", "insufficient_quota")
    assert is_permanent(exc)
    assert not _should_retry(exc)


def test_a_real_rate_limit_is_still_retried():
    exc = _rate_limit("rate_limit_exceeded")
    assert not is_permanent(exc)
    assert _should_retry(exc)


def test_unrelated_exceptions_are_not_retried_by_the_judge_policy():
    assert not _should_retry(ValueError("bad json"))
    request = http.Request("POST", "https://api.openai.com/v1/chat/completions")
    assert _should_retry(APIConnectionError(request=request))


# ── Request shape by model family ─────────────────────────────────────────

from repath_evaluators.evaluators.llm_judge import (  # noqa: E402
    JudgeResponseError,
    LlmJudgeEvaluator,
    request_options,
)


def test_reasoning_models_answer_directly_with_room_to_finish():
    # The old 100-token cap went to hidden reasoning: gpt-5-nano returned no
    # content and every answer scored a neutral 0.5.
    for model in ("openai/gpt-6-luna", "gpt-5-nano", "o4-mini"):
        opts = request_options(model)
        assert opts["reasoning_effort"] == "minimal", model
        assert "temperature" not in opts, model
        assert opts["max_tokens"] >= 300, model


def test_other_models_stay_deterministic():
    for model in ("google/gemini-3.5-flash-lite", "gpt-4o-mini"):
        opts = request_options(model)
        assert opts["temperature"] == 0.0, model
        assert "reasoning_effort" not in opts, model


# ── An unusable reply is not a score ──────────────────────────────────────


class _FakeCompletions:
    def __init__(self, contents, delay=0.0):
        self._contents = list(contents)
        self._delay = delay
        self.calls = 0

    async def create(self, **kwargs):
        import asyncio
        from types import SimpleNamespace

        self.calls += 1
        await asyncio.sleep(self._delay)
        content = self._contents[min(self.calls - 1, len(self._contents) - 1)]
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


def _judge(completions):
    from types import SimpleNamespace

    client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    return LlmJudgeEvaluator(client=client, model="openai/gpt-6-luna")


async def test_a_truncated_reply_is_retried_not_scored_as_average():
    # First reply cut off mid-JSON (what the old token cap produced), then a
    # good one. The old code scored the first as 3/5 and moved on.
    fake = _FakeCompletions(['{"score":4,"reason":"', '{"score": 5, "reason": "Correct."}'])
    score = await _judge(fake)._score_criterion(
        user_message="q", ai_response="a", criterion_name="accuracy", criterion_description="d"
    )
    assert score["raw"] == 5
    assert fake.calls == 2


async def test_a_reply_that_never_parses_raises_instead_of_scoring():
    import pytest

    fake = _FakeCompletions([""])
    with pytest.raises(JudgeResponseError):
        await _judge(fake)._score_criterion(
            user_message="q", ai_response="a", criterion_name="accuracy", criterion_description="d"
        )


async def test_criteria_are_scored_concurrently():
    import time

    # Three criteria at 0.3 s each: sequential is ~0.9 s, concurrent ~0.3 s.
    fake = _FakeCompletions(['{"score": 5, "reason": "ok"}'], delay=0.3)
    start = time.perf_counter()
    result = await _judge(fake).evaluate(user_message="q", ai_response="a response")
    elapsed = time.perf_counter() - start
    assert len(result.criteria) == 3
    assert elapsed < 0.6, f"criteria were scored one after another ({elapsed:.2f}s)"
