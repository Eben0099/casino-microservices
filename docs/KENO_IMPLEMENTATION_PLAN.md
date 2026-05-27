# Keno — Plan d'exécution multi-agents

**Version:** 1.0
**Date:** 2026-05-26
**Objectif:** ajouter le jeu **Keno** à la plateforme casino, *exactement comme la Roulette*, sur les trois surfaces : **WebSocket (moteur)**, **onglet Admin (backoffice)**, **onglet Caissier (agent-web)** — plus le règlement des tickets et l'infra.
**Contrat WebSocket de référence:** [`docs/BACKEND.md`](./BACKEND.md) (protocole VOLKENO). Ce document est **autoritaire** pour tout ce que le moteur émet vers le client d'affichage Keno.

> Ce plan est découpé en **work packages (WP)** assignables à des sous-agents distincts. Chaque WP liste : périmètre, fichiers, contrats, critères d'acceptation, dépendances.

---

## 0. Lecture rapide — ce qu'on construit

| Surface (onglet) | Roulette (existant) | Keno (à créer) | Sous-agent |
|---|---|---|---|
| **WebSocket / moteur** | `game-roulette-service` (`/ws/roulette`) | `game-keno-service` (`/ws/keno`) implémentant **BACKEND.md** | `api-endpoint-builder` |
| **Règlement tickets** | `ticket-service` ← `roulette-events` | `ticket-service` ← `keno-events`, paytable Keno | `api-endpoint-builder` |
| **Admin** | `backoffice` → `pages/Roulette.jsx` | `backoffice` → `pages/Keno.jsx` + onglet Paramètres + Jackpots | `component-builder` |
| **Caissier** | `agent-web` → `pages/Jeux.jsx` (roulette) | `agent-web` → `pages/Keno.jsx` (grille 1–80) | `component-builder` |
| **Infra** | compose/traefik/CI roulette | mêmes touchpoints pour keno | `general-purpose` |

Le moteur Keno **réutilise l'architecture** du moteur Roulette (boucle de phases, `ConnectionManager`, validation kiosk, `jackpot_state` Postgres + cache Redis, endpoints admin, scaffolding du service, provably-fair) mais **parle le protocole VOLKENO** de `BACKEND.md`, pas le protocole roulette.

---

## 1. Vue d'architecture

```
                    ┌─────────────────────────────────────────────────────┐
                    │                      Redis (pub/sub)                  │
                    │   keno-events            keno-jackpot-events          │
                    └───────┬───────────────────────────┬──────────────────┘
                            │ ROUND_FINISHED             │ ROUND_SETTLED
                            │ {round_id, drawn_numbers}  │ {round_id, total_wager,
                            ▼                            │  per_kiosk_wager, per_kiosk_medals}
   ┌───────────────────────────────────┐                │            ▲
   │        ticket-service             │                │            │
   │  • listen_to_keno_results()       │────────────────┘            │
   │  • calculate_keno_payout(paytable)│                             │
   │  • settle KENO tickets            │                             │
   └──────────────▲────────────────────┘                             │
                  │ POST /api/tickets/ (game_id=KENO-DRAW1,           │
                  │   round_id=<drawId>, bets=[{KENO, "5,12,...", amt}])
                  │                                                   │
   ┌──────────────┴───────────┐        ┌──────────────────────────────┴───────────┐
   │  agent-web  /keno         │        │        game-keno-service                   │
   │  (Caissier)               │        │  • game_loop: idle→preLaunch→draw→results  │
   │  KenoGrid, useKenoWs,     │◀──WS───│  • /ws/keno  (protocole BACKEND.md)        │
   │  useKenoJackpots          │  /ws/keno │  • publish keno-events ROUND_FINISHED     │
   └───────────────────────────┘        │  • consume keno-jackpot-events → jackpot_updated
                                         │  • jackpot_state (general/volkeno + medals)│
   ┌───────────────────────────┐        │  • admin: settings/jackpots/history        │
   │  backoffice /keno (Admin)  │◀──WS───│  • kiosk_validator → agent-service         │
   │  Keno.jsx, useKenoWs       │        └────────────────────────────────────────────┘
   └───────────────────────────┘
   ┌───────────────────────────┐
   │  Affichage public VOLKENO  │◀──WS── /ws/keno (ou /ws/volkeno alias)
   │  (Next.js / Unity)         │   ← consomme BACKEND.md tel quel
   └───────────────────────────┘
```

**Pourquoi des canaux Redis séparés (`keno-events`, `keno-jackpot-events`) :** `ticket-service.listen_to_roulette_results()` ne filtre **pas** par jeu et `game-roulette-service.consume_jackpot_events()` consomme `jackpot-events` sans discriminant. Si Keno publiait sur `jackpot-events`, le moteur **roulette** ferait croître ses propres pots avec les mises Keno (et inversement). Les canaux dédiés évitent toute contamination croisée. (Confirmé dans `ticket-service/app/main.py:156-322`.)

---

## 2. Décisions de conception (divergences vs Roulette à acter)

### 2.1 Protocole WebSocket : VOLKENO ≠ Roulette

Le moteur Keno **n'utilise pas** les noms de phases / messages de la roulette. Il suit `BACKEND.md` :

| Concept | Roulette (moteur actuel) | **Keno (BACKEND.md)** |
|---|---|---|
| Phases | `Betting / BetsClosing / Spinning / Result` | `idle / preLaunch / draw / results` |
| Fenêtre de mise | phase `Betting` | phase **`idle`** (240 s en prod) |
| Résultat | `result_revealed` `{result:{number,color}}` | `draw_locked` `{numbers:[20]}` |
| Stats | `stats_updated` `{stats:{...}}` | `stats_updated` `{snapshot:{...}}` |
| Horloge | `serverTime = time.time()` (secondes) | `serverTime` en **epoch ms** + `phaseStartedAt/phaseDurationMs` |
| Round id | `ROUND-<unix>` (string) | `currentDrawId` / `drawId` (**int**, +1 à l'entrée `idle`) |
| Jackpot | dict 5 clés `{general,spin2win,bronze,silver,gold}` | `jackpot{generalAmount, volkenoAmount, currency, lastHitDrawId}` |
| Médailles | (n/a — bronze/silver/gold = montants) | `medals{bronze,silver,gold}` = **compteurs par-kiosk** |
| Auth kiosk invalide | `accept()` puis `close(4404)` | **HTTP 403 au handshake** (close **avant** accept) |

### 2.2 Mapping jackpot/médailles sur `jackpot_state`

On garde la table `jackpot_state(kiosk_id, name, value, contribution_pct)` du moteur roulette, ré-instanciée dans la DB `casino_keno_db` :

- `name="general"`, `kiosk_id="__GLOBAL__"` → `jackpot.generalAmount` (montant XAF global)
- `name="volkeno"`, `kiosk_id="__GLOBAL__"` → `jackpot.volkenoAmount` (montant XAF global)
- `name in {bronze,silver,gold}`, `kiosk_id=<code>` → `medals.{tier}` (**compteur**, par-kiosk)

`get_jackpots_for_kiosk()` renvoie alors deux structures (`jackpot` + `medals`) au lieu du dict plat roulette.

### 2.3 Auth kiosk : strict pour l'affichage, souple pour l'admin

- **Affichage public + caissier** : envoient toujours `?kiosk_id=<code>`. Un code **inconnu/malformé** ⇒ **HTTP 403** au handshake (close avant `accept()`), conforme à `BACKEND.md`.
- **Backoffice admin** : se connecte **sans** `kiosk_id` (vue globale) — comme `useRouletteWs` aujourd'hui. Le moteur autorise `kiosk_id` absent = vue *global only* (medals à 0). C'est une relaxation documentée de `BACKEND.md` (qui ne concerne que l'affichage public, lequel envoie toujours un id).

> **Décision à confirmer (non bloquante)** : si on veut être 100 % strict sur BACKEND.md, le backoffice devrait lire les stats via REST polling au lieu du WS. Recommandation : garder la parité roulette (WS sans kiosk_id = global).

### 2.4 Modèle de pari Keno

- Le caissier choisit **`spots`** numéros (1–10) parmi 1–80, mise un montant.
- Stocké dans le modèle générique `TicketBet` : `bet_type="KENO"`, `bet_target="5,12,23,47,61"` (CSV trié), `amount=<XAF>`. `spots = len(picks)`.
- Règlement = `paytable[spots][matches] * amount` (voir §6.3). Aucune migration du modèle `Ticket`/`TicketBet` requise (champs déjà génériques — `bet_target` est `String(100)`).

---

## 3. Contrat WebSocket du moteur Keno (concret)

Le moteur émet **exactement** les messages de `BACKEND.md`. Rappel des payloads que `game-keno-service` doit produire (S→C) :

```jsonc
// à la connexion (et reconnexion)
{ "type":"welcome", "serverTime":<ms>, "currentDrawId":1617, "phase":"idle",
  "phaseStartedAt":<ms>, "phaseDurationMs":240000, "drawnNumbers":null,
  "stats":{/* StatsSnapshot §BACKEND.md.3 */},
  "jackpot":{"generalAmount":1500000,"volkenoAmount":500000000,"currency":"XAF","lastHitDrawId":null},
  "medals":{"bronze":0,"silver":0,"gold":0} }   // medals = vue du kiosk_id de CE socket

{ "type":"phase_changed", "serverTime":<ms>, "drawId":1617, "phase":"draw",
  "startedAt":<ms>, "durationMs":67000 }

{ "type":"draw_locked", "serverTime":<ms>, "drawId":1617,
  "numbers":[3,7,12,...,79], "lockedAt":<ms> }   // 20 entiers uniques [1..80], ORDRE DE RÉVÉLATION

{ "type":"stats_updated", "serverTime":<ms>, "snapshot":{/* recentDraws, hot, cold, consecutive, rowDistribution[8], colDistribution[10] */} }

{ "type":"jackpot_updated", "serverTime":<ms>, "jackpot":{...} }            // global
{ "type":"medals_updated",  "serverTime":<ms>, "medals":{...} }            // par-kiosk
{ "type":"pong", "clientTime":<echo>, "serverTime":<ms> }
```

**Ordre contractuel** (cf. BACKEND.md) : `phase_changed(draw)` **avant** `draw_locked` ; `stats_updated` **avant** `phase_changed(results)` ; `drawId` incrémente à l'entrée `idle`.

**Durées par défaut** (paramétrables via `/admin/settings`, lues à chaque tour) :

| Phase | Démo | Prod cible | Clé settings |
|---|--:|--:|---|
| `idle` (mise) | 30 s | 240 s | `idle_duration` |
| `preLaunch` | 2 s | 2 s | `prelaunch_duration` |
| `draw` | 67 s | 67 s | `draw_duration` |
| `results` | 5 s | 35 s | `results_duration` |

**RNG provably-fair** : réutiliser l'approche HMAC du moteur roulette, étendue pour tirer **20 numéros uniques** dans `[1..80]` à partir de `server_seed` + `drawId` (dérivation par incréments de nonce jusqu'à 20 uniques). Persister `(round_id, server_seed, server_seed_hash, drawn_numbers)` pour `/verify/{round_id}`.

---

## 4. Contrats inter-services (Redis + REST)

### 4.1 `keno-events` (publié par game-keno-service, consommé par ticket-service)
```jsonc
{ "event":"ROUND_FINISHED", "round_id":"1617", "drawn_numbers":[3,7,12,...,79] }
// publié à l'entrée de la phase `draw` (numéros connus), round_id = str(drawId)
// (optionnel) { "type":"phase_changed", "phase":"idle", "drawId":1618 }  → génération des replays
```

### 4.2 `keno-jackpot-events` (publié par ticket-service, consommé par game-keno-service)
```jsonc
{ "event":"ROUND_SETTLED", "round_id":"1617", "total_wager":120000,
  "per_kiosk_wager":{"ZHHN":50000, "AB12":70000},
  "per_kiosk_medals":{"ZHHN":{"bronze":1,"silver":0,"gold":0}} }  // medals = Phase 2 (peut être {})
```
Le moteur applique : `generalAmount += floor(total_wager * pct_general)`, `volkenoAmount += floor(total_wager * pct_volkeno)`, puis `medals[kiosk] += per_kiosk_medals[kiosk]`, et broadcast `jackpot_updated` (global) + `medals_updated` (par-kiosk concerné).

### 4.3 Ticket Keno (POST `/api/tickets/`, inchangé côté schéma)
```jsonc
{ "agent_id":"<uuid>", "game_id":"KENO-DRAW1", "round_id":"1617",
  "bets":[{ "bet_type":"KENO", "bet_target":"5,12,23,47,61", "amount":1000 }],
  "replay_rounds":1 }
```

---

## 5. Work packages (assignables aux sous-agents)

### WP1 — `game-keno-service` (moteur + WS + admin + jackpots)  → **api-endpoint-builder**
**Dépend de :** WP5 (DB/compose) pour tourner, mais peut être codé en parallèle.
**Fichiers à créer** (`services/game-keno-service/`) — scaffolding copié de `game-roulette-service` :
- `Dockerfile`, `entrypoint.sh` (msg "Keno"), `requirements.txt`, `alembic.ini`, `alembic/env.py` (DB par défaut `casino_keno_db`), `app/__init__.py`, `app/database.py`, `app/init_db.py` (générique, copié tel quel), `app/kiosk_validator.py` (copié tel quel).
- `app/models.py` : `KenoDraw(round_id, server_seed, server_seed_hash, drawn_numbers JSON, created_at)` + `JackpotState` (réutilisé tel quel).
- `app/keno_rng.py` : tirage provably-fair de 20 uniques [1..80].
- `app/rules.py` : `calculate_stats(history)` → **StatsSnapshot BACKEND.md** (recentDraws≤10, hot/cold/consecutive≤6, rowDistribution[8] = lignes de 10, colDistribution[10] = chiffre des unités). **Pas** de couleur/parité.
- `app/jackpot_service.py` : adapter `name in {general, volkeno, bronze, silver, gold}`, `get_jackpots_for_kiosk()` → `{jackpot:{generalAmount,volkenoAmount,...}, medals:{bronze,silver,gold}}`, `apply_round_settlement()` (globaux money + medals counts), `admin_set_jackpots()`, `consume`.
- `app/settings.py` : `idle_duration, prelaunch_duration, draw_duration, results_duration, min_stake, max_stake, enabled, commission_pct, default_spots`.
- `app/main.py` :
  - `game_loop()` : `idle → preLaunch → draw (emit phase_changed+draw_locked, publish keno-events ROUND_FINISHED) → stats_updated → results`, bump `drawId` à l'entrée `idle`. Times en **epoch ms**.
  - WS `/ws/keno` (+ alias `/ws/volkeno`) : kiosk_id query, **403 au handshake** si invalide (close avant accept), `welcome` immédiat, `ping`→`pong`.
  - `ConnectionManager` par-kiosk (copié de roulette) pour `medals_updated` ciblés + `jackpot_updated` global.
  - `consume_jackpot_events()` sur **`keno-jackpot-events`**.
  - Admin (clé `x-api-key`) : `GET/PATCH /admin/settings`, `GET /admin/jackpots/all`, `PATCH /admin/jackpots`, `GET /admin/history`, `GET /status`, `GET /jackpots?kiosk_id=`, `GET /verify/{round_id}`, `GET /settings/public`.
**Critères d'acceptation :**
- [ ] Un client WS avec kiosk valide reçoit `welcome` (shape BACKEND.md) puis le cycle complet.
- [ ] kiosk_id inconnu ⇒ **HTTP 403** (pas de frame).
- [ ] `phase_changed(draw)` précède `draw_locked` ; `stats_updated` précède `phase_changed(results)`.
- [ ] `draw_locked.numbers` = 20 uniques [1..80] ; `recentDraws[i].numbers` triés asc.
- [ ] `/verify/{round_id}` rejoue le tirage depuis `server_seed`.

### WP2 — `ticket-service` : règlement Keno  → **api-endpoint-builder**
**Dépend de :** rien (contrats §4 figés). Parallélisable avec WP1.
**Fichiers :**
- `app/keno_rules.py` (nouveau) : `KENO_PAYTABLE` (§6.3) + `calculate_keno_payout(bet_target, drawn_numbers, amount) -> int` (+ helper médaille tier).
- `app/main.py` : nouvelle tâche `listen_to_keno_results()` abonnée à **`keno-events`** ; `process_keno_settlement(round_id, drawn_numbers)` (batch comme roulette, `winning_number` reste NULL côté keno → utiliser un champ/colonne ou marquer via `total_payout`/`status` ; voir note migration) ; agrégation `total_wager`/`per_kiosk_wager` (+ médailles) → publish **`keno-jackpot-events`**.
- Validation création : si `game_id` commence par `KENO`, lire l'état/phase depuis `keno:current_state` (publié par le moteur) et exiger phase `idle` (fenêtre de mise) ; bornes `min_stake/max_stake` via `GET /api/keno/settings/public`.
- **Migration alembic** : ajouter `tickets.drawn_numbers (JSON, nullable)` *ou* réutiliser `winning_number` pour stocker le CSV des 20 tirés. (Recommandé : nouvelle colonne `drawn_numbers` pour ne pas surcharger la sémantique roulette.)
**Critères d'acceptation :**
- [ ] Un ticket KENO PENDING passe WON/LOST après `keno-events ROUND_FINISHED`, payout = paytable.
- [ ] `keno-jackpot-events ROUND_SETTLED` publié une seule fois/round avec `total_wager` + `per_kiosk_wager` corrects.
- [ ] Aucun ticket roulette n'est affecté par un round Keno (et inversement).

### WP3 — Backoffice : onglet **Admin Keno**  → **component-builder**
**Dépend de :** WP1 (endpoints admin + WS) pour données réelles ; mockable.
**Fichiers (`services/backoffice/src/`) :**
- `hooks/useKenoWs.js` : WS `ws://${location.host}/ws/keno`, gère `welcome/phase_changed/draw_locked/stats_updated/jackpot_updated`, reconnexion backoff ; retourne `{connected, phase, drawId, drawnNumbers, stats, jackpot, medals}`.
- `pages/Keno.jsx` (copié de `Roulette.jsx`, adapté) : barre de phase live, bande des 20 derniers tirés, **heatmap 1–80** (10×8), hot/cold, table historique (colonnes : #, Tirage, 20 numéros, Heure). **Retirer** pie couleurs / dozens / colonnes / parité.
- `pages/Parametres.jsx` : ajouter onglet `keno` + `KenoTab()` (GET/PATCH `/api/keno/admin/settings`).
- `pages/Jackpots.jsx` : rendre *game-aware* (prop `game`) ou ajouter une vue Keno : cartes globales `general`/`volkeno` + tableau médailles par-kiosk (bronze/silver/gold = compteurs).
- `App.jsx` (route `/keno`) + `components/Layout.jsx`/`Sidebar.jsx` (entrée nav "Keno" sous Jeux).
**Critères d'acceptation :**
- [ ] `/keno` affiche les phases live, la heatmap 1–80 et l'historique des tirages.
- [ ] L'onglet Paramètres Keno lit/écrit les durées et bornes de mise.
- [ ] Les jackpots Keno (general/volkeno) et médailles par-kiosk sont éditables.

### WP4 — Agent-web : onglet **Caissier Keno**  → **component-builder**
**Dépend de :** WP1 (WS + jackpots) ; WP2 (création/règlement) pour bout-en-bout.
**Fichiers (`services/agent-web/src/`) :**
- `components/KenoGrid.jsx` (nouveau) : grille 1–80 (8×10), sélection jusqu'à `spots` max, surbrillance des picks, badge "X/10". Émet un pari `bet_type="KENO"`, `bet_target=<picks CSV triés>`.
- `hooks/useKenoWs.js` : WS `/ws/keno?kiosk_id=<code>`, retourne `{phase, drawId, remaining, drawnNumbers, jackpot, medals}`. Fenêtre de mise = `phase === "idle"`.
- `hooks/useKenoJackpots.js` : `GET /keno/jackpots?kiosk_id=` → cartes (general GLOBAL, volkeno GAME, + médailles par-kiosk en tier). Poll 5 s.
- `pages/Keno.jsx` (copié de `Jeux.jsx`) : même layout (JackpotsBar, BetSlip, TicketReceipt réutilisés), centre = `KenoGrid` + sélecteur de mise + sélecteur de spots. `game_id="KENO-DRAW1"`, `round_id=drawId`.
- `pages/Jeux.jsx`/registry : passer `VK` (VolKeno) à `available:true` et faire **naviguer** la tuile vers `/keno` (les tuiles ne naviguent pas aujourd'hui).
- `App.jsx` (route `/keno`) ; `i18n/locales/fr.js`+`en.js` : section `keno` (titre, "Choisir N numéros", spots), `bet.type.KENO`, `phase.idle/preLaunch/draw/results`.
**Critères d'acceptation :**
- [ ] Le caissier sélectionne des numéros, mise, vend un ticket KENO pendant `idle`, reçoit un reçu.
- [ ] Le ticket passe WON/LOST après le tirage ; le solde caisse est débité/crédité.
- [ ] La barre de jackpots Keno s'actualise.

### WP5 — Infra & wiring  → **general-purpose**
**Dépend de :** rien. À faire **tôt** (débloque le run local de WP1/WP2).
**Fichiers :**
- `docker-compose.yml` + `docker-compose.prod.yml` : bloc `game-keno-service` (image GHCR `game-keno-service`, `container_name: casino_keno_engine`, `DATABASE_URL=.../casino_keno_db`, `ROOT_PATH=/api/keno`, `REDIS_URL`, `ADMIN_API_KEY`, `AGENT_SERVICE_URL`, labels traefik keno).
- `init-databases.sql` : `CREATE DATABASE casino_keno_db;`
- `traefik/dynamic_conf.yml` (local) + `traefik/dynamic-prod.yml` (prod) : routers/service `keno` pour `PathPrefix(/api/keno) || PathPrefix(/ws/keno) || PathPrefix(/ws/volkeno)` → `game-keno-service:8000` (+ stripprefix `/api/keno` en local).
- `.github/workflows/deploy.yml` : ajouter `game-keno-service` à `matrix.service`.
**Critères d'acceptation :**
- [ ] `docker compose up` démarre `casino_keno_engine`, crée `casino_keno_db`, applique les migrations.
- [ ] `GET /api/keno/status` répond à travers Traefik ; `/ws/keno` upgrade OK.

### WP6 — Tooling & QA bout-en-bout  → **e2e-qa-tester**
**Dépend de :** WP1–WP5.
**Fichiers :**
- `tools/keno_observer.py` (copié de `tools/jackpot_observer.py`) : WS `/ws/keno`, affiche welcome/phase/draw_locked/stats/jackpot/medals + deltas ; `--fire-tickets` crée des tickets KENO via `/api/agents/login` (réutilise le flow `--phone/--password`) avec picks aléatoires ; `--rounds`, `--tickets-per-round`.
- Scénario E2E : créer/charger un kiosk, vendre 3 tickets Keno pendant `idle`, observer le tirage, vérifier WON/LOST + deltas jackpot = `floor(total_wager * pct)`.
**Critères d'acceptation :**
- [ ] L'observer voit un cycle complet et des deltas jackpot cohérents au franc près.
- [ ] Parcours caissier (sélection→vente→tirage→reçu WON) validé via Playwright.

---

## 6. Annexes

### 6.1 Layout des numéros (BACKEND.md §"Number layout")
- `rowDistribution[8]` : lignes de 10 → `[1–10],[11–20],...,[71–80]` (tirage courant).
- `colDistribution[10]` : chiffre des unités → index 0..8 = `1,2,...,9` ; index 9 = multiples de 10.
- Fenêtre de tendance hot/cold/consecutive : ~20 derniers tirages.

### 6.2 Phases & règlement — qui déclenche quoi
1. `idle` : caissiers vendent (round_id = drawId courant).
2. `preLaunch` (2 s).
3. `draw` : moteur émet `phase_changed(draw)` + `draw_locked(numbers)` **et** publie `keno-events ROUND_FINISHED`.
4. ticket-service règle, publie `keno-jackpot-events ROUND_SETTLED`.
5. moteur émet `stats_updated` puis `phase_changed(results)`, applique le settlement jackpot et émet `jackpot_updated`/`medals_updated`.

### 6.3 Paytable Keno (proposition — **à valider business**)
Multiplicateur appliqué à la mise selon `(spots joués, matches)`. Valeurs standard 80 boules / tirage de 20 ; à ajuster pour le RTP cible.

| Spots \ Matches | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 1 | 0 | 3 | | | | | | | | | |
| 2 | 0 | 0 | 12 | | | | | | | | |
| 3 | 0 | 0 | 1 | 42 | | | | | | | |
| 4 | 0 | 0 | 1 | 4 | 120 | | | | | | |
| 5 | 0 | 0 | 0 | 2 | 12 | 800 | | | | | |
| 6 | 0 | 0 | 0 | 1 | 4 | 70 | 1600 | | | | |
| 7 | 0 | 0 | 0 | 1 | 2 | 20 | 100 | 5000 | | | |
| 8 | 0 | 0 | 0 | 0 | 2 | 10 | 50 | 1000 | 10000 | | |
| 9 | 0 | 0 | 0 | 0 | 1 | 5 | 25 | 200 | 4000 | 25000 | |
| 10 | 0 | 0 | 0 | 0 | 0 | 5 | 20 | 80 | 500 | 10000 | 100000 |

Tiers médailles (proposition) : `bronze` = gain ≥ 6 matches sur spots≥6 ; `silver` = ≥ 8 ; `gold` = match max (ex. 9/9, 10/10). Médailles = **Phase 2** (peuvent rester à 0 au MVP).

---

## 7. Séquencement

```
Sprint 0 (parallèle) :  WP5 (infra)  ┐
                        WP1 (moteur) ┤── peuvent démarrer ensemble
                        WP2 (tickets)┘
Sprint 1 (après contrats stables) :  WP3 (admin) ‖ WP4 (caissier)   (parallèle)
Sprint 2 :              WP6 (tooling + E2E)  → corrections
```
Les contrats des §3/§4 doivent être **gelés avant** WP3/WP4 (les fronts en dépendent). WP1 et WP2 partagent les contrats §4 mais ne se bloquent pas mutuellement.

---

## 8. Checklist d'acceptation maître (miroir de BACKEND.md §"Testing checklist")
- [ ] `welcome` immédiat à chaque (re)connexion, shape conforme.
- [ ] Phases exactes : `idle / preLaunch / draw / results`.
- [ ] `drawId` monotone, +1 à l'entrée `idle`.
- [ ] `phase_changed(draw)` avant `draw_locked` ; `stats_updated` avant `phase_changed(results)`.
- [ ] `draw_locked.numbers` : 20 uniques [1..80], ordre de révélation ; `recentDraws[i].numbers` triés.
- [ ] kiosk_id absent ⇒ vue global-only (admin) ; kiosk_id inconnu ⇒ **403**.
- [ ] `jackpot.generalAmount/volkenoAmount` identiques pour tous ; `medals` propres au kiosk.
- [ ] Tickets KENO réglés via `keno-events` ; jackpots Keno alimentés via `keno-jackpot-events` ; **étanchéité totale** vis-à-vis de la roulette.
- [ ] `/verify/{round_id}` rejoue le tirage.
- [ ] Caissier : vente pendant `idle`, reçu, WON/LOST, solde mis à jour.
- [ ] Admin : phases live + heatmap 1–80 + historique + édition settings/jackpots.
```
