"""Keno statistics calculator.

Produces a ``StatsSnapshot`` conforming exactly to BACKEND.md §3:

    {
      "recentDraws":     [...up to 10, chronological oldest-first...],
      "hot":             [...up to 6 {n, count}...],
      "cold":            [...up to 6 {n, count}...],
      "consecutive":     [...up to 6 {n, count}...],
      "rowDistribution": [int x 8],   // rows of 10 for the LATEST draw
      "colDistribution": [int x 10],  // units digit for the LATEST draw
    }

``history_entries`` is a list of dicts ``{"round_id": int, "numbers": list[int]}``
in chronological order (oldest first).  Entries may optionally carry a
``"time"`` key (``"HH:MM"`` string); if absent the snapshot generates one
from wall clock (only matters for synthetic seeds).

Trend window for hot/cold/consecutive: last 20 draws.
"""

from __future__ import annotations

import time
from collections import Counter
from datetime import datetime, timezone
from typing import Any


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def calculate_stats(history_entries: list[dict[str, Any]]) -> dict[str, Any]:
    """Compute and return a full StatsSnapshot dict.

    Safe to call with an empty list — returns a zeroed-out snapshot.
    """
    if not history_entries:
        return _empty_snapshot()

    # Limit to last 20 draws for trend computation (hot/cold/consecutive).
    trend_window = history_entries[-20:]

    # ---- recentDraws (up to 10, oldest first) --------------------------------
    recent_src = history_entries[-10:]
    recent_draws = []
    for entry in recent_src:
        numbers_sorted = sorted(entry["numbers"])
        t = entry.get("time") or _wall_time()
        recent_draws.append({
            "id": entry["round_id"],
            "numbers": numbers_sorted,
            "time": t,
        })

    # ---- frequency counts over trend window ----------------------------------
    freq: Counter[int] = Counter()
    for entry in trend_window:
        for n in entry["numbers"]:
            freq[n] += 1

    # hot: up to 6, most frequent (tie-break: lower number first)
    all_nums = list(range(1, 81))
    sorted_by_freq_desc = sorted(all_nums, key=lambda n: (-freq[n], n))
    hot = [{"n": n, "count": freq[n]} for n in sorted_by_freq_desc[:6]]

    # cold: up to 6, least frequent (tie-break: lower number first)
    sorted_by_freq_asc = sorted(all_nums, key=lambda n: (freq[n], n))
    cold = [{"n": n, "count": freq[n]} for n in sorted_by_freq_asc[:6]]

    # ---- consecutive: numbers appearing in 2+ consecutive draws in window ----
    consecutive = _consecutive_counts(trend_window)

    # ---- row/col distributions for the LATEST draw only ----------------------
    latest_numbers = history_entries[-1]["numbers"]
    row_dist = _row_distribution(latest_numbers)
    col_dist = _col_distribution(latest_numbers)

    return {
        "recentDraws": recent_draws,
        "hot": hot,
        "cold": cold,
        "consecutive": consecutive,
        "rowDistribution": row_dist,
        "colDistribution": col_dist,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _row_distribution(numbers: list[int]) -> list[int]:
    """Counts per row of 10: [1-10], [11-20], ..., [71-80] → 8 buckets."""
    rows = [0] * 8
    for n in numbers:
        idx = (n - 1) // 10  # 1→0, 11→1, ..., 71→7
        rows[idx] += 1
    return rows


def _col_distribution(numbers: list[int]) -> list[int]:
    """Counts per units digit.

    Index mapping (BACKEND.md §"Number layout"):
        index 0 → units digit 1  (1, 11, 21, ..., 71)
        index 1 → units digit 2
        ...
        index 8 → units digit 9
        index 9 → multiples of 10 (10, 20, ..., 80)
    """
    cols = [0] * 10
    for n in numbers:
        units = n % 10
        if units == 0:
            cols[9] += 1
        else:
            cols[units - 1] += 1
    return cols


def _consecutive_counts(
    window: list[dict[str, Any]],
) -> list[dict[str, int]]:
    """Numbers appearing in 2 or more *consecutive* draws within the window.

    "Consecutive" means the number appeared in draw[i] AND draw[i+1] for at
    least one pair i, i+1 in the window.  Returns up to 6 entries sorted by
    descending streak count, tie-break lower number first.
    """
    if len(window) < 2:
        return []

    # Count how many consecutive pairs contain each number.
    pair_counts: Counter[int] = Counter()
    for i in range(len(window) - 1):
        set_a = set(window[i]["numbers"])
        set_b = set(window[i + 1]["numbers"])
        for n in set_a & set_b:
            pair_counts[n] += 1

    # Filter: must appear in at least 1 consecutive pair (count >= 1 means
    # it was in 2+ consecutive draws at least once).
    candidates = [(n, c) for n, c in pair_counts.items() if c >= 1]
    candidates.sort(key=lambda x: (-x[1], x[0]))

    return [{"n": n, "count": c} for n, c in candidates[:6]]


def _wall_time() -> str:
    """Return current wall-clock time as 'HH:MM' string."""
    return datetime.now(timezone.utc).strftime("%H:%M")


def _empty_snapshot() -> dict[str, Any]:
    return {
        "recentDraws": [],
        "hot": [],
        "cold": [],
        "consecutive": [],
        "rowDistribution": [0] * 8,
        "colDistribution": [0] * 10,
    }
