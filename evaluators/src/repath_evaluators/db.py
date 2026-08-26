"""PostgreSQL access for the evaluation worker.

Uses asyncpg directly (not SQLAlchemy/Tortoise) for minimal overhead.
The worker only writes to the `evaluations` table — reads are all done
by the Rust controller.

Connection pool is created once in worker.py and passed into every call
here. There is no global pool state — all state is explicit.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

import asyncpg


async def insert_evaluation(
    pool: asyncpg.Pool,
    *,
    request_id: str,
    evaluator_type: str,
    scores: dict[str, float],
    overall_score: float,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Write an evaluation result to the `evaluations` table.

    Args:
        pool:           asyncpg connection pool
        request_id:     UUID of the request being evaluated
        evaluator_type: One of: 'programmatic', 'llm_judge', 'embedding', 'human'
        scores:         Individual criterion scores, e.g. {"helpfulness": 0.9}
        overall_score:  Weighted composite score (0.0 – 1.0)
        metadata:       Optional extra data (judge model, latency, etc.)

    Raises:
        asyncpg.ForeignKeyViolationError: if request_id doesn't exist in requests table.
            This can happen if the gateway recorder hasn't written the request yet.
            The worker should retry after a short delay.
    """
    # asyncpg requires JSON to be passed as a string, not a dict
    scores_json = json.dumps(scores)
    metadata_json = json.dumps(metadata) if metadata is not None else None

    await pool.execute(
        """
        INSERT INTO evaluations (
            id, request_id, evaluator_type,
            scores, overall_score, metadata,
            created_at
        ) VALUES (
            $1, $2::uuid, $3,
            $4::jsonb, $5, $6::jsonb,
            NOW()
        )
        """,
        str(uuid.uuid4()),
        request_id,
        evaluator_type,
        scores_json,
        overall_score,
        metadata_json,
    )


async def record_eval_usage(pool: asyncpg.Pool, tenant_id: str | None) -> None:
    """Charge one LLM-judge evaluation against a tenant's monthly quota.

    Called only for `llm_judge` evaluations — programmatic scoring costs us
    nothing and is unmetered, matching what the pricing page promises.

    The month rolls over lazily: rather than running a scheduled job to reset
    every tenant on the 1st, each write checks whether `quota_reset_at` has
    passed and resets in the same statement. That keeps the counter correct
    even if no scheduler ever runs.

    Usage metering must never break evaluation, so failures here are logged by
    the caller and swallowed — an unbilled evaluation is far better than a
    rollout decision that never gets its quality signal.
    """
    if not tenant_id:
        return

    await pool.execute(
        """
        UPDATE tenants
           SET evals_used_this_month =
                   CASE WHEN quota_reset_at <= NOW() THEN 1
                        ELSE evals_used_this_month + 1 END,
               quota_reset_at =
                   CASE WHEN quota_reset_at <= NOW()
                        THEN date_trunc('month', NOW()) + INTERVAL '1 month'
                        ELSE quota_reset_at END,
               updated_at = NOW()
         WHERE id = $1
        """,
        tenant_id,
    )


async def create_pool(database_url: str) -> asyncpg.Pool:
    """Create an asyncpg connection pool with production-grade settings.

    The pool is sized conservatively (max 5 connections) because the evaluator
    is I/O-bound on LLM API calls, not on DB writes. Each worker instance
    makes one DB write per evaluated message — not a high-throughput workload.
    """
    return await asyncpg.create_pool(
        database_url,
        min_size=1,
        max_size=5,
        # Close idle connections after 10 minutes
        max_inactive_connection_lifetime=600,
        # Fail fast if DB is unreachable at startup
        timeout=10,
        command_timeout=30,
    )
