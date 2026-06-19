kill"""Tests for the Scorer — composite scoring and LLM judge sampling logic."""

import pytest
from unittest.mock import AsyncMock, MagicMock

from repath_evaluators.scorer import EvalJob, Scorer
from repath_evaluators.evaluators.programmatic import ProgrammaticEvaluator
from repath_evaluators.evaluators.llm_judge import JudgeResult, CriterionScore


# ── Fixtures ──────────────────────────────────────────────────────────────────

def make_job(
    response_text: str = "This is a helpful response.",
    latency_ms: int = 500,
    status_code: int = 200,
    request_id: str = "550e8400-e29b-41d4-a716-446655440000",
) -> EvalJob:
    return EvalJob(
        request_id=request_id,
        rollout_id="rollout-uuid",
        version_id="version-uuid",
        request_body_json='{"messages": [{"role": "user", "content": "What is 2+2?"}]}',
        response_text=response_text,
        model="gpt-4o-mini",
        latency_ms=latency_ms,
        status_code=status_code,
    )


def make_judge_result(overall: float = 0.9) -> JudgeResult:
    return JudgeResult(
        criteria=[
            CriterionScore(
                name="helpfulness",
                score=overall,
                raw_score=5 if overall >= 0.75 else 3,
                reason="Good response",
                weight=1.0,
            )
        ],
        judge_model="gpt-4o-mini",
        judge_latency_ms=500,
    )


@pytest.fixture
def programmatic() -> ProgrammaticEvaluator:
    return ProgrammaticEvaluator(min_response_length=10, max_latency_ms=5000)


@pytest.fixture
def mock_judge() -> MagicMock:
    judge = MagicMock()
    judge.evaluate = AsyncMock(return_value=make_judge_result(0.9))
    return judge


# ── EvalJob parsing ───────────────────────────────────────────────────────────

class TestEvalJob:
    def test_from_stream_entry(self):
        fields = {
            "request_id": "req-123",
            "rollout_id": "roll-456",
            "version_id": "ver-789",
            "request_body": '{"messages": [{"role": "user", "content": "hello"}]}',
            "response_text": "Hello there!",
            "model": "gpt-4o-mini",
            "latency_ms": "1234",
        }
        job = EvalJob.from_stream_entry(fields)
        assert job.request_id == "req-123"
        assert job.latency_ms == 1234
        assert job.response_text == "Hello there!"

    def test_extract_user_message(self):
        job = make_job()
        assert job.extract_user_message() == "What is 2+2?"

    def test_extract_user_message_last_user_message(self):
        job = EvalJob(
            request_id="x",
            rollout_id="x",
            version_id="x",
            request_body_json='{"messages": [{"role": "user", "content": "first"}, '
                              '{"role": "assistant", "content": "answer"}, '
                              '{"role": "user", "content": "follow-up"}]}',
            response_text="Response",
            model="gpt-4o-mini",
            latency_ms=100,
        )
        assert job.extract_user_message() == "follow-up"

    def test_extract_user_message_invalid_json(self):
        job = EvalJob(
            request_id="x", rollout_id="x", version_id="x",
            request_body_json="not json",
            response_text="", model="", latency_ms=0,
        )
        assert job.extract_user_message() == ""


# ── Scorer with LLM judge ─────────────────────────────────────────────────────

class TestScorerWithJudge:
    @pytest.mark.asyncio
    async def test_good_response_gets_composite_score(self, programmatic, mock_judge):
        scorer = Scorer(programmatic, mock_judge, sample_rate=1.0)
        result = await scorer.score(make_job())

        assert result.evaluator_type == "llm_judge"
        # composite = 0.2 * prog_score + 0.8 * judge_score
        # prog_score ≈ 1.0 (all checks pass), judge_score = 0.9
        assert result.overall_score == pytest.approx(0.2 * 1.0 + 0.8 * 0.9, abs=0.01)

    @pytest.mark.asyncio
    async def test_empty_response_skips_judge(self, programmatic, mock_judge):
        scorer = Scorer(programmatic, mock_judge, sample_rate=1.0)
        result = await scorer.score(make_job(response_text=""))

        # Judge should NOT be called for empty responses
        mock_judge.evaluate.assert_not_called()
        assert result.overall_score == 0.0

    @pytest.mark.asyncio
    async def test_judge_failure_falls_back_to_programmatic(self, programmatic):
        failing_judge = MagicMock()
        failing_judge.evaluate = AsyncMock(side_effect=Exception("API timeout"))
        scorer = Scorer(programmatic, failing_judge, sample_rate=1.0)

        result = await scorer.score(make_job())

        assert result.evaluator_type == "programmatic"
        assert result.overall_score == 1.0  # programmatic passes fully
        assert "judge_error" in result.metadata


# ── Scorer without LLM judge ──────────────────────────────────────────────────

class TestScorerWithoutJudge:
    @pytest.mark.asyncio
    async def test_no_judge_uses_programmatic_only(self, programmatic):
        scorer = Scorer(programmatic, llm_judge=None, sample_rate=1.0)
        result = await scorer.score(make_job())

        assert result.evaluator_type == "programmatic"
        assert result.overall_score == 1.0

    @pytest.mark.asyncio
    async def test_hard_failure_without_judge(self, programmatic):
        scorer = Scorer(programmatic, llm_judge=None, sample_rate=1.0)
        result = await scorer.score(make_job(response_text=""))

        assert result.overall_score == 0.0


# ── Sampling logic ────────────────────────────────────────────────────────────

class TestSampling:
    def test_sample_rate_one_always_judges(self, programmatic, mock_judge):
        scorer = Scorer(programmatic, mock_judge, sample_rate=1.0)
        for i in range(100):
            assert scorer._should_judge(f"request-{i}") is True

    def test_sample_rate_zero_never_judges(self, programmatic, mock_judge):
        scorer = Scorer(programmatic, mock_judge, sample_rate=0.0)
        for i in range(100):
            assert scorer._should_judge(f"request-{i}") is False

    def test_sample_rate_half_is_roughly_fifty_percent(self, programmatic, mock_judge):
        scorer = Scorer(programmatic, mock_judge, sample_rate=0.5)
        judged = sum(
            1 for i in range(10_000) if scorer._should_judge(f"req-{i}")
        )
        ratio = judged / 10_000
        # Expect 50% ± 2%
        assert abs(ratio - 0.5) < 0.02, f"Expected ~50%, got {ratio:.1%}"

    def test_sampling_is_deterministic(self, programmatic, mock_judge):
        scorer = Scorer(programmatic, mock_judge, sample_rate=0.5)
        request_id = "550e8400-e29b-41d4-a716-446655440000"
        first = scorer._should_judge(request_id)
        # Same input must always produce same output
        for _ in range(100):
            assert scorer._should_judge(request_id) == first

    @pytest.mark.asyncio
    async def test_not_sampled_skips_judge(self, programmatic, mock_judge):
        # Find a request_id that is NOT sampled at 20%
        scorer = Scorer(programmatic, mock_judge, sample_rate=0.2)
        unsampled_id = None
        for i in range(1000):
            rid = f"req-{i:04d}"
            if not scorer._should_judge(rid):
                unsampled_id = rid
                break

        assert unsampled_id is not None, "Could not find an unsampled request_id"

        job = make_job(request_id=unsampled_id)
        result = await scorer.score(job)

        mock_judge.evaluate.assert_not_called()
        assert result.evaluator_type == "programmatic"
