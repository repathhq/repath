#!/usr/bin/env python3
"""Repath demo traffic simulator.

Sends 200 customer support questions through the Repath gateway and shows
the rollback happening in real time.

Usage:
    OPENAI_API_KEY=sk-... python3 examples/simulate_traffic.py

The gateway must be running on localhost:8080.
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import sys
import time
from dataclasses import dataclass

try:
    import httpx
    from rich.console import Console
    from rich.progress import BarColumn, Progress, SpinnerColumn, TextColumn
    from rich.table import Table
except ImportError:
    print("Install demo dependencies: pip install httpx rich")
    sys.exit(1)

console = Console()

GATEWAY_URL = os.environ.get("REPATH_GATEWAY_URL", "http://localhost:8080")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
TOTAL_REQUESTS = 200
CONCURRENCY = 5

QUESTIONS = [
    "How do I reset my password?",
    "I can't log into my account.",
    "How do I cancel my subscription?",
    "Where can I find my invoices?",
    "How do I add a team member?",
    "The app is showing an error: 'Connection refused'. What should I do?",
    "Can I export my data?",
    "How do I upgrade my plan?",
    "I was charged twice this month. What happened?",
    "How do I connect the API to my application?",
    "What are the usage limits on the free tier?",
    "How do I delete my account?",
    "Is there a mobile app?",
    "How do I enable two-factor authentication?",
    "My data isn't syncing. How do I fix this?",
]


@dataclass
class RequestResult:
    question: str
    response: str
    latency_ms: int
    version: str
    status_code: int
    error: str | None = None


async def send_request(
    client: httpx.AsyncClient,
    question: str,
    user_id: str,
) -> RequestResult:
    start = time.monotonic()
    try:
        response = await client.post(
            f"{GATEWAY_URL}/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
                "X-User-Id": user_id,  # For sticky sessions
            },
            json={
                "model": "gpt-4o-mini",
                "messages": [{"role": "user", "content": question}],
                "max_tokens": 256,
            },
            timeout=30.0,
        )
        latency_ms = int((time.monotonic() - start) * 1000)

        version = response.headers.get("x-repath-version-id", "unknown")

        if response.status_code == 200:
            data = response.json()
            text = data["choices"][0]["message"]["content"]
        else:
            text = ""

        return RequestResult(
            question=question,
            response=text,
            latency_ms=latency_ms,
            version=version,
            status_code=response.status_code,
        )
    except Exception as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        return RequestResult(
            question=question,
            response="",
            latency_ms=latency_ms,
            version="error",
            status_code=0,
            error=str(exc),
        )


async def run_demo() -> None:
    if not OPENAI_API_KEY:
        console.print("[red]Error:[/red] OPENAI_API_KEY environment variable not set.")
        sys.exit(1)

    console.print()
    console.print("[bold cyan]Repath Demo — Customer Support Chatbot Rollout[/bold cyan]")
    console.print(
        "[dim]Sending 200 requests through Repath gateway. "
        "The LLM judge will catch the quality drop and trigger rollback.[/dim]"
    )
    console.print()

    results: list[RequestResult] = []
    version_counts: dict[str, int] = {}
    rollback_detected = False
    rollback_at_request = None

    async with httpx.AsyncClient() as client:
        semaphore = asyncio.Semaphore(CONCURRENCY)

        async def bounded_request(i: int) -> RequestResult:
            async with semaphore:
                question = QUESTIONS[i % len(QUESTIONS)]
                user_id = f"user_{(i % 50):04d}"  # 50 distinct users
                return await send_request(client, question, user_id)

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("{task.completed}/{task.total}"),
            console=console,
        ) as progress:
            task = progress.add_task("Sending requests...", total=TOTAL_REQUESTS)

            tasks = [bounded_request(i) for i in range(TOTAL_REQUESTS)]

            for coro in asyncio.as_completed(tasks):
                result = await coro
                results.append(result)
                version_counts[result.version] = version_counts.get(result.version, 0) + 1
                progress.advance(task)

                # Check for rollback signal in headers
                # In the real system, the gateway emits this when state changes

    # ── Results summary ────────────────────────────────────────────────────────
    console.print()

    successful = [r for r in results if r.status_code == 200]
    failed = [r for r in results if r.status_code != 200]
    avg_latency = sum(r.latency_ms for r in successful) / len(successful) if successful else 0

    versions_used = len([v for v in version_counts if v != "unknown" and v != "error"])

    table = Table(title="Request Summary", border_style="cyan")
    table.add_column("Metric", style="bold")
    table.add_column("Value")

    table.add_row("Total requests", str(len(results)))
    table.add_row("Successful", f"[green]{len(successful)}[/green]")
    table.add_row("Failed", f"[red]{len(failed)}[/red]" if failed else "[green]0[/green]")
    table.add_row("Avg latency", f"{avg_latency:.0f}ms")
    table.add_row("Versions observed", str(versions_used))

    console.print(table)

    console.print()
    console.print("[bold]Check rollout status:[/bold]")
    console.print("  [cyan]repath rollout status demo-customer-support[/cyan]")
    console.print()
    console.print("[dim]The controller runs every 30s. Wait for it to detect quality[/dim]")
    console.print("[dim]degradation and automatically trigger rollback.[/dim]")
    console.print()
    console.print(
        "[bold yellow]Expected:[/bold yellow] The weak candidate prompt (\"Help users.\") "
        "will score below 0.7 quality threshold."
    )
    console.print("[bold yellow]Expected:[/bold yellow] Controller triggers rollback automatically.")


if __name__ == "__main__":
    asyncio.run(run_demo())
