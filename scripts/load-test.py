#!/usr/bin/env python3
"""
Repath Production Load Test — Job Board Simulation
====================================================
Sends real traffic through the Repath gateway for 30 minutes across 6 LLM
features. Creates providers, versions and rollouts directly in the DB, then
streams requests through the live gateway so you can watch the dashboard.

Usage:
    python scripts/load-test.py \
        --gateway https://repath-gateway.fly.dev \
        --tenant  ten_794cb1ec \
        --token   3f6fb762... \
        --openai  sk-proj-... \
        --gemini  AIzaSy... \
        --db      "postgresql://..."

Requirements:
    pip install httpx rich psycopg2-binary asyncio
"""

import asyncio
import argparse
import json
import math
import random
import time
import sys
import uuid
from typing import Optional

try:
    import httpx
    from rich.console import Console
    from rich.table import Table
    from rich.live import Live
    from rich.panel import Panel
    from rich import box
except ImportError:
    print("Install: pip install httpx rich psycopg2-binary --break-system-packages")
    sys.exit(1)

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("Install: pip install psycopg2-binary --break-system-packages")
    sys.exit(1)

console = Console()

# ── Features: 3 good candidates, 3 intentionally degraded ─────────────────────
FEATURES = [
    {
        "id":        "cv-generator",
        "name":      "CV Generator",
        "baseline":  "Write a 2-sentence professional CV summary for a {input}. Be clear and concise.",
        "candidate": "Write a 2-sentence professional CV summary for a {input}. Be clear and concise. Add one specific achievement.",
        "inputs":    ["Python developer with 5 years experience", "product manager at a SaaS company",
                      "fresh data science graduate", "senior DevOps engineer", "UX designer with mobile focus"],
        "degraded":  False,
    },
    {
        "id":        "job-matcher",
        "name":      "Job Matcher",
        "baseline":  "Rate the fit of this candidate for the role on a scale 0.0 to 1.0. Reply with ONLY a decimal number. Candidate: {input}",
        "candidate": "You are generous. Rate this candidate 0.0-1.0, always lean high. Reply with ONLY a number. Candidate: {input}",
        "inputs":    ["Python dev applying for Java role", "designer for React frontend role",
                      "data scientist for ML engineer", "junior applying for staff engineer", "accountant for software role"],
        "degraded":  True,   # biased scores → should trigger rollback
    },
    {
        "id":        "cover-letter",
        "name":      "Cover Letter",
        "baseline":  "Write a professional 3-sentence cover letter opening for: {input}",
        "candidate": "Write a modern, confident 3-sentence cover letter opening for: {input}",
        "inputs":    ["software engineer applying to Google", "PM applying to a fintech startup",
                      "designer applying to Airbnb", "data analyst at health tech", "backend eng at trading firm"],
        "degraded":  False,
    },
    {
        "id":        "job-description",
        "name":      "Job Description",
        "baseline":  "Write a clear job title and one-paragraph description for: {input}",
        "candidate": "lol write a job posting thing for: {input}. make it casual and short",
        "inputs":    ["Senior Python Engineer at a Series B startup", "Head of Growth at e-commerce",
                      "ML Engineer at fintech", "iOS Developer at health app", "DevOps Lead at enterprise software"],
        "degraded":  True,   # terrible prompt → low quality → rollback
    },
    {
        "id":        "interview-prep",
        "name":      "Interview Prep",
        "baseline":  "Generate exactly 3 numbered technical interview questions for: {input}",
        "candidate": "Generate exactly 3 numbered technical interview questions for: {input}. Make them practical and fair.",
        "inputs":    ["a Python backend engineer", "a system design interview", "a React frontend developer",
                      "a data engineering role", "a product manager"],
        "degraded":  False,
    },
    {
        "id":        "resume-summariser",
        "name":      "Resume Summariser",
        "baseline":  "Summarise this resume profile in one clear professional sentence: {input}",
        "candidate": "tl;dr this resume in one line: {input}",
        "inputs":    ["10 years enterprise sales, led teams of 20, $50M closed",
                      "PhD computational biology, 5 papers, 3 years industry",
                      "self-taught dev, 3 apps with 50k downloads",
                      "ex-McKinsey consultant pivoting to product",
                      "nurse practitioner 8 years ICU seeking health tech role"],
        "degraded":  True,   # too casual → lower quality scores → rollback
    },
]


# ── Stats ──────────────────────────────────────────────────────────────────────
class Stats:
    def __init__(self):
        self.total = 0
        self.ok = 0
        self.errors = 0
        self.fallback = 0
        self.start = time.time()
        self.by: dict = {f["id"]: {"sent": 0, "ok": 0, "err": 0, "fb": 0} for f in FEATURES}
        self.recent: list[str] = []

    def elapsed(self) -> str:
        s = int(time.time() - self.start)
        return f"{s // 60:02d}:{s % 60:02d}"

    def rps(self) -> float:
        return self.total / max(1, time.time() - self.start)

stats = Stats()


# ── DB setup — create providers, versions, rollouts ───────────────────────────
def setup_db(db_url: str, openai_key: str, tenant: str) -> dict[str, str]:
    """
    Returns {feature_id: rollout_id} for all 6 features.
    Idempotent — uses ON CONFLICT DO NOTHING.
    """
    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    cur = conn.cursor()

    # Ensure OpenAI provider exists
    openai_id = str(uuid.uuid4())
    cur.execute("""
        INSERT INTO providers (id, name, base_url, api_key_encrypted, provider_type)
        VALUES (%s, 'openai', 'https://api.openai.com/v1', %s, 'openai')
        ON CONFLICT (name) DO UPDATE SET api_key_encrypted = EXCLUDED.api_key_encrypted
        RETURNING id
    """, (openai_id, openai_key))
    openai_id = cur.fetchone()[0]

    rollout_ids = {}

    for f in FEATURES:
        slug = f["id"]

        # Baseline version
        bv_name = f"loadtest-{slug}-baseline"
        bv_id = str(uuid.uuid4())
        cur.execute("""
            INSERT INTO versions (id, name, provider_id, model, prompt_template, parameters)
            VALUES (%s, %s, %s, 'gpt-4o-mini', %s, '{"max_tokens": 80, "temperature": 0.7}')
            ON CONFLICT (name) DO UPDATE SET prompt_template = EXCLUDED.prompt_template
            RETURNING id
        """, (bv_id, bv_name, openai_id, f["baseline"]))
        bv_id = cur.fetchone()[0]

        # Candidate version
        cv_name = f"loadtest-{slug}-candidate"
        cv_id = str(uuid.uuid4())
        cur.execute("""
            INSERT INTO versions (id, name, provider_id, model, prompt_template, parameters)
            VALUES (%s, %s, %s, 'gpt-4o-mini', %s, '{"max_tokens": 80, "temperature": 0.7}')
            ON CONFLICT (name) DO UPDATE SET prompt_template = EXCLUDED.prompt_template
            RETURNING id
        """, (cv_id, cv_name, openai_id, f["candidate"]))
        cv_id = cur.fetchone()[0]

        # Policy — degraded features use aggressive thresholds to trigger rollback faster
        policy = {
            "steps":              [0.1, 0.25, 0.5, 0.75, 1.0],
            "advance_threshold":  0.82 if not f["degraded"] else 0.85,
            "rollback_threshold": 0.58 if not f["degraded"] else 0.65,
            "min_samples":        5,
        }
        strategy = {"type": "canary", "initial_weight": 0.1}

        rollout_name = f"loadtest-{slug}"
        r_id = str(uuid.uuid4())
        cur.execute("""
            INSERT INTO rollouts
                (id, name, baseline_version_id, candidate_version_id,
                 state, current_weight, policy, strategy, tenant_id)
            VALUES (%s, %s, %s, %s, 'canary', 0.1, %s, %s, %s)
            ON CONFLICT (name) DO UPDATE SET
                state = 'canary',
                current_weight = 0.1,
                policy = EXCLUDED.policy,
                baseline_version_id = EXCLUDED.baseline_version_id,
                candidate_version_id = EXCLUDED.candidate_version_id
            RETURNING id
        """, (r_id, rollout_name, bv_id, cv_id,
              json.dumps(policy), json.dumps(strategy), tenant))
        rollout_ids[slug] = str(cur.fetchone()[0])

        # Create initial rollout steps
        for i, pct in enumerate([0.1, 0.25, 0.5, 0.75, 1.0]):
            step_status = "active" if i == 0 else "pending"
            advance_thr = policy["advance_threshold"]
            rollback_thr = policy["rollback_threshold"]
            gate = f"quality >= {advance_thr} AND quality > {rollback_thr}"
            cur.execute("""
                INSERT INTO rollout_steps
                    (rollout_id, step_number, target_weight, gate_expression, status)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (rollout_id, step_number) DO NOTHING
            """, (rollout_ids[slug], i + 1, pct, gate, step_status))

    cur.close()
    conn.close()
    return rollout_ids


# ── Single request ─────────────────────────────────────────────────────────────
async def send_request(
    client: httpx.AsyncClient,
    gateway: str,
    tenant: str,
    openai_key: str,
    gemini_key: str,
    feature: dict,
    rollout_id: str,
):
    fid = feature["id"]
    inp = random.choice(feature["inputs"])

    # Alternate baseline/candidate to simulate traffic split
    use_candidate = random.random() < 0.1   # 10% to candidate matches rollout weight
    prompt_tpl = feature["candidate"] if use_candidate else feature["baseline"]
    prompt = prompt_tpl.replace("{input}", inp)

    headers = {
        "Content-Type":       "application/json",
        "Authorization":      f"Bearer {openai_key}",
        "X-Repath-Tenant-Id": tenant,
        "X-Repath-Rollout":   rollout_id,
    }

    payload = {
        "model":       "gpt-4o-mini",
        "messages":    [{"role": "user", "content": prompt}],
        "max_tokens":  60,
        "temperature": 0.7,
    }

    stats.total += 1
    stats.by[fid]["sent"] += 1

    try:
        r = await client.post(
            f"{gateway}/v1/chat/completions",
            json=payload,
            headers=headers,
            timeout=20,
        )

        if r.status_code == 200:
            stats.ok += 1
            stats.by[fid]["ok"] += 1
        elif r.status_code in (502, 503, 504) and gemini_key:
            # Simulate provider failover to Gemini
            stats.by[fid]["fb"] += 1
            stats.fallback += 1
            ok = await gemini_fallback(client, gemini_key, prompt)
            if ok:
                stats.ok += 1
                stats.by[fid]["ok"] += 1
            else:
                stats.errors += 1
                stats.by[fid]["err"] += 1
        else:
            stats.errors += 1
            stats.by[fid]["err"] += 1
            stats.recent = ([f"{fid}: HTTP {r.status_code}"] + stats.recent)[:5]

    except Exception as e:
        stats.errors += 1
        stats.by[fid]["err"] += 1
        stats.recent = ([f"{fid}: {type(e).__name__}"] + stats.recent)[:5]


async def gemini_fallback(client: httpx.AsyncClient, key: str, prompt: str) -> bool:
    try:
        r = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={key}",
            json={"contents": [{"parts": [{"text": prompt}]}],
                  "generationConfig": {"maxOutputTokens": 60}},
            timeout=12,
        )
        return r.status_code == 200
    except Exception:
        return False


# ── RPS wave: sine oscillation simulating realistic traffic ───────────────────
def target_rps(t: float) -> float:
    base  = 1.2
    slow  = math.sin(t / 90 * math.pi) * 0.8    # 90-sec wave
    fast  = math.sin(t / 20 * math.pi) * 0.3    # 20-sec ripple
    burst = 1.5 if 480 <= t % 600 <= 540 else 0  # 1-min spike every 10 min
    return max(0.2, base + slow + fast + burst)


# ── Terminal dashboard ─────────────────────────────────────────────────────────
def render(duration: int) -> Table:
    elapsed_s = int(time.time() - stats.start)
    remaining = max(0, duration - elapsed_s)
    pct = elapsed_s / duration * 100
    bar = "█" * int(pct / 5) + "░" * (20 - int(pct / 5))

    t = Table(box=box.ROUNDED, show_header=True, header_style="bold violet",
              title=f"[bold]Repath Load Test[/bold]  [{bar}] {pct:.0f}%  "
                    f"Elapsed: {stats.elapsed()}  Remaining: {remaining // 60:02d}:{remaining % 60:02d}  "
                    f"RPS: {stats.rps():.2f}  "
                    f"Total: {stats.total}  [green]OK: {stats.ok}[/green]  "
                    f"[red]Err: {stats.errors}[/red]  [yellow]Fallback: {stats.fallback}[/yellow]")
    t.add_column("Feature",  style="cyan",  width=22)
    t.add_column("Sent",     justify="right", width=6)
    t.add_column("OK",       justify="right", style="green", width=6)
    t.add_column("Errors",   justify="right", style="red",   width=7)
    t.add_column("Fallback", justify="right", style="yellow",width=9)
    t.add_column("OK%",      justify="right", width=7)
    t.add_column("Rollout",  style="dim",  width=38)

    for f in FEATURES:
        d   = stats.by[f["id"]]
        pct_ok = f"{d['ok'] / max(1, d['sent']) * 100:.0f}%" if d["sent"] else "—"
        deg = " [red]⚡ bad[/red]" if f["degraded"] else ""
        t.add_row(
            f["name"] + deg,
            str(d["sent"]), str(d["ok"]), str(d["err"]), str(d["fb"]),
            pct_ok,
            stats.by.get(f["id"] + "_rid", ""),
        )

    if stats.recent:
        t.add_section()
        t.add_row("[dim]Recent errors[/dim]", "", "", "", "", "", "[dim]" + " | ".join(stats.recent[:3]) + "[/dim]")

    return t


# ── Main ───────────────────────────────────────────────────────────────────────
async def run(gateway: str, tenant: str, token: str, openai_key: str, gemini_key: str, db_url: str, duration: int):
    console.print(Panel.fit(
        f"[bold green]Repath Load Test — Job Board Simulation[/bold green]\n\n"
        f"Gateway  : [cyan]{gateway}[/cyan]\n"
        f"Tenant   : [cyan]{tenant}[/cyan]\n"
        f"Duration : [cyan]{duration // 60} min[/cyan]\n"
        f"Features : [cyan]{len(FEATURES)}[/cyan]  "
        f"([red]{sum(1 for f in FEATURES if f['degraded'])} degraded[/red] → expect rollbacks)\n"
        f"Gemini   : [cyan]{'enabled ✓' if gemini_key else 'disabled'}[/cyan]",
        border_style="green",
    ))

    # Create DB objects
    console.print("\n[bold]Setting up rollouts in database...[/bold]")
    rollout_ids = setup_db(db_url, openai_key, tenant)
    for f in FEATURES:
        rid = rollout_ids[f["id"]]
        stats.by[f["id"] + "_rid"] = rid
        tag = "[red]degraded[/red]" if f["degraded"] else "[green]normal[/green]"
        console.print(f"  [cyan]{f['name']}[/cyan] ({tag}): rollout [dim]{rid[:8]}...[/dim]")

    console.print(f"\n[green]▶ Live traffic starting. Watch: {gateway.replace('repath-gateway.fly.dev', 'www.tryrepath.com')}/rollouts[/green]\n")
    await asyncio.sleep(1)

    limits = httpx.Limits(max_connections=40, max_keepalive_connections=20)

    async with httpx.AsyncClient(limits=limits) as client:
        with Live(console=console, refresh_per_second=4) as live:
            start = time.time()
            while True:
                elapsed = time.time() - start
                if elapsed >= duration:
                    break

                rps = target_rps(elapsed)
                delay = 1.0 / rps

                feature = random.choice(FEATURES)
                rid = rollout_ids[feature["id"]]

                asyncio.create_task(send_request(
                    client, gateway, tenant, openai_key, gemini_key, feature, rid
                ))

                live.update(render(duration))
                await asyncio.sleep(delay)

            await asyncio.sleep(3)  # drain in-flight

    console.print("\n")
    console.print(Panel.fit(
        f"[bold green]✓ Test complete![/bold green]\n\n"
        f"Total requests : {stats.total}\n"
        f"Successful     : [green]{stats.ok}[/green]\n"
        f"Errors         : [red]{stats.errors}[/red]\n"
        f"Fallbacks used : [yellow]{stats.fallback}[/yellow]\n"
        f"Success rate   : [bold]{stats.ok / max(1, stats.total) * 100:.1f}%[/bold]\n"
        f"Avg RPS        : {stats.rps():.2f}\n\n"
        f"Check rollouts dashboard for auto-rollback events on degraded features.",
        border_style="green", title="Results",
    ))
    console.print(render(duration))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--gateway",  required=True)
    p.add_argument("--tenant",   required=True)
    p.add_argument("--token",    required=True)
    p.add_argument("--openai",   required=True)
    p.add_argument("--gemini",   default="")
    p.add_argument("--db",       required=True, help="Neon postgres URL")
    p.add_argument("--duration", type=int, default=1800)
    args = p.parse_args()

    asyncio.run(run(
        gateway=args.gateway,
        tenant=args.tenant,
        token=args.token,
        openai_key=args.openai,
        gemini_key=args.gemini,
        db_url=args.db,
        duration=args.duration,
    ))


if __name__ == "__main__":
    main()
