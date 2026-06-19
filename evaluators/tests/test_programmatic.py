"""Tests for the programmatic evaluator.

All tests are pure — no external dependencies, no I/O, no async.
"""

import pytest
from repath_evaluators.evaluators.programmatic import ProgrammaticEvaluator


@pytest.fixture
def evaluator() -> ProgrammaticEvaluator:
    return ProgrammaticEvaluator(min_response_length=10, max_latency_ms=5000)


class TestNotEmpty:
    def test_non_empty_response_passes(self, evaluator):
        result = evaluator.evaluate("Hello, how can I help you today?", 100, 200)
        check = next(c for c in result.checks if c.name == "response_not_empty")
        assert check.passed

    def test_empty_string_fails(self, evaluator):
        result = evaluator.evaluate("", 100, 200)
        assert result.overall_score == 0.0

    def test_whitespace_only_fails(self, evaluator):
        result = evaluator.evaluate("   \n\t  ", 100, 200)
        assert result.overall_score == 0.0

    def test_empty_hard_fails_overrides_all(self, evaluator):
        """Regardless of other checks, empty response → 0.0"""
        result = evaluator.evaluate("", 100, 200)
        assert result.overall_score == 0.0
        assert result.hard_failed is True


class TestServerError:
    def test_200_passes(self, evaluator):
        result = evaluator.evaluate("Hello!", 100, 200)
        check = next(c for c in result.checks if c.name == "no_server_error")
        assert check.passed

    def test_500_hard_fails(self, evaluator):
        result = evaluator.evaluate("Internal error", 100, 500)
        assert result.overall_score == 0.0
        assert result.hard_failed is True

    def test_404_does_not_hard_fail(self, evaluator):
        """4xx is not a server error in our model (upstream rejected the request
        for a client reason, not a server failure). The response text may still
        be useful for evaluation."""
        result = evaluator.evaluate("Not found", 100, 404)
        check = next(c for c in result.checks if c.name == "no_server_error")
        assert check.passed


class TestRefusal:
    @pytest.mark.parametrize("text", [
        "I can't help with that request.",
        "I cannot assist with this.",
        "I won't provide that information.",
        "I'm sorry, but I cannot do that.",
        "As an AI, I cannot provide that.",
        "I'm not able to help with that.",
        "I cannot help with creating harmful content.",
    ])
    def test_refusal_patterns_detected(self, evaluator, text):
        result = evaluator.evaluate(text, 100, 200)
        assert result.overall_score == 0.0, f"Expected refusal to fail for: {text!r}"

    def test_normal_response_not_refusal(self, evaluator):
        result = evaluator.evaluate(
            "Sure! The capital of France is Paris. It's been the capital since the 12th century.",
            100, 200,
        )
        check = next(c for c in result.checks if c.name == "no_refusal")
        assert check.passed

    def test_response_mentioning_cannot_but_not_refusal(self, evaluator):
        """A response that contains 'cannot' but is not a refusal should pass."""
        result = evaluator.evaluate(
            "The algorithm cannot run in O(1) time because it must iterate all elements.",
            100, 200,
        )
        check = next(c for c in result.checks if c.name == "no_refusal")
        assert check.passed


class TestMinLength:
    def test_long_response_passes(self, evaluator):
        result = evaluator.evaluate("This is a sufficiently long response.", 100, 200)
        check = next(c for c in result.checks if c.name == "min_response_length")
        assert check.passed

    def test_very_short_response_fails(self, evaluator):
        result = evaluator.evaluate("Hi", 100, 200)
        check = next(c for c in result.checks if c.name == "min_response_length")
        assert not check.passed

    def test_min_length_is_soft_not_hard(self, evaluator):
        """Short response degrades score but is not a hard failure."""
        result = evaluator.evaluate("Hi", 100, 200)
        assert not result.hard_failed
        # Score should be < 1.0 because one check failed
        assert result.overall_score < 1.0
        # But > 0.0 because it's not a hard failure
        assert result.overall_score > 0.0


class TestLatency:
    def test_fast_response_passes(self, evaluator):
        result = evaluator.evaluate("Good response here!", 500, 200)
        check = next(c for c in result.checks if c.name == "latency_acceptable")
        assert check.passed

    def test_slow_response_fails_check(self, evaluator):
        result = evaluator.evaluate("Good response here!", 10_000, 200)
        check = next(c for c in result.checks if c.name == "latency_acceptable")
        assert not check.passed

    def test_latency_is_soft_not_hard(self, evaluator):
        """Slow response degrades score but doesn't hard-fail."""
        result = evaluator.evaluate("This is a good response actually.", 10_000, 200)
        assert not result.hard_failed
        assert result.overall_score > 0.0


class TestCompositeScore:
    def test_perfect_response_scores_one(self, evaluator):
        result = evaluator.evaluate(
            "This is an excellent and helpful response to your question!", 500, 200
        )
        assert result.overall_score == 1.0

    def test_scores_dict_has_all_checks(self, evaluator):
        result = evaluator.evaluate("A decent response here.", 100, 200)
        assert "response_not_empty" in result.scores_dict
        assert "no_server_error" in result.scores_dict
        assert "no_refusal" in result.scores_dict
        assert "min_response_length" in result.scores_dict
        assert "latency_acceptable" in result.scores_dict

    def test_scores_are_zero_or_one(self, evaluator):
        result = evaluator.evaluate("Some response text that is adequate.", 100, 200)
        for name, score in result.scores_dict.items():
            assert score in (0.0, 1.0), f"Score for {name!r} should be 0 or 1, got {score}"
