# services/ticket-service/app/keno_rules.py
#
# Keno payout logic — fully isolated from roulette rules.
# Source: docs/KENO_IMPLEMENTATION_PLAN.md §6.3

from __future__ import annotations

from decimal import Decimal

# Cash denomination: every payout is floored to a multiple of this (see
# calculate_keno_payout). Mirror of rules.py / AGD payout-denomination.ts.
PAYOUT_DENOMINATION = 50

# ---------------------------------------------------------------------------
# Paytable: KENO_PAYTABLE[spots][matches] = multiplier applied to bet amount.
# Spots 1..11, matches 0..spots. Missing entries are 0-multiplier (loss).
#
# TUNED FOR 30% NET HOUSE MARGIN. Every spot count is calibrated to the SAME
# base RTP of 68.5% so no spot-count is exploitable. "Net" means after the
# guaranteed jackpot slice (GLOBAL 1% + KENO game 0.5% = 1.5%, deferred player
# return): 1 − 0.685 − 0.015 = 0.30. The realized per-draw margin varies
# (Law of Large Numbers); only the long-run expectation is 30%.
#
# This table is GENERATED — do not hand-edit values. To re-shape prizes, edit
# the SHAPES in `tools/keno_paytable.py`, regenerate (`--emit-python` /
# `--emit-js` for the agent-web mirror), and verify with
# `python tools/keno_rtp_check.py` (and `pytest tests/test_keno_rtp.py`).
# Multipliers are fractional for low spot counts because integer-only cannot
# hit 68.5% there (e.g. 1 spot: 2.74×, not 3×=75%). Aspirational top prizes
# (k>=5) are preserved exactly as the jackpot hook.
# ---------------------------------------------------------------------------
KENO_PAYTABLE: dict[int, dict[int, float]] = {
     1: {1: 2.74},
     2: {1: 1.01, 2: 5.03},
     3: {2: 2.69, 3: 22.4},
     4: {2: 0.99, 3: 3.96, 4: 99},
     5: {3: 1.93, 4: 19.3, 5: 450},
     6: {3: 0.99, 4: 6.92, 5: 49.4, 6: 1600},
     7: {3: 0.97, 4: 2.92, 5: 19.5, 6: 97.5, 7: 5000},
     8: {4: 1.98, 5: 9.92, 6: 49.6, 7: 992, 8: 15000},
     9: {4: 0.98, 5: 4.9, 6: 24.5, 7: 196, 8: 3924, 9: 40000},
    10: {0: 1.63, 4: 0.81, 5: 1.63, 6: 16.3, 7: 65, 8: 406, 9: 8126, 10: 100000},
    11: {0: 1.98, 5: 0.99, 6: 9.91, 7: 49.5, 8: 248, 9: 1486, 10: 14863, 11: 500000},
}


def calculate_keno_payout(bet_target: str, drawn_numbers: list[int], amount: int) -> int:
    """Return the total payout (amount * multiplier) for a single Keno bet line.

    Parameters
    ----------
    bet_target:
        CSV string of the player's chosen numbers, e.g. "5,12,23,47,61".
        Whitespace is tolerated; non-numeric tokens are silently ignored.
    drawn_numbers:
        The 20 integers drawn by the engine for this round.
    amount:
        Bet amount in XAF (integer). Must be positive; caller is responsible
        for validation — this function returns 0 for non-positive amounts.

    Returns
    -------
    int
        Payout in XAF (>= 0). Returns 0 on any parse error or unknown
        (spots, matches) combination.
    """
    if amount <= 0:
        return 0

    try:
        picks = [int(t.strip()) for t in bet_target.split(",") if t.strip().lstrip("-").isdigit()]
    except Exception:
        return 0

    spots = len(picks)
    if spots < 1 or spots > 11:
        return 0

    drawn_set = set(drawn_numbers)
    matches = len(set(picks) & drawn_set)

    multiplier = KENO_PAYTABLE.get(spots, {}).get(matches, 0)
    # Multipliers can be fractional (low spot counts). Decimal avoids binary
    # float drift (e.g. 0.81 * amount). The exact payout is then floored to a
    # payable 50 XAF denomination so a cashier never owes an unpayable sum
    # (e.g. 1 515 F) — house-favorable, keeps net margin >= target. Mirrors the
    # AGD casino-service payout-denomination rounding (both engines agree).
    exact = int(Decimal(amount) * Decimal(str(multiplier)))
    if exact <= 0:
        return 0
    return (exact // PAYOUT_DENOMINATION) * PAYOUT_DENOMINATION


def keno_medal_tier(spots: int, matches: int) -> str | None:
    """Return the medal tier earned by a Keno bet, or None if no medal.

    Medal thresholds (plan §6.3):
      - 'bronze' : matches >= 6 on a spots >= 6 ticket
      - 'silver' : matches >= 8  (implies spots >= 8)
      - 'gold'   : full match (matches == spots) on spots >= 6

    Precedence: gold > silver > bronze. A 10/10 hit returns 'gold', not
    'silver' even though it also satisfies that threshold.
    """
    if spots < 6 or matches < 6:
        return None

    # Full match: gold
    if matches == spots:
        return "gold"

    # >= 8 matches without being a full-match: silver
    if matches >= 8:
        return "silver"

    # >= 6 matches (already guaranteed by outer check): bronze
    return "bronze"
