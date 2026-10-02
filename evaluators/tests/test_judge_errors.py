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
