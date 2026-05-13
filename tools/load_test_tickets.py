"""
Burst load test for the ticket-creation pipeline.

Scenario: simulate N kiosks firing ticket creations in parallel during the
Betting window, and measure throughput, latency distribution, and error rates.

Usage:
    python tools/load_test_tickets.py --agents 100 --total 10000 --concurrency 200

The script:
  1. Bootstraps test agents via the admin API (idempotent — skips existing).
  2. Provisions each agent's cash register with enough balance.
  3. Mints JWT tokens directly using the shared secret (avoids login overhead
     and isolates the test from agent-service login throughput).
  4. Polls the current roulette round_id via Redis state (queried through the
     ticket-service's view of Redis — or alternatively, the agent-web exposes
     no read endpoint, so we read it via a side door: a single ticket creation
     attempt with a guess, then parse the error). For simplicity we expose a
     small helper: query the game-roulette-service WebSocket once.
  5. Releases an asyncio.Event to launch all requests at once.
  6. Reports stats.
"""

import argparse
import asyncio
import json
import os
import random
import statistics
import string
import sys
import time
from dataclasses import dataclass, field
from typing import Optional

import httpx
import jwt as pyjwt
import subprocess


DEFAULT_BASE = "http://localhost"
DEFAULT_REDIS_CONTAINER = "casino_redis"
JWT_SECRET = "MonSuperSecretCasino2026!NePasPartager"
ADMIN_KEY = "CleSuperSecreteBackoffice2026"
ALGORITHM = "HS256"
ROULETTE_GAME_ID = "11111111-1111-1111-1111-111111111111"


def mint_token(agent_id: str) -> str:
    return pyjwt.encode({"sub": agent_id}, JWT_SECRET, algorithm=ALGORITHM)


def random_phone(seed: int) -> str:
    return f"+237 6{seed:08d}"


@dataclass
class Result:
    ok: bool
    status: int
    latency_ms: float
    detail: str = ""


@dataclass
class Stats:
    results: list[Result] = field(default_factory=list)
    started_at: float = 0.0
    ended_at: float = 0.0

    def add(self, r: Result):
        self.results.append(r)

    def summary(self) -> str:
        n = len(self.results)
        if n == 0:
            return "no results"
        ok = sum(1 for r in self.results if r.ok)
        ko = n - ok
        lats_ok = sorted(r.latency_ms for r in self.results if r.ok)
        wall = max(self.ended_at - self.started_at, 1e-6)
        rps = n / wall
        by_status: dict[int, int] = {}
        by_detail: dict[str, int] = {}
        for r in self.results:
            by_status[r.status] = by_status.get(r.status, 0) + 1
            if not r.ok:
                key = (r.detail or "")[:80]
                by_detail[key] = by_detail.get(key, 0) + 1

        def pct(p):
            if not lats_ok:
                return float("nan")
            idx = min(len(lats_ok) - 1, int(p / 100 * len(lats_ok)))
            return lats_ok[idx]

        lines = [
            "=" * 70,
            f"  Total requests : {n}",
            f"  OK             : {ok} ({ok / n * 100:.1f}%)",
            f"  Errors         : {ko}",
            f"  Wall time      : {wall:.2f}s",
            f"  Throughput     : {rps:.1f} req/s",
            "  -- Latency (OK only) --",
            f"  min   : {(lats_ok[0] if lats_ok else 0):.0f} ms",
            f"  p50   : {pct(50):.0f} ms",
            f"  p90   : {pct(90):.0f} ms",
            f"  p95   : {pct(95):.0f} ms",
            f"  p99   : {pct(99):.0f} ms",
            f"  max   : {(lats_ok[-1] if lats_ok else 0):.0f} ms",
            "  -- Status codes --",
        ]
        for s, c in sorted(by_status.items()):
            lines.append(f"  {s}: {c}")
        if by_detail:
            lines.append("  -- Top error details --")
            for d, c in sorted(by_detail.items(), key=lambda x: -x[1])[:5]:
                lines.append(f"  ({c}x) {d}")
        lines.append("=" * 70)
        return "\n".join(lines)


def get_roulette_state(container: str) -> Optional[dict]:
    """Query roulette state via `docker exec redis-cli` since Redis isn't exposed on host."""
    try:
        out = subprocess.run(
            ["docker", "exec", container, "redis-cli", "get", "roulette:current_state"],
            capture_output=True, text=True, timeout=5,
        )
        raw = out.stdout.strip()
        if not raw:
            return None
        return json.loads(raw)
    except Exception:
        return None


async def wait_for_betting(container: str, timeout_s: int = 60) -> str:
    deadline = time.monotonic() + timeout_s
    last_phase = None
    while time.monotonic() < deadline:
        st = get_roulette_state(container)
        if st:
            phase = st.get("phase")
            if phase != last_phase:
                print(f"  [wait] phase = {phase}")
                last_phase = phase
            if phase == "Betting":
                return st.get("round_id")
        await asyncio.sleep(0.5)
    raise RuntimeError("Timed out waiting for Betting phase")


async def bootstrap_agents(base: str, n: int, balance: int) -> list[str]:
    """Idempotently create N test agents. Returns list of agent IDs."""
    agent_ids: list[str] = []
    headers = {"X-API-Key": ADMIN_KEY, "Content-Type": "application/json"}
    async with httpx.AsyncClient(base_url=base, timeout=30.0) as c:
        # Try to fetch existing list first
        try:
            r = await c.get("/api/agents/", headers=headers)
            if r.status_code == 200:
                existing = {a["phone"]: a["id"] for a in r.json()}
            else:
                existing = {}
        except Exception:
            existing = {}

        print(f"  [bootstrap] found {len(existing)} existing agents")
        for i in range(n):
            phone = random_phone(i)
            if phone in existing:
                agent_ids.append(existing[phone])
                continue
            payload = {
                "phone": phone,
                "display_name": f"LoadTest Kiosk {i:04d}",
                "password": "Lt-" + "".join(random.choices(string.ascii_letters, k=10)),
                "kiosk_name": f"LT-{i:04d}",
                "kiosk_location": "loadtest",
                "role": "AGENT",
            }
            r = await c.post("/api/agents/", headers=headers, json=payload)
            if r.status_code in (200, 201):
                agent_ids.append(r.json()["id"])
            elif r.status_code == 400:  # phone duplicate edge
                r2 = await c.get("/api/agents/", headers=headers)
                m = {a["phone"]: a["id"] for a in r2.json()}
                if phone in m:
                    agent_ids.append(m[phone])
            else:
                raise RuntimeError(f"Agent creation failed: {r.status_code} {r.text}")
            if (i + 1) % 50 == 0:
                print(f"  [bootstrap] {i + 1}/{n}")

        # Provision each agent
        print(f"  [provision] funding {len(agent_ids)} agents with {balance:,} XAF each")
        sem = asyncio.Semaphore(20)

        async def provision(aid: str):
            async with sem:
                try:
                    await c.post(
                        f"/api/agents/{aid}/provision",
                        headers=headers,
                        json={"amount": balance, "description": "loadtest funding"},
                    )
                except Exception as e:
                    print(f"  [provision] {aid} failed: {e}")

        await asyncio.gather(*(provision(a) for a in agent_ids))
    return agent_ids


def make_ticket_payload(agent_id: str, round_id: str, wager: int) -> dict:
    return {
        "agent_id": agent_id,
        "game_id": ROULETTE_GAME_ID,
        "round_id": round_id,
        "replay_rounds": 1,
        "bets": [
            {"bet_type": "COLOR", "bet_target": "RED", "amount": wager},
        ],
    }


async def fire_one(
    client: httpx.AsyncClient,
    agent_id: str,
    token: str,
    round_id: str,
    wager: int,
    stats: Stats,
):
    headers = {"Authorization": f"Bearer {token}"}
    payload = make_ticket_payload(agent_id, round_id, wager)
    t0 = time.monotonic()
    try:
        r = await client.post("/api/tickets/", headers=headers, json=payload, timeout=30.0)
        lat = (time.monotonic() - t0) * 1000
        ok = 200 <= r.status_code < 300
        detail = ""
        if not ok:
            try:
                detail = r.json().get("detail", "")[:200] if isinstance(r.json(), dict) else r.text[:200]
            except Exception:
                detail = r.text[:200]
        stats.add(Result(ok=ok, status=r.status_code, latency_ms=lat, detail=detail))
    except Exception as e:
        lat = (time.monotonic() - t0) * 1000
        stats.add(Result(ok=False, status=0, latency_ms=lat, detail=f"{type(e).__name__}: {e}"[:200]))


async def run_burst(base: str, agent_ids: list[str], total: int, concurrency: int, wager: int, round_id: str):
    tokens = {aid: mint_token(aid) for aid in agent_ids}
    stats = Stats()
    sem = asyncio.Semaphore(concurrency)
    barrier = asyncio.Event()

    limits = httpx.Limits(max_connections=concurrency * 2, max_keepalive_connections=concurrency)
    async with httpx.AsyncClient(base_url=base, limits=limits, timeout=30.0) as client:
        async def worker(idx: int):
            await barrier.wait()
            aid = agent_ids[idx % len(agent_ids)]
            async with sem:
                await fire_one(client, aid, tokens[aid], round_id, wager, stats)

        tasks = [asyncio.create_task(worker(i)) for i in range(total)]
        print(f"  [burst] starting {total} requests, concurrency={concurrency}")
        stats.started_at = time.monotonic()
        barrier.set()

        last_print = 0
        while True:
            done = sum(1 for t in tasks if t.done())
            if done >= total:
                break
            now = time.monotonic()
            if now - last_print > 2.0:
                elapsed = now - stats.started_at
                rate = done / max(elapsed, 1e-6)
                print(f"  [progress] {done}/{total} ({rate:.0f} req/s, t={elapsed:.1f}s)")
                last_print = now
            await asyncio.sleep(0.2)

        await asyncio.gather(*tasks, return_exceptions=True)
        stats.ended_at = time.monotonic()
    return stats


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--base", default=DEFAULT_BASE)
    p.add_argument("--redis-container", default=DEFAULT_REDIS_CONTAINER)
    p.add_argument("--agents", type=int, default=100, help="Number of distinct kiosks to simulate")
    p.add_argument("--total", type=int, default=2000, help="Total tickets to fire")
    p.add_argument("--concurrency", type=int, default=100, help="Max in-flight requests")
    p.add_argument("--wager", type=int, default=100, help="Wager per ticket (XAF)")
    p.add_argument("--balance", type=int, default=50_000_000, help="Balance to provision per agent")
    p.add_argument("--skip-bootstrap", action="store_true", help="Reuse existing LT- agents only")
    return p.parse_args()


async def main():
    args = parse_args()
    print("Burst load test for ticket creation")
    print(f"  base={args.base}  agents={args.agents}  total={args.total}  concurrency={args.concurrency}")
    print("\n[1/4] Waiting for Betting phase...")
    round_id = await wait_for_betting(args.redis_container)
    print(f"  active round_id = {round_id}")

    if not args.skip_bootstrap:
        print("\n[2/4] Bootstrapping agents...")
        agent_ids = await bootstrap_agents(args.base, args.agents, args.balance)
        print(f"  ready: {len(agent_ids)} agents")
    else:
        print("\n[2/4] Reusing existing agents...")
        headers = {"X-API-Key": ADMIN_KEY}
        async with httpx.AsyncClient(base_url=args.base, timeout=30.0) as c:
            r = await c.get("/api/agents/", headers=headers)
            agent_ids = [a["id"] for a in r.json() if a.get("display_name", "").startswith("LoadTest")][: args.agents]
        print(f"  reusing {len(agent_ids)} agents")
        if len(agent_ids) < args.agents:
            print("  WARNING: fewer agents than requested. Run without --skip-bootstrap first.")

    print("\n[3/4] Re-checking we are still in Betting phase...")
    round_id = await wait_for_betting(args.redis_container)
    print(f"  round_id confirmed = {round_id}")

    print("\n[4/4] Firing burst...")
    stats = await run_burst(args.base, agent_ids, args.total, args.concurrency, args.wager, round_id)

    print("\n" + stats.summary())


if __name__ == "__main__":
    asyncio.run(main())
