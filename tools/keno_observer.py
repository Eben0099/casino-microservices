"""Live WebSocket observer for the Keno (VOLKENO) engine — prod or local.

Opens `/ws/keno?kiosk_id=<CODE>` and pretty-prints every VOLKENO message the
engine broadcasts to that kiosk (welcome, phase_changed, draw_locked,
stats_updated, jackpot_updated, medals_updated, pong) with timestamps — so you
can watch the wire protocol of `docs/BACKEND.md` in clear text.

Mirrors `tools/jackpot_observer.py` (roulette) but speaks the VOLKENO protocol:
    - phases are idle / preLaunch / draw / results (betting window = `idle`)
    - the result is `draw_locked` carrying 20 unique numbers in [1..80]
    - jackpot is {generalAmount, volkenoAmount, currency, lastHitDrawId} (global)
    - medals  is {bronze, silver, gold} (per-kiosk counters)
    - clocks are epoch milliseconds

Optional: `--fire-tickets` makes the observer also create N realistic Keno
tickets during the `idle` (betting) window on the same kiosk, so you can watch
the jackpot counters tick up after each settlement (the `jackpot_updated` that
follows the `keno-jackpot-events` ROUND_SETTLED).

Usage:
    # Just watch — production / local
    python3 tools/keno_observer.py \\
        --base http://localhost \\
        --kiosk-code AB12

    # Watch + fire 3 Keno tickets per round (1 round), 10 spots each
    python3 tools/keno_observer.py \\
        --base http://localhost \\
        --kiosk-code AB12 --fire-tickets --rounds 1 --tickets-per-round 3 \\
        --phone +237600000000 --password secret --spots 10
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
# for stricter environments — but in this repo they match docker-compose.yml,
# so the defaults usually just work.
JWT_SECRET = "MonSuperSecretCasino2026!NePasPartager"
ADMIN_KEY = "CleSuperSecreteBackoffice2026"

# Keno game_id used by the cashier / ticket-service (plan §4.3).
KENO_GAME_ID = "KENO-DRAW1"

# Global jackpot contribution percentages (game-keno-service jackpot_service
# SEED_CONTRIBUTION_PCT). Only used to print the EXPECTED settlement delta so
# the operator can eyeball it against the observed jackpot_updated.
PCT_GENERAL = 0.003
PCT_VOLKENO = 0.002


def now() -> str:
    return dt.datetime.now().strftime("%H:%M:%S.%f")[:-3]


def ws_url_from_base(base: str, kiosk_code: str) -> str:
    """http://host -> ws://host/ws/keno?kiosk_id=XX (https -> wss)."""
    u = urlparse(base)
    scheme = "wss" if u.scheme == "https" else "ws"
    return f"{scheme}://{u.netloc}/ws/keno?kiosk_id={kiosk_code}"


def random_keno_target(spots: int) -> str:
    """Return a CSV of `spots` unique numbers from 1..80, sorted ascending.

    Mirrors the cashier (agent-web KenoGrid): bet_target is the sorted CSV of
    the player's picks. spots is clamped to [1, 10].
    """
    k = max(1, min(10, int(spots)))
    picks = sorted(random.sample(range(1, 81), k))
    return ",".join(str(n) for n in picks)


def random_bets(spots: int, n: int = 1) -> list[dict]:
    out = []
    for _ in range(n):
        out.append({
            "bet_type": "KENO",
            "bet_target": random_keno_target(spots),
            "amount": random.choice([100, 200, 500, 1000, 2000]),
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


async def fire_one_ticket(
    base: str, agent_id: str, round_id: str, spots: int, token: str | None = None
) -> dict | None:
    bets = random_bets(spots, n=1)
    # Use a server-issued token when provided (via $OBSERVER_TOKEN or --password
    # login). Falls back to local JWT signing when the script knows JWT_SECRET.
    if not token:
        token = pyjwt.encode({"sub": agent_id}, JWT_SECRET, algorithm="HS256")
    payload = {
        "agent_id": agent_id,
        "game_id": KENO_GAME_ID,
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
            picks = bets[0]["bet_target"]
            print(
                f"  [{now()}]  ticket fired: {data.get('short_code')}  "
                f"wager={total:,} XAF  picks=[{picks}]  round={round_id}"
            )
            return data
        print(f"  [{now()}]  ticket REJECTED status={r.status_code}  body={r.text[:200]}")
        return None


def short_jackpot(j: dict | None) -> str:
    if not j:
        return "—"
    parts = [
        f"general={int(j.get('generalAmount', 0)):,}",
        f"volkeno={int(j.get('volkenoAmount', 0)):,}",
    ]
    if j.get("lastHitDrawId") is not None:
        parts.append(f"lastHit={j.get('lastHitDrawId')}")
    return " ".join(parts)


def short_medals(m: dict | None) -> str:
    if not m:
        return "—"
    return " ".join(f"{k}={int(m.get(k, 0))}" for k in ("bronze", "silver", "gold"))


def jackpot_deltas(new: dict, prev: dict | None) -> str:
    """Human-readable Δ between two jackpot snapshots (general/volkeno)."""
    if not prev:
        return ""
    deltas = []
    for k, label in (("generalAmount", "general"), ("volkenoAmount", "volkeno")):
        d = int(new.get(k, 0)) - int(prev.get(k, 0))
        if d:
            deltas.append(f"{label} +{d:,}")
    return ("  Δ " + ", ".join(deltas)) if deltas else "  (unchanged)"


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
                lr = await c.post(
                    "/api/agents/login",
                    json={"phone": args.phone, "password": args.password},
                )
                if lr.status_code == 200:
                    server_token = lr.json().get("access_token")
                    print(f"[setup]  login OK — using server-issued JWT")
                else:
                    print(
                        f"[setup]  login FAILED status={lr.status_code} — "
                        f"falling back to local JWT signing"
                    )
        print(
            f"[setup]  fire-tickets enabled — agent_id={agent_id}  "
            f"token={'server' if server_token else 'local-signed'}"
        )

    url = ws_url_from_base(args.base, args.kiosk_code)
    print(f"[setup]  WS → {url}")
    print(f"[setup]  base → {args.base}")
    print(f"[setup]  kiosk → {args.kiosk_code}")
    print(
        f"[setup]  fire-tickets → {args.fire_tickets} "
        f"(rounds={args.rounds}, tickets/round={args.tickets_per_round}, spots={args.spots})"
    )
    print("─" * 80)

    rounds_seen: set[str] = set()      # draw_locked seen (a draw completed)
    rounds_fired: set[str] = set()     # idle rounds we fired tickets into
    jp_last: dict | None = None        # last jackpot snapshot for diffing
    jackpot_updates_post_fire = 0      # jackpot_updated count after we fired

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
                    jp_last = msg.get("jackpot")
                    print(
                        f"[{now()}] WELCOME   phase={msg.get('phase')} "
                        f"drawId={msg.get('currentDrawId')} "
                        f"durationMs={msg.get('phaseDurationMs')}"
                    )
                    print(f"            jackpot: {short_jackpot(jp_last)}")
                    print(f"            medals:  {short_medals(msg.get('medals'))}")
                    dn = msg.get("drawnNumbers")
                    if dn:
                        print(f"            drawnNumbers (reconnect): {dn}")

                elif t == "phase_changed":
                    new_phase = msg.get("phase")
                    rid = str(msg.get("drawId")) if msg.get("drawId") is not None else ""
                    started = msg.get("startedAt")
                    dur = msg.get("durationMs")
                    print(
                        f"[{now()}] PHASE     → {str(new_phase):<10} "
                        f"drawId={rid}  durationMs={dur}  startedAt={started}"
                    )
                    # Fire N tickets on the very first `idle` window we see per
                    # round (the only phase where bets are accepted, plan §2.1).
                    # Sequential with a small delay so the requests don't all
                    # land on the same Postgres tx slot.
                    if (
                        args.fire_tickets
                        and new_phase == "idle"
                        and rid
                        and rid not in rounds_fired
                        and len(rounds_fired) < args.rounds
                    ):
                        rounds_fired.add(rid)
                        for i in range(args.tickets_per_round):
                            await fire_one_ticket(
                                args.base, agent_id, rid, args.spots, token=server_token
                            )
                            if i < args.tickets_per_round - 1:
                                await asyncio.sleep(0.3)

                elif t == "draw_locked":
                    rid = str(msg.get("drawId")) if msg.get("drawId") is not None else ""
                    rounds_seen.add(rid)
                    nums = msg.get("numbers") or []
                    ok = (
                        len(nums) == 20
                        and len(set(nums)) == 20
                        and all(1 <= int(n) <= 80 for n in nums)
                    )
                    flag = "" if ok else "  [!] INVALID (expected 20 unique in 1..80)"
                    print(f"[{now()}] DRAW_LOCK drawId={rid}  numbers={nums}{flag}")

                elif t == "stats_updated":
                    s = msg.get("snapshot") or {}
                    recent = s.get("recentDraws") or []
                    last = recent[-1] if recent else None
                    last_id = last.get("id") if last else "?"
                    hot = s.get("hot") or []
                    hot_str = ",".join(str(h.get("n")) for h in hot[:3])
                    print(
                        f"[{now()}] STATS     recentDraws={len(recent)} "
                        f"latest=#{last_id}  hot=[{hot_str}]  "
                        f"rowDist={s.get('rowDistribution')}"
                    )

                elif t == "jackpot_updated":
                    new = msg.get("jackpot") or {}
                    delta_str = jackpot_deltas(new, jp_last)
                    print(f"[{now()}] JACKPOT   {short_jackpot(new)}{delta_str}")
                    jp_last = new
                    # Count jackpot updates that arrive after we started firing,
                    # so the exit condition can wait for the settlement broadcast
                    # rather than quitting on the bare draw_locked.
                    if rounds_fired:
                        jackpot_updates_post_fire += 1

                elif t == "medals_updated":
                    print(f"[{now()}] MEDALS    {short_medals(msg.get('medals'))}")

                elif t == "pong":
                    pass  # keepalive — ignore

                else:
                    print(f"[{now()}] {str(t):<10} {json.dumps(msg)[:160]}")

                # Stop condition for --fire-tickets after N rounds finished.
                # The engine broadcasts jackpot_updated TWICE per round:
                #   1) from game_loop on results entry (broadcast_jackpots),
                #      before the ticket settlement → deltas all zero
                #   2) from consume_jackpot_events (keno-jackpot-events), after
                #      ticket-service settles → real deltas (the operator's goal)
                # So we wait for the 2nd broadcast before exiting.
                if (
                    args.fire_tickets
                    and len(rounds_seen) >= args.rounds
                    and rounds_fired
                    and rounds_seen >= rounds_fired
                    and jackpot_updates_post_fire >= 2 * len(rounds_fired)
                ):
                    print(
                        f"\n[done]   observed {args.rounds} round(s) with fired "
                        f"tickets and settlement deltas, exiting."
                    )
                    return
    except websockets.exceptions.InvalidStatusCode as e:
        print(f"\n[fatal] WS rejected by server: HTTP {e.status_code}")
        if e.status_code == 403:
            print("        — the kiosk_id was rejected by the validator (BACKEND.md §auth).")
        elif e.status_code == 404:
            print("        — check the traefik/ALB rule for /ws/keno*")
        sys.exit(3)
    except websockets.exceptions.ConnectionClosed as e:
        print(f"\n[exit] WS closed by server: code={e.code} reason={e.reason!r}")
        if e.code in (1008, 4404):
            print("        — the kiosk_id was rejected by the validator (is_valid_kiosk_code=False).")
        sys.exit(0 if e.code == 1000 else 4)


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--base", required=True, help="http(s)://<traefik-or-alb-host>")
    p.add_argument("--kiosk-code", required=True, help="4-char kiosk code (e.g. AB12)")
    p.add_argument("--fire-tickets", action="store_true",
                   help="Also create Keno tickets per round during the idle window")
    p.add_argument("--rounds", type=int, default=3,
                   help="Rounds to observe before exit when --fire-tickets is set")
    p.add_argument("--tickets-per-round", type=int, default=1,
                   help="How many Keno tickets to fire per idle window (default 1)")
    p.add_argument("--spots", type=int, default=10,
                   help="Numbers picked per Keno ticket, 1..10 (default 10)")
    p.add_argument("--phone", default=None,
                   help="Agent phone for /api/agents/login (use with --password if "
                        "the prod JWT_SECRET differs from the script's default)")
    p.add_argument("--password", default=None,
                   help="Agent password for /api/agents/login")
    return p.parse_args()


if __name__ == "__main__":
    asyncio.run(observe(parse_args()))
