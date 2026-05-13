"""
Companion to realistic_simulator.py — settles the WON tickets it produced.

Reads a tickets.jsonl file emitted by the simulator, polls each ticket's status
until the round is fully settled, then attempts to cash out every WON ticket
exactly as a cashier would (POST /api/tickets/{short_code}/payout with a
cashier JWT).

Usage:
    python tools/cashout_tester.py simulator-runs/20260513-125216/tickets.jsonl
"""

import argparse
import asyncio
import json
import sys
import time
from collections import Counter
from pathlib import Path

import httpx
import jwt as pyjwt


BASE = "http://localhost"
JWT_SECRET = "MonSuperSecretCasino2026!NePasPartager"


def mint_token(agent_id: str) -> str:
    return pyjwt.encode({"sub": agent_id}, JWT_SECRET, algorithm="HS256")


async def fetch_status(client: httpx.AsyncClient, short_code: str, agent_id: str) -> dict:
    token = mint_token(agent_id)
    r = await client.get(
        f"/api/tickets/{short_code}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10.0,
    )
    r.raise_for_status()
    return r.json()


async def payout(client: httpx.AsyncClient, short_code: str, agent_id: str) -> tuple[int, str]:
    token = mint_token(agent_id)
    r = await client.post(
        f"/api/tickets/{short_code}/payout",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15.0,
    )
    return r.status_code, r.text[:200]


async def wait_until_settled(client: httpx.AsyncClient, samples: list[dict], timeout_s: int = 120):
    """Poll up to a few sample tickets until none are PENDING anymore."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        statuses = []
        for tk in samples[:5]:
            try:
                data = await fetch_status(client, tk["short_code"], tk["agent_id"])
                statuses.append(data["status"])
            except Exception:
                pass
        if statuses and not any(s == "PENDING" for s in statuses):
            return
        print(f"  [wait-settle] sample statuses: {statuses}")
        await asyncio.sleep(3)
    print("  [warn] timed out waiting for settlement — proceeding anyway")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tickets_file", help="Path to tickets.jsonl produced by realistic_simulator.py")
    ap.add_argument("--base", default=BASE)
    ap.add_argument("--concurrency", type=int, default=20)
    ap.add_argument("--dry-run", action="store_true", help="Only check statuses; do not cash out")
    args = ap.parse_args()

    path = Path(args.tickets_file)
    if not path.exists():
        print(f"ERROR: {path} not found")
        sys.exit(1)

    tickets = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    print(f"Loaded {len(tickets)} tickets from {path}")

    async with httpx.AsyncClient(base_url=args.base, timeout=30.0) as client:
        print("\n[1/3] Waiting for round settlement...")
        await wait_until_settled(client, tickets, timeout_s=180)

        print("\n[2/3] Fetching final status of every ticket...")
        statuses: dict[str, str] = {}
        payouts: dict[str, int] = {}
        sem = asyncio.Semaphore(args.concurrency)

        async def fetch(tk):
            async with sem:
                try:
                    data = await fetch_status(client, tk["short_code"], tk["agent_id"])
                    statuses[tk["short_code"]] = data["status"]
                    payouts[tk["short_code"]] = data.get("total_payout", 0)
                except Exception as e:
                    statuses[tk["short_code"]] = f"ERR:{type(e).__name__}"

        await asyncio.gather(*(fetch(t) for t in tickets))

        c = Counter(statuses.values())
        print(f"  status distribution: {dict(c)}")
        total_pending_payout = sum(p for sc, p in payouts.items() if statuses.get(sc) == "WON")
        print(f"  total pending payout (WON): {total_pending_payout:,} XAF")

        if args.dry_run:
            print("\n[dry-run] skipping payout step")
            return

        won_tickets = [t for t in tickets if statuses.get(t["short_code"]) == "WON"]
        print(f"\n[3/3] Cashing out {len(won_tickets)} WON tickets...")
        payout_results: Counter = Counter()
        payout_amount = 0

        async def cash(tk):
            nonlocal payout_amount
            async with sem:
                code, body = await payout(client, tk["short_code"], tk["agent_id"])
                payout_results[code] += 1
                if 200 <= code < 300:
                    payout_amount += payouts.get(tk["short_code"], 0)
                elif code != 400:  # 400 likely "already paid" — informational
                    print(f"  [{code}] {tk['short_code']}: {body[:100]}")

        t0 = time.monotonic()
        await asyncio.gather(*(cash(t) for t in won_tickets))
        elapsed = time.monotonic() - t0
        rate = len(won_tickets) / max(elapsed, 0.01)

        print("\n" + "═" * 60)
        print(f"  Cashout HTTP codes : {dict(payout_results)}")
        print(f"  Successful payouts : {payout_results[200]:>4}/{len(won_tickets)}")
        print(f"  Total cashed out   : {payout_amount:,} XAF")
        print(f"  Elapsed            : {elapsed:.1f}s ({rate:.1f} payouts/s)")
        print("═" * 60)


if __name__ == "__main__":
    asyncio.run(main())
