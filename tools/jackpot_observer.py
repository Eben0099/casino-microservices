"""Live WebSocket observer for the roulette engine — for prod or local.

Opens `/ws/roulette?kiosk_id=<CODE>` and prints every message the engine
broadcasts to that kiosk (welcome, phase_changed, stats_updated,
result_revealed, jackpot_updated, pong), so you can watch Unity's wire
protocol in clear text.

Optional: `--fire-tickets` makes the observer also create one realistic
ticket per Betting window on the same kiosk, so you can see the jackpot
counters tick up after each settlement.

Usage:
    # Just watch — production
    python3 tools/jackpot_observer.py \\
        --base http://casino-alb-155400631.eu-west-3.elb.amazonaws.com \\
        --kiosk-code AB12

    # Watch + fire 1 ticket per round (5 rounds)
    python3 tools/jackpot_observer.py \\
        --base http://casino-alb-155400631.eu-west-3.elb.amazonaws.com \\
        --kiosk-code AB12 --fire-tickets --rounds 5
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import os
import random
import sys
from urllib.parse import urlparse

import httpx
import jwt as pyjwt
import websockets

# Same default secrets as the rest of the simulator suite. Override via env
# for stricter environments — but in this repo they match docker-compose.yml
# and infrastructure/ecs.tf, so the defaults usually just work.
JWT_SECRET = "MonSuperSecretCasino2026!NePasPartager"
ADMIN_KEY = "CleSuperSecreteBackoffice2026"
ROULETTE_GAME_ID = "ROULETTE-TBL1"

# Lightweight realistic bet set — enough to vary the wager without depending
# on the heavy realistic_simulator module.
BET_TEMPLATES = [
    {"bet_type": "STRAIGHT", "targets": [str(n) for n in range(0, 37)], "stake": [500, 1000]},
    {"bet_type": "COLOR",    "targets": ["RED", "BLACK"],                "stake": [1000, 2000]},
    {"bet_type": "DOZEN",    "targets": ["1st", "2nd", "3rd"],           "stake": [1000, 2000]},
    {"bet_type": "EVEN_ODD", "targets": ["EVEN", "ODD"],                 "stake": [1000, 2000]},
    {"bet_type": "HALF",     "targets": ["1-18", "19-36"],               "stake": [1000, 2000]},
    {"bet_type": "SECTOR",   "targets": ["A", "B", "C", "D", "E", "F"], "stake": [500, 1500]},
]


def now() -> str:
    return dt.datetime.now().strftime("%H:%M:%S.%f")[:-3]


def ws_url_from_base(base: str, kiosk_code: str) -> str:
    """http://host -> ws://host/ws/roulette?kiosk_id=XX (https -> wss)."""
    u = urlparse(base)
    scheme = "wss" if u.scheme == "https" else "ws"
    return f"{scheme}://{u.netloc}/ws/roulette?kiosk_id={kiosk_code}"


def random_bets(n: int = 2) -> list[dict]:
    out = []
    for _ in range(n):
        t = random.choice(BET_TEMPLATES)
        out.append({
            "bet_type": t["bet_type"],
            "bet_target": random.choice(t["targets"]),
            "amount": random.choice(t["stake"]),
        })
    return out


async def resolve_agent_id(base: str, kiosk_code: str) -> str:
    async with httpx.AsyncClient(base_url=base, timeout=10.0) as c:
        r = await c.get(f"/api/agents/by-code/{kiosk_code}")
        if r.status_code == 404:
            print(f"[fatal] kiosk_code '{kiosk_code}' not found in agent-service")
            sys.exit(2)
        r.raise_for_status()
        return r.json()["agent_id"]


async def fire_one_ticket(base: str, agent_id: str, round_id: str, token: str | None = None) -> dict | None:
    bets = random_bets(n=random.randint(1, 3))
    # Use a server-issued token when provided (via $OBSERVER_TOKEN or --password
    # login). Falls back to local JWT signing when the script knows JWT_SECRET.
    if not token:
        token = pyjwt.encode({"sub": agent_id}, JWT_SECRET, algorithm="HS256")
    payload = {
        "agent_id": agent_id,
        "game_id": ROULETTE_GAME_ID,
        "round_id": round_id,
        "replay_rounds": 1,
        "bets": bets,
    }
    async with httpx.AsyncClient(base_url=base, timeout=15.0) as c:
        r = await c.post(
            "/api/tickets/",
            headers={"Authorization": f"Bearer {token}"},
            json=payload,
        )
        if 200 <= r.status_code < 300:
            data = r.json()
            total = sum(b["amount"] for b in bets)
            print(f"  [{now()}]  ticket fired: {data.get('short_code')}  wager={total:,} XAF  bets={len(bets)}")
            return data
        print(f"  [{now()}]  ticket REJECTED status={r.status_code}  body={r.text[:200]}")
        return None


def short_jackpots(j: dict | None) -> str:
    if not j:
        return "—"
    return " ".join(f"{k}={v:,}" for k, v in j.items())


async def observe(args):
    agent_id = None
    server_token = None
    if args.fire_tickets:
        agent_id = await resolve_agent_id(args.base, args.kiosk_code)
        # Prefer a server-issued token when available — works with prods whose
        # JWT_SECRET differs from the script's default.
        server_token = os.getenv("OBSERVER_TOKEN")
        if not server_token and args.password and args.phone:
            async with httpx.AsyncClient(base_url=args.base, timeout=10.0) as c:
                lr = await c.post("/api/agents/login", json={"phone": args.phone, "password": args.password})
                if lr.status_code == 200:
                    server_token = lr.json().get("access_token")
                    print(f"[setup]  login OK — using server-issued JWT")
                else:
                    print(f"[setup]  login FAILED status={lr.status_code} — falling back to local JWT signing")
        print(f"[setup]  fire-tickets enabled — agent_id={agent_id}  token={'server' if server_token else 'local-signed'}")

    url = ws_url_from_base(args.base, args.kiosk_code)
    print(f"[setup]  WS → {url}")
    print(f"[setup]  base → {args.base}")
    print(f"[setup]  kiosk → {args.kiosk_code}")
    print(f"[setup]  fire-tickets → {args.fire_tickets} (rounds={args.rounds}, tickets/round={args.tickets_per_round})")
    print("─" * 80)

    rounds_seen: set[str] = set()
    rounds_fired: set[str] = set()
    pots_last: dict | None = None
    jackpot_updates_post_fire = 0

    try:
        async with websockets.connect(url, ping_interval=20) as ws:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except Exception:
                    print(f"[{now()}] (non-json) {raw[:120]}")
                    continue
                t = msg.get("type")

                if t == "welcome":
                    pots_last = msg.get("jackpots")
                    print(f"[{now()}] WELCOME phase={msg.get('currentPhase')} round={msg.get('currentGameId')}")
                    print(f"            jackpots: {short_jackpots(pots_last)}")

                elif t == "phase_changed":
                    new_phase = msg.get("phase")
                    rid = msg.get("gameId") or msg.get("round_id") or ""
                    print(f"[{now()}] PHASE     → {new_phase:<12} round={rid}")
                    # Fire N tickets on the very first Betting we see (per round).
                    # We do it sequentially with a small delay so the requests
                    # don't all land on the same Postgres tx slot.
                    if (
                        args.fire_tickets
                        and new_phase == "Betting"
                        and rid
                        and rid not in rounds_fired
                        and len(rounds_fired) < args.rounds
                    ):
                        rounds_fired.add(rid)
                        for i in range(args.tickets_per_round):
                            await fire_one_ticket(args.base, agent_id, rid, token=server_token)
                            if i < args.tickets_per_round - 1:
                                await asyncio.sleep(0.3)

                elif t == "result_revealed":
                    rid = msg.get("gameId") or ""
                    rounds_seen.add(rid)
                    res = msg.get("result", {})
                    print(f"[{now()}] RESULT    number={res.get('number')} color={res.get('color')} round={rid}")

                elif t == "jackpot_updated":
                    new = msg.get("jackpots") or {}
                    # Diff with previous snapshot for readability
                    if pots_last:
                        deltas = []
                        for k, v in new.items():
                            d = int(v) - int(pots_last.get(k, 0))
                            if d:
                                deltas.append(f"{k} +{d:,}")
                        delta_str = ("  Δ " + ", ".join(deltas)) if deltas else "  (unchanged)"
                    else:
                        delta_str = ""
                    print(f"[{now()}] JACKPOTS  {short_jackpots(new)}{delta_str}")
                    pots_last = new
                    # Count jackpot updates that arrive after we started firing,
                    # so the exit condition can wait for the settlement broadcast
                    # rather than quitting on the bare result_revealed.
                    if rounds_fired:
                        jackpot_updates_post_fire += 1

                elif t == "stats_updated":
                    s = msg.get("stats") or {}
                    hist = s.get("history") or []
                    last_n = hist[0].get("number") if hist else "?"
                    print(f"[{now()}] STATS     last={last_n}  history_len={len(hist)}")

                elif t == "pong":
                    pass  # ignore keepalive

                else:
                    print(f"[{now()}] {t:<10} {json.dumps(msg)[:160]}")

                # Stop condition for --fire-tickets after N rounds finished.
                # The engine broadcasts jackpot_updated TWICE per round:
                #   1) from game_loop, before settlement → deltas all zero
                #   2) from consume_jackpot_events (Redis), after the ticket
                #      settlement → real deltas (what the operator wants to see)
                # So we wait for the 2nd broadcast before exiting.
                if (
                    args.fire_tickets
                    and len(rounds_seen) >= args.rounds
                    and rounds_fired
                    and rounds_seen >= rounds_fired
                    and jackpot_updates_post_fire >= 2 * len(rounds_fired)
                ):
                    print(f"\n[done]   observed {args.rounds} round(s) with fired tickets and settlement deltas, exiting.")
                    return
    except websockets.exceptions.InvalidStatusCode as e:
        print(f"\n[fatal] WS rejected by server: HTTP {e.status_code}")
        if e.status_code == 404:
            print("        — check the ALB rule for /ws/roulette*")
        sys.exit(3)
    except websockets.exceptions.ConnectionClosed as e:
        print(f"\n[exit] WS closed by server: code={e.code} reason={e.reason!r}")
        if e.code == 4404:
            print("        — the kiosk_id was rejected by the validator (kiosk_validator.is_valid_kiosk_code returned False).")
        sys.exit(0 if e.code == 1000 else 4)


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--base", required=True, help="http(s)://<alb-or-traefik-host>")
    p.add_argument("--kiosk-code", required=True, help="4-char kiosk code (e.g. AB12)")
    p.add_argument("--fire-tickets", action="store_true",
                   help="Also create 1 ticket per round on this kiosk to drive jackpot growth")
    p.add_argument("--rounds", type=int, default=3,
                   help="Number of rounds to observe before exit when --fire-tickets is set")
    p.add_argument("--tickets-per-round", type=int, default=1,
                   help="How many tickets to fire per Betting window (default 1)")
    p.add_argument("--phone", default=None,
                   help="Agent phone for /agents/login (use with --password if the prod JWT_SECRET differs from the script's default)")
    p.add_argument("--password", default=None,
                   help="Agent password for /agents/login")
    return p.parse_args()


if __name__ == "__main__":
    asyncio.run(observe(parse_args()))
