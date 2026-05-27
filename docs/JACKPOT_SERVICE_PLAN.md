# Jackpot Service — Plan de consolidation (source de vérité unique)

**Version:** 1.0
**Date:** 2026-05-27
**Problème:** après l'ajout du Keno, on a **deux** "Jackpot Général" (un par moteur de jeu) car chaque moteur garde son propre `jackpot_state`. Le général doit être **un seul pot** alimenté par tous les jeux/kiosques.
**Décisions actées:** (1) **service jackpot dédié** ; (2) niveaux locaux **par kiosque ET par jeu**.

---

## 1. Cause racine

Deux systèmes coexistent :

| | Système A — `ticket-service/app/jackpot/` | Système B — `jackpot_state` des moteurs |
|---|---|---|
| Modèle | scopé `GLOBAL/GAME/LOCAL`, **correct** | 5 pots fixes copiés **dans chaque moteur** |
| Général | **1 seul** pot `GLOBAL` (tous jeux) | **1 par moteur** → duplication ❌ |
| Alimentation | `contribute_for_ticket` à la **création** du ticket | events Redis à la **settlement** |
| Lu par | personne (pas exposé) | les frontends + WS d'affichage |

➡️ La duplication = Système B. Le bon modèle (A) existe déjà mais n'est pas l'autorité.

**Cible :** extraire le moteur A dans un microservice **`jackpot-service`** = **source de vérité unique**. Les moteurs de jeu **ne possèdent plus** de jackpots ; ils **lisent** l'autorité et **relaient** à leur WS. Les frontends lisent l'autorité.

---

## 2. Modèle canonique (porté tel quel depuis Système A)

`JackpotPot(scope, game_id, kiosk_id, tier)`, `UniqueConstraint(scope, game_id, kiosk_id, tier)` :

| Pot | scope | game_id | kiosk_id | tier | Alimenté par |
|---|---|---|---|---|---|
| **Général** | `GLOBAL` | null | null | null | **tous** les tickets, tous jeux, tous kiosques |
| **Par jeu** (Spin&Win, VolKeno) | `GAME` | `ROULETTE-TBL1` / `KENO-DRAW1` | null | null | tous les tickets **de ce jeu**, tous kiosques |
| **Local bronze/silver/gold** | `LOCAL` | game_id | kiosk_id | BRONZE/SILVER/GOLD | tickets **de ce jeu** **de ce kiosque** |

Chaque pot : `contribution_rate` (ou montant fixe), `threshold_min/max`, `current_threshold` (secret), `current_amount`, `cycle_number`. Mécanique de HIT (un ticket franchit le seuil → gagne le pot) conservée.

> **Note d'affichage Keno :** BACKEND.md modélise `medals.{bronze,silver,gold}` comme des **compteurs**. Ici les 3 niveaux locaux deviennent des **pots en argent** (modèle A). Le moteur Keno mappera les 3 montants `LOCAL` dans le payload `medals` (ou un `localJackpots`). À acter au câblage front Keno (cosmétique).

---

## 3. Contribution : synchrone à la création (inchangé fonctionnellement)

On garde le comportement actuel du Système A : la contribution se fait **à la création du ticket**, de façon **synchrone**, pour pouvoir **attribuer un HIT au ticket vendeur immédiatement** (le caissier voit le jackpot gagné sur le reçu).

```
agent-web → POST /api/tickets/ (création)
   ticket-service (dans la tx ticket):
       └── POST jackpot-service /internal/contribute { ticket_id, game_id, kiosk_id(agent_id), wager }
              └── jackpot-service: incrémente GLOBAL + GAME + LOCAL(tiers), détecte HIT, renvoie { touched_pots, hits }
       └── si hit → marque le ticket gagnant du jackpot (comme aujourd'hui)
   (jackpot-service down → la vente passe quand même ; contribution loggée/sautée, fail-open)
```

Les moteurs de jeu pour l'affichage :
```
jackpot-service ── publie ──> Redis canal `jackpot-updated` { game_id, kiosk_id?, pots }
game-*-service  ── consomme/poll ──> rebroadcast WS (jackpot_updated / medals_updated)
```

On **supprime** les canaux `jackpot-events` et `keno-jackpot-events` (feed Système B) et les `jackpot_state` des moteurs.

---

## 4. Work packages

### WP-J1 — Créer `jackpot-service` (api-endpoint-builder)
- Scaffolding (Dockerfile, entrypoint, requirements, alembic, init_db, database) — DB `casino_jackpot_db`.
- **Porter** `app/jackpot/{models,services,threshold,schemas,routes}.py` depuis ticket-service (logique inchangée).
- Endpoints :
  - `POST /internal/contribute` (clé interne) → exécute `contribute_for_ticket`, renvoie `{touched_pots, hits}`.
  - `GET /jackpots?game_id=&kiosk_id=` (public) → `{general, game, locals:{bronze,silver,gold}}` prêt pour l'affichage.
  - `GET /admin/pots`, `POST/PATCH /admin/pots`, `POST /admin/seed` (clé admin) → config/seed.
  - Publie `jackpot-updated` (Redis) à chaque contribution/override.
- Migration initiale : tables pots/contributions/wins + **seed** des pots (GLOBAL général ; GAME roulette+keno ; LOCAL créés à la volée par kiosque+jeu au 1er ticket).

### WP-J2 — `ticket-service` : déléguer la contribution (api-endpoint-builder)
- Retirer `app/jackpot/` (déplacé). Dans `create_ticket`, remplacer l'appel local par `POST {JACKPOT_SERVICE_URL}/internal/contribute` ; conserver la logique d'attribution du HIT depuis la réponse.
- Supprimer la publication `jackpot-events` **et** `keno-jackpot-events` + l'agrégation `per_kiosk_wager/per_kiosk_medals` du settlement (devenues inutiles).
- Migration : drop des tables jackpot du `casino_ticket_db`.
- Le règlement WON/LOST des tickets reste inchangé.

### WP-J3 — `game-roulette-service` : lire l'autorité (api-endpoint-builder)
- Supprimer `jackpot_service.py`, modèle `JackpotState`, `ensure_seeded`, `consume_jackpot_events`, migration `jackpot_state`.
- `welcome` + broadcast : récupérer les pots via `GET {JACKPOT_SERVICE_URL}/jackpots?game_id=ROULETTE-TBL1&kiosk_id=<code>` (cache court) ; mapper `general`→Jackpot Général, `game`→Spin&Win, `locals`→bronze/silver/gold ; rebroadcast sur `jackpot-updated`.
- `GET /jackpots` du moteur devient un proxy/relais (ou le front lit directement jackpot-service — voir WP-J5).

### WP-J4 — `game-keno-service` : lire l'autorité (api-endpoint-builder)
- Idem J3 : supprimer `jackpot_service.py`/`JackpotState`/`consume_jackpot_events`.
- Mapper vers VOLKENO : `jackpot.generalAmount = general`, `jackpot.volkenoAmount = game(KENO-DRAW1)`, `medals = locals(bronze,silver,gold)` (montants).

### WP-J5 — Frontends (component-builder)
- **backoffice** `pages/Jackpots.jsx` → **éditeur des règles de répartition** (exigence métier). Pour chaque pot (Général, par-jeu, LOCAL par kiosque×jeu), l'admin configure via `GET/POST/PATCH /api/jackpots/admin/pots` :
  - `enabled`
  - `contribution_mode` = **PERCENT** ou **FIXED** + `contribution_percent` (% de la mise) / `contribution_fixed` (XAF par ticket)
  - `threshold_min` / `threshold_max` (plage du seuil aléatoire ; le seuil courant reste **secret**, jamais affiché)
  - `reset_mode` (ZERO/SEED) + `seed_amount`
  - `winner_mode` (TRIGGER_TICKET/RANDOM_RECENT) + `recent_window_minutes`
  - `max_payout` (cap optionnel)
  - lecture seule : `current_amount`, `cycle_number`, historique des gains (`/admin/pots/{id}/wins`).
  Vue unique : 1 Général, N par-jeu, table LOCAL par (kiosque, jeu).
- **agent-web** `useKioskJackpots.js` (roulette) et `useKenoJackpots.js` (keno) : pointer sur `GET /api/jackpots?game_id=&kiosk_id=`.

### WP-J6 — Infra (general-purpose)
- `docker-compose.yml` + `.prod.yml` : service `jackpot-service` (`casino_jackpot_db`, `ROOT_PATH=/api/jackpots`, `REDIS_URL`, `ADMIN_API_KEY`, `JACKPOT_INTERNAL_API_KEY`).
- `init-databases.sql` : `CREATE DATABASE casino_jackpot_db;`
- Traefik (dev + prod) : `PathPrefix(/api/jackpots)` → `jackpot-service:8000`.
- `JACKPOT_SERVICE_URL=http://jackpot-service:8000` ajouté à ticket-service + game-roulette + game-keno.
- CI matrix : `jackpot-service`.

### WP-J7 — QA (e2e-qa-tester)
- Vendre des tickets **Roulette** et **Keno** depuis 2 kiosques.
- Vérifier : **un seul** Général grossit avec les deux jeux ; le pot GAME roulette ne bouge qu'avec des tickets roulette (idem keno) ; les LOCAL bronze/silver/gold sont distincts par (kiosque, jeu).
- Vérifier l'attribution d'un HIT au ticket vendeur (seuil franchi).

---

## 5. Séquencement
```
WP-J6 (infra) + WP-J1 (jackpot-service)        → d'abord (débloque le reste)
WP-J2 (ticket) ‖ WP-J3 (roulette) ‖ WP-J4 (keno) → contrats /internal/contribute & /jackpots gelés
WP-J5 (fronts)                                   → après endpoints
WP-J7 (QA)                                       → fin
```

## 6. Risques / points d'attention
- **Argent** : la contribution touche le solde des pots ; garder la contribution **synchrone à la création** (pas de double comptage, HIT attribuable). Fail-open si jackpot-service indisponible.
- **game_id** : les pots GAME/LOCAL doivent utiliser **exactement** le `game_id` des tickets (`ROULETTE-TBL1`, `KENO-DRAW1`).
- **Migration de valeurs** : les compteurs actuels du Système B sont des seeds de test → on **re-seed** proprement dans `jackpot-service`, pas de migration des valeurs jetables.
- **Médailles Keno** : compteurs (BACKEND.md) vs pots argent (modèle A) → mapping d'affichage à acter.
- Suppression du Système B = retrait de code dans 2 moteurs + ticket-service ; bien vérifier qu'aucun chemin ne lit plus `jackpot_state`.
