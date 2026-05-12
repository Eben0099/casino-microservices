#!/usr/bin/env python3
"""
Roulette profitability simulator.

Imports the actual `calculate_payout` from ticket-service so the simulation
exercises the SAME code that runs in production. Generates winning numbers
with the same HMAC-SHA256 -> mod 37 logic as the engine, plays multiple
player profiles over N rounds, and reports:

  - empirical RTP (return to player) per bet type
  - house GGR (gross gaming revenue) per profile
  - daily variance (95% confidence interval)
  - max drawdown over the run (worst losing streak for the house)
  - risk of ruin given an operating bankroll
  - verdict: profitable / not / under-bankrolled

Usage:
    python3 tools/profitability_sim.py
    python3 tools/profitability_sim.py --rounds 100000 --seed 42
    python3 tools/profitability_sim.py --rounds 1000 --bankroll 5000000 --json
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import math
import os
import random
import secrets
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Callable

# Import the production payout function.
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "services", "ticket-service"))
from app.rules import calculate_payout  # noqa: E402

RED = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}
BLACK = set(range(1, 37)) - RED


# ----------------------------------------------------------------------------
# Jackpot engine — replique la logique de services/ticket-service/app/jackpot/
# en pur Python pour la simulation. Les memes parametres (scope, modes, seuils)
# sont supportes pour pouvoir charger les configs de prod par export JSON.
# ----------------------------------------------------------------------------
@dataclass
class PotConfig:
    name: str                      # libelle lisible pour le rapport
    scope: str                     # GLOBAL | GAME | LOCAL
    game_id: str | None = None
    kiosk_id: str | None = None
    tier: str | None = None
    contribution_mode: str = "PERCENT"   # PERCENT | FIXED
    contribution_percent: float = 0.5
    contribution_fixed: int = 0
    threshold_min: int = 100_000
    threshold_max: int = 500_000
    reset_mode: str = "ZERO"             # ZERO | SEED
    seed_amount: int = 0
    winner_mode: str = "TRIGGER_TICKET"  # TRIGGER_TICKET | RANDOM_RECENT
    max_payout: int | None = None        # cap optionnel


@dataclass
class PotState:
    config: PotConfig
    current_amount: int = 0
    current_threshold: int = 0
    cycle_number: int = 1
    hits: int = 0
    total_contributed: int = 0
    total_paid: int = 0
    seeds_planted: int = 0   # somme des seeds remis au demarrage / a chaque reset SEED
    carryover_held: int = 0  # cumul des carryover (en pratique reintegre au pot, suivi info)


class JackpotEngine:
    """Simulation a peu de frais des pots : on ignore RANDOM_RECENT
    pour la simulation (le gagnant est toujours le ticket declencheur,
    car le payout total est identique a long terme — seul le bénéficiaire
    change, pas la masse redistribuee)."""

    def __init__(self, configs: list[PotConfig], rng: random.Random):
        self.rng = rng
        self.pots: list[PotState] = []
        for cfg in configs:
            initial = cfg.seed_amount if cfg.reset_mode == "SEED" else 0
            ps = PotState(
                config=cfg,
                current_amount=initial,
                current_threshold=self._draw(cfg),
                seeds_planted=initial,
            )
            self.pots.append(ps)

    def _draw(self, cfg: PotConfig) -> int:
        return self.rng.randint(cfg.threshold_min, cfg.threshold_max)

    def _eligible(self, ps: PotState, game_id: str, kiosk_id: str) -> bool:
        c = ps.config
        if c.scope == "GLOBAL":
            return True
        if c.scope == "GAME":
            return c.game_id == game_id
        if c.scope == "LOCAL":
            return c.game_id == game_id and c.kiosk_id == kiosk_id
        return False

    def _contribution(self, ps: PotState, ticket_wager: int) -> int:
        c = ps.config
        if c.contribution_mode == "FIXED":
            return int(c.contribution_fixed)
        return int(ticket_wager * c.contribution_percent / 100)

    def process_ticket(self, ticket_wager: int, game_id: str, kiosk_id: str) -> int:
        """Alimente tous les pots eligibles, retourne le payout jackpot pour ce ticket."""
        total_payout = 0
        for ps in self.pots:
            if not self._eligible(ps, game_id, kiosk_id):
                continue
            contrib = self._contribution(ps, ticket_wager)
            if contrib <= 0:
                continue
            ps.current_amount += contrib
            ps.total_contributed += contrib

            if ps.current_amount >= ps.current_threshold:
                # HIT
                payout = ps.current_amount
                if ps.config.max_payout is not None and ps.config.max_payout > 0:
                    payout = min(payout, ps.config.max_payout)
                carryover = ps.current_amount - payout

                ps.hits += 1
                ps.total_paid += payout
                ps.carryover_held += carryover
                total_payout += payout

                # Reset cycle
                base = ps.config.seed_amount if ps.config.reset_mode == "SEED" else 0
                ps.current_amount = base + carryover
                if ps.config.reset_mode == "SEED":
                    ps.seeds_planted += base
                ps.current_threshold = self._draw(ps.config)
                ps.cycle_number += 1

        return total_payout


# Configurations par defaut representatives d'un deploiement typique :
# - 1 Jackpot General reseau (Or unique)
# - 3 Jackpots Roulette (Bronze / Argent / Or)
# - 3 Jackpots Locaux (Bronze / Argent / Or) sur un kiosque "demo"
DEFAULT_JACKPOT_CONFIGS = [
    PotConfig("Global",               scope="GLOBAL",
              contribution_mode="PERCENT", contribution_percent=0.5,
              threshold_min=5_000_000, threshold_max=20_000_000,
              reset_mode="SEED", seed_amount=500_000),
    PotConfig("Roulette Jackpot",     scope="GAME", game_id="roulette", tier=None,
              contribution_mode="PERCENT", contribution_percent=0.4,
              threshold_min=2_000_000, threshold_max=10_000_000,
              reset_mode="SEED", seed_amount=200_000),
    PotConfig("Roulette Bronze",      scope="GAME", game_id="roulette", tier="BRONZE",
              contribution_mode="PERCENT", contribution_percent=0.3,
              threshold_min=50_000, threshold_max=200_000),
    PotConfig("Roulette Argent",      scope="GAME", game_id="roulette", tier="SILVER",
              contribution_mode="PERCENT", contribution_percent=0.3,
              threshold_min=200_000, threshold_max=1_000_000),
    PotConfig("Roulette Or",          scope="GAME", game_id="roulette", tier="GOLD",
              contribution_mode="PERCENT", contribution_percent=0.3,
              threshold_min=1_000_000, threshold_max=5_000_000),
    PotConfig("Local Demo Bronze",    scope="LOCAL", game_id="roulette", kiosk_id="demo", tier="BRONZE",
              contribution_mode="FIXED", contribution_fixed=50,
              threshold_min=20_000, threshold_max=80_000),
    PotConfig("Local Demo Argent",    scope="LOCAL", game_id="roulette", kiosk_id="demo", tier="SILVER",
              contribution_mode="FIXED", contribution_fixed=50,
              threshold_min=80_000, threshold_max=300_000),
    PotConfig("Local Demo Or",        scope="LOCAL", game_id="roulette", kiosk_id="demo", tier="GOLD",
              contribution_mode="FIXED", contribution_fixed=50,
              threshold_min=300_000, threshold_max=1_500_000),
]


# ----------------------------------------------------------------------------
# RNG — same algorithm as services/game-roulette-service/app/main.py
# ----------------------------------------------------------------------------
def spin(server_seed: str, nonce: str) -> int:
    h = hmac.new(server_seed.encode(), nonce.encode(), hashlib.sha256).hexdigest()
    return int(h[:8], 16) % 37


# ----------------------------------------------------------------------------
# Bet helpers — every helper returns (bet_type, bet_target) tuples
# ----------------------------------------------------------------------------
def straight(n: int) -> tuple[str, str]:
    return "STRAIGHT", str(n)


def split_(a: int, b: int) -> tuple[str, str]:
    return "SPLIT", f"{a},{b}"


def street(start: int) -> tuple[str, str]:
    return "STREET", f"{start},{start + 1},{start + 2}"


def corner(a: int) -> tuple[str, str]:
    return "CORNER", f"{a},{a + 1},{a + 3},{a + 4}"


def six_line(start: int) -> tuple[str, str]:
    nums = [str(start + i) for i in range(6)]
    return "SIX_LINE", ",".join(nums)


def column(idx: int) -> tuple[str, str]:
    return "COLUMN", f"Col{idx}"


def dozen(label: str) -> tuple[str, str]:
    return "DOZEN", label


def color(c: str) -> tuple[str, str]:
    return "COLOR", c


def even_odd(eo: str) -> tuple[str, str]:
    return "EVEN_ODD", eo


def half(h: str) -> tuple[str, str]:
    return "HALF", h


def sector(letter: str) -> tuple[str, str]:
    return "SECTOR", letter


def half_color(combo: str) -> tuple[str, str]:
    return "HALF_COLOR", combo  # LOW_RED | LOW_BLACK | HIGH_RED | HIGH_BLACK


# ----------------------------------------------------------------------------
# Player profiles
# Each profile is a function: (rng) -> list[(bet_type, bet_target, stake)]
# ----------------------------------------------------------------------------
@dataclass
class Profile:
    name: str
    description: str
    weight: float  # share of total round volume
    build_bets: Callable[[random.Random], list[tuple[str, str, int]]]


def casual_player(rng: random.Random) -> list[tuple[str, str, int]]:
    """Plays mostly outside bets, modest stakes (500-3000 XAF)."""
    bets: list[tuple[str, str, int]] = []
    n_bets = rng.randint(1, 3)
    for _ in range(n_bets):
        stake = rng.choice([500, 1000, 1500, 2000, 3000])
        choice = rng.random()
        if choice < 0.45:
            t, tgt = color(rng.choice(["RED", "BLACK"]))
        elif choice < 0.70:
            t, tgt = even_odd(rng.choice(["EVEN", "ODD"]))
        elif choice < 0.85:
            t, tgt = half(rng.choice(["1-18", "19-36"]))
        elif choice < 0.95:
            t, tgt = dozen(rng.choice(["1st", "2nd", "3rd"]))
        else:
            t, tgt = straight(rng.randint(0, 36))
        bets.append((t, tgt, stake))
    return bets


def aggressive_player(rng: random.Random) -> list[tuple[str, str, int]]:
    """Mix inside/outside, higher stakes (2000-15000)."""
    bets: list[tuple[str, str, int]] = []
    n_bets = rng.randint(3, 8)
    for _ in range(n_bets):
        stake = rng.choice([2000, 5000, 10000, 15000])
        choice = rng.random()
        if choice < 0.25:
            t, tgt = straight(rng.randint(0, 36))
        elif choice < 0.40:
            a = rng.randint(1, 35)
            t, tgt = split_(a, a + 1)
        elif choice < 0.50:
            t, tgt = street(rng.choice([1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34]))
        elif choice < 0.55:
            t, tgt = sector(rng.choice(["A", "B", "C", "D", "E", "F"]))
        elif choice < 0.65:
            t, tgt = half_color(rng.choice(["LOW_RED", "LOW_BLACK", "HIGH_RED", "HIGH_BLACK"]))
        elif choice < 0.70:
            t, tgt = column(rng.choice([1, 2, 3]))
        elif choice < 0.85:
            t, tgt = dozen(rng.choice(["1st", "2nd", "3rd"]))
        else:
            t, tgt = color(rng.choice(["RED", "BLACK"]))
        bets.append((t, tgt, stake))
    return bets


def whale_straight(rng: random.Random) -> list[tuple[str, str, int]]:
    """Whale putting big STRAIGHT bets only — high variance test."""
    bets = []
    for _ in range(rng.randint(1, 5)):
        bets.append((*straight(rng.randint(0, 36)), 50_000))
    return bets


def cover_all(rng: random.Random) -> list[tuple[str, str, int]]:
    """
    Pathological case: player buys 37 STRAIGHT bets covering the whole table.
    Always wins exactly 36x his stake, paid 37x → guaranteed loss of 1 stake/round.
    Worth simulating to confirm there is no exploit.
    """
    return [(*straight(n), 1000) for n in range(37)]


def martingale_red(rng: random.Random, state: dict) -> list[tuple[str, str, int]]:
    """Doubles stake on RED after every loss, resets on win. Capped at 16x base."""
    base = 1000
    cap = 16
    losses = state.get("losses", 0)
    mult = min(2 ** losses, cap)
    return [(*color("RED"), base * mult)]


PROFILES: list[Profile] = [
    Profile("casual", "Joueur prudent, paris extérieurs, mises faibles", 0.55, casual_player),
    Profile("aggressive", "Joueur multi-bets mixte, mises moyennes-hautes", 0.30, aggressive_player),
    Profile("whale_straight", "Whale paris pleins uniquement", 0.10, whale_straight),
    Profile("cover_all", "Joueur couvrant les 37 numéros (test exploit)", 0.05, cover_all),
]


# ----------------------------------------------------------------------------
# Theoretical RTP per bet type (for sanity check)
# ----------------------------------------------------------------------------
THEORETICAL_RTP = {
    "STRAIGHT": 36 / 37,
    "SPLIT": 36 / 37,
    "STREET": 36 / 37,
    "CORNER": 36 / 37,
    "SIX_LINE": 36 / 37,
    # SECTOR : 6 numbers per sector x 6 sectors = 36 numbers covered, 0 is outside.
    # P(win) = 6/37, payout x6 -> 36/37 = 97.30%, same edge as the rest of the table.
    "SECTOR": 36 / 37,
    # HALF_COLOR : intersection HALF ∩ COLOR = 9 numbers, payout x4 -> 36/37.
    "HALF_COLOR": 36 / 37,
    "COLUMN": 36 / 37,
    "DOZEN": 36 / 37,
    "COLOR": 36 / 37,
    "EVEN_ODD": 36 / 37,
    "HALF": 36 / 37,
}


# ----------------------------------------------------------------------------
# Simulation engine
# ----------------------------------------------------------------------------
@dataclass
class Stats:
    rounds: int = 0
    wagered: int = 0
    paid_out: int = 0  # total winnings credited (already includes stake-back)
    wagered_by_type: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    paid_by_type: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    wagered_by_profile: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    paid_by_profile: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    pnl_history: list[int] = field(default_factory=list)  # cumulative GGR per round
    biggest_round_win_for_player: int = 0
    biggest_round_loss_for_player: int = 0
    # Jackpot
    jackpot_engine: "JackpotEngine | None" = None
    jackpot_paid_total: int = 0  # somme des payouts jackpots verses aux joueurs


def run_simulation(
    rounds: int,
    seed: int | None,
    martingale_count: int = 5,
    jackpot_configs: list[PotConfig] | None = None,
) -> Stats:
    rng = random.Random(seed)
    server_seed = secrets.token_hex(32) if seed is None else f"seed-{seed}"
    stats = Stats()
    if jackpot_configs:
        stats.jackpot_engine = JackpotEngine(jackpot_configs, rng)
    martingale_states = [{"losses": 0} for _ in range(martingale_count)]

    cum_ggr = 0
    for r in range(rounds):
        nonce = f"round-{r}"
        winning = spin(server_seed, nonce)

        # Pick profile by weight (one "table seat" per round can have several real players,
        # but we abstract: weight ~= probability of that profile contributing this round).
        round_bets: list[tuple[str, str, int, str]] = []  # +profile name

        # Standard profiles
        for p in PROFILES:
            if rng.random() < p.weight:
                for t, tgt, stk in p.build_bets(rng):
                    round_bets.append((t, tgt, stk, p.name))

        # Martingale players each round
        for i in range(martingale_count):
            for t, tgt, stk in martingale_red(rng, martingale_states[i]):
                round_bets.append((t, tgt, stk, "martingale"))

        if not round_bets:
            # No-one played this round. Skip but still count.
            stats.rounds += 1
            stats.pnl_history.append(cum_ggr)
            continue

        round_wager = 0
        round_payout = 0
        tickets_wager: dict[str, int] = defaultdict(int)  # profile -> total wager (pour jackpot)
        for bet_type, target, stake, profile in round_bets:
            payout = calculate_payout(bet_type, target, stake, str(winning))
            stats.wagered += stake
            stats.paid_out += payout
            stats.wagered_by_type[bet_type] += stake
            stats.paid_by_type[bet_type] += payout
            stats.wagered_by_profile[profile] += stake
            stats.paid_by_profile[profile] += payout
            round_wager += stake
            round_payout += payout
            tickets_wager[profile] += stake

        # Hook jackpot : chaque "ticket" (= ensemble de paris d'un profile dans le round)
        # alimente les pots eligibles. Le payout jackpot s'ajoute au paye joueur.
        if stats.jackpot_engine and tickets_wager:
            for profile, total_wager in tickets_wager.items():
                jp_payout = stats.jackpot_engine.process_ticket(total_wager, "roulette", "demo")
                if jp_payout > 0:
                    stats.jackpot_paid_total += jp_payout
                    stats.paid_by_profile[profile] += jp_payout
                    round_payout += jp_payout

        # Update martingale state by re-walking the list in the same order
        m_idx = 0
        for bet_type, target, stake, profile in round_bets:
            if profile == "martingale":
                payout = calculate_payout(bet_type, target, stake, str(winning))
                if payout > 0:
                    martingale_states[m_idx]["losses"] = 0
                else:
                    martingale_states[m_idx]["losses"] += 1
                m_idx += 1

        # round_payout inclut deja les jackpots si actifs
        round_ggr = round_wager - round_payout
        cum_ggr += round_ggr
        stats.rounds += 1
        stats.pnl_history.append(cum_ggr)

        # Track player extremes (negative round_ggr = player won this round)
        player_pnl = -round_ggr
        if player_pnl > stats.biggest_round_win_for_player:
            stats.biggest_round_win_for_player = player_pnl
        if player_pnl < stats.biggest_round_loss_for_player:
            stats.biggest_round_loss_for_player = player_pnl

    return stats


# ----------------------------------------------------------------------------
# Reporting
# ----------------------------------------------------------------------------
def max_drawdown(pnl_series: list[int]) -> tuple[int, int, int]:
    """Returns (max_drawdown_value, peak_index, trough_index)."""
    peak = pnl_series[0] if pnl_series else 0
    peak_idx = 0
    max_dd = 0
    dd_peak_idx = 0
    dd_trough_idx = 0
    for i, v in enumerate(pnl_series):
        if v > peak:
            peak = v
            peak_idx = i
        dd = v - peak
        if dd < max_dd:
            max_dd = dd
            dd_peak_idx = peak_idx
            dd_trough_idx = i
    return max_dd, dd_peak_idx, dd_trough_idx


def daily_variance(pnl_series: list[int], rounds_per_day: int = 1000) -> dict:
    """Splits the series into days and computes mean/std of daily GGR."""
    if len(pnl_series) < 2 * rounds_per_day:
        return {"days": 0, "mean": 0.0, "std": 0.0, "min": 0, "max": 0}
    daily = []
    prev = 0
    for i in range(rounds_per_day, len(pnl_series), rounds_per_day):
        ggr = pnl_series[i] - pnl_series[i - rounds_per_day]
        daily.append(ggr)
        prev = pnl_series[i]
    if not daily:
        return {"days": 0, "mean": 0.0, "std": 0.0, "min": 0, "max": 0}
    mean = sum(daily) / len(daily)
    var = sum((d - mean) ** 2 for d in daily) / len(daily)
    std = math.sqrt(var)
    return {
        "days": len(daily),
        "mean": mean,
        "std": std,
        "min": min(daily),
        "max": max(daily),
        "ci95_low": mean - 1.96 * std,
        "ci95_high": mean + 1.96 * std,
    }


def fmt(n: int | float) -> str:
    return f"{n:,.0f}".replace(",", " ")


def print_report(stats: Stats, bankroll: int, rounds_per_day: int):
    rtp_overall = stats.paid_out / stats.wagered if stats.wagered else 0
    edge = 1 - rtp_overall
    ggr = stats.wagered - stats.paid_out

    print("=" * 78)
    print("RAPPORT DE RENTABILITÉ — ROULETTE EUROPÉENNE (Spin & Win)")
    print("=" * 78)
    print()
    print(f"Rounds simulés       : {fmt(stats.rounds)}")
    print(f"Mises totales        : {fmt(stats.wagered)} XAF")
    print(f"Payouts totaux       : {fmt(stats.paid_out)} XAF")
    print(f"GGR (revenu casino)  : {fmt(ggr)} XAF")
    print(f"RTP empirique        : {rtp_overall * 100:.3f}%   (théorique 97.297%)")
    print(f"House edge empirique : {edge * 100:.3f}%   (théorique 2.703%)")
    print()

    # Section jackpot (si actif)
    if stats.jackpot_engine:
        print("--- Impact JACKPOTS sur le RTP ---")
        jp_paid = stats.jackpot_paid_total
        jp_rtp = jp_paid / stats.wagered if stats.wagered else 0
        total_rtp = rtp_overall + jp_rtp
        total_edge = 1 - total_rtp
        total_ggr = stats.wagered - stats.paid_out - jp_paid

        sum_contrib = sum(p.total_contributed for p in stats.jackpot_engine.pots)
        sum_residual = sum(p.current_amount for p in stats.jackpot_engine.pots)
        sum_seeds = sum(p.seeds_planted for p in stats.jackpot_engine.pots)
        sum_hits = sum(p.hits for p in stats.jackpot_engine.pots)

        print(f"Pots configures      : {len(stats.jackpot_engine.pots)}")
        print(f"HITs total           : {sum_hits}")
        print(f"Contributions totales: {fmt(sum_contrib)} XAF")
        print(f"Payouts jackpots     : {fmt(jp_paid)} XAF")
        print(f"Résiduel dans pots   : {fmt(sum_residual)} XAF  (capital encore en jeu)")
        print(f"Seeds plantés (coût) : {fmt(sum_seeds)} XAF  (financés par la maison, hors mises)")
        # Invariant : seeds + contribs == paid + residual
        invariant_delta = sum_seeds + sum_contrib - jp_paid - sum_residual
        print(f"Invariant conservation: delta = {invariant_delta:+}  (doit etre proche de 0)")
        print()
        print(f"RTP jackpot          : +{jp_rtp * 100:.3f}%   (additionnel sur le RTP joueur)")
        print(f"RTP total joueur     : {total_rtp * 100:.3f}%   (roulette + jackpot)")
        print(f"House edge effectif  : {total_edge * 100:.3f}%   (apres financement jackpots)")
        print(f"GGR net casino       : {fmt(total_ggr)} XAF  (vs {fmt(ggr)} XAF sans jackpots)")
        print(f"Cout des jackpots    : {fmt(ggr - total_ggr)} XAF  ({(ggr - total_ggr) / max(ggr, 1) * 100:.1f}% du GGR roulette)")
        print()

        print("--- Détail par pot ---")
        print(f"{'Pot':<24}{'HITs':>6}{'Contrib':>14}{'Payouts':>14}{'Résiduel':>14}{'RTP/pot':>10}")
        for p in stats.jackpot_engine.pots:
            pot_rtp = (p.total_paid / p.total_contributed * 100) if p.total_contributed else 0
            print(f"  {p.config.name:<22}{p.hits:>6}{fmt(p.total_contributed):>14}{fmt(p.total_paid):>14}{fmt(p.current_amount):>14}{pot_rtp:>9.2f}%")
        print()
    print("--- RTP par type de pari (vérification du code de payout) ---")
    rows = []
    for t in [
        "STRAIGHT", "SPLIT", "STREET", "CORNER", "SIX_LINE",
        "SECTOR", "HALF_COLOR", "COLUMN", "DOZEN", "COLOR", "EVEN_ODD", "HALF",
    ]:
        w = stats.wagered_by_type.get(t, 0)
        p = stats.paid_by_type.get(t, 0)
        rtp = p / w if w else 0
        theo = THEORETICAL_RTP[t]
        delta = (rtp - theo) * 100
        flag = "OK" if abs(delta) < 1.5 else "ATTENTION" if abs(delta) < 5 else "ANOMALIE"
        rows.append((t, w, p, rtp, theo, delta, flag))
    print(f"{'Type':<10}{'Volume':>16}{'Payouts':>16}{'RTP':>9}{'Théo':>9}{'Δ (pp)':>10}  Statut")
    for t, w, p, rtp, theo, d, f in rows:
        if w == 0:
            print(f"{t:<10}{fmt(w):>16}{fmt(p):>16}{'n/a':>9}{theo*100:>8.2f}%{'—':>10}  no volume")
        else:
            print(f"{t:<10}{fmt(w):>16}{fmt(p):>16}{rtp*100:>8.3f}%{theo*100:>8.2f}%{d:>+9.3f}  {f}")
    print()
    print("--- GGR par profil ---")
    for prof, w in stats.wagered_by_profile.items():
        p = stats.paid_by_profile[prof]
        rtp = p / w if w else 0
        margin = w - p
        print(f"  {prof:<18} mise={fmt(w):>14}  payé={fmt(p):>14}  GGR={fmt(margin):>14}  RTP={rtp*100:.2f}%")
    print()

    # Daily variance
    dv = daily_variance(stats.pnl_history, rounds_per_day=rounds_per_day)
    if dv["days"] > 0:
        print(f"--- Variance journalière ({rounds_per_day} rounds = ~1 journée à 60s/round) ---")
        print(f"  Jours simulés   : {dv['days']}")
        print(f"  GGR moyen/jour  : {fmt(dv['mean'])} XAF")
        print(f"  Écart-type      : {fmt(dv['std'])} XAF")
        print(f"  Pire journée    : {fmt(dv['min'])} XAF")
        print(f"  Meilleure       : {fmt(dv['max'])} XAF")
        print(f"  IC 95%          : [{fmt(dv['ci95_low'])} ; {fmt(dv['ci95_high'])}]")
        print()

    # Max drawdown
    if stats.pnl_history:
        dd, peak_i, trough_i = max_drawdown(stats.pnl_history)
        print("--- Drawdown maximum ---")
        print(f"  Pire perte cumulée pour le casino : {fmt(dd)} XAF")
        print(f"  Survenue entre round {peak_i} et round {trough_i} ({trough_i - peak_i} rounds)")
        if dd < 0:
            print(f"  Bankroll cashier conseillé pour absorber 99% des cas : {fmt(abs(dd) * 3)} XAF")
        print()

    # Verdict
    print("=" * 78)
    print("VERDICT")
    print("=" * 78)
    profitable = ggr > 0
    rtp_ok = abs(rtp_overall - 36 / 37) < 0.005
    if profitable and rtp_ok:
        print("✓ Le jeu est RENTABLE et la house edge est conforme à la roulette européenne.")
    elif profitable:
        print("△ Rentable, mais la RTP empirique s'écarte de la théorie. Vérifier la distribution.")
    else:
        print("✗ NON rentable sur cette simulation — investigation requise (bug payout ou variance).")
    print()

    # Bankroll check
    if bankroll > 0 and stats.pnl_history:
        dd, _, _ = max_drawdown(stats.pnl_history)
        if abs(dd) > bankroll:
            print(f"⚠ ALERTE BANKROLL : drawdown observé ({fmt(abs(dd))}) > bankroll cashier ({fmt(bankroll)}).")
            print("  → Risque de rupture de caisse. Augmenter le bankroll ou abaisser les max bets.")
        else:
            ratio = bankroll / max(abs(dd), 1)
            print(f"✓ Bankroll OK : ratio bankroll/drawdown = {ratio:.1f}x")
    print()

    # Recommendations
    print("RECOMMANDATIONS")
    print("-" * 78)
    recos = build_recommendations(stats, bankroll)
    for i, r in enumerate(recos, 1):
        print(f"{i}. {r}")


def build_recommendations(stats: Stats, bankroll: int) -> list[str]:
    recos: list[str] = []

    # 1. Min/max bet limits — none visible in the code
    recos.append(
        "Ajouter des LIMITES MIN/MAX par type de pari et par table. Aujourd'hui aucune borne "
        "n'est imposée côté backend — un STRAIGHT à 10M XAF est techniquement possible. "
        "Suggéré : MIN=500 XAF, MAX_STRAIGHT=50 000 XAF, MAX_OUTSIDE=500 000 XAF, MAX_TOTAL_TABLE=2 000 000 XAF par round."
    )

    # 2. Bankroll provisioning
    if stats.pnl_history:
        dd, _, _ = max_drawdown(stats.pnl_history)
        rec_bankroll = abs(dd) * 3
        recos.append(
            f"Provisionner un BANKROLL CASHIER d'au moins {fmt(rec_bankroll)} XAF "
            f"(3× le pire drawdown observé sur cette simulation). À ajuster selon volume réel."
        )

    # 3. Stop-loss / circuit breaker
    recos.append(
        "Implémenter un CIRCUIT BREAKER : si le ratio payouts/wagers d'une session dépasse 130% "
        "sur une fenêtre glissante (ex. 100 rounds), bloquer temporairement les mises STRAIGHT "
        "ou alerter l'opérateur. Évite l'exploitation d'un éventuel défaut RNG."
    )

    # 4. Bet type RTP audit
    anomalies = []
    for t, theo in THEORETICAL_RTP.items():
        w = stats.wagered_by_type.get(t, 0)
        p = stats.paid_by_type.get(t, 0)
        if w > 0:
            rtp = p / w
            if abs(rtp - theo) > 0.05:
                anomalies.append(t)
    if anomalies:
        recos.append(
            f"ANOMALIE RTP DÉTECTÉE sur : {', '.join(anomalies)}. Vérifier `calculate_payout` "
            "dans services/ticket-service/app/rules.py — un multiplicateur incorrect peut "
            "transformer le jeu en perte garantie pour l'opérateur."
        )
    else:
        recos.append(
            "RTP code-vérifiée : tous les types de paris convergent vers 97.30% comme attendu. "
            "Aucune correction de payout nécessaire."
        )

    # 5. Hot/cold disclosure
    recos.append(
        "ATTENTION UX : la page stats du backoffice expose 'numéros chauds/froids'. "
        "Ce doit rester un outil d'analyse INTERNE — ne pas le diffuser aux joueurs sous peine "
        "d'induire des biais (gambler's fallacy) et amplifier la variance via des stratégies "
        "calquées sur ces stats. Aucune incidence mathématique sur la RTP, mais impact comportemental."
    )

    # 6. Anti-collusion / table coverage
    recos.append(
        "Détecter les patterns de COUVERTURE TOTALE (joueur misant sur >32 numéros uniques "
        "STRAIGHT en simultané). Bien que mathématiquement défavorable au joueur (-1/37 par round), "
        "ce pattern indique souvent du blanchiment ou un test d'exploit. Logger et alerter."
    )

    # 7. Provably fair publication
    recos.append(
        "Publier le seed_hash AVANT le début de la phase betting et révéler le server_seed APRÈS "
        "result_revealed (déjà prévu dans le contrat d'intégration v1, §10). Cela protège "
        "juridiquement l'opérateur en cas de contestation."
    )

    return recos


# ----------------------------------------------------------------------------
# Entry point
# ----------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Simulateur de rentabilité — Roulette EU")
    parser.add_argument("--rounds", type=int, default=100_000, help="Nombre de rounds à simuler")
    parser.add_argument("--seed", type=int, default=None, help="Seed déterministe (optionnel)")
    parser.add_argument("--bankroll", type=int, default=10_000_000, help="Bankroll cashier en XAF")
    parser.add_argument("--rounds-per-day", type=int, default=1000, help="Rounds par journée d'exploitation")
    parser.add_argument("--martingale", type=int, default=3, help="Nombre de joueurs martingale RED simultanés")
    parser.add_argument("--with-jackpots", action="store_true", help="Active la simulation des pots jackpot par-dessus la roulette")
    parser.add_argument("--json", action="store_true", help="Sortie JSON pour CI")
    args = parser.parse_args()

    jackpot_configs = DEFAULT_JACKPOT_CONFIGS if args.with_jackpots else None
    label = " + jackpots" if jackpot_configs else ""
    print(f"Simulation en cours : {fmt(args.rounds)} rounds{label}...")
    stats = run_simulation(args.rounds, args.seed,
                           martingale_count=args.martingale,
                           jackpot_configs=jackpot_configs)

    if args.json:
        rtp = stats.paid_out / stats.wagered if stats.wagered else 0
        ggr = stats.wagered - stats.paid_out
        dd, _, _ = max_drawdown(stats.pnl_history) if stats.pnl_history else (0, 0, 0)
        out = {
            "rounds": stats.rounds,
            "wagered": stats.wagered,
            "paid_out": stats.paid_out,
            "ggr": ggr,
            "rtp": rtp,
            "house_edge": 1 - rtp,
            "max_drawdown": dd,
            "by_type": {
                t: {
                    "wagered": stats.wagered_by_type.get(t, 0),
                    "paid": stats.paid_by_type.get(t, 0),
                    "rtp": (stats.paid_by_type.get(t, 0) / stats.wagered_by_type[t]) if stats.wagered_by_type.get(t) else None,
                }
                for t in THEORETICAL_RTP
            },
            "verdict": "profitable" if ggr > 0 and abs(rtp - 36 / 37) < 0.005 else "review_required",
        }
        print(json.dumps(out, indent=2))
    else:
        print_report(stats, args.bankroll, args.rounds_per_day)


if __name__ == "__main__":
    main()
