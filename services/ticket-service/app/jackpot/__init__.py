"""Module jackpot : moteur multi-niveaux integre au ticket-service.

Trois familles de pots tournent en parallele (cf docs/jackpot-system.md) :
  - GLOBAL : 1 pot, alimente par tous les tickets
  - GAME   : 1 pot par jeu, 3 tiers (Bronze/Argent/Or)
  - LOCAL  : 1 pot par (jeu, kiosque), 3 tiers
"""
