#!/usr/bin/env python3
"""Keno RTP / house-margin checker — pure math, no live stack.

Imports the PRODUCTION keno paytable from ticket-service (the same table
`calculate_keno_payout` uses) and reports, per spot count, the exact
hypergeometric return-to-player, the base house edge, and the NET house margin
after the jackpot slice is returned to players. Use after any paytable edit:

    python3 tools/keno_rtp_check.py
    python3 tools/keno_rtp_check.py --weights 0,0,0,1,1,2,2,2,1,3,1

Net margin = 1 - RTP(k) - jackpot_slice. Two slices are shown:
  1.5%  -> GLOBAL 1% + KENO game 0.5% (guaranteed, no kiosk needed)
  2.4%  -> + LOCAL bronze/silver/gold 0.9% (only when kiosk_code present)
"""
from __future__ import annotations

import argparse
import os
import sys
from fractions import Fraction
from math import comb

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "services", "ticket-service"))

from app.keno_rules import KENO_PAYTABLE  # noqa: E402  (production table)

POOL = 80
DRAWN = 20
SLICE_GUARANTEED = Fraction(15, 10)  # 1.5%
SLICE_WITH_LOCAL = Fraction(24, 10)  # 2.4%


def prob(k: int, m: int) -> Fraction:
    """Hypergeometric P(exactly m matches | k spots), 20 drawn from 80."""
    return Fraction(comb(k, m) * comb(POOL - k, DRAWN - m), comb(POOL, DRAWN))


def rtp(k: int) -> Fraction:
    row = KENO_PAYTABLE.get(k, {})
    return sum((prob(k, m) * Fraction(str(mult)) for m, mult in row.items()), Fraction(0))


def variance(k: int) -> Fraction:
    """Var of the per-unit return (drives per-round swing / CoV)."""
    row = KENO_PAYTABLE.get(k, {})
    mean = rtp(k)
    e_sq = sum((prob(k, m) * Fraction(str(mult)) ** 2 for m, mult in row.items()), Fraction(0))
    return e_sq - mean * mean


def top_prize(k: int) -> float:
    row = KENO_PAYTABLE.get(k, {})
    return max(row.values()) if row else 0


def analyse(weights: list[float] | None = None) -> dict:
    rows = []
    for k in range(1, 12):
        r = rtp(k)
        var = variance(k)
        cov = float(var) ** 0.5 / float(r) if r else 0.0
        rows.append({
            "spots": k,
            "rtp": float(r),
            "base_edge": float(1 - r),
            "net_15": float(1 - r - SLICE_GUARANTEED / 100),
            "net_24": float(1 - r - SLICE_WITH_LOCAL / 100),
            "top": top_prize(k),
            "cov": cov,
        })
    # Blended RTP over the spot-popularity distribution (default uniform).
    w = weights or [1] * 11
    tot = sum(w) or 1
    blended_rtp = sum(Fraction(w[k - 1]) * rtp(k) for k in range(1, 12)) / tot
    return {
        "rows": rows,
        "blended_rtp": float(blended_rtp),
        "blended_net_15": float(1 - blended_rtp - SLICE_GUARANTEED / 100),
        "blended_net_24": float(1 - blended_rtp - SLICE_WITH_LOCAL / 100),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--weights", help="11 comma-separated spot-popularity weights (k=1..11)")
    args = ap.parse_args()
    weights = None
    if args.weights:
        weights = [float(x) for x in args.weights.split(",")]
        if len(weights) != 11:
            ap.error("--weights needs exactly 11 values (spots 1..11)")

    a = analyse(weights)
    print(f"{'spots':>5} {'RTP':>8} {'base edge':>10} {'net@1.5%':>9} "
          f"{'net@2.4%':>9} {'top prize':>10} {'CoV':>9}")
    print("-" * 64)
    for r in a["rows"]:
        top = int(r["top"]) if float(r["top"]).is_integer() else r["top"]
        print(f"{r['spots']:>5} {r['rtp']*100:>7.2f}% {r['base_edge']*100:>9.2f}% "
              f"{r['net_15']*100:>8.2f}% {r['net_24']*100:>8.2f}% {top:>10} {r['cov']:>9.1f}")
    print("-" * 64)
    label = "blended (uniform)" if not weights else "blended (weighted)"
    print(f"{label}: RTP {a['blended_rtp']*100:.2f}%  "
          f"net margin {a['blended_net_15']*100:.2f}% @1.5%  "
          f"{a['blended_net_24']*100:.2f}% @2.4%")


if __name__ == "__main__":
    main()
