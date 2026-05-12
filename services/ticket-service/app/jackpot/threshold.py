"""Tirage du seuil aleatoire `current_threshold` d'un pot.

Utilise `secrets` pour une source cryptographiquement sure. Le seuil reste
secret en base et n'est revele que dans `jackpot_wins.threshold_hit` apres
le HIT.
"""
import secrets


def draw_threshold(min_value: int, max_value: int) -> int:
    """Tirage uniforme dans [min_value, max_value] inclus."""
    if min_value < 0 or max_value < 0:
        raise ValueError("Les bornes du seuil doivent etre positives.")
    if max_value < min_value:
        raise ValueError("threshold_max doit etre >= threshold_min.")
    span = max_value - min_value + 1
    return min_value + secrets.randbelow(span)
