#!/usr/bin/env python3
"""Keno paytable generator — retune every spot-count to a uniform target RTP.

The casino's NET house margin target is 30%. Jackpot contributions (GLOBAL 1% +
KENO game 0.5% = 1.5% guaranteed) are deferred player return, so the BASE
paytable must target:

    base RTP = (1 - 0.30) - JACKPOT_DEFERRAL_PCT/100 = 0.70 - 0.015 = 0.685

Every spot count k = 1..11 is tuned to the SAME base RTP so no spot-count is
exploitable (today spot-10 returns 84% — a rational player just picks 10).

Method (per row):
  - Keep the existing prize-curve SHAPE (which match tiers pay, their relative
    ratios). For k >= 5 keep the aspirational TOP prize fixed (the jackpot hook)
    and scale the remaining tiers to absorb the difference; for k <= 4 scale the
    whole row. Multipliers are rounded magnitude-aware (big rare prizes to whole
    numbers, small frequent ones to 2 decimals — real keno uses fractional
    low-spot multipliers; integer-only cannot hit 0.685 for k=1).

This is a constrained fit, not unique — the SHAPES below are the operator's
product knobs. After any edit, verify with:  python tools/keno_rtp_check.py

Usage:
  python tools/keno_paytable.py            # report current vs retuned RTP
  python tools/keno_paytable.py --emit-python   # KENO_PAYTABLE dict literal
  python tools/keno_paytable.py --emit-js       # KenoGrid.jsx array literal
"""

from __future__ import annotations

import argparse
from decimal import Decimal, ROUND_HALF_UP
from fractions import Fraction
from math import comb

# ── Game constants ──────────────────────────────────────────────────────────
POOL = 80          # numbers in the pool
DRAWN = 20         # numbers drawn per round
NET_MARGIN_TARGET = Fraction(30, 100)
JACKPOT_DEFERRAL_PCT = Fraction(15, 10)   # 1.5% guaranteed (GLOBAL 1% + KENO 0.5%)
TARGET_RTP = (1 - NET_MARGIN_TARGET) - JACKPOT_DEFERRAL_PCT / 100  # 0.685

# ── Prize-curve shapes (operator product knobs) ─────────────────────────────
# The current "official VOLK" multipliers, used as relative shape. The solver
# rescales them to the target RTP; only the ratios between tiers and which tiers
# pay are meaningful here.
SHAPES: dict[int, dict[int, float]] = {
    1:  {1: 3},
    2:  {1: 1, 2: 5},
    3:  {2: 3, 3: 25},
    4:  {2: 1, 3: 4, 4: 100},
    5:  {3: 2, 4: 20, 5: 450},
    6:  {3: 1, 4: 7, 5: 50, 6: 1600},
    7:  {3: 1, 4: 3, 5: 20, 6: 100, 7: 5000},
    8:  {4: 2, 5: 10, 6: 50, 7: 1000, 8: 15000},
    9:  {4: 1, 5: 5, 6: 25, 7: 200, 8: 4000, 9: 40000},
    10: {0: 2, 4: 1, 5: 2, 6: 20, 7: 80, 8: 500, 9: 10000, 10: 100000},
    11: {0: 2, 5: 1, 6: 10, 7: 50, 8: 250, 9: 1500, 10: 15000, 11: 500000},
}

# Aspirational top prizes kept exactly (the jackpot hook). Only where the full
# match is rare enough that fixing it barely moves RTP (k >= 5).
TOP_FIXED = {k: SHAPES[k][k] for k in range(5, 12)}


def prob(k: int, m: int) -> Fraction:
    """Hypergeometric P(exactly m matches | k spots), 20 drawn from 80."""
    return Fraction(comb(k, m) * comb(POOL - k, DRAWN - m), comb(POOL, DRAWN))


def rtp_of_row(k: int, row: dict[int, float]) -> Fraction:
    """Exact expected return for a k-spot bet given its multiplier row."""
    return sum((prob(k, m) * Fraction(str(mult)) for m, mult in row.items()), Fraction(0))


def _round_nice(x: Fraction) -> float:
    """Round a multiplier to a readable precision that scales with magnitude.

    High-value tiers carry tiny probability weight, so coarse rounding barely
    moves RTP but keeps the published prize legible; low-value (high-probability)
    tiers keep 2 decimals because integer granularity there would swing RTP.
        |v| >= 100  -> nearest integer        (e.g. 8126)
        10 <= |v| < 100 -> 1 decimal          (e.g. 49.4)
        |v| < 10    -> 2 decimals             (e.g. 2.74)
    """
    d = Decimal(x.numerator) / Decimal(x.denominator)
    av = abs(d)
    step = Decimal("1") if av >= 100 else Decimal("0.1") if av >= 10 else Decimal("0.01")
    d = d.quantize(step, rounding=ROUND_HALF_UP)
    return int(d) if d == d.to_integral_value() else float(d)


def generate_row(k: int, target: Fraction = TARGET_RTP) -> dict[int, float]:
    """Rescale SHAPES[k] so its RTP ≈ target. Top prize fixed for k>=5."""
    shape = SHAPES[k]
    if k in TOP_FIXED:
        top = TOP_FIXED[k]
        fixed_contrib = prob(k, k) * Fraction(str(top))
        free = {m: v for m, v in shape.items() if m != k}
        free_rtp = sum((prob(k, m) * Fraction(str(v)) for m, v in free.items()), Fraction(0))
        scale = (target - fixed_contrib) / free_rtp
        row = {m: _round_nice(Fraction(str(v)) * scale) for m, v in free.items()}
        row[k] = top
    else:
        shape_rtp = rtp_of_row(k, shape)
        scale = target / shape_rtp
        row = {m: _round_nice(Fraction(str(v)) * scale) for m, v in shape.items()}
    return dict(sorted(row.items()))


def generate_paytable(target: Fraction = TARGET_RTP) -> dict[int, dict[int, float]]:
    return {k: generate_row(k, target) for k in range(1, 12)}


# Canonical generated table — the committed KENO_PAYTABLE in
# ticket-service/app/keno_rules.py is this value.
PAYTABLE = generate_paytable()


# ── Emitters ────────────────────────────────────────────────────────────────
def _fmt(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else str(v)


def emit_python(pt: dict[int, dict[int, float]]) -> str:
    lines = ["KENO_PAYTABLE: dict[int, dict[int, float]] = {"]
    for k in range(1, 12):
        inner = ", ".join(f"{m}: {_fmt(v)}" for m, v in pt[k].items())
        lines.append(f"    {k:>2}: {{{inner}}},")
    lines.append("}")
    return "\n".join(lines)


def emit_js(pt: dict[int, dict[int, float]]) -> str:
    lines = ["const KENO_PAYTABLE = [", "  [],  // index 0 unused"]
    for k in range(1, 12):
        row = pt[k]
        arr = [_fmt(row.get(m, 0)) for m in range(0, k + 1)]
        lines.append(f"  [{', '.join(arr)}],  // spots {k}")
    lines.append("];")
    return "\n".join(lines)


def _report() -> None:
    cur = {k: SHAPES[k] for k in range(1, 12)}
    new = PAYTABLE
    print(f"Target base RTP = {float(TARGET_RTP)*100:.2f}%  "
          f"(net margin {float(NET_MARGIN_TARGET)*100:.0f}% + jackpot slice "
          f"{float(JACKPOT_DEFERRAL_PCT):.1f}%)\n")
    print(f"{'spots':>5} {'current RTP':>12} {'retuned RTP':>12} {'net margin':>11} {'top prize':>10}")
    for k in range(1, 12):
        cur_rtp = rtp_of_row(k, cur[k])
        new_rtp = rtp_of_row(k, new[k])
        net = 1 - new_rtp - JACKPOT_DEFERRAL_PCT / 100
        top = max(new[k].values())
        print(f"{k:>5} {float(cur_rtp)*100:>11.2f}% {float(new_rtp)*100:>11.2f}% "
              f"{float(net)*100:>10.2f}% {_fmt(top):>10}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--emit-python", action="store_true")
    ap.add_argument("--emit-js", action="store_true")
    args = ap.parse_args()
    if args.emit_python:
        print(emit_python(PAYTABLE))
    elif args.emit_js:
        print(emit_js(PAYTABLE))
    else:
        _report()


if __name__ == "__main__":
    main()
