from typing import List, Dict, Any

RED_NUMBERS = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}

# 6 secteurs couvrant les 37 pockets (0 inclus dans A pour aligner sur la
# disposition de la roue Unity ou 0 est le premier pocket du secteur A).
# A/B/C/D/E ont 6 pockets, F en a 7 (total = 37).
SECTORS = {
    "A": [0, 32, 15, 19, 4, 21],
    "B": [2, 25, 17, 34, 6, 27],
    "C": [13, 36, 11, 30, 8, 23],
    "D": [10, 5, 24, 16, 33, 1],
    "E": [20, 14, 31, 9, 22, 18],
    "F": [29, 7, 28, 12, 35, 3, 26],
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
    # Lines = 6 lignes de 6 numeros consecutifs (1-6, 7-12, ..., 31-36) — spec Unity
    lines = [0] * 6

    frequencies = [0] * 37

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
            # Lines: 6 lignes de 6 numeros ((n-1)//6 → 0..5)
            lines[(n - 1) // 6] += 1

        # Secteurs — 0 est inclus dans le secteur A (spec Unity)
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

    # Secteurs couvrent les 37 pockets (0 inclus dans A) → divise par total
    sectors_pct = normalize_percentages(sectors, total)
    
    # Hot and Cold numbers
    freq_with_num = [(frequencies[i], i) for i in range(37)]
    # Hot: sort desc frequency
    freq_desc = sorted(freq_with_num, key=lambda x: (-x[0], x[1]))
    hot_numbers = [x[1] for x in freq_desc[:7]]
    
    # Cold: sort asc frequency (if multiple same, arbitrary, usually lower numbers first)
    freq_asc = sorted(freq_with_num, key=lambda x: (x[0], x[1]))
    cold_numbers = [x[1] for x in freq_asc[:7]]

    # History: jusqu'a 200 spins en ordre chronologique (le plus ancien d'abord).
    # `isEven`/`isHigh` requis par le client Unity ; `count` et `round_id`
    # restent en extra (count = nb d'apparitions, round_id = correlation admin).
    recent_entries = history_entries[-200:]
    history_compact = []
    for e in recent_entries:
        n = _num(e)
        props = get_number_properties(n)
        history_compact.append({
            "number": n,
            "color": props["color"],
            "isEven": props["isEven"],
            "isHigh": props["isHigh"],
            "count": frequencies[n],
            "round_id": _rid(e),
        })

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
        "sectorsPercents": [17.0, 17.0, 17.0, 17.0, 16.0, 16.0],
        "linesPercents": [17.0, 17.0, 17.0, 17.0, 16.0, 16.0],
        "hotNumbers": [0, 1, 2, 3, 4, 5, 6],
        "coldNumbers": [36, 35, 34, 33, 32, 31, 30],
        "numberFrequencies": [0] * 37,
        "history": []
    }
