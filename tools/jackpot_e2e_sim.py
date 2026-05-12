"""End-to-end simulator for the jackpot engine.

Drives the real HTTP stack (Traefik -> agent-service + ticket-service) :
  1. provisions a fresh test cashier with a known PIN
  2. creates 3 pots (GLOBAL/GAME/LOCAL) tuned to trigger HITs reliably
  3. sells N tickets with random stakes and bets
  4. verifies for every pot :
         sum(contributions) == current_amount - initial_seed_carry + sum(payouts)
     => the pot has neither lost nor created money
  5. reports HIT count, total volume, total payout, jackpot RTP

Run :
    python3 tools/jackpot_e2e_sim.py
    python3 tools/jackpot_e2e_sim.py --tickets 1000

Requires the docker compose stack to be up (Traefik on localhost:80) and a
roulette round in `Betting` phase.
"""
from __future__ import annotations

import argparse
import random
import sys
import time
from dataclasses import dataclass, field
from typing import Optional

import httpx

BASE_URL = "http://localhost"
ADMIN_KEY = "CleSuperSecreteBackoffice2026"
ADMIN_HEADERS = {"x-api-key": ADMIN_KEY, "Content-Type": "application/json"}

# Pot configurations (lowered thresholds for fast HITs in simulation)
POTS = [
    # GLOBAL : PERCENT 1% of wager, threshold [5k ; 30k], SEED 1000
    {"scope": "GLOBAL", "contribution_mode": "PERCENT", "contribution_percent": "1.0",
     "threshold_min": 5000,  "threshold_max": 30000,   "reset_mode": "SEED",
     "seed_amount": 1000,    "winner_mode": "TRIGGER_TICKET"},
    # GAME ROULETTE-TBL1 BRONZE : PERCENT 0.5%, threshold [3k ; 12k]
    {"scope": "GAME",   "game_id": "ROULETTE-TBL1", "tier": "BRONZE",
     "contribution_mode": "PERCENT", "contribution_percent": "0.5",
     "threshold_min": 3000,  "threshold_max": 12000,   "reset_mode": "ZERO",
     "winner_mode": "TRIGGER_TICKET"},
    # LOCAL ROULETTE-TBL1 GOLD : FIXED 20, threshold [800 ; 3000]
    {"scope": "LOCAL",  "game_id": "ROULETTE-TBL1", "tier": "GOLD",
     "contribution_mode": "FIXED",   "contribution_fixed": 20,
     "threshold_min": 800,   "threshold_max": 3000,    "reset_mode": "ZERO",
     "winner_mode": "RANDOM_RECENT", "recent_window_minutes": 5},
]

STAKES = [100, 200, 500, 1000, 2000]
BET_TARGETS = [
    ("COLOR", "RED"), ("COLOR", "BLACK"),
    ("EVEN_ODD", "EVEN"), ("EVEN_ODD", "ODD"),
    ("HALF", "1-18"), ("HALF", "19-36"),
]


@dataclass
class PotStats:
    id: str
    label: str
    initial_amount: int = 0
    expected_total_contrib: int = 0          # somme des contributions versees ce run
    hits: int = 0
    total_payout: int = 0
    final_amount: int = 0
    # invariant : initial + contribs == final + payouts
    invariant_ok: bool = False
    delta: int = 0


def log(msg: str, level: str = "info") -> None:
    prefix = {"info": " ", "ok": "+", "warn": "!", "err": "X"}[level]
    print(f"[{prefix}] {msg}")


# ----------------------------------------------------------------------
# API helpers
# ----------------------------------------------------------------------

def admin_get(client: httpx.Client, path: str) -> dict:
    r = client.get(f"{BASE_URL}{path}", headers=ADMIN_HEADERS)
    r.raise_for_status()
    return r.json()


def admin_post(client: httpx.Client, path: str, body: dict) -> dict:
    r = client.post(f"{BASE_URL}{path}", headers=ADMIN_HEADERS, json=body)
    r.raise_for_status()
    return r.json()


def admin_patch(client: httpx.Client, path: str, body: dict) -> dict:
    r = client.patch(f"{BASE_URL}{path}", headers=ADMIN_HEADERS, json=body)
    r.raise_for_status()
    return r.json()


# ----------------------------------------------------------------------
# Setup
# ----------------------------------------------------------------------

def get_round_id(client: httpx.Client) -> Optional[str]:
    """Lit l'etat roulette via Redis (sortie commande exec). Fallback: tente une vente."""
    import subprocess
    out = subprocess.run(
        ["docker", "compose", "exec", "-T", "redis", "redis-cli", "GET", "roulette:current_state"],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        return None
    import json
    try:
        st = json.loads(out.stdout.strip())
        if st.get("phase") == "Betting":
            return st.get("round_id")
    except Exception:
        return None
    return None


def disable_all_pots(client: httpx.Client) -> int:
    """Desactive tous les pots existants pour isoler le run."""
    existing = admin_get(client, "/api/tickets/admin/jackpots")
    n = 0
    for p in existing:
        if p["enabled"]:
            admin_patch(client, f"/api/tickets/admin/jackpots/{p['id']}", {"enabled": False})
            n += 1
    return n


def setup_cashier(client: httpx.Client, suffix: str) -> tuple[dict, str]:
    phone = f"+237600{int(time.time()) % 1000000:06d}"
    log(f"Creation caissier test phone={phone}")
    agent = admin_post(client, "/api/agents/register", {
        "phone": phone,
        "display_name": f"Sim Cashier {suffix}",
        "password": "simtest",
        "kiosk_name": f"Sim Kiosk {suffix}",
        "role": "AGENT",
    })
    admin_post(client, f"/api/agents/{agent['id']}/provision", {
        "amount": 5_000_000, "description": "Bootstrap sim",
    })
    # Login JWT
    r = client.post(f"{BASE_URL}/api/agents/login",
                    headers={"Content-Type": "application/json"},
                    json={"phone": phone, "password": "simtest"})
    r.raise_for_status()
    token = r.json()["access_token"]
    log(f"Caissier id={agent['id'][:8]}... kiosk_code={agent['kiosk_code']}", "ok")
    return agent, token


def create_pots(client: httpx.Client, agent_id: str) -> list[dict]:
    out = []
    for cfg in POTS:
        body = dict(cfg)
        if body["scope"] == "LOCAL":
            body["kiosk_id"] = agent_id
        pot = admin_post(client, "/api/tickets/admin/jackpots", body)
        label = f"{pot['scope']}/{pot.get('tier') or '-'}/{pot.get('game_id') or '-'}"
        log(f"Pot cree {label} id={pot['id'][:8]}... seed={pot.get('seed_amount', 0)}", "ok")
        out.append(pot)
    return out


# ----------------------------------------------------------------------
# Drive
# ----------------------------------------------------------------------

def sell_ticket(client: httpx.Client, agent_id: str, token: str, round_id: str, stake: int, target: tuple[str, str]):
    bt, tgt = target
    r = client.post(f"{BASE_URL}/api/tickets/",
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                    json={
                        "agent_id": agent_id,
                        "game_id": "ROULETTE-TBL1",
                        "round_id": round_id,
                        "bets": [{"bet_type": bt, "bet_target": tgt, "amount": stake}],
                    })
    if r.status_code != 200:
        return None
    return r.json()


# ----------------------------------------------------------------------
# Audit
# ----------------------------------------------------------------------

def audit_pot(client: httpx.Client, pot_id: str) -> tuple[int, int, list[int]]:
    """Retourne (current_amount, sum_payouts, list_carryovers) via API admin."""
    pot = admin_get(client, f"/api/tickets/admin/jackpots/{pot_id}")
    wins = admin_get(client, f"/api/tickets/admin/jackpots/{pot_id}/wins?limit=500")
    sum_payouts = sum(w["payout_amount"] for w in wins)
    carryovers = [w["carryover"] for w in wins]
    return pot["current_amount"], sum_payouts, carryovers, pot.get("seed_amount", 0), pot.get("reset_mode", "ZERO")


# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tickets", type=int, default=500, help="Nombre de tickets a vendre")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    random.seed(args.seed)

    with httpx.Client(timeout=20.0) as client:
        # Round actif
        round_id = get_round_id(client)
        if not round_id:
            log("Aucun round Betting actif dans Redis — abandonne. Demarre la roulette d'abord.", "err")
            sys.exit(1)
        log(f"Round actif: {round_id}", "ok")

        # Isolation : on desactive tous les pots preexistants pour ne pas interferer
        n_disabled = disable_all_pots(client)
        if n_disabled:
            log(f"{n_disabled} pot(s) preexistant(s) desactive(s) pour isolation", "ok")

        # Setup
        suffix = str(int(time.time()))[-4:]
        agent, token = setup_cashier(client, suffix)
        pots = create_pots(client, agent["id"])

        # Snapshot initial
        stats_by_pot: dict[str, PotStats] = {}
        for p in pots:
            label = f"{p['scope']}/{p.get('tier') or '-'}/{p.get('game_id') or '-'}"
            stats_by_pot[p["id"]] = PotStats(id=p["id"], label=label, initial_amount=p["current_amount"])

        # Vente
        log(f"Vente de {args.tickets} tickets...")
        sold = 0
        wons = 0
        total_volume = 0
        total_payout_observed = 0
        t0 = time.time()
        for i in range(args.tickets):
            stake = random.choice(STAKES)
            target = random.choice(BET_TARGETS)
            t = sell_ticket(client, agent["id"], token, round_id, stake, target)
            if t is None:
                # round peut avoir change ; on retente une fois
                round_id = get_round_id(client) or round_id
                t = sell_ticket(client, agent["id"], token, round_id, stake, target)
                if t is None:
                    continue
            sold += 1
            total_volume += stake
            if t["status"] == "WON" and t["total_payout"] > 0:
                wons += 1
                total_payout_observed += t["total_payout"]
            if (i + 1) % 100 == 0:
                log(f"  {i+1}/{args.tickets}  HITs={wons}  volume={total_volume}")

        elapsed = time.time() - t0
        log(f"Vente terminee : {sold} OK / {args.tickets} demande, {wons} HITs, {elapsed:.1f}s", "ok")

        # Audit par pot
        print()
        log("=" * 70)
        log("AUDIT PAR POT")
        log("=" * 70)
        anomalies = 0
        for p in pots:
            st = stats_by_pot[p["id"]]
            final_amount, sum_payouts, carryovers, seed_amount, reset_mode = audit_pot(client, p["id"])
            st.hits = len(carryovers)
            st.total_payout = sum_payouts
            st.final_amount = final_amount

            # Invariant :
            # initial + contribs == final + (sum_payouts) + (seeds bloques par cycles repartis)
            # Soit on calcule les contribs via la formule attendue, soit on lit la table.
            # Plus simple : la conservation s'exprime par
            #   final_amount = sum_contribs - sum_payouts + initial_amount
            #                  + (nombre de cycles HIT) * seed_amount_si_SEED
            # On ne lit pas les contribs directement par API (pas exposees). On verifie
            # juste le sens : final >= 0 et coherence approximative.

            # Estimation des contribs : depend du mode
            # PERCENT : Σ stake_i × percent /100 (sum on eligible tickets)
            # FIXED : count(eligible) × fixed
            # Sur GLOBAL: tous tickets eligibles → sold; sur GAME et LOCAL: idem (meme jeu, meme kiosque)
            eligible = sold
            if p["contribution_mode"] == "PERCENT":
                # On approxime : volume total × percent / 100 (tous eligibles ici)
                pct = float(p["contribution_percent"])
                expected_contrib = int(total_volume * pct / 100)
            else:
                expected_contrib = eligible * int(p["contribution_fixed"])

            # Conservation : initial + expected_contrib == final + payouts + (seed re-pose au reset SEED)
            seed_redeposit = st.hits * (seed_amount if reset_mode == "SEED" else 0)
            balance = st.initial_amount + expected_contrib - (final_amount + sum_payouts + seed_redeposit)
            # Tolerance : PERCENT mode peut perdre jusqu'a 1 XAF par ticket sur int(),
            # FIXED mode est exact.
            tolerance = sold if p["contribution_mode"] == "PERCENT" else 0
            st.delta = balance
            st.invariant_ok = abs(balance) <= tolerance
            st.expected_total_contrib = expected_contrib

            status = "OK" if st.invariant_ok else "ANOMALIE"
            mark = "ok" if st.invariant_ok else "err"
            log(f"{st.label:<40}  hits={st.hits:>3}  contribs~{expected_contrib:>8}  final={final_amount:>8}  payouts={sum_payouts:>8}  delta={balance:>+5}  [{status}]", mark)
            if not st.invariant_ok:
                anomalies += 1

        # Rapport global
        print()
        log("=" * 70)
        log("RECAP GLOBAL")
        log("=" * 70)
        log(f"Tickets vendus      : {sold}")
        log(f"Volume total        : {total_volume:>10,} XAF")
        log(f"Total HITs          : {wons}")
        log(f"Payouts jackpots    : {total_payout_observed:>10,} XAF")
        if total_volume:
            jp_rtp = 100 * total_payout_observed / total_volume
            log(f"RTP jackpot        : {jp_rtp:.3f}% (mesure)")
        log(f"Anomalies invariant : {anomalies}", "err" if anomalies else "ok")

        if anomalies == 0:
            log("Conservation des pots validee. OK.", "ok")
            sys.exit(0)
        else:
            log("Des pots violent l'invariant — investiguer.", "err")
            sys.exit(2)


if __name__ == "__main__":
    main()
