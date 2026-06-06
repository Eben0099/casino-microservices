# Protection des caisses — structure des gains keno & roulette (note de décision)

> **Statut : PROPOSITION — à valider par le propriétaire avant tout développement.**
>
> Complément de `JACKPOT_AND_MARGIN.md` (le 70/30) et `ROULETTE_MARGIN_PLAN.md`
> (la marge roulette). Exigence produit : **maximiser les gains petits et
> fréquents, supprimer les gains rares et énormes** qui peuvent vider une
> caisse en un ticket. La marge ne change pas : on rend toujours 70 % aux
> joueurs — on change la **forme** de la redistribution, pas son total.

---

## 1. Le danger, chiffré (état actuel)

Gain maximum d'une **seule grille keno à 1 000 XAF** :

| Numéros cochés | Top multiplicateur | Gain max (mise 1 000) | Fréquence du top |
|---|---|---|---|
| 5 | ×450 | 450 000 XAF | 1 / 1 550 |
| 6 | ×1 600 | 1 600 000 XAF | 1 / 7 752 |
| 7 | ×5 000 | 5 000 000 XAF | 1 / 41 000 |
| 8 | ×15 000 | 15 000 000 XAF | 1 / 230 000 |
| 9 | ×40 000 | **40 000 000 XAF** | 1 / 1,4 M |
| 10 | ×100 000 | **100 000 000 XAF** | 1 / 8,9 M |
| 11 | ×500 000 | **500 000 000 XAF** | 1 / 62 M |

Ces probabilités paraissent rassurantes, mais avec du volume elles arrivent :
à 1 000 grilles/jour à 7+ numéros, un ×15 000 sort en espérance ~tous les
8 mois — et une caisse de kiosque ne peut pas payer 15 M. Côté roulette,
l'exposition vient de la mise : plein à 50 000 XAF (max actuel) = 1,8 M
aujourd'hui, 1,25 M après le passage à ×25.

## 2. Les quatre ceintures de sécurité proposées

### Ceinture 1 — Keno : maximum 7 numéros cochés

On **bloque à la vente** toute grille de plus de 7 numéros (aujourd'hui 11) :

- Le top prize possible passe de ×500 000 à celui de la ligne 7.
- ⚠️ **On ne supprime PAS les lignes 8–11 de la table de règlement** : un
  ticket 8–11 numéros déjà vendu doit encore se régler à ses conditions.
  On bloque uniquement les **nouvelles ventes** ; les lignes mortes seront
  retirées plus tard.

### Ceinture 2 — Keno : re-profilage des lignes 1–7 (petits gains fréquents)

Le générateur (`tools/keno_paytable.py`) recale n'importe quelle forme au
même RTP 68,5 % — on garde le 70/30, on écrase les sommets et on engraisse
les petits gains. **Proposition de tops** (à trancher, c'est le bouton
produit) :

| Cochés | Top actuel | **Top proposé** | Gain max (1 000 XAF) | Ce que ça libère pour les petits gains |
|---|---|---|---|---|
| 5 | ×450 | **×100** | 100 000 | les paliers 3/5 et 4/5 paient plus souvent/plus |
| 6 | ×1 600 | **×250** | 250 000 | idem 3/6 et 4/6 |
| 7 | ×5 000 | **×500** | 500 000 | idem 3/7 à 5/7 |

Effet joueur : on touche **plus souvent** quelque chose (consolations
revalorisées), mais le « coup de folie » est plafonné. C'est exactement
« maximiser les petites mises » : le petit gain est rejoué au round suivant.

### Ceinture 3 — Plafond de gain PAR TICKET, appliqué à la vente (les 2 jeux)

C'est la protection **déterministe** : depuis le 05/06, chaque ticket a son
`maxPayout` **calculé et figé au placement**. On ajoute une règle de vente :

> si `maxPayout` du ticket > PLAFOND → **vente refusée** avec message clair
> (« Gain potentiel 1 250 000 XAF au-dessus du plafond autorisé 500 000 —
> réduisez la mise »).

- Marche pour keno ET roulette, quel que soit le barème.
- Aucune caisse ne peut plus devoir plus que PLAFOND × tickets gagnants du
  round — borné, connu d'avance.
- **Proposition : 500 000 XAF par ticket** (à trancher).

### Ceinture 4 — Mises max par jeu (déjà livré, à régler)

Le panneau « Réglages moteur » du dashboard (livré le 05/06) règle min/max
de mise **en live, sans redéploiement**. Recommandation :

| Jeu | max_stake actuel | **Proposé** | Exposition pire cas (avec ceintures 1–3) |
|---|---|---|---|
| Keno | 50 000 | **5 000** | plafonnée par la ceinture 3 de toute façon |
| Roulette | 50 000 | **20 000** | plein ×25 = 500 000 = le plafond ticket |

## 3. Ce que ça donne au total

| Scénario | Aujourd'hui | Après |
|---|---|---|
| Pire ticket keno possible | 500 000 000 XAF (11 cochés, 1 000 XAF) | **500 000 XAF** |
| Pire ticket roulette possible | 1 800 000 XAF (plein 50 000 XAF) | **500 000 XAF** |
| Marge entreprise | 30 % (keno) / ~1 % (roulette) | **30 % partout** (avec ROULETTE_MARGIN_PLAN) |
| Retour joueurs | 70 % keno / 97 % roulette | **70 % partout** — mais en gains plus fréquents |

## 4. Carte d'implémentation (où ça se code)

| Ceinture | Fichiers |
|---|---|
| 1 — 7 cochés max | `agd-casino-service` keno validator + `KENO_MAX_SPOTS` (11→7) ; `ticket-service/app/keno_rules.py` (validation standalone) ; `agent-web` `KenoGrid` (`maxSpots`) ; moteur keno `default_spots` clamp (1..7) |
| 2 — re-profilage | `tools/keno_paytable.py` SHAPES 5–7 + `TOP_FIXED` → régénérer (`--emit-python`/`--emit-js`) → `keno_rules.py`, `keno-bet-types.enum.ts` (lignes 1–7 seulement ; 8–11 conservées pour le legacy), miroir `KenoGrid.jsx` ; `keno_rtp_check.py` + `test_keno_rtp.py` revalident le 68,5 % |
| 3 — plafond ticket | `agd-casino-service` `TicketPlacementService` (le `maxPayout` est déjà calculé au placement → un `if` + nouveau paramètre par jeu `maxPayoutPerTicket` dans l'entité Game, éditable dashboard) ; équivalent standalone dans `ticket-service` |
| 4 — mises max | aucun code : réglage live via le panneau Réglages moteur |

Remarques :
- Les tickets déjà vendus ne sont **jamais réécrits** (cotes figées à la
  vente — en prod depuis le 05/06). Seul le règlement des grilles 8–11
  legacy impose de garder ces lignes dans la table de règlement (cf. C1).
- Fenêtre de bascule : les tickets PENDING au moment du deploy (cycle de
  ~3 min) se règlent sur la nouvelle table 1–7 — re-profiler entre deux
  rounds ou accepter la fenêtre de quelques minutes.
- La vérifiabilité provably-fair est intacte : on ne touche ni au RNG ni
  aux seeds, uniquement aux barèmes et aux règles de vente.

## 5. À trancher par le propriétaire

1. **Tops keno** : ×100 / ×250 / ×500 (proposés) — ou d'autres valeurs ?
2. **Plafond de gain par ticket** : 500 000 XAF ? (même valeur pour les
   2 jeux, ou différenciée ?)
3. **Mises max** : keno 5 000 / roulette 20 000 ?
4. Confirmer la conservation des lignes 8–11 pour le legacy (réglage des
   tickets déjà vendus) avec blocage à la vente uniquement.
5. Calendrier : même bascule que le 70/30 roulette (`ROULETTE_MARGIN_PLAN`)
   ou indépendant ?
