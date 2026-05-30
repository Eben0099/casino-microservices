"""Jackpot demo driver — place KENO bets so jackpots/medals visibly grow and HIT.

Drives the live standalone stack so you can watch, end-to-end:
  - jackpots (general + VOLKENO) and medals (bronze/silver/gold) tick UP over time,
  - a jackpot HIT fire — triggering the VOLKENO display cinematic and the agent-web
    cashier overlay — then the pot amount DROP (reset) in the backoffice,
  all on the kiosk you point your display/cashier at.

Real thresholds are 5M–50M XAF (thousands of bets), so by default this script
TEMPORARILY lowers the keno-relevant pot thresholds via the admin API so hits
happen within minutes, staggered bronze → silver → gold → volkeno → general, then
RESTORES the originals on exit. Use --no-prime to bet at real thresholds.

Requires the STANDALONE / cyclic keno engine (the WS idle→draw→results loop); bets
are only accepted during the `idle` window. Dev/demo only — uses the admin key.

Usage:
    python3 tools/jackpot_demo.py --base http://localhost --kiosk-code HRS7

    # bigger stakes / more bets per round → faster growth; stop after 3 hits
    python3 tools/jackpot_demo.py --base http://localhost --kiosk-code HRS7 \\
        --stake 100000 --tickets-per-round 30 --hits 3

    # watch real (slow) growth without touching pot config
    python3 tools/jackpot_demo.py --base http://localhost --kiosk-code HRS7 --no-prime
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

# Same default secrets as the rest of the simulator suite (docker-compose.yml).
# Override via env for stricter environments.
JWT_SECRET = os.getenv("JWT_SECRET", "MonSuperSecretCasino2026!NePasPartager")
ADMIN_KEY = os.getenv("ADMIN_API_KEY", "CleSuperSecreteBackoffice2026")

KENO_GAME_ID = "KENO-DRAW1"

# Per-tier "rounds until hit" from the pot's CURRENT balance — staggers the hits
# so the operator sees medals fall first and the big general jackpot last.
DEFAULT_R_TIERS = {
    "bronze": 3,
    "silver": 5,
    "gold": 7,
    "volkeno": 6,   # GAME pot (KENO-DRAW1)
    "general": 9,   # GLOBAL pot
}


def now() -> str:
    return dt.datetime.now().strftime("%H:%M:%S.%f")[:-3]


def ws_url_from_base(base: str, kiosk_code: str) -> str:
    """http://host -> ws://host/ws/keno?kiosk_id=XX (https -> wss)."""
    u = urlparse(base)
    scheme = "wss" if u.scheme == "https" else "ws"
    return f"{scheme}://{u.netloc}/ws/keno?kiosk_id={kiosk_code}"


def random_keno_target(spots: int) -> str:
    """CSV of `spots` unique numbers from 1..80, sorted — mirrors the cashier."""
    k = max(1, min(10, int(spots)))
    return ",".join(str(n) for n in sorted(random.sample(range(1, 81), k)))


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
    return " ".join(f"{k}={int(m.get(k, 0)):,}" for k in ("bronze", "silver", "gold"))


def _deltas(new: dict, prev: dict | None, keys: list[tuple[str, str]]) -> str:
    if not prev:
        return ""
    out = []
    for k, label in keys:
        d = int(new.get(k, 0)) - int(prev.get(k, 0))
        if d:
            out.append(f"{label} {'+' if d > 0 else ''}{d:,}")
    return ("  Δ " + ", ".join(out)) if out else "  (unchanged)"


# ── HTTP helpers ────────────────────────────────────────────────────────────

async def resolve_agent_id(client: httpx.AsyncClient, kiosk_code: str) -> str:
    r = await client.get(f"/api/agents/by-code/{kiosk_code}")
    if r.status_code == 404:
        print(f"[fatal] kiosk_code '{kiosk_code}' not found in agent-service.\n"
              f"        Create an agent for this kiosk in the backoffice, or pass a "
              f"valid --kiosk-code.")
        sys.exit(2)
    r.raise_for_status()
    return r.json()["agent_id"]


async def get_token(client: httpx.AsyncClient, agent_id: str,
                    phone: str | None, password: str | None) -> str:
    """Prefer a server-issued token (prod JWT_SECRET may differ); else mint locally."""
    if password and phone:
        lr = await client.post("/api/agents/login", json={"phone": phone, "password": password})
        if lr.status_code == 200:
            print("[setup]  login OK — using server-issued JWT")
            return lr.json()["access_token"]
        print(f"[setup]  login FAILED ({lr.status_code}) — falling back to local JWT signing")
    return pyjwt.encode({"sub": agent_id}, JWT_SECRET, algorithm="HS256")


async def provision(client: httpx.AsyncClient, agent_id: str, amount: int) -> None:
    r = await client.post(
        f"/api/agents/{agent_id}/provision",
        headers={"x-api-key": ADMIN_KEY},
        json={"amount": amount, "description": "jackpot_demo top-up"},
    )
    if 200 <= r.status_code < 300:
        print(f"[setup]  provisioned +{amount:,} XAF (balance now "
              f"{int(r.json().get('new_balance', 0)):,})")
    else:
        print(f"[warn]   provision failed ({r.status_code}): {r.text[:160]}")


async def setup_agent(client: httpx.AsyncClient, *, phone: str, pin: str,
                      kiosk_code: str, kiosk_name: str = "Demo Kiosk") -> None:
    """Create the demo cashier with a CHOSEN kiosk_code (idempotent).

    Requires the agent-service custom-kiosk-code support. On a re-run the phone
    or code already exists (400/409) — we reuse it; resolve_agent_id confirms.
    """
    r = await client.post(
        "/api/agents/",
        headers={"x-api-key": ADMIN_KEY},
        json={
            "phone": phone,
            "display_name": kiosk_name,
            "password": pin,
            "kiosk_name": kiosk_name,
            "kiosk_code": kiosk_code,
        },
    )
    if 200 <= r.status_code < 300:
        code = r.json().get("kiosk_code", kiosk_code)
        print(f"[setup]  created cashier phone={phone} kiosk_code={code}")
    elif r.status_code in (400, 409):
        print(f"[setup]  cashier/kiosk already exists ({r.status_code}) — reusing it.")
    else:
        print(f"[warn]   setup failed ({r.status_code}): {r.text[:180]}")


async def fire_ticket(client: httpx.AsyncClient, token: str, agent_id: str,
                      round_id: str, stake: int, spots: int) -> tuple[bool, bool]:
    """Fire one KENO ticket. Returns (ok, insufficient_balance)."""
    bet_target = random_keno_target(spots)
    r = await client.post(
        "/api/tickets/",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "agent_id": agent_id,
            "game_id": KENO_GAME_ID,
            "round_id": round_id,
            "replay_rounds": 1,
            "bets": [{"bet_type": "KENO", "bet_target": bet_target, "amount": stake}],
        },
    )
    if 200 <= r.status_code < 300:
        return True, False
    body = r.text[:200]
    insufficient = r.status_code == 503 or "insuffis" in body.lower() or "solde" in body.lower()
    if not insufficient:
        print(f"  [{now()}]  ticket REJECTED status={r.status_code} body={body}")
    return False, insufficient


async def list_pots(client: httpx.AsyncClient) -> list[dict]:
    r = await client.get("/api/jackpots/admin/pots", headers={"x-api-key": ADMIN_KEY})
    r.raise_for_status()
    return r.json()


async def patch_pot(client: httpx.AsyncClient, pot_id: str, tmin: int, tmax: int) -> bool:
    r = await client.patch(
        f"/api/jackpots/admin/pots/{pot_id}",
        headers={"x-api-key": ADMIN_KEY},
        json={"threshold_min": int(tmin), "threshold_max": int(tmax)},
    )
    if 200 <= r.status_code < 300:
        return True
    print(f"[warn]   PATCH pot {pot_id} failed ({r.status_code}): {r.text[:160]}")
    return False


def select_keno_pots(pots: list[dict], kiosk_code: str) -> dict[str, dict]:
    """Map label -> pot for the pots a keno bet at this kiosk feeds."""
    kc = kiosk_code.upper()
    out: dict[str, dict] = {}
    for p in pots:
        scope, tier = p.get("scope"), (p.get("tier") or "")
        gid, pkc = p.get("game_id"), (p.get("kiosk_code") or "")
        if scope == "GLOBAL":
            out["general"] = p
        elif scope == "GAME" and gid == KENO_GAME_ID:
            out["volkeno"] = p
        elif scope == "LOCAL" and gid == KENO_GAME_ID and pkc.upper() == kc:
            if tier == "BRONZE":
                out["bronze"] = p
            elif tier == "SILVER":
                out["silver"] = p
            elif tier == "GOLD":
                out["gold"] = p
    return out


async def prime_thresholds(client: httpx.AsyncClient, kiosk_code: str,
                           wager_per_round: int, r_tiers: dict[str, int]) -> dict[str, dict]:
    """Lower thresholds so each pot hits in ~R_tier rounds from its CURRENT balance.

    Returns {pot_id: {threshold_min, threshold_max}} of the ORIGINAL values for restore.
    """
    pots = await list_pots(client)
    selected = select_keno_pots(pots, kiosk_code)
    if not selected:
        print("[warn]   no keno pots found to prime (is the kiosk's first bet settled?)")
        return {}

    saved: dict[str, dict] = {}
    print("[prime]  lowering thresholds (staggered hits from current balance):")
    for label, pot in selected.items():
        pct = float(pot.get("contribution_percent") or 0)
        growth = wager_per_round * pct / 100.0
        if growth <= 0:
            continue
        R = r_tiers.get(label, 6)
        target = int(pot["current_amount"]) + growth * R
        tmin = max(1, round(target * 0.85))
        tmax = max(tmin + 1, round(target * 1.05))
        saved[pot["id"]] = {
            "threshold_min": pot["threshold_min"],
            "threshold_max": pot["threshold_max"],
        }
        if await patch_pot(client, pot["id"], tmin, tmax):
            print(f"           {label:<8} cur={int(pot['current_amount']):>12,}  "
                  f"→ threshold ~{tmin:,}–{tmax:,}  (≈{R} rounds, {pct:g}%/bet)")
    return saved


async def restore_thresholds(client: httpx.AsyncClient, saved: dict[str, dict]) -> None:
    if not saved:
        return
    print(f"\n[restore] putting {len(saved)} pot threshold(s) back…")
    for pot_id, th in saved.items():
        ok = await patch_pot(client, pot_id, th["threshold_min"], th["threshold_max"])
        print(f"           {pot_id}  → {th['threshold_min']:,}–{th['threshold_max']:,}"
              f"{'' if ok else '  [FAILED]'}")


# ── Main drive loop ─────────────────────────────────────────────────────────

async def run(args) -> None:
    base = args.base.rstrip("/")
    wager_per_round = args.stake * args.tickets_per_round
    r_tiers = dict(DEFAULT_R_TIERS)

    async with httpx.AsyncClient(base_url=base, timeout=20.0) as client:
        if args.setup:
            if not (args.phone and args.pin):
                print("[fatal] --setup requires --phone and --pin")
                sys.exit(2)
            await setup_agent(client, phone=args.phone, pin=args.pin, kiosk_code=args.kiosk_code)
            print(f"[setup]  → log into the cashier (/agents/pos) with "
                  f"phone={args.phone}  pin={args.pin}")
            print(f"[setup]  → point the VOLKENO display at  ?kiosk_id={args.kiosk_code}")

        agent_id = await resolve_agent_id(client, args.kiosk_code)
        token = await get_token(client, agent_id, args.phone, args.pin or args.password)
        funded = args.fund
        await provision(client, agent_id, funded)

        print("─" * 84)
        print(f"[setup]  kiosk={args.kiosk_code}  agent={agent_id}")
        print(f"[setup]  stake={args.stake:,}  tickets/round={args.tickets_per_round}  "
              f"spots={args.spots}  wager/round={wager_per_round:,}")
        print(f"[setup]  prime={'on' if args.prime else 'off'}  "
              f"restore={'on' if args.restore else 'off'}  "
              f"stop_after_hits={args.hits or '∞'}")
        if args.prime:
            print("[setup]  NOTE: lowering the GLOBAL pot affects all games/kiosks for the "
                  "demo window (restored on exit).")
        print("─" * 84)

        saved: dict[str, dict] = {}
        primed = not args.prime         # if --no-prime, treat as already done
        fired_rounds: set[str] = set()
        bet_tasks: list = []            # background paced-betting tasks
        spent = 0
        jp_last: dict | None = None
        md_last: dict | None = None
        hits = 0

        async def ensure_funds(next_wager: int) -> None:
            nonlocal funded, spent
            if spent + next_wager > funded:
                await provision(client, agent_id, args.fund)
                funded += args.fund

        async def fire_batch(round_id: str, n: int, window_s: float) -> None:
            nonlocal spent
            # Spread the bets across the idle window so the pots climb
            # step-by-step for the whole phase instead of jumping once at the
            # start. Runs as a background task so the WS loop keeps printing
            # jackpot/medals deltas and catching hits while we bet.
            guard = 3.0  # headroom before preLaunch closes betting
            interval = max(args.bet_delay, max(0.0, window_s - guard) / max(1, n))
            ok_count = 0
            for i in range(n):
                await ensure_funds(args.stake)
                ok, low = await fire_ticket(client, token, agent_id, round_id, args.stake, args.spots)
                if low:  # balance ran out mid-batch — top up and retry once
                    await provision(client, agent_id, args.fund)
                    ok, low = await fire_ticket(client, token, agent_id, round_id, args.stake, args.spots)
                if ok:
                    ok_count += 1
                    spent += args.stake
                if i < n - 1:
                    await asyncio.sleep(interval)
            print(f"  [{now()}]  round {round_id}: fired {ok_count}/{n} tickets over "
                  f"~{window_s:.0f}s (every ~{interval:.1f}s, spent total {spent:,})")

        url = ws_url_from_base(base, args.kiosk_code)
        print(f"[setup]  WS → {url}\n")

        try:
            async with websockets.connect(url, ping_interval=20) as ws:
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except Exception:
                        continue
                    t = msg.get("type")

                    if t == "welcome":
                        jp_last = msg.get("jackpot")
                        md_last = msg.get("medals")
                        print(f"[{now()}] WELCOME  phase={msg.get('phase')} "
                              f"drawId={msg.get('currentDrawId')}")
                        print(f"           jackpot: {short_jackpot(jp_last)}")
                        print(f"           medals:  {short_medals(md_last)}")

                    elif t == "phase_changed" and msg.get("phase") == "idle":
                        rid = str(msg.get("drawId"))
                        if rid in fired_rounds:
                            continue
                        fired_rounds.add(rid)
                        window_s = float(msg.get("durationMs") or 0) / 1000.0
                        # First idle window: warm-up bet creates the kiosk's LOCAL
                        # pots, then prime thresholds (inline, ~1-2s) before the
                        # paced batch.
                        if not primed:
                            await ensure_funds(args.stake)
                            ok, _ = await fire_ticket(client, token, agent_id, rid,
                                                      args.stake, args.spots)
                            if ok:
                                spent += args.stake
                            saved = await prime_thresholds(client, args.kiosk_code,
                                                           wager_per_round, r_tiers)
                            primed = True
                        # Schedule the paced betting concurrently so this WS loop
                        # keeps printing growth + catching hits while it runs.
                        bet_tasks.append(
                            asyncio.create_task(
                                fire_batch(rid, args.tickets_per_round, window_s)
                            )
                        )

                    elif t == "jackpot_updated":
                        new = msg.get("jackpot") or {}
                        print(f"[{now()}] JACKPOT  {short_jackpot(new)}"
                              f"{_deltas(new, jp_last, [('generalAmount', 'general'), ('volkenoAmount', 'volkeno')])}")
                        jp_last = new

                    elif t == "medals_updated":
                        new = msg.get("medals") or {}
                        print(f"[{now()}] MEDALS   {short_medals(new)}"
                              f"{_deltas(new, md_last, [('bronze', 'bronze'), ('silver', 'silver'), ('gold', 'gold')])}")
                        md_last = new

                    elif t == "jackpot_hit":
                        hits += 1
                        scope = msg.get("scope")
                        tier = msg.get("tier")
                        amount = int(msg.get("amount", 0))
                        label = f"{scope}{'/' + tier if tier else ''}"
                        print("\n" + "🎉" * 28)
                        print(f"🎉  JACKPOT HIT  ({hits})  {label}  "
                              f"amount={amount:,} XAF  drawId={msg.get('drawId')}")
                        print(f"🎉  → watch the VOLKENO cinematic + cashier overlay; the pot "
                              f"amount now resets (drops) in the backoffice")
                        print("🎉" * 28 + "\n")
                        if args.hits and hits >= args.hits:
                            print(f"[done]   reached {hits} hit(s), exiting.")
                            return
        except websockets.exceptions.InvalidStatusCode as e:
            print(f"\n[fatal] WS rejected: HTTP {e.status_code} "
                  f"({'kiosk_id invalid' if e.status_code == 403 else 'check /ws/keno route'})")
            sys.exit(3)
        except (KeyboardInterrupt, asyncio.CancelledError):
            print("\n[exit]  interrupted")
        finally:
            # Stop any in-flight paced-betting tasks before the client closes.
            for tsk in bet_tasks:
                tsk.cancel()
            if args.restore and saved:
                try:
                    await restore_thresholds(client, saved)
                except Exception as e:
                    print(f"[warn]  threshold restore did not complete ({e}).\n"
                          f"        Thresholds may still be low — reset them in the "
                          f"backoffice Jackpots page, or re-run and exit cleanly.")


def parse_args():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base", required=True, help="http(s)://<traefik-host> (e.g. http://localhost)")
    p.add_argument("--kiosk-code", required=True,
                   help="kiosk code your display/cashier use (e.g. HRS7)")
    p.add_argument("--stake", type=int, default=50_000, help="XAF per ticket (default 50000)")
    p.add_argument("--tickets-per-round", type=int, default=20,
                   help="tickets fired per idle window (default 20)")
    p.add_argument("--spots", type=int, default=10, help="numbers per ticket, 1..10 (default 10)")
    p.add_argument("--bet-delay", type=float, default=0.15,
                   help="MIN seconds between bets (bets are otherwise paced across "
                        "the whole idle window; default 0.15)")
    p.add_argument("--setup", action="store_true",
                   help="create the cashier agent with the chosen --kiosk-code "
                        "(needs --phone and --pin); idempotent")
    p.add_argument("--pin", default=None,
                   help="cashier login PIN to set/use (with --setup, and for login)")
    p.add_argument("--fund", type=int, default=1_000_000_000,
                   help="XAF to provision the agent (auto-tops-up; default 1e9)")
    p.add_argument("--hits", type=int, default=0, help="stop after N jackpot hits (0 = run forever)")
    p.add_argument("--no-prime", dest="prime", action="store_false",
                   help="do NOT lower thresholds — watch real (slow) growth")
    p.add_argument("--no-restore", dest="restore", action="store_false",
                   help="do NOT restore thresholds on exit (leave them low)")
    p.add_argument("--phone", default=None, help="agent phone for /api/agents/login (optional)")
    p.add_argument("--password", default=None, help="agent password for /api/agents/login (optional)")
    p.set_defaults(prime=True, restore=True)
    return p.parse_args()


if __name__ == "__main__":
    try:
        asyncio.run(run(parse_args()))
    except KeyboardInterrupt:
        print("\n[exit]  interrupted")
