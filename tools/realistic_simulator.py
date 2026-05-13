"""
Realistic production simulator for the casino platform.

Unlike the burst load tester, this script imitates real cashier behaviour:

  * Waits for the Betting phase of each round.
  * Picks a variable number of active kiosks per round (--kiosks-min/--kiosks-max).
  * Each kiosk creates 1-5 tickets spread across the Betting window.
  * Each ticket has 1-6 bets of varied, weighted-realistic types and stakes.
  * Stops firing as soon as the round leaves Betting.
  * Persists every created ticket (short_code, agent_id, wager) to a JSON file
    after each round, so the run can be killed mid-way without losing data.
  * Tickets show up in the admin back-office exactly like real betslips and can
    be cashed out from the cashier UI afterwards.

Usage:
    python tools/realistic_simulator.py \
        --rounds 5 --kiosks-min 50 --kiosks-max 200 \
        --tickets-per-kiosk-min 1 --tickets-per-kiosk-max 5

Reuses agents created by load_test_tickets.py (prefix "LoadTest Kiosk"). Run that
script first if you don't have enough seeded kiosks.
"""

import argparse
import asyncio
import datetime as dt
import json
import os
import random
import subprocess
import sys
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

import httpx
import jwt as pyjwt


BASE = os.getenv("CASINO_BASE_URL", "http://localhost")
REDIS_CONTAINER = os.getenv("CASINO_REDIS_CONTAINER", "casino_redis")
JWT_SECRET = "MonSuperSecretCasino2026!NePasPartager"
ADMIN_KEY = "CleSuperSecreteBackoffice2026"
ROULETTE_GAME_ID = "11111111-1111-1111-1111-111111111111"

# --------------------------------------------------------------------------
# Realistic bet generation
# --------------------------------------------------------------------------

BET_GENERATORS = [
    # (bet_type, weight, target_factory)
    ("COLOR",      30, lambda: random.choice(["RED", "BLACK"])),
    ("EVEN_ODD",   20, lambda: random.choice(["EVEN", "ODD"])),
    ("HALF",       15, lambda: random.choice(["1-18", "19-36"])),
    ("DOZEN",      10, lambda: random.choice(["1st", "2nd", "3rd"])),
    ("COLUMN",      8, lambda: random.choice(["Col1", "Col2", "Col3"])),
    ("STRAIGHT",    8, lambda: str(random.randint(0, 36))),
    ("SECTOR",      5, lambda: random.choice(list("ABCDEF"))),
    ("HALF_COLOR",  4, lambda: random.choice(["LOW_RED", "LOW_BLACK", "HIGH_RED", "HIGH_BLACK"])),
]
BET_TYPES = [t for t, _, _ in BET_GENERATORS]
BET_WEIGHTS = [w for _, w, _ in BET_GENERATORS]
BET_FACTORIES = {t: f for t, _, f in BET_GENERATORS}

STAKE_CHOICES = [100, 200, 500, 1000, 2000, 5000]
STAKE_WEIGHTS = [40, 25, 15, 10, 6, 4]
TICKETS_PER_KIOSK_WEIGHTS = [40, 30, 15, 10, 5]  # 1/2/3/4/5 tickets
BETS_PER_TICKET_WEIGHTS = [35, 30, 18, 10, 5, 2]  # 1..6 bets


def random_bets(min_n: int = 1, max_n: int = 6) -> list[dict]:
    weights = BETS_PER_TICKET_WEIGHTS[: max_n - min_n + 1] or [1]
    n = random.choices(range(min_n, max_n + 1), weights=weights, k=1)[0]
    seen_keys = set()
    bets = []
    for _ in range(n):
        # Up to 4 retries to avoid duplicate (bet_type, target)
        for _ in range(4):
            t = random.choices(BET_TYPES, weights=BET_WEIGHTS, k=1)[0]
            target = BET_FACTORIES[t]()
            key = (t, target)
            if key not in seen_keys:
                seen_keys.add(key)
                break
        amount = random.choices(STAKE_CHOICES, weights=STAKE_WEIGHTS, k=1)[0]
        bets.append({"bet_type": t, "bet_target": target, "amount": amount})
    return bets


# --------------------------------------------------------------------------
# Roulette state polling (Redis via docker exec — host port not exposed)
# --------------------------------------------------------------------------

def read_state(container: str = REDIS_CONTAINER) -> Optional[dict]:
    try:
        out = subprocess.run(
            ["docker", "exec", container, "redis-cli", "get", "roulette:current_state"],
            capture_output=True, text=True, timeout=3,
        )
        raw = out.stdout.strip()
        return json.loads(raw) if raw else None
    except Exception:
        return None


async def wait_for_betting(container: str, timeout_s: int = 90) -> dict:
    """Block until phase == Betting. Returns the full state dict."""
    deadline = time.monotonic() + timeout_s
    last = None
    while time.monotonic() < deadline:
        st = read_state(container)
        if st:
            phase = st.get("phase")
            if phase != last:
                print(f"  [phase] {phase}")
                last = phase
            if phase == "Betting":
                return st
        await asyncio.sleep(0.4)
    raise RuntimeError("Timed out waiting for Betting phase")


def betting_seconds_remaining(state: dict) -> float:
    started = state.get("started_at", 0)
    duration = state.get("duration", 0)
    return max(0.0, started + duration - time.time())


# --------------------------------------------------------------------------
# Agent pool
# --------------------------------------------------------------------------

def mint_token(agent_id: str) -> str:
    return pyjwt.encode({"sub": agent_id}, JWT_SECRET, algorithm="HS256")


@dataclass
class CreatedTicket:
    short_code: str
    agent_id: str
    round_id: str
    total_wager: int
    bets: list[dict]
    created_at: str


@dataclass
class RoundSummary:
    round_id: str
    started_at: str
    kiosks_used: int
    attempts: int
    succeeded: int
    rejected_phase: int
    rejected_other: int
    errors: int
    tickets: list[CreatedTicket] = field(default_factory=list)


async def fetch_kiosks(base: str, pool_size_needed: int) -> list[str]:
    headers = {"X-API-Key": ADMIN_KEY}
    async with httpx.AsyncClient(base_url=base, timeout=30.0) as c:
        r = await c.get("/api/agents/", headers=headers)
        r.raise_for_status()
        loadtest = [a["id"] for a in r.json() if a.get("display_name", "").startswith("LoadTest")]
        all_ids = [a["id"] for a in r.json()]
    if len(loadtest) >= pool_size_needed:
        return loadtest
    print(f"  [warn] only {len(loadtest)} 'LoadTest' kiosks available; mixing with {len(all_ids) - len(loadtest)} other kiosks")
    return all_ids


# --------------------------------------------------------------------------
# Simulation core
# --------------------------------------------------------------------------

async def fire_ticket(
    client: httpx.AsyncClient,
    agent_id: str,
    round_id: str,
    summary: RoundSummary,
    output_dir: Path,
    save_lock: asyncio.Lock,
):
    bets = random_bets(min_n=1, max_n=6)
    total = sum(b["amount"] for b in bets)
    token = mint_token(agent_id)
    payload = {
        "agent_id": agent_id,
        "game_id": ROULETTE_GAME_ID,
        "round_id": round_id,
        "replay_rounds": 1,
        "bets": bets,
    }
    summary.attempts += 1
    try:
        r = await client.post(
            "/api/tickets/",
            headers={"Authorization": f"Bearer {token}"},
            json=payload,
            timeout=15.0,
        )
        if 200 <= r.status_code < 300:
            data = r.json()
            tk = CreatedTicket(
                short_code=data["short_code"],
                agent_id=agent_id,
                round_id=round_id,
                total_wager=total,
                bets=bets,
                created_at=dt.datetime.utcnow().isoformat() + "Z",
            )
            summary.succeeded += 1
            summary.tickets.append(tk)
            async with save_lock:
                with (output_dir / "tickets.jsonl").open("a") as f:
                    f.write(json.dumps(asdict(tk)) + "\n")
        elif r.status_code == 400:
            try:
                detail = r.json().get("detail", "")
            except Exception:
                detail = r.text
            if "Round" in detail or "fermée" in detail or "ferm" in detail:
                summary.rejected_phase += 1
            else:
                summary.rejected_other += 1
        else:
            summary.errors += 1
    except Exception as e:
        summary.errors += 1


async def kiosk_session(
    client: httpx.AsyncClient,
    agent_id: str,
    round_id: str,
    betting_remaining: float,
    summary: RoundSummary,
    tickets_min: int,
    tickets_max: int,
    output_dir: Path,
    save_lock: asyncio.Lock,
):
    """One kiosk fires N tickets, jittered across the betting window.

    For small ranges (1..5) we use the realistic weighted distribution.
    For larger ranges (e.g. 200..300 for stress tests) we just pick uniformly
    — the weights array is only meaningful for small counts.
    """
    range_size = tickets_max - tickets_min + 1
    if 0 < range_size <= len(TICKETS_PER_KIOSK_WEIGHTS):
        weights = TICKETS_PER_KIOSK_WEIGHTS[:range_size]
        n_tickets = random.choices(range(tickets_min, tickets_max + 1), weights=weights, k=1)[0]
    else:
        n_tickets = random.randint(tickets_min, tickets_max)
    # Spread evenly with random jitter; leave a 1s safety margin before BetsClosing
    safe_window = max(0.5, betting_remaining - 1.0)
    delays = sorted(random.uniform(0, safe_window) for _ in range(n_tickets))
    last = 0.0
    for d in delays:
        if d > last:
            await asyncio.sleep(d - last)
            last = d
        await fire_ticket(client, agent_id, round_id, summary, output_dir, save_lock)


async def simulate_round(
    client: httpx.AsyncClient,
    pool: list[str],
    kiosks_min: int,
    kiosks_max: int,
    tickets_min: int,
    tickets_max: int,
    output_dir: Path,
) -> RoundSummary:
    state = await wait_for_betting(REDIS_CONTAINER)
    round_id = state["round_id"]
    betting_remaining = betting_seconds_remaining(state)
    if betting_remaining < 2:
        print(f"  [skip] Betting almost over ({betting_remaining:.1f}s) — waiting next round")
        await asyncio.sleep(betting_remaining + 1)
        return await simulate_round(client, pool, kiosks_min, kiosks_max, tickets_min, tickets_max, output_dir)

    k = random.randint(kiosks_min, min(kiosks_max, len(pool)))
    chosen = random.sample(pool, k)
    summary = RoundSummary(
        round_id=round_id,
        started_at=dt.datetime.utcnow().isoformat() + "Z",
        kiosks_used=k,
        attempts=0, succeeded=0, rejected_phase=0, rejected_other=0, errors=0,
    )

    print(f"\n── ROUND {round_id} ──  kiosques actifs: {k}  fenêtre: {betting_remaining:.1f}s")
    save_lock = asyncio.Lock()
    tasks = [
        asyncio.create_task(kiosk_session(
            client, aid, round_id, betting_remaining, summary,
            tickets_min, tickets_max, output_dir, save_lock,
        ))
        for aid in chosen
    ]
    await asyncio.gather(*tasks, return_exceptions=True)

    duration = (time.time() - dt.datetime.fromisoformat(summary.started_at.rstrip("Z")).replace(tzinfo=dt.timezone.utc).timestamp())
    rate = summary.succeeded / max(duration, 0.01)
    print(
        f"  ✓ tickets créés : {summary.succeeded:>4}/{summary.attempts}  "
        f"rejets phase: {summary.rejected_phase}  errors: {summary.errors}  "
        f"~{rate:.1f} tickets/s pendant la fenêtre"
    )

    # Append round summary
    with (output_dir / "rounds.jsonl").open("a") as f:
        f.write(json.dumps({
            "round_id": round_id,
            "started_at": summary.started_at,
            "kiosks_used": summary.kiosks_used,
            "attempts": summary.attempts,
            "succeeded": summary.succeeded,
            "rejected_phase": summary.rejected_phase,
            "rejected_other": summary.rejected_other,
            "errors": summary.errors,
        }) + "\n")
    return summary


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--base", default=BASE)
    p.add_argument("--rounds", type=int, default=3, help="Number of Betting windows to simulate")
    p.add_argument("--kiosks-min", type=int, default=50)
    p.add_argument("--kiosks-max", type=int, default=200)
    p.add_argument("--tickets-per-kiosk-min", type=int, default=1)
    p.add_argument("--tickets-per-kiosk-max", type=int, default=5)
    p.add_argument("--output-dir", default=None, help="Directory for tickets.jsonl/rounds.jsonl (default: ./simulator-runs/<ts>)")
    return p.parse_args()


async def main():
    args = parse_args()
    out = Path(args.output_dir or f"./simulator-runs/{dt.datetime.now():%Y%m%d-%H%M%S}")
    out.mkdir(parents=True, exist_ok=True)

    print(f"Realistic casino simulator")
    print(f"  base       : {args.base}")
    print(f"  rounds     : {args.rounds}")
    print(f"  kiosks     : {args.kiosks_min}–{args.kiosks_max} per round")
    print(f"  tickets    : {args.tickets_per_kiosk_min}–{args.tickets_per_kiosk_max} per kiosk")
    print(f"  output dir : {out}")

    pool = await fetch_kiosks(args.base, args.kiosks_max)
    print(f"  kiosk pool : {len(pool)} agents")
    if len(pool) < args.kiosks_min:
        print(f"\nERROR: need at least {args.kiosks_min} kiosks. Run load_test_tickets.py first to seed the DB.")
        sys.exit(1)

    limits = httpx.Limits(max_connections=args.kiosks_max * 4, max_keepalive_connections=args.kiosks_max)
    totals = {"tickets": 0, "wager": 0, "kiosks_used_avg": 0.0}
    async with httpx.AsyncClient(base_url=args.base, limits=limits, timeout=30.0) as client:
        for i in range(args.rounds):
            print(f"\n══════════ ROUND {i + 1}/{args.rounds} ══════════")
            summary = await simulate_round(
                client, pool,
                args.kiosks_min, args.kiosks_max,
                args.tickets_per_kiosk_min, args.tickets_per_kiosk_max,
                out,
            )
            totals["tickets"] += summary.succeeded
            totals["wager"] += sum(t.total_wager for t in summary.tickets)
            totals["kiosks_used_avg"] += summary.kiosks_used / args.rounds

    print("\n" + "═" * 60)
    print(f"  TOTAL tickets créés  : {totals['tickets']}")
    print(f"  Mise totale agrégée  : {totals['wager']:,} XAF")
    print(f"  Kiosques actifs/rond : {totals['kiosks_used_avg']:.1f} en moyenne")
    print(f"  Détails              : {out / 'tickets.jsonl'}")
    print(f"  Résumé par round     : {out / 'rounds.jsonl'}")
    print("═" * 60)
    print(f"\n→ Ouvre le back-office (/transactions) pour voir les ventes")
    print(f"→ Pour décaisser : lis tickets.jsonl, GET /api/tickets/{{short_code}}, paye les WON")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[interrupted]")
