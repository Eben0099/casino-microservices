# services/ticket-service/app/rules.py

# Les numéros par couleur
RED_NUMBERS = {"1", "3", "5", "7", "9", "12", "14", "16", "18", "19", "21", "23", "25", "27", "30", "32", "34", "36"}
BLACK_NUMBERS = {"2", "4", "6", "8", "10", "11", "13", "15", "17", "20", "22", "24", "26", "28", "29", "31", "33", "35"}

def calculate_payout(bet_type: str, bet_target: str, amount: int, winning_number: str) -> int:
    """
    Calcule le gain pour une ligne de pari spécifique selon les règles de la roulette européenne.
    """
    win_n = str(winning_number)
    
    # --- PARIS INTÉRIEURS ---

    # 1. Plein (Straight) - 36x
    if bet_type == "STRAIGHT":
        if bet_target == win_n:
            return amount * 36

    # 2. À Cheval (Split) - 18x
    # bet_target est une chaîne "num1,num2"
    elif bet_type == "SPLIT":
        if win_n in bet_target.split(","):
            return amount * 18

    # 3. Transversale (Street) - 12x
    # bet_target est une chaîne "num1,num2,num3"
    elif bet_type == "STREET":
        if win_n in bet_target.split(","):
            return amount * 12

    # 4. Carré (Corner) - 9x
    # bet_target est une chaîne "num1,num2,num3,num4"
    elif bet_type == "CORNER":
        if win_n in bet_target.split(","):
            return amount * 9

    # 5. Sixain (Six Line) - 6x
    # bet_target est une chaîne "num1,num2,num3,num4,num5,num6"
    elif bet_type == "SIX_LINE":
        if win_n in bet_target.split(","):
            return amount * 6


    # --- PARIS EXTÉRIEURS ---

    # 6. Colonnes (Column) - 3x
    elif bet_type == "COLUMN":
        # Col1: 1,4,7... | Col2: 2,5,8... | Col3: 3,6,9...
        if win_n == "0": return 0
        n = int(win_n)
        if bet_target == "Col1" and n % 3 == 1: return amount * 3
        if bet_target == "Col2" and n % 3 == 2: return amount * 3
        if bet_target == "Col3" and n % 3 == 0: return amount * 3

    # 7. Douzaines (Dozen) - 3x
    elif bet_type == "DOZEN":
        if win_n == "0": return 0
        n = int(win_n)
        if bet_target == "1st" and 1 <= n <= 12: return amount * 3
        if bet_target == "2nd" and 13 <= n <= 24: return amount * 3
        if bet_target == "3rd" and 25 <= n <= 36: return amount * 3

    # 8. Rouge / Noir (Color) - 2x
    elif bet_type == "COLOR":
        if bet_target == "RED" and win_n in RED_NUMBERS: return amount * 2
        if bet_target == "BLACK" and win_n in BLACK_NUMBERS: return amount * 2

    # 9. Pair / Impair (Even/Odd) - 2x
    elif bet_type == "EVEN_ODD":
        if win_n == "0": return 0
        n = int(win_n)
        if bet_target == "EVEN" and n % 2 == 0: return amount * 2
        if bet_target == "ODD" and n % 2 != 0: return amount * 2

    # 10. Manque / Passe (Half) - 2x
    elif bet_type == "HALF":
        if win_n == "0": return 0
        n = int(win_n)
        if bet_target == "1-18" and 1 <= n <= 18: return amount * 2
        if bet_target == "19-36" and 19 <= n <= 36: return amount * 2

    # Par défaut, perdu
    return 0
