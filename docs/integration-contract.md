# Game Provider Contract v1

**Spécification d'intégration entre les jeux de casino (notre système) et la plateforme centrale (PremierBet ou autre opérateur).**

| Champ | Valeur |
|---|---|
| Version | 1.0 (draft) |
| Statut | Proposition à valider |
| Auteur | Équipe Jeux |
| Public cible | Équipe plateforme centrale, intégrateurs B2B |

---

## 1. Vocabulaire et concepts

Tous les acteurs doivent parler le même langage. Voici les termes utilisés dans cette spec.

| Terme | Définition |
|---|---|
| **Plateforme centrale** | Le système opérateur (ex. PremierBet) qui gère le wallet, les agents, les tickets, et qui consomme nos jeux. |
| **Provider** | Notre système. Fournit les jeux comme service. |
| **Game** | Un jeu identifié par un `game_code` stable (ex. `ROULETTE_EU`, `KENO_V1`). |
| **Round** | Une instance de jeu (ex. un tirage de roulette). Identifié par un `round_id`. A un cycle de vie : `BETTING → NO_MORE_BETS → SPINNING → RESULT → CLOSED`. |
| **Ticket** | Une mise d'un joueur (ou agent) sur un round. Côté opérateur = 1 entrée dans leur ticketing. Côté provider = 1 enregistrement de pari. |
| **Bet line** | Une ligne de pari à l'intérieur d'un ticket (ex. "100 XAF sur ROUGE"). Un ticket contient 1..N bet lines. |
| **Settlement** | Calcul des gains à la fin d'un round et notification à l'opérateur. |
| **External ID** | Identifiant fourni par l'opérateur (sa clé primaire de son côté). Utilisé pour l'idempotence. |
| **Operator ID** | Identifiant unique de l'opérateur côté provider. Permet le multi-tenant. |

### Relation Round / Ticket / Bet line

```
1 Round  ─── N Tickets (1 par joueur ayant misé sur ce round)
1 Ticket ─── N Bet lines (les jetons placés par le joueur)
```

Un ticket concerne **un seul round**. Pour les jeux multi-rounds (auto-play futur), voir §13.

---

## 2. Architecture générale

### 2.1 Sens des appels

```
   ┌────────────────────────┐                    ┌─────────────────────────┐
   │ Plateforme centrale    │                    │ Provider (nous)         │
   │                        │  ──── REST ────►   │                         │
   │ ─ POS / UI agent       │                    │ ─ Catalog               │
   │ ─ Wallet               │                    │ ─ Round Engine          │
   │ ─ Ticketing            │  ◄── Webhooks ──   │ ─ RNG                   │
   │ ─ Players / Agents     │                    │ ─ Settlement            │
   │                        │  ◄── WebSocket ──  │                         │
   └────────────────────────┘                    └─────────────────────────┘
```

- **REST** : la plateforme centrale appelle le provider pour soumettre des tickets, lire l'état des rounds, etc.
- **Webhooks** : le provider appelle la plateforme pour notifier le settlement, l'annulation, etc.
- **WebSocket** : le provider pousse les changements de phase, les résultats et les stats live (consommé par la plateforme et/ou son UI).

### 2.2 URL de base

```
Production  : https://provider.example.com/v1
Preproduction: https://provider-preprod.example.com/v1
```

Toutes les routes dans cette spec sont préfixées par `/v1`.

### 2.3 Format

- Encodage : `application/json; charset=utf-8`
- Dates : ISO 8601 UTC (ex. `2026-05-09T14:32:11.482Z`)
- Devises : code ISO 4217 (ex. `XAF`, `XOF`, `EUR`, `USD`)
- Montants : entiers exprimés dans la **plus petite unité de la devise** (ex. centimes pour EUR, franc pour XAF qui n'a pas de décimales)
- IDs : UUID v4 quand générés par le provider, sinon string libre fournie par l'opérateur

---

## 3. Authentification

Le provider supporte **trois méthodes** d'authentification, configurables par opérateur. Lors de l'onboarding d'un opérateur, on choisit la méthode et on échange les credentials via un canal sécurisé hors-bande.

### 3.1 HMAC-SHA256 (recommandé)

Méthode par défaut. Standard dans l'industrie betting (Pragmatic, Evolution, etc.).

L'opérateur signe chaque requête avec un secret partagé.

**Headers requis** :
```
X-Operator-Id: pb-prod
X-Timestamp: 1715260331
X-Nonce: 7f3a2e1b
X-Signature: hex(hmac_sha256(secret, payload))
```

**Payload signé** :
```
{METHOD}\n{PATH}\n{X-Timestamp}\n{X-Nonce}\n{BODY_SHA256_HEX}
```

Règles :
- Timestamp tolérance : ±60 secondes
- Nonce stocké côté provider pendant 5 minutes (anti-replay)
- Si pas de body : `BODY_SHA256_HEX` = `e3b0c44...` (sha256 du vide)

### 3.2 OAuth2 Client Credentials

Pour les opérateurs disposant déjà d'un IDP.

```
POST /v1/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=...&client_secret=...
→ { "access_token": "...", "expires_in": 3600, "token_type": "Bearer" }
```

Ensuite :
```
Authorization: Bearer {access_token}
X-Operator-Id: pb-prod
```

### 3.3 IP whitelist + clé statique

Pour les intégrations simples / réseaux fermés.

```
X-Operator-Id: pb-prod
X-Api-Key: {static-key}
```

Le provider rejette toute requête dont l'IP source n'est pas dans la liste blanche de l'opérateur. La clé seule ne suffit pas.

### 3.4 Identification multi-tenant

Le header `X-Operator-Id` est **toujours obligatoire**, quelle que soit la méthode d'auth. Il permet au provider d'isoler les données entre opérateurs.

### 3.5 Webhooks sortants

Quand le provider appelle l'opérateur (webhooks), le **même schéma HMAC** est appliqué dans l'autre sens. Le secret webhook est distinct du secret API.

---

## 4. Endpoints REST

### 4.1 Catalogue

#### `GET /games`
Liste les jeux disponibles pour cet opérateur.

**Réponse 200**
```json
{
  "games": [
    {
      "code": "ROULETTE_EU",
      "name": "Spin & Win European Roulette",
      "category": "TABLE",
      "rtp": 0.973,
      "currencies": ["XAF", "XOF", "EUR"],
      "min_stake_per_line": 50,
      "max_stake_per_ticket": 500000,
      "round_duration_seconds": 60
    }
  ]
}
```

#### `GET /games/{game_code}`
Détails complets d'un jeu, incluant le catalogue des types de paris (utile pour rendre l'UI côté opérateur).

**Réponse 200**
```json
{
  "code": "ROULETTE_EU",
  "name": "Spin & Win European Roulette",
  "version": "1.0",
  "rtp": 0.973,
  "currencies": ["XAF"],
  "phases": ["BETTING", "NO_MORE_BETS", "SPINNING", "RESULT"],
  "round_duration_seconds": 60,
  "betting_window_seconds": 45,
  "bet_types": [
    {
      "code": "STRAIGHT",
      "label": "Plein",
      "target_schema": { "type": "integer", "min": 0, "max": 36 },
      "payout_multiplier": 36,
      "min_amount": 50,
      "max_amount": 50000
    },
    {
      "code": "SPLIT",
      "label": "Cheval",
      "target_schema": { "type": "array", "items": "integer", "length": 2, "rule": "adjacent_on_layout" },
      "payout_multiplier": 18
    },
    {
      "code": "RED",
      "label": "Rouge",
      "target_schema": { "type": "null" },
      "payout_multiplier": 2
    },
    { "code": "BLACK", "...": "..." },
    { "code": "EVEN", "...": "..." },
    { "code": "ODD", "...": "..." },
    { "code": "LOW", "label": "1-18", "payout_multiplier": 2 },
    { "code": "HIGH", "label": "19-36", "payout_multiplier": 2 },
    { "code": "DOZEN", "...": "..." },
    { "code": "COLUMN", "...": "..." }
  ]
}
```

> Note : la liste complète et le format exact des `target_schema` pour la roulette sont en **Annexe A**.

### 4.2 Rounds

#### `GET /games/{game_code}/rounds/active`
Retourne le round actuellement ouvert pour les paris (s'il y en a un).

**Réponse 200**
```json
{
  "round_id": "ROUND-2026050914321100",
  "game_code": "ROULETTE_EU",
  "phase": "BETTING",
  "phase_started_at": "2026-05-09T14:32:11.000Z",
  "betting_closes_at": "2026-05-09T14:32:56.000Z",
  "result_expected_at": "2026-05-09T14:33:11.000Z",
  "seed_hash": "9e3f...a1b2"
}
```

**Réponse 404** : pas de round actif (ex. entre deux rounds, maintenance).

`seed_hash` = engagement crypto du provider sur le résultat (révélé après tirage). Voir §10.

#### `GET /games/{game_code}/rounds/{round_id}`
État d'un round précis. Permet à l'opérateur de récupérer l'état après une coupure.

### 4.3 Tickets

#### `POST /games/{game_code}/tickets`
**L'endpoint principal.** L'opérateur soumet un ticket avec ses bet lines.

**Requête**
```json
{
  "external_ticket_id": "PB-TKT-2026-12345",
  "external_player_ref": "agent-67",
  "round_id": "ROUND-2026050914321100",
  "currency": "XAF",
  "bet_lines": [
    { "type": "STRAIGHT", "target": 17,   "amount": 100 },
    { "type": "RED",      "target": null, "amount": 400 },
    { "type": "COLUMN",   "target": 2,    "amount": 200 }
  ]
}
```

**Réponse 201**
```json
{
  "ticket_id": "tk_8a7b6c5d-...",
  "external_ticket_id": "PB-TKT-2026-12345",
  "round_id": "ROUND-2026050914321100",
  "status": "PENDING",
  "currency": "XAF",
  "total_stake": 700,
  "max_potential_payout": 3700,
  "accepted_lines": [
    { "index": 0, "type": "STRAIGHT", "target": 17,   "amount": 100, "potential_payout": 3600 },
    { "index": 1, "type": "RED",      "target": null, "amount": 400, "potential_payout": 800 },
    { "index": 2, "type": "COLUMN",   "target": 2,    "amount": 200, "potential_payout": 600 }
  ],
  "settles_at": "2026-05-09T14:33:11.000Z",
  "created_at": "2026-05-09T14:32:30.000Z"
}
```

**Erreurs possibles** : voir §8.

**Idempotence** : si l'opérateur réémet la même requête (même `external_ticket_id`), le provider renvoie la **même réponse 201** sans doubler le pari. Voir §7.

#### `GET /tickets/{ticket_id}`
Pour récupérer l'état d'un ticket (utile en cas de webhook perdu côté opérateur).

#### `GET /tickets/by-external/{external_ticket_id}`
Lookup par ID opérateur. Utile pour idempotence côté client.

#### `POST /tickets/{ticket_id}/cancel`
Demande d'annulation **avant** tirage. Renvoie 200 si annulé, 409 si la fenêtre est dépassée.

```json
{ "reason": "PLAYER_REQUEST" }
```

---

## 5. WebSocket

### 5.1 URL

```
wss://provider.example.com/v1/games/{game_code}/ws
```

L'authentification WS se fait via :
- Query param `?token=...` pour OAuth2
- Query param `?signature=...&ts=...&nonce=...` pour HMAC
- IP whitelist + `?api_key=...` pour la 3e méthode

Header `X-Operator-Id` ou query `?operator_id=...` requis.

### 5.2 Messages serveur → client

Tous les messages ont la forme :
```json
{ "event": "...", "data": { ... }, "ts": "2026-05-09T14:32:11Z" }
```

**`welcome`** — émis à la connexion
```json
{ "event": "welcome", "data": { "round": { /* objet round */ }, "server_time": "..." } }
```

**`phase_changed`**
```json
{ "event": "phase_changed", "data": {
  "round_id": "ROUND-...",
  "phase": "NO_MORE_BETS",
  "next_phase_at": "2026-05-09T14:33:00Z"
}}
```

**`round_started`** / **`round_ended`** — borne haute/basse d'un round.

**`result_revealed`**
```json
{ "event": "result_revealed", "data": {
  "round_id": "ROUND-...",
  "result": { "number": 17, "color": "RED", "parity": "ODD", "dozen": 2, "column": 2 },
  "seed": "raw-seed-revealed",
  "nonce": "...",
  "verification_url": "https://provider.example.com/v1/verify/ROUND-..."
}}
```

**`stats_updated`** — agrégats live (utile pour dashboards opérateurs)
```json
{ "event": "stats_updated", "data": {
  "last_numbers": [17, 5, 23, 0, 11],
  "color_counts": { "RED": 142, "BLACK": 137, "GREEN": 7 },
  "hot_numbers": [17, 23],
  "cold_numbers": [4, 31]
}}
```

### 5.3 Reconnexion

Le client doit implémenter un backoff exponentiel : 1s → 2s → 4s → 8s → max 30s. À la reconnexion, il reçoit à nouveau un `welcome` avec l'état courant.

---

## 6. Webhooks (provider → plateforme)

### 6.1 Configuration

L'opérateur déclare lors de l'onboarding :
- `webhook_url` (HTTPS obligatoire)
- `webhook_secret` (pour signature HMAC sortante)

### 6.2 Format

Tous les webhooks ont :
```
POST {webhook_url}/{event_type}
X-Provider-Signature: hex(hmac_sha256(webhook_secret, body))
X-Webhook-Id: wh_<uuid>
X-Webhook-Attempt: 1
Content-Type: application/json
```

L'opérateur doit répondre **HTTP 2xx** dans les 5 secondes pour confirmer la réception.

### 6.3 Politique de retry

Si pas de 2xx dans 5s : retry avec backoff exponentiel.

| Tentative | Délai | |
|---|---|---|
| 1 | immédiat | |
| 2 | +30s | |
| 3 | +2min | |
| 4 | +10min | |
| 5 | +1h | |
| 6 | +6h | |
| 7 | +24h | abandon → état `WEBHOOK_FAILED` |

L'opérateur peut toujours faire un `GET /tickets/{id}` pour récupérer l'état manuellement.

### 6.4 Événements

#### `ticket_settled`
Émis dès que le round est terminé et les bet lines réglées.

```json
{
  "event_id": "evt_...",
  "ticket_id": "tk_...",
  "external_ticket_id": "PB-TKT-2026-12345",
  "round_id": "ROUND-...",
  "result": { "number": 17, "color": "RED", "parity": "ODD", "dozen": 2, "column": 2 },
  "currency": "XAF",
  "total_stake": 700,
  "total_payout": 3600,
  "net": 2900,
  "bet_lines": [
    { "index": 0, "won": true,  "payout": 3600, "details": {} },
    { "index": 1, "won": false, "payout": 0,    "details": {} },
    { "index": 2, "won": false, "payout": 0,    "details": {} }
  ],
  "settled_at": "2026-05-09T14:33:11.480Z"
}
```

#### `ticket_cancelled`
Annulation d'un ticket avant tirage (déclenchée par `POST /tickets/{id}/cancel` ou par règle métier).
```json
{
  "ticket_id": "tk_...",
  "external_ticket_id": "PB-TKT-...",
  "reason": "PLAYER_REQUEST | OPERATOR_REQUEST | TIME_EXPIRED",
  "refund_amount": 700,
  "cancelled_at": "..."
}
```

#### `round_voided`
Annulation totale d'un round (panne RNG, anomalie). Tous les tickets concernés sont remboursés.
```json
{
  "round_id": "ROUND-...",
  "reason": "RNG_FAILURE | TECHNICAL_INCIDENT | REGULATOR_REQUEST",
  "affected_ticket_ids": ["tk_...", "tk_..."],
  "voided_at": "..."
}
```

L'opérateur reçoit ensuite un `ticket_cancelled` pour chaque ticket affecté.

---

## 7. Idempotence

### 7.1 Côté soumission de ticket

L'opérateur **doit** fournir un `external_ticket_id` unique. Le provider stocke ce mapping et :
- Si un ticket avec ce `external_ticket_id` existe **et que le payload est identique** : renvoie la réponse précédente avec le même status code (201 ou autre).
- Si un ticket existe **et que le payload diffère** : renvoie `409 Conflict` avec `code: EXTERNAL_ID_MISMATCH`.

Cette règle protège contre les doubles débits côté opérateur.

### 7.2 Côté webhooks

Chaque webhook a un `X-Webhook-Id` unique. L'opérateur doit le déduplicater côté réception. Un même événement peut être livré plusieurs fois en cas de retry après timeout.

---

## 8. Codes d'erreur

Format standard :
```json
{
  "error": {
    "code": "INVALID_BET_TYPE",
    "message": "Bet type 'FOO' is not supported by ROULETTE_EU.",
    "details": { "field": "bet_lines[0].type" },
    "request_id": "req_..."
  }
}
```

| Code | HTTP | Description |
|---|---|---|
| `UNAUTHENTICATED` | 401 | Signature invalide, token expiré, IP non autorisée |
| `OPERATOR_NOT_FOUND` | 401 | Header X-Operator-Id inconnu |
| `FORBIDDEN_GAME` | 403 | Cet opérateur n'est pas autorisé sur ce game_code |
| `GAME_NOT_FOUND` | 404 | game_code inexistant |
| `ROUND_NOT_FOUND` | 404 | round_id inexistant |
| `ROUND_CLOSED` | 409 | La fenêtre de paris est fermée pour ce round |
| `ROUND_VOIDED` | 410 | Le round a été annulé |
| `INVALID_BET_TYPE` | 422 | Type de pari inconnu pour ce jeu |
| `INVALID_BET_TARGET` | 422 | Cible (target) invalide pour ce type |
| `BET_AMOUNT_TOO_LOW` | 422 | Montant sous le minimum |
| `BET_AMOUNT_TOO_HIGH` | 422 | Montant au-dessus du maximum |
| `STAKE_LIMIT_EXCEEDED` | 422 | Total ticket dépasse le max |
| `CURRENCY_NOT_SUPPORTED` | 422 | Devise non supportée par ce jeu |
| `EXTERNAL_ID_MISMATCH` | 409 | external_ticket_id existe avec un payload différent |
| `TICKET_NOT_CANCELLABLE` | 409 | Trop tard pour annuler |
| `RATE_LIMITED` | 429 | Trop de requêtes (voir Retry-After) |
| `INTERNAL_ERROR` | 500 | Erreur serveur (à logger côté opérateur) |
| `MAINTENANCE` | 503 | Maintenance planifiée |

---

## 9. Multi-devises

- Le provider **n'effectue aucune conversion**.
- L'opérateur déclare la devise du ticket dans la requête.
- Le provider vérifie que la devise est supportée par le jeu (cf. `currencies` dans `GET /games/{code}`).
- Tous les montants liés à un ticket (stake, payout) sont dans cette devise.
- Les limites min/max de paris sont déclarées par devise dans le catalogue (à étendre côté provider quand on supporte de nouvelles devises).

---

## 10. Provably Fair / Transparence du RNG

Pour permettre à l'opérateur (et éventuellement au régulateur) de vérifier qu'aucun tirage n'a été manipulé :

### 10.1 Avant le round
À l'ouverture du round, le provider expose un **`seed_hash`** :
```
seed_hash = sha256(server_seed)
```
Le `server_seed` est gardé secret jusqu'à la résolution.

### 10.2 Pendant les paris
L'opérateur (ou le joueur via lui) peut fournir un **client_seed** optionnel à inclure dans le calcul :
```
POST /games/{code}/rounds/{id}/client-seed
{ "client_seed": "user-provided-string" }
```

### 10.3 Après le round
Au moment du `result_revealed`, le provider expose :
- `server_seed` (en clair)
- `client_seed` (si fourni)
- `nonce` (numéro du round)
- Algorithme : `result = HMAC_SHA256(server_seed, client_seed:nonce) mod 37`

L'opérateur peut **vérifier indépendamment** que :
1. `sha256(server_seed) == seed_hash` annoncé avant le round
2. Le HMAC redonne bien le numéro tiré

### 10.4 Endpoint de vérification publique
```
GET /v1/verify/{round_id}
→ {
  "server_seed": "...",
  "client_seed": "...",
  "nonce": 12345,
  "result": 17,
  "algorithm": "HMAC_SHA256(server_seed, client_seed:nonce) mod 37"
}
```

Note : si une certification (eCOGRA, GLI-19) devient nécessaire, ce schéma est déjà compatible.

---

## 11. Versionnage

- Le contrat est versionné dans l'URL : `/v1/`, `/v2/`, etc.
- Une version reste supportée **au minimum 12 mois** après l'annonce de sa dépréciation.
- Les ajouts (nouveaux champs optionnels, nouveaux jeux, nouveaux événements WS) sont rétro-compatibles **dans la même version**.
- Les changements breaking nécessitent une nouvelle version.

### Politique de changement
Tout changement breaking est annoncé :
- 90 jours minimum à l'avance
- Via webhook `provider_announcement` + email aux contacts techniques opérateur
- Avec une période de coexistence (v1 et v2 disponibles simultanément)

---

## 12. Limites & rate limiting

| Limite | Valeur par défaut |
|---|---|
| Requêtes REST par opérateur | 100 req/s, 5000 req/min |
| Soumissions de tickets par round | 10 000 |
| Bet lines par ticket | 100 |
| Taille de payload | 64 KB |
| Connexions WS simultanées par opérateur | 50 |

Dépassement → `429 Rate Limited` avec header `Retry-After`. Limites ajustables par contrat.

---

## 13. Modes futurs (v2 ready)

Anticipés mais **pas implémentés en v1** :

### 13.1 Auto-play / multi-rounds
Un ticket peut couvrir N rounds (ex. "10 spins automatiques sur ROUGE"). Le provider émettrait alors :
- 1 `ticket_partial_settlement` par round
- 1 `ticket_settled` final agrégé

### 13.2 Bonus / free spins
Champ `bonus_ref` optionnel sur le ticket pour signaler que la mise vient d'un bonus. Le provider applique alors les règles du bonus (mise virtuelle, conversion en réel sous condition).

### 13.3 Side bets
Pour les jeux multi-niveaux (ex. blackjack avec side bets), le ticket pourra avoir des `bet_groups` au lieu d'un seul `bet_lines` plat.

### 13.4 Live dealer
Pour les jeux à croupier humain, ajout d'un champ `dealer_session_id` et d'événements WS supplémentaires (`dealer_action`, `chat_message`).

---

## Annexe A — Roulette européenne : catalogue des paris

Roulette à 37 cases (0 à 36). RTP théorique : 1 - 1/37 ≈ 97.30%.

| Code | Label | Cible (`target`) | Multiplicateur |
|---|---|---|---|
| `STRAIGHT` | Plein | un nombre 0..36 | x36 |
| `SPLIT` | Cheval | 2 nombres adjacents | x18 |
| `STREET` | Transversale | 3 nombres d'une ligne | x12 |
| `CORNER` | Carré | 4 nombres formant un carré | x9 |
| `SIX_LINE` | Sixain | 6 nombres de 2 lignes adjacentes | x6 |
| `DOZEN` | Douzaine | 1 / 2 / 3 (pour 1-12, 13-24, 25-36) | x3 |
| `COLUMN` | Colonne | 1 / 2 / 3 | x3 |
| `RED` | Rouge | null | x2 |
| `BLACK` | Noir | null | x2 |
| `EVEN` | Pair | null | x2 |
| `ODD` | Impair | null | x2 |
| `LOW` | 1-18 | null | x2 |
| `HIGH` | 19-36 | null | x2 |

> Le multiplicateur inclut la mise (ex. STRAIGHT à x36 sur 100 = retour de 3600 dont 100 de mise initiale).

### Validation des cibles

**SPLIT** : les 2 numéros doivent être adjacents sur le tapis (ex. [1,2] valide, [1,4] valide, [1,5] invalide).
**STREET** : les 3 numéros doivent former une ligne horizontale (ex. [1,2,3]).
**CORNER** : les 4 numéros forment un carré 2x2 (ex. [1,2,4,5]).
**SIX_LINE** : 6 numéros de 2 streets adjacents (ex. [1,2,3,4,5,6]).

Le provider rejette les cibles invalides avec `INVALID_BET_TARGET`.

---

## Annexe B — Cycle de vie d'un round

```
   ┌──────────┐      ┌──────────────┐      ┌──────────┐      ┌─────────┐      ┌────────┐
   │ BETTING  │ ───► │NO_MORE_BETS  │ ───► │ SPINNING │ ───► │ RESULT  │ ───► │ CLOSED │
   └──────────┘      └──────────────┘      └──────────┘      └─────────┘      └────────┘
        ▲                                                                        │
        │                                                                        │
        └────────────────────────────  nouveau round  ◄────────────────────────┘

Durées par défaut (configurables par jeu) :
- BETTING        : 45s   (paris ouverts)
- NO_MORE_BETS   :  3s   (transition, paris fermés)
- SPINNING       :  7s   (animation)
- RESULT         :  5s   (résultat affiché)
- CLOSED → BETTING:  0s  (round suivant ouvre immédiatement)
```

---

## Annexe C — Exemple complet : un round de roulette

### 1. Round s'ouvre (WS)
```json
{ "event": "round_started", "data": { "round_id": "ROUND-2026050914321100", "betting_closes_at": "2026-05-09T14:32:56Z", "seed_hash": "9e3f...a1b2" }}
```

### 2. Joueur place un pari (REST)
```
POST /v1/games/ROULETTE_EU/tickets
X-Operator-Id: pb-prod
X-Signature: ...
{ "external_ticket_id": "PB-12345", "external_player_ref": "ag-67", "round_id": "ROUND-...", "currency": "XAF", "bet_lines": [{ "type": "STRAIGHT", "target": 17, "amount": 100 }]}
→ 201 { "ticket_id": "tk_...", "status": "PENDING", "total_stake": 100, "max_potential_payout": 3600 }
```

### 3. Fermeture des paris (WS)
```json
{ "event": "phase_changed", "data": { "round_id": "ROUND-...", "phase": "NO_MORE_BETS" }}
```

### 4. Tirage et résultat (WS)
```json
{ "event": "result_revealed", "data": {
  "round_id": "ROUND-...",
  "result": { "number": 17, "color": "RED" },
  "server_seed": "abcd1234...",
  "nonce": 1234,
  "verification_url": "https://provider.example.com/v1/verify/ROUND-..."
}}
```

### 5. Settlement (Webhook)
```
POST {operator_webhook}/ticket_settled
X-Provider-Signature: ...
{ "ticket_id": "tk_...", "external_ticket_id": "PB-12345", "result": { "number": 17 }, "total_stake": 100, "total_payout": 3600, "bet_lines": [{ "index": 0, "won": true, "payout": 3600 }]}
→ 200 OK (l'opérateur crédite le wallet de son côté)
```

---

## Questions ouvertes pour l'opérateur

À discuter et figer avant l'implémentation :

1. **Méthode d'auth retenue** ? (HMAC recommandé)
2. **URL et format webhook** côté opérateur — un endpoint par event_type ou un endpoint unique avec dispatch sur `event` ?
3. **Devises supportées** au lancement ?
4. **Comportement en cas d'`INTERNAL_ERROR`** sur soumission ticket — opérateur retry automatique ou intervention humaine ?
5. **SLA sur le webhook de settlement** — combien de temps maximum entre `result_revealed` et `ticket_settled` reçu côté opérateur ?
6. **Politique de cancellation** — autorisée ou interdite ? Si autorisée, fenêtre exacte (jusqu'à NO_MORE_BETS ? ou jusqu'à RESULT ?) ?
7. **Identifiants joueur** — l'opérateur veut-il qu'on stocke le `external_player_ref` (utile pour stats per-player) ou juste pass-through ?
8. **Round duration** — fixe ou paramétrable par opérateur ? (Ex. agence physique = 90s, online = 30s.)

---

## Changelog

| Version | Date | Changements |
|---|---|---|
| 1.0-draft | 2026-05-09 | Première proposition |
