from typing import List, Dict, Any

RED_NUMBERS = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}

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

def calculate_stats(history_numbers: List[int]) -> Dict[str, Any]:
    """
    Calcule les statistiques exactes demandées par le layout Unity.
    history_numbers est supposé être dans l'ordre chronologique (plus ancien au plus récent).
    """
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
    
    # Wheel sectors layout from BACKEND_PROTOCOL.md
    sectors_map = {
        0: 0, 32: 0, 15: 0, 19: 0, 4: 0, 21: 0,
        2: 1, 25: 1, 17: 1, 34: 1, 6: 1, 27: 1,
        13: 2, 36: 2, 11: 2, 30: 2, 8: 2, 23: 2,
        10: 3, 5: 3, 24: 3, 16: 3, 33: 3, 1: 3,
        20: 4, 14: 4, 31: 4, 9: 4, 22: 4, 18: 4,
        29: 5, 7: 5, 28: 5, 12: 5, 35: 5, 3: 5, 26: 5
    }

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

        # Sectors
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
    
    sectors_pct = normalize_percentages(sectors, total)
    
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
    recent = history_numbers[-10:]
    history_compact = [
        {
            "number": n,
            "color": get_number_properties(n)["color"],
            "count": frequencies[n]
        }
        for n in recent
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
