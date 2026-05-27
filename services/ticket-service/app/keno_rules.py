# services/ticket-service/app/keno_rules.py
#
# Keno payout logic — fully isolated from roulette rules.
# Source: docs/KENO_IMPLEMENTATION_PLAN.md §6.3

# ---------------------------------------------------------------------------
# Paytable: KENO_PAYTABLE[spots][matches] = multiplier applied to bet amount.
# Spots 1..10, matches 0..spots. Missing entries are 0-multiplier (loss).
# ---------------------------------------------------------------------------
KENO_PAYTABLE: dict[int, dict[int, int]] = {
    1: {0: 0, 1: 3},
    2: {0: 0, 1: 0, 2: 12},
    3: {0: 0, 1: 0, 2: 1, 3: 42},
    4: {0: 0, 1: 0, 2: 1, 3: 4, 4: 120},
    5: {0: 0, 1: 0, 2: 0, 3: 2, 4: 12, 5: 800},
    6: {0: 0, 1: 0, 2: 0, 3: 1, 4: 4, 5: 70, 6: 1600},
    7: {0: 0, 1: 0, 2: 0, 3: 1, 4: 2, 5: 20, 6: 100, 7: 5000},
    8: {0: 0, 1: 0, 2: 0, 3: 0, 4: 2, 5: 10, 6: 50, 7: 1000, 8: 10000},
    9: {0: 0, 1: 0, 2: 0, 3: 0, 4: 1, 5: 5, 6: 25, 7: 200, 8: 4000, 9: 25000},
    10: {0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 5, 6: 20, 7: 80, 8: 500, 9: 10000, 10: 100000},
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
    if spots < 1 or spots > 10:
        return 0

    drawn_set = set(drawn_numbers)
    matches = len(set(picks) & drawn_set)

    multiplier = KENO_PAYTABLE.get(spots, {}).get(matches, 0)
    return amount * multiplier


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
