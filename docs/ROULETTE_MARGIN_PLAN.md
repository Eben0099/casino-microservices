# Roulette — passage au 70/30 (note de décision)

> **Statut : PROPOSITION — à valider par le propriétaire avant tout développement.**
>
> Complément de `JACKPOT_AND_MARGIN.md`, qui a établi le 70/30 pour le KENO.
> Ce document applique la même méthode à la ROULETTE, le seul jeu qui n'est
> pas encore au standard : **70 % des mises retournées aux parieurs, 30 %
> sécurisés pour l'entreprise**.

---

## 1. Le principe (rappel — identique au keno)

La marge ne vient **jamais** d'une manipulation du tirage : le RNG reste
honnête et provably-fair (vérifiable par `/verify/{round_id}`). La marge est
**l'espérance mathématique de la table de paiement** : chaque pari rend en
moyenne 70 % de la mise au joueur (68,5 % par la table + 1,5 % par la tranche
jackpot, qui est du retour joueur différé), et l'entreprise garde 30 %
**en espérance**. Round par round la marge réalisée oscille (35 %, 24 %,
27 %…) — c'est la loi des grands nombres qui fait converger, comme au keno.

## 2. Où en est la roulette aujourd'hui

Tous les paris de la roulette européenne paient au barème classique
(plein ×36, couleur ×2, douzaine ×3…). Sur 37 cases, **chaque** type de pari
rend exactement `36/37 = 97,3 %` :

> mise 1 000 sur le 17 → 1 chance sur 37 de toucher 36 000 → espérance 973.

Le casino ne garde donc que **2,7 %** (≈ 1,2 % net après la tranche jackpot) —
très loin du 70/30. Le réglage `commission_pct` qui existe dans les moteurs
n'est branché nulle part (bouton mort) et le doc margin note explicitement
« roulette parity — keno is wired first » : c'était la suite prévue.

## 3. Deux mécanismes possibles

### Option A — Table de paiement recalibrée (recommandée, = méthode keno)

On réduit les multiplicateurs pour viser un RTP de base de **68,5 %**
(facteur exact : `0,685 × 37/36 ≈ ×0,704` sur chaque multiplicateur).
La cote affichée au POS **est** la cote payée — transparent, zéro
contestation au guichet, même outillage de contrôle que le keno.

### Option B — Commission sur les gains (déconseillée)

Garder ×36 affiché mais prélever ~29,6 % sur chaque gain au règlement
(en branchant `commission_pct`). Même espérance, mais le ticket annonce
×36 et paie ~×25 : écart cote affichée / cote payée = réclamations
clients, risque réglementaire, et double source de vérité dans le code.

**La suite du document détaille l'option A.**

## 4. Les nouvelles tables (option A) — deux variantes au choix

`n` = nombre de cases couvertes ; multiplicateur cible exact = `0,685 × 37 / n`.

| Pari | n | Actuel | **V. exacte** | RTP base | **V. ronde** | RTP base |
|---|---|---|---|---|---|---|
| STRAIGHT (plein) | 1 | ×36 | **×25,34** | 68,49 % | **×25** | 67,57 % |
| SPLIT (cheval) | 2 | ×18 | **×12,67** | 68,49 % | **×12,5** | 67,57 % |
| MIRROR | 2 | ×18 | **×12,67** | 68,49 % | **×12,5** | 67,57 % |
| STREET (transversale) | 3 | ×12 | **×8,44** | 68,43 % | **×8,4** | 68,11 % |
| CORNER (carré) | 4 | ×9 | **×6,33** | 68,43 % | **×6,3** | 68,11 % |
| SIX_LINE (sixain) | 6 | ×6 | **×4,22** | 68,43 % | **×4,2** | 68,11 % |
| SECTOR | 6 | ×6 | **×4,22** | 68,43 % | **×4,2** | 68,11 % |
| HALF_COLOR | 9 | ×4 | **×2,81** | 68,35 % | **×2,8** | 68,11 % |
| COLUMN (colonne) | 12 | ×3 | **×2,11** | 68,43 % | **×2,1** | 68,11 % |
| DOZEN (douzaine) | 12 | ×3 | **×2,11** | 68,43 % | **×2,1** | 68,11 % |
| COLOR (couleur) | 18 | ×2 | **×1,40** | 68,11 % | **×1,4** | 68,11 % |
| EVEN_ODD (pair/impair) | 18 | ×2 | **×1,40** | 68,11 % | **×1,4** | 68,11 % |
| HALF (manque/passe) | 18 | ×2 | **×1,40** | 68,11 % | **×1,4** | 68,11 % |
| LINES | 18 | ×2 | **×1,40** | 68,11 % | **×1,4** | 68,11 % |

Tous les arrondis sont **vers le bas** (favorables maison, comme le `floor`
keno) — la marge nette réelle ne descend jamais sous la cible.

| | RTP base pondéré* | + jackpot 1,5 % | **Marge nette entreprise** |
|---|---|---|---|
| **Variante exacte** | ≈ 68,40 % | ≈ 69,90 % | **≈ 30,1 %** |
| **Variante ronde** | ≈ 67,95 % | ≈ 69,45 % | **≈ 30,5 %** |

\* pondération uniforme par type ; le mix réel des ventes fera légèrement varier.

**Recommandation : la variante ronde.** Les cotes restent lisibles au guichet
(×25, ×12,5, ×2,1, ×1,4), l'écart de marge (+0,4 pt pour l'entreprise) est
dans la tolérance que le keno s'autorise déjà (±0,5 pt), et l'affichage POS
n'a pas à gérer 2 décimales partout.

### Exemples concrets (mise 1 000 XAF, variante ronde)

| Pari gagnant | Aujourd'hui | Après |
|---|---|---|
| Plein (le 17 sort) | 36 000 | **25 000** |
| Couleur (rouge) | 2 000 | **1 400** |
| Douzaine | 3 000 | **2 100** |

> **Point produit assumé** (comme la retune keno spot-10 84 % → 68,5 %) :
> le changement est visible par les joueurs. C'est une décision de marge
> délibérée, pas une retouche silencieuse — à annoncer/assumer commercialement.

## 5. Variance (à quoi s'attendre round par round)

- **Paris pairs** (couleur, pair/impair, manque/passe) : ~49 % de tickets
  gagnants → la marge converge vite (quelques centaines de tickets).
- **Pleins** : 1/37 de gagnants à ×25 → marge très volatile par round
  (un plein qui sort = round très négatif), converge sur quelques milliers
  de paris. Identique en nature au top-prize keno — déjà accepté.
- Le suivi de convergence se fait avec le monitoring (§7), pas à l'œil.

## 6. Implémentation — où la table vit (toutes les copies à synchroniser)

La règle d'or keno s'applique : **une seule copie fait foi pour l'argent**,
les autres sont des miroirs d'affichage gardés par des tests anti-dérive.

| # | Fichier | Rôle | Mode |
|---|---|---|---|
| 1 | `agd-casino-service/src/database/enums/bet-types.enum.ts` (`ROULETTE_PAYOUT_MULTIPLIERS`) | **règlement + cotes figées à la vente** (AGD) | intégré |
| 2 | `casino-microservices/services/ticket-service/app/rules.py` | règlement standalone | standalone |
| 3 | `agent-web` `TicketReceipt.jsx` (BET_MULTIPLIERS) + `OddsTable.jsx` | affichage POS (fallback — la cote API prime déjà) | les deux |
| 4 | `agd-casino-service` `roulette.calculator.ts` | doit rester aligné sur #1 (même source) | intégré |

**Acquis important (déjà en prod)** : les cotes sont désormais **figées en DB
au placement** (`casino_ticket_bets.odds`). Le jour du basculement, les
tickets déjà vendus **gardent et paient leurs anciennes cotes** ; seuls les
tickets vendus après la mise en prod portent la nouvelle table. Zéro litige
rétroactif, pas de migration.

À construire en plus (parité avec le keno) :
- `tools/roulette_rtp_check.py` — vérifie `RTP(type) = n × mult / 37` pour
  chaque type, et le blended (équivalent de `keno_rtp_check.py`).
- Tests anti-dérive : un test côté AGD (`bet-types.enum`) et un côté
  standalone (`rules.py`) qui cassent si un multiplicateur s'écarte de la
  cible 68,5 % ± 0,5 pt ; un test miroir agent-web (comme `test_keno_rtp.py`).
- Monitoring : endpoint « marge roulette réalisée vs cible 30 % »
  (équivalent `/admin/keno/margin`) + affichage backoffice/dashboard.

### Ordre de déploiement proposé

1. PR standalone (`rules.py` + miroirs agent-web + outillage + tests)
2. PR AGD (`bet-types.enum.ts` + tests) — les cotes affichées au POS suivent
   automatiquement (l'API sert les cotes depuis cette table)
3. Annonce produit / formation caissières (les cotes changent)
4. Bascule coordonnée (les deux modes le même jour pour éviter deux barèmes
   en parallèle)
5. Surveillance de la marge réalisée sur les 7 premiers jours

## 7. Ce que le propriétaire doit trancher

1. **Mécanisme** : table recalibrée (option A — recommandée) ou commission
   sur gains (option B) ?
2. **Variante de table** : ronde (lisible, marge ≈ 30,5 %) ou exacte
   (2 décimales, marge ≈ 30,1 %) ?
3. **Date de bascule** et communication joueurs/caissières (changement
   visible : plein ×36 → ×25).
4. La tranche jackpot roulette reste-t-elle à 1,5 % garanti (Général 1 % +
   Spin & Win 0,5 %) ? (hypothèse de tout ce document)
