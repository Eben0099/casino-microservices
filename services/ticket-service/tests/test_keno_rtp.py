"""Keno paytable invariants — the safety net for the 30% NET house margin.

Run from anywhere:  pytest services/ticket-service/tests/test_keno_rtp.py

Asserts that the production paytable (app.keno_rules.KENO_PAYTABLE):
  - returns ~68.5% base RTP for EVERY spot count (uniform, so no spot-count is
    exploitable; net margin = 1 - 0.685 - 0.015 jackpot slice = 30%),
  - has a sane prize curve (monotonic over paying tiers, consolation <= 2x),
  - stays in phase with the agent-web display mirror (KenoGrid.jsx) — drift guard.

If you change the paytable, regenerate via tools/keno_paytable.py and these
tests will confirm the margin still holds.
"""
from __future__ import annotations

import os
import re
import sys
from fractions import Fraction
from math import comb

# Make `app` importable regardless of the working directory pytest runs from.
TS_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, TS_ROOT)

from app.keno_rules import KENO_PAYTABLE, calculate_keno_payout  # noqa: E402

POOL, DRAWN = 80, 20
TARGET_RTP = Fraction(685, 1000)
TOL = Fraction(5, 1000)  # ±0.5 percentage points


def prob(k: int, m: int) -> Fraction:
    return Fraction(comb(k, m) * comb(POOL - k, DRAWN - m), comb(POOL, DRAWN))


def rtp(k: int) -> Fraction:
    return sum((prob(k, m) * Fraction(str(v)) for m, v in KENO_PAYTABLE[k].items()), Fraction(0))


def test_every_spot_count_hits_target_rtp():
    for k in range(1, 12):
        r = rtp(k)
        assert abs(r - TARGET_RTP) <= TOL, (
            f"spots={k}: RTP {float(r)*100:.2f}% is outside "
            f"68.5%±0.5 — net margin would drift off 30%"
        )


def test_blended_net_margin_is_30_percent():
    # Uniform spot-popularity blend; net = 1 - RTP - 1.5% guaranteed jackpot slice.
    blended = sum(rtp(k) for k in range(1, 12)) / 11
    net = 1 - blended - Fraction(15, 1000)
    assert abs(net - Fraction(30, 100)) <= TOL


def test_prize_curve_is_monotonic_and_consolation_sane():
    for k in range(1, 12):
        row = KENO_PAYTABLE[k]
        # Consolation (0 matches) must not exceed 2x the stake.
        assert row.get(0, 0) <= 2, f"spots={k}: 0-match consolation > 2x"
        # Multiplier must not decrease as matches increase (over paying tiers,
        # ignoring the 0-match consolation which is a special low tier).
        paying = [(m, v) for m, v in sorted(row.items()) if m > 0 and v > 0]
        for (m0, v0), (m1, v1) in zip(paying, paying[1:]):
            assert v1 >= v0, f"spots={k}: payout drops from {m0}->{m1} ({v0} -> {v1})"


def test_payout_floors_to_50_denomination():
    # 1 spot pays 2.74x; payouts are floored to a payable 50 XAF denomination
    # (house-favorable) so a cashier never owes an unpayable sum.
    # 2.74 * 1000 = 2740 -> floor to 50 -> 2700.
    assert calculate_keno_payout("7", [7], 1000) == 2700
    # 2.74 * 100 = 274 -> floor to 50 -> 250.
    assert calculate_keno_payout("7", [7], 100) == 250
    # A miss pays 0 for low spots (no consolation tier).
    assert calculate_keno_payout("7", [80], 1000) == 0


def _parse_js_mirror() -> list[list[float]]:
    js_path = os.path.join(
        TS_ROOT, os.pardir, "agent-web", "src", "components", "KenoGrid.jsx"
    )
    text = open(js_path, encoding="utf-8").read()
    block = text.split("const KENO_PAYTABLE = [", 1)[1].split("];", 1)[0]
    rows = []
    for inner in re.findall(r"\[([^\[\]]*)\]", block):
        nums = [float(t) for t in inner.split(",") if t.strip() != ""]
        rows.append(nums)
    return rows


def test_js_display_mirror_matches_backend():
    """agent-web KenoGrid.jsx must equal the backend table, else max-gain lies."""
    rows = _parse_js_mirror()
    # rows[0] is the unused index-0 empty array; spots k -> rows[k].
    for k in range(1, 12):
        expected = [float(KENO_PAYTABLE[k].get(m, 0)) for m in range(0, k + 1)]
        assert rows[k] == expected, (
            f"spots={k}: KenoGrid.jsx mirror {rows[k]} != backend {expected} "
            f"— regenerate with `python tools/keno_paytable.py --emit-js`"
        )
