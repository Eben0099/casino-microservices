from typing import List, Dict, Any

RED_NUMBERS = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}

# 6 sectors of 6 numbers each, sliced from the European wheel order
# (clockwise from 0): 32 15 19 4 21 2 | 25 17 34 6 27 13 | 36 11 30 8 23 10 |
# 5 24 16 33 1 20 | 14 31 9 22 18 29 | 7 28 12 35 3 26
# Zero is intentionally NOT mapped: sector bets always lose on 0.
SECTORS = {
    "A": [32, 15, 19, 4, 21, 2],
    "B": [25, 17, 34, 6, 27, 13],
    "C": [36, 11, 30, 8, 23, 10],
    "D": [5, 24, 16, 33, 1, 20],
    "E": [14, 31, 9, 22, 18, 29],
    "F": [7, 28, 12, 35, 3, 26],
}
SECTOR_LETTERS = ("A", "B", "C", "D", "E", "F")
SECTORS_MAP = {n: i for i, letter in enumerate(SECTOR_LETTERS) for n in SECTORS[letter]}

def get_number_properties(number: int) -> Dict[str, Any]:
    if number == 0:
        color = "Green"
        is_even = False
        is_high = False
    else:
        color = "Red" if number in RED_NUMBERS else "Black"
        is_even = (number % 2 == 0)
        is_high = (number >= 19)

    return {
        "number": number,
        "color": color,
        "isEven": is_even,
        "isHigh": is_high
    }

def calculate_stats(history_entries: List[Any]) -> Dict[str, Any]:
    """
    Calcule les statistiques exactes demandées par le layout Unity.

    `history_entries` est dans l'ordre chronologique (plus ancien au plus
    recent). Chaque entree est soit un int (ancien format Redis) soit un dict
    `{"number": int, "round_id": str|None}` (nouveau format).
    """
    # Normalise vers (number, round_id) pour pouvoir manipuler uniformement.
    def _num(e):
        return e["number"] if isinstance(e, dict) else int(e)

    def _rid(e):
        return e.get("round_id") if isinstance(e, dict) else None

    history_numbers = [_num(e) for e in history_entries]
    total = len(history_numbers)
    if total == 0:
        # Default empty stats with 0 splits
        return _get_empty_stats()
    
    red_count = 0
    black_count = 0
    green_count = 0
    even_count = 0
    odd_count = 0
    high_count = 0
    low_count = 0
    
    dozens = [0, 0, 0]
    cols = [0, 0, 0]
    sectors = [0, 0, 0, 0, 0, 0]
    # Lines = 12 streets of 3 consecutive non-zero numbers (1-3, 4-6, ..., 34-36)
    lines = [0] * 12

    frequencies = [0] * 37

    # 6 sectors of 6 numbers each, sliced from the European wheel order
    # starting AFTER zero. Zero itself belongs to no sector (always loses
    # sector bets, payout x6 keeps RTP at 97.30% across all sectors).
    sectors_map = SECTORS_MAP

    for n in history_numbers:
        props = get_number_properties(n)
        frequencies[n] += 1

        if props["color"] == "Red":
            red_count += 1
        elif props["color"] == "Black":
            black_count += 1
        else:
            green_count += 1

        if n != 0:
            if props["isEven"]:
                even_count += 1
            else:
                odd_count += 1

            if props["isHigh"]:
                high_count += 1
            else:
                low_count += 1

            # Dozens
            dozens[(n - 1) // 12] += 1
            # Columns
            cols[(n - 1) % 3] += 1
            # Lines: 12 streets of 3 numbers each ((n-1)//3 → 0..11)
            lines[(n - 1) // 3] += 1

        # Sectors — 0 is intentionally outside all sectors
        if n in sectors_map:
            sectors[sectors_map[n]] += 1

    # Normalization helper (Largest Remainder Method)
    def normalize_percentages(counts: List[int], div: int) -> List[float]:
        if div == 0:
            val = 100.0 / len(counts)
            return [val for _ in counts]
        
        exact = [c * 100.0 / div for c in counts]
        floors = [int(x) for x in exact]
        remainders = [(exact[i] - floors[i], i) for i in range(len(counts))]
        
        diff = 100 - sum(floors)
        remainders.sort(reverse=True)
        
        for i in range(diff):
            floors[remainders[i][1]] += 1
            
        return [float(f) for f in floors]

    color_div = total
    colors_pct = normalize_percentages([red_count, black_count, green_count], color_div)
    
    eo_div = even_count + odd_count
    eo_pct = normalize_percentages([even_count, odd_count], eo_div)
    
    hl_div = high_count + low_count
    hl_pct = normalize_percentages([high_count, low_count], hl_div)
    
    non_zero_div = total - green_count
    dozens_pct = normalize_percentages(dozens, non_zero_div)
    cols_pct = normalize_percentages(cols, non_zero_div)
    lines_pct = normalize_percentages(lines, non_zero_div)
    
    # Sectors sum over non-zero spins only (0 belongs to no sector)
    sectors_pct = normalize_percentages(sectors, non_zero_div)
    
    # Hot and Cold numbers
    freq_with_num = [(frequencies[i], i) for i in range(37)]
    # Hot: sort desc frequency
    freq_desc = sorted(freq_with_num, key=lambda x: (-x[0], x[1]))
    hot_numbers = [x[1] for x in freq_desc[:7]]
    
    # Cold: sort asc frequency (if multiple same, arbitrary, usually lower numbers first)
    freq_asc = sorted(freq_with_num, key=lambda x: (x[0], x[1]))
    cold_numbers = [x[1] for x in freq_asc[:7]]

    # History: only the last 10 spins, in chronological order (oldest first).
    # Each entry carries the total occurrence count of that number across the
    # full tracked history — what the UI displays as "appeared N times".
    # `round_id` lets the frontend match each spin with the round that produced
    # it (used by the admin history table and any time-series correlation).
    recent_entries = history_entries[-10:]
    history_compact = [
        {
            "number": _num(e),
            "color": get_number_properties(_num(e))["color"],
            "count": frequencies[_num(e)],
            "round_id": _rid(e),
        }
        for e in recent_entries
    ]

    return {
        "redPercent": colors_pct[0],
        "blackPercent": colors_pct[1],
        "greenPercent": colors_pct[2],
        "evenPercent": eo_pct[0],
        "oddPercent": eo_pct[1],
        "highPercent": hl_pct[0],
        "lowPercent": hl_pct[1],
        "dozensPercents": dozens_pct,
        "columnsPercents": cols_pct,
        "sectorsPercents": sectors_pct,
        "linesPercents": lines_pct,
        "hotNumbers": hot_numbers,
        "coldNumbers": cold_numbers,
        "numberFrequencies": frequencies,
        "history": history_compact
    }

def _get_empty_stats() -> Dict[str, Any]:
    # 12-entry lines defaults: 8 cells at 8% + 4 cells at 9% = 100
    lines_default = [8.0] * 8 + [9.0] * 4
    return {
        "redPercent": 48.6,
        "blackPercent": 48.6,
        "greenPercent": 2.8,
        "evenPercent": 50.0,
        "oddPercent": 50.0,
        "highPercent": 50.0,
        "lowPercent": 50.0,
        "dozensPercents": [33.0, 33.0, 34.0],
        "columnsPercents": [33.0, 33.0, 34.0],
        "sectorsPercents": [16.0, 16.0, 17.0, 17.0, 17.0, 17.0],
        "linesPercents": lines_default,
        "hotNumbers": [0, 1, 2, 3, 4, 5, 6],
        "coldNumbers": [36, 35, 34, 33, 32, 31, 30],
        "numberFrequencies": [0] * 37,
        "history": []
    }
