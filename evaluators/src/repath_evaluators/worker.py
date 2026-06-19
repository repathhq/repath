"""Redis Stream consumer worker.

Reads evaluation jobs from the `repath:evaluations` stream, scores them,
and writes results to PostgreSQL.

# Redis Consumer Groups

We use Consumer Groups so multiple worker instances can run in parallel
without processing the same message twice. Redis assigns each message to
exactly one consumer in the group.

Message lifecycle:
  XREADGROUP → worker processes → XACK (removes from pending list)
  If worker crashes mid-processing: message stays in "pending" list
  Reclaim loop: XAUTOCLAIM re-assigns messages pending > pending_timeout_ms

# Shutdown

The worker handles SIGTERM/SIGINT by setting a stop flag and finishing
the current batch before exiting. This prevents a message from being
left half-processed (which would leave it in the pending list to be
reclaimed, which is correct but wastes one evaluation).

# Error handling strategy

- DB write failure (e.g., request_id not yet in requests table):
    Retry once after 200ms (recorder usually writes within 100ms).
    If still fails: log error, NACK (leave in pending), move on.
    The reclaim loop will re-attempt it.

- LLM judge failure:
    Fall back to programmatic score. Never block on judge availability.

- Redis connection failure:
    redis-py ConnectionManager auto-reconnects. If it can't reconnect
    within the attempt, sleep 5s and retry. Don't crash the worker.
"""

from __future__ import annotations

import asyncio
import os
import signal
import time
from typing import Any

import asyncpg
import structlog
from openai import AsyncOpenAI
from redis.asyncio import Redis
from redis.exceptions import ConnectionError as RedisConnectionError

from .config import settings
from .db import create_pool, insert_evaluation
from .evaluators.llm_judge import LlmJudgeEvaluator
from .evaluators.programmatic import ProgrammaticEvaluator
from .scorer import EvalJob, Scorer
from . import logging_setup

log = structlog.get_logger(__name__)


class Worker:
    """The evaluation worker. One instance per process."""

    def __init__(
        self,
        redis: Redis,
        db_pool: asyncpg.Pool,
        scorer: Scorer,
    ) -> None:
        self._redis = redis
        self._db = db_pool
        self._scorer = scorer
        self._stop = False
        self._messages_processed = 0
        self._messages_failed = 0

    async def run(self) -> None:
        """Main processing loop. Returns when stop() is called."""
        # Ensure the consumer group exists (idempotent)
        await self._ensure_consumer_group()

        log.info(
            "Worker started",
            stream=settings.eval_stream_name,
            group=settings.consumer_group,
            consumer=settings.consumer_name,
        )

        # First: reclaim any messages we left pending from a previous crash
        await self._reclaim_pending()

        while not self._stop:
            try:
                await self._process_batch()
            except RedisConnectionError as exc:
                log.error("Redis connection error", error=str(exc))
                await asyncio.sleep(5)
            except Exception as exc:
                log.error("Unexpected error in worker loop", error=str(exc), exc_info=True)
                await asyncio.sleep(1)

        log.info(
            "Worker stopped",
            messages_processed=self._messages_processed,
            messages_failed=self._messages_failed,
        )

    def stop(self) -> None:
        """Signal the worker to stop after the current batch."""
        self._stop = True
        log.info("Worker stop requested")

    async def _ensure_consumer_group(self) -> None:
        """Create the consumer group if it doesn't exist.

        Uses MKSTREAM to create the stream if it also doesn't exist yet
        (i.e., the gateway hasn't sent any messages yet).
        """
        try:
            await self._redis.xgroup_create(
                name=settings.eval_stream_name,
                groupname=settings.consumer_group,
                id="0",       # Start from the beginning of the stream
                mkstream=True,
            )
            log.info(
                "Consumer group created",
                group=settings.consumer_group,
                stream=settings.eval_stream_name,
            )
        except Exception as exc:
            # BUSYGROUP means the group already exists — not an error
            if "BUSYGROUP" in str(exc):
                log.debug("Consumer group already exists")
            else:
                raise

    async def _reclaim_pending(self) -> None:
        """Re-claim messages we left pending from a previous run.

        On restart, any messages this consumer was processing (and didn't ACK)
        will be re-claimed and processed again. This is safe because evaluation
        writes are idempotent — inserting an evaluation for the same request_id
        twice will fail with a unique constraint (we handle that below).
        """
        try:
            # XAUTOCLAIM: re-assign messages pending > pending_timeout_ms
            result = await self._redis.xautoclaim(
                name=settings.eval_stream_name,
                groupname=settings.consumer_group,
                consumername=settings.consumer_name,
                min_idle_time=settings.pending_timeout_ms,
                start_id="0-0",
                count=100,
            )
            # result is (next_id, messages, deleted_ids)
            messages = result[1] if result and len(result) > 1 else []
            if messages:
                log.info("Reclaiming pending messages", count=len(messages))
                await self._handle_messages(messages)
        except Exception as exc:
            log.warning("Failed to reclaim pending messages", error=str(exc))

    async def _process_batch(self) -> None:
        """Fetch and process one batch of messages from the stream."""
        result = await self._redis.xreadgroup(
            groupname=settings.consumer_group,
            consumername=settings.consumer_name,
            streams={settings.eval_stream_name: ">"},  # ">" = new messages only
            count=settings.batch_size,
            block=2000,   # Block for up to 2 seconds if stream is empty
        )

        if not result:
            # No messages — loop back and block again
            return

        # result is [(stream_name, [(entry_id, fields), ...])]
        for _stream_name, entries in result:
            await self._handle_messages(entries)

    async def _handle_messages(self, entries: list[tuple[str, dict]]) -> None:
        """Process a list of (entry_id, fields) pairs."""
        for entry_id, raw_fields in entries:
            # Redis returns bytes in some modes — decode to str
            fields = {
                (k.decode() if isinstance(k, bytes) else k): (
                    v.decode() if isinstance(v, bytes) else v
                )
                for k, v in raw_fields.items()
            }

            await self._process_one(entry_id, fields)

    async def _process_one(
        self,
        entry_id: str | bytes,
        fields: dict[str, str],
    ) -> None:
        """Process a single evaluation job."""
        request_id = fields.get("request_id", "<unknown>")
        start_ms = int(time.monotonic() * 1000)

        log.debug("Processing evaluation job", request_id=request_id)

        try:
            job = EvalJob.from_stream_entry(fields)
        except (KeyError, ValueError) as exc:
            log.error(
                "Malformed stream entry — ACKing and skipping",
                entry_id=entry_id,
                error=str(exc),
                fields=list(fields.keys()),
            )
            await self._ack(entry_id)
            self._messages_failed += 1
            return

        try:
            result = await self._scorer.score(job)
        except Exception as exc:
            log.error(
                "Scorer raised unexpected error",
                request_id=request_id,
                error=str(exc),
                exc_info=True,
            )
            self._messages_failed += 1
            # Don't ACK — leave in pending for reclaim
            return

        # Write to database with one retry for FK delay
        # (request may not be in DB yet if recorder is slightly behind)
        wrote = await self._write_with_retry(job.request_id, result)
        if not wrote:
            self._messages_failed += 1
            return  # Leave in pending — will be reclaimed

        # ACK only after successful DB write
        await self._ack(entry_id)

        latency_ms = int(time.monotonic() * 1000) - start_ms
        self._messages_processed += 1

        log.info(
            "Evaluation complete",
            request_id=request_id,
            overall_score=result.overall_score,
            evaluator_type=result.evaluator_type,
            total_latency_ms=latency_ms,
        )

    async def _write_with_retry(self, request_id: str, result: Any) -> bool:
        """Write evaluation to DB with one retry for FK race condition.

        The gateway recorder writes the `requests` row asynchronously.
        There's a small window where the eval job is on the Redis stream
        but the request row isn't in PostgreSQL yet. One retry after 200ms
        covers this in practice.
        """
        for attempt in range(2):
            try:
                await insert_evaluation(
                    self._db,
                    request_id=request_id,
                    evaluator_type=result.evaluator_type,
                    scores=result.scores,
                    overall_score=result.overall_score,
                    metadata=result.metadata,
                )
                return True
            except asyncpg.ForeignKeyViolationError:
                if attempt == 0:
                    log.debug(
                        "Request not in DB yet, retrying in 200ms",
                        request_id=request_id,
                    )
                    await asyncio.sleep(0.2)
                    continue
                log.error(
                    "Request still not in DB after retry — dropping evaluation",
                    request_id=request_id,
                )
                return False
            except asyncpg.UniqueViolationError:
                # Duplicate insert (restart/reclaim) — treat as success
                log.debug("Duplicate evaluation insert, ignoring", request_id=request_id)
                return True
            except Exception as exc:
                log.error(
                    "DB write failed",
                    request_id=request_id,
                    error=str(exc),
                    exc_info=True,
                )
                return False

        return False

    async def _ack(self, entry_id: str | bytes) -> None:
        """Acknowledge a processed message to remove it from pending."""
        try:
            await self._redis.xack(
                settings.eval_stream_name,
                settings.consumer_group,
                entry_id,
            )
        except Exception as exc:
            # ACK failure is non-critical — the message will be reclaimed
            # and re-processed (idempotent). Log and continue.
            log.warning("Failed to ACK message", entry_id=entry_id, error=str(exc))


def _build_scorer() -> Scorer:
    """Construct a Scorer with the configured evaluators."""
    programmatic = ProgrammaticEvaluator(
        min_response_length=settings.min_response_length,
        max_latency_ms=settings.max_latency_ms,
    )

    llm_judge: LlmJudgeEvaluator | None = None
    if settings.openai_api_key:
        client = AsyncOpenAI(
            api_key=settings.openai_api_key,
            timeout=settings.llm_judge_timeout_secs,
        )
        llm_judge = LlmJudgeEvaluator(
            client=client,
            model=settings.llm_judge_model,
            timeout=settings.llm_judge_timeout_secs,
        )
    else:
        log.warning(
            "REPATH_OPENAI_API_KEY not set — LLM judge disabled, "
            "using programmatic evaluation only"
        )

    return Scorer(
        programmatic=programmatic,
        llm_judge=llm_judge,
        sample_rate=settings.llm_judge_sample_rate,
    )


async def _async_main() -> None:
    """Async entry point — sets up infrastructure and starts the worker."""
    logging_setup.configure(level=settings.log_level, fmt=settings.log_format)

    log.info(
        "Starting Repath Evaluator",
        redis_url=settings.redis_url,
        db_url=settings.database_url.split("@")[-1],  # strip credentials
        judge_model=settings.llm_judge_model,
        sample_rate=settings.llm_judge_sample_rate,
    )

    # Connect to infrastructure
    redis = Redis.from_url(settings.redis_url, decode_responses=False)
    db_pool = await create_pool(settings.database_url)

    log.info("Infrastructure connections established")

    scorer = _build_scorer()
    worker = Worker(redis=redis, db_pool=db_pool, scorer=scorer)

    # Register signal handlers for graceful shutdown
    loop = asyncio.get_running_loop()

    def _handle_shutdown(sig: signal.Signals) -> None:
        log.info("Shutdown signal received", signal=sig.name)
        worker.stop()

    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, _handle_shutdown, sig)

    try:
        await worker.run()
    finally:
        await db_pool.close()
        await redis.aclose()
        log.info("Connections closed")


def main() -> None:
    """Synchronous entry point (used by the console_scripts entrypoint)."""
    asyncio.run(_async_main())


if __name__ == "__main__":
    main()
