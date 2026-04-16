# services/ticket-service/app/rules.py

# Les numéros rouges de la roulette européenne
RED_NUMBERS = {"1", "3", "5", "7", "9", "12", "14", "16", "18", "19", "21", "23", "25", "27", "30", "32", "34", "36"}
BLACK_NUMBERS = {"2", "4", "6", "8", "10", "11", "13", "15", "17", "20", "22", "24", "26", "28", "29", "31", "33", "35"}
# Le 0 est vert, il n’est ni rouge ni noir.

def calculate_payout(bet_type: str, bet_target: str, amount: int, winning_number: str) -> int:
    """Calcule le gain pour une ligne de pari spécifique."""
    
    # 1. Pari sur un numéro plein (Numéro exact) -> Paye 36 fois la mise
    if bet_type == "STRAIGHT":
        if bet_target == winning_number:
            return amount * 36
            
    # 2. Pari sur la couleur ROUGE -> Paye 2 fois la mise
    elif bet_type == "RED":
        if winning_number in RED_NUMBERS:
            return amount * 2
            
    # 3. Pari sur la couleur NOIRE -> Paye 2 fois la mise
    elif bet_type == "BLACK":
        if winning_number in BLACK_NUMBERS:
            return amount * 2
            
    # Si on n'est dans aucun cas gagnant, le gain est de 0
    return 0
