# AGDTech Casino Backend

Plateforme de casino multi-jeux (roulette europeenne en production, autres jeux en preparation) basee sur une architecture microservices FastAPI + Postgres + Redis, derriere une gateway Traefik. Deux clients web React sont fournis (POS agent + backoffice admin). Un client Unity se connecte au moteur de jeu via WebSocket pour la roulette en temps reel.

---

## Sommaire

1. [Architecture](#architecture)
2. [Lancement local en 2 minutes](#lancement-local-en-2-minutes)
3. [URLs et points d'acces](#urls-et-points-dacces)
4. [Authentification](#authentification)
5. [API REST — endpoints par service](#api-rest--endpoints-par-service)
6. [Protocole WebSocket roulette (Unity)](#protocole-websocket-roulette-unity)
7. [Types de paris (roulette)](#types-de-paris-roulette)
8. [Cycle d'un round](#cycle-dun-round)
9. [Variables d'environnement](#variables-denvironnement)
10. [Provably fair](#provably-fair)
11. [Bases de donnees](#bases-de-donnees)
12. [Depannage](#depannage)

---

## Architecture

```
                              ┌───────────────────────────────┐
                              │        Traefik (port 80)      │
                              └───────────────────────────────┘
                                          │
   ┌───────────────────────┬──────────────┼──────────────────┬────────────────────────┐
   │                       │              │                  │                        │
┌─────────────┐   ┌────────────────┐  ┌─────────────┐  ┌────────────────────┐  ┌──────────────┐
│agent-service│   │ ticket-service │  │display-srv  │  │game-roulette-srv   │  │ backoffice / │
│ /api/agents │   │ /api/tickets   │  │/api/display │  │/api/roulette + /ws │  │ agent-web    │
└─────────────┘   └────────────────┘  └─────────────┘  └────────────────────┘  └──────────────┘
       │                 │                  │                   │
       ├───── Postgres ──┼──────────────────┼───────────────────┘
       │                 │                  │
       └───── Redis ◄──── pub/sub roulette-events ──────► Unity / Web (WebSocket)
```

| Service | Tech | Role | DB |
|---|---|---|---|
| `agent-service` | FastAPI + Postgres | Agents, caisses, transactions, login JWT | `casino_agent_db` |
| `ticket-service` | FastAPI + Postgres + Redis | Emission/paiement tickets, settlement auto | `casino_ticket_db` |
| `game-roulette-service` | FastAPI + Postgres + Redis | Moteur de jeu (state machine), RNG, WS | `casino_roulette_db` |
| `display-service` | FastAPI + Redis | Relai WebSocket pour clients passifs | (stateless) |
| `backoffice` | React 18 + Vite + Tailwind | Console admin (multi-jeux) | — |
| `agent-web` | React 18 + Vite + Tailwind | POS agent | — |

**Communication inter-services** : HTTP synchrone (ticket -> agent) + Redis Pub/Sub (roulette -> ticket pour le settlement, roulette -> display pour la diffusion).

---

## Lancement local en 2 minutes

### Pre-requis
- Docker Desktop >= 4.20
- Port 80 et 8080 libres

### Demarrage

```bash
git clone https://github.com/agdtechbet/casino-backend.git
cd casino-backend
docker compose up -d --build
```

Tous les services demarrent automatiquement, les migrations Alembic s'executent au boot, le moteur de roulette commence sa boucle de tours.

Verifier que tout est OK :
```bash
docker compose ps         # tous les services doivent etre "running" / "healthy"
docker compose logs -f game-roulette-service   # voir le cycle BETTING > SPINNING > RESULT
```

### Arret / Reset

```bash
docker compose down              # arrete tout (les donnees postgres restent)
docker compose down -v           # arrete + supprime les volumes (reset complet)
```

---

## URLs et points d'acces

Tout transite par Traefik sur le port **80**.

| URL | Service | Usage |
|---|---|---|
| http://localhost/ | backoffice | Console admin (login API key) |
| http://localhost/agents/pos | agent-web | POS agent (login phone/password) |
| http://localhost/api/agents/docs | agent-service | **Swagger** agents/caisse/auth |
| http://localhost/api/tickets/docs | ticket-service | **Swagger** tickets |
| http://localhost/api/roulette/docs | game-roulette-service | **Swagger** roulette |
| http://localhost/api/display/docs | display-service | **Swagger** display |
| ws://localhost/ws/roulette | game-roulette-service | **WebSocket Unity (recommande)** |
| ws://localhost/api/display/ws/roulette | display-service | WebSocket relai (lecture seule) |
| http://localhost:8080 | traefik | Dashboard Traefik |

> **Pour Unity**, utiliser de preference `ws://localhost/ws/roulette` qui est sur le moteur de jeu lui-meme. `display-service` est un relai pour les ecrans passifs sans charge bidirectionnelle.

En production (ALB/ECS), remplacer `localhost` par le DNS de l'ALB. Les chemins (`/api/agents`, `/ws/roulette`...) restent identiques.

---

## Authentification

Deux mecanismes coexistent :

### 1. JWT (agents/caissiers)
Utilise par `agent-service` et `ticket-service` pour proteger les endpoints "POS".

- Login : `POST /api/agents/login` avec `{ phone, password }`
- Reponse : `{ access_token, token_type: "bearer", agent_id, agent_name }`
- A chaque requete protegee : header `Authorization: Bearer <access_token>`

Algo : HS256, secret `JWT_SECRET` (env), `sub` = `agent_id` (UUID).

### 2. Admin API Key (backoffice)
Utilise pour les endpoints `/admin/*` (CRUD agents, stats globales, historique...).

- Header : `X-API-Key: <ADMIN_API_KEY>`
- Cle par defaut (a remplacer en prod) : `CleSuperSecreteBackoffice2026`

> Le moteur de roulette **n'expose aucun endpoint protege par JWT** — seuls les endpoints admin (`/admin/history`) sont keyguarded. Le WebSocket est public (lecture seule).

---

## API REST — endpoints par service

### `agent-service` — `/api/agents`

| Methode | Path | Auth | Description |
|---|---|---|---|
| POST | `/login` | public | Login agent (phone + password) |
| POST | `/` | admin key | Creer un agent (+caisse) |
| POST | `/register` | admin key | Idem (alias) |
| GET | `/` | admin key | Liste paginee des agents |
| GET | `/admin/stats` | admin key | Nombre d'agents actifs |
| GET | `/admin/transactions?skip=&limit=` | admin key | Toutes les transactions de caisse |
| GET | `/admin/{agent_id}` | admin key | Detail agent + caisse |
| PATCH | `/admin/{agent_id}` | admin key | MAJ agent (suspension, kiosk...) |
| GET | `/{agent_id}` | JWT | Detail agent (self) |
| PATCH | `/{agent_id}` | JWT | MAJ agent (self) |
| POST | `/{agent_id}/provision` | admin key | Approvisionner / debiter une caisse |
| GET | `/status` | public | Healthcheck |

**Schema agent** :
```json
{
  "id": "uuid",
  "phone": "string",
  "display_name": "string",
  "kiosk_name": "string|null",
  "kiosk_location": "string|null",
  "role": "AGENT | SUPERVISOR | ADMIN",
  "is_active": true,
  "is_suspended": false
}
```

**Provision** :
```json
{
  "amount": 50000,
  "tx_type": "PROVISION | BET_RECEIVED | PAYOUT | REVERSAL | ADJUSTMENT | COMMISSION",
  "description": "string",
  "reference": "string|null"
}
```

### `ticket-service` — `/api/tickets`

| Methode | Path | Auth | Description |
|---|---|---|---|
| POST | `/` | JWT | Creer un ticket (multi-paris) |
| GET | `/{short_code}` | JWT | Lire un ticket par code |
| POST | `/{short_code}/payout` | JWT | Payer un ticket gagnant |
| GET | `/admin/stats` | admin key | Total wager / payout / tickets |
| GET | `/admin/agents-performance` | admin key | Top 5 agents par volume |
| GET | `/status` | public | Healthcheck |

**Creer un ticket** (`POST /api/tickets/`) :
```json
{
  "agent_id": "uuid-de-l-agent",
  "game_id": "ROULETTE-TBL1",
  "round_id": "ROUND-1714986300",
  "bets": [
    { "bet_type": "STRAIGHT", "bet_target": "17", "amount": 1000 },
    { "bet_type": "COLOR",    "bet_target": "RED", "amount": 500 },
    { "bet_type": "DOZEN",    "bet_target": "2nd", "amount": 200 }
  ]
}
```

Le serveur verifie que la roulette est en phase `Betting` ET que le `round_id` correspond au round courant. Sinon : 400.

**Reponse ticket** :
```json
{
  "id": "uuid",
  "short_code": "TK-20260507-A1B2C3",
  "agent_id": "uuid",
  "game_id": "ROULETTE-TBL1",
  "round_id": "ROUND-1714986300",
  "status": "PENDING | WON | LOST | PAID | CANCELLED",
  "total_wager": 1700,
  "total_payout": 0,
  "winning_number": null,
  "created_at": "2026-05-07T10:00:00",
  "bets": [ { "bet_type": "...", "bet_target": "...", "amount": 1000, "is_winning": false, "payout": 0 } ]
}
```

### `game-roulette-service` — `/api/roulette` + `/ws/roulette`

| Methode | Path | Auth | Description |
|---|---|---|---|
| GET | `/status` | public | Etat actuel du jeu (round_id, phase, result) |
| GET | `/admin/history` | admin key | 10 derniers rounds avec server_seed reveles |
| WS | `/ws/roulette` | public | WebSocket principal (Unity) |
| WS | `/api/display/ws/roulette` | public | Alias Traefik (meme chose) |

### `display-service` — `/api/display`

| Methode | Path | Auth | Description |
|---|---|---|---|
| GET | `/history` | public | Liste des derniers numeros (pour stats) |
| WS | `/ws/roulette` | public | Relai WS lecture seule |

---

## Protocole WebSocket roulette (Unity)

URL : `ws://localhost/ws/roulette` (en local) ou `ws://<alb-dns>/ws/roulette` (prod).

**Pas d'authentification** — la connexion est ouverte. Les messages sont du JSON. Tous les timestamps `serverTime` sont des `float` UNIX (secondes).

### A la connexion : `welcome`
Le serveur pousse immediatement l'etat courant.
```json
{
  "type": "welcome",
  "serverTime": 1714986300.123,
  "currentGameId": "ROUND-1714986300",
  "currentPhase": "Betting",
  "phaseStartedAt": 1714986300.0,
  "phaseDuration": 30.0,
  "result": null
}
```
> Si la phase est `Spinning` ou `Result`, `result` contient deja `{ "number", "color", "isEven", "isHigh" }`.

### A chaque transition de phase : `phase_changed`
```json
{
  "type": "phase_changed",
  "serverTime": 1714986330.0,
  "gameId": "ROUND-1714986300",
  "phase": "BetsClosing",
  "duration": 5.0
}
```
**Phases** dans l'ordre : `Betting` (30s) -> `BetsClosing` (5s) -> `Spinning` (12s) -> `Result` (5s) -> nouveau round.

### Resultat revele en avance : `result_revealed`
Envoye **a 11s du spin** (1s avant la fin) pour permettre l'animation cote Unity.
```json
{
  "type": "result_revealed",
  "serverTime": 1714986346.0,
  "gameId": "ROUND-1714986300",
  "result": {
    "number": 17,
    "color": "Red",
    "isEven": false,
    "isHigh": false
  }
}
```
Couleurs possibles : `"Red"`, `"Black"`, `"Green"` (zero uniquement). `isHigh` : true si 19-36, false si 1-18, false pour 0.

### Stats mises a jour : `stats_updated`
Envoye apres chaque tirage.
```json
{
  "type": "stats_updated",
  "serverTime": 1714986347.0,
  "gameId": "ROUND-1714986300",
  "stats": {
    "redPercent": 48.6,
    "blackPercent": 48.6,
    "greenPercent": 2.8,
    "evenPercent": 50.0,
    "oddPercent": 50.0,
    "highPercent": 50.0,
    "lowPercent": 50.0,
    "dozensPercents": [33, 33, 34],
    "columnsPercents": [33, 33, 34],
    "sectorsPercents": [16, 16, 17, 17, 17, 17],
    "linesPercents": [16, 16, 17, 17, 17, 17],
    "hotNumbers": [17, 23, 5, ...],
    "coldNumbers": [11, 28, 0, ...],
    "numberFrequencies": [3, 5, 0, 1, ..., 2],
    "history": [
      { "number": 17, "color": "Red", "isEven": false, "isHigh": false },
      ...
    ]
  }
}
```
- Pourcentages **toujours en sommes entieres = 100** (largest remainder method).
- `numberFrequencies` : tableau de 37 entiers, index = numero.
- `history` : 200 derniers numeros, plus ancien -> plus recent.
- `hotNumbers` / `coldNumbers` : 7 elements chacun.

### Heartbeat : `ping` / `pong`
Le client peut envoyer :
```json
{ "type": "ping", "clientTime": 1714986300.0 }
```
Le serveur repond :
```json
{ "type": "pong", "clientTime": 1714986300.0, "serverTime": 1714986300.123 }
```
> Recommande pour Unity : ping toutes les 15s pour calculer le RTT et detecter une coupure.

### Reconnexion
En cas de coupure, **se reconnecter avec backoff exponentiel** (1s -> 2s -> 4s -> 8s -> 30s max). Le `welcome` qui suit donne directement l'etat a jour.

---

## Types de paris (roulette)

Tous les `bet_target` sont des strings.

### Paris interieurs

| `bet_type` | `bet_target` | Cote | Exemple |
|---|---|---|---|
| `STRAIGHT` | `"17"` | x36 | Plein sur le 17 |
| `SPLIT` | `"17,20"` | x18 | A cheval entre 17 et 20 |
| `STREET` | `"4,5,6"` | x12 | Transversale ligne 4-6 |
| `CORNER` | `"4,5,7,8"` | x9 | Carre 4-5-7-8 |
| `SIX_LINE` | `"4,5,6,7,8,9"` | x6 | Sixain |

> Les numeros dans `bet_target` sont separes par virgules. **Pas d'espaces.**

### Paris exterieurs

| `bet_type` | `bet_target` | Cote |
|---|---|---|
| `COLUMN` | `"Col1"` / `"Col2"` / `"Col3"` | x3 |
| `DOZEN` | `"1st"` / `"2nd"` / `"3rd"` | x3 |
| `COLOR` | `"RED"` / `"BLACK"` | x2 |
| `EVEN_ODD` | `"EVEN"` / `"ODD"` | x2 |
| `HALF` | `"1-18"` / `"19-36"` | x2 |

> **Le 0 fait perdre tous les paris exterieurs** (regle europeenne).

La cote inclut la mise (gain net = cote - 1). Ex : Plein 1000 XAF gagnant -> `payout = 36000` (gain net 35000 + mise 1000).

---

## Cycle d'un round

```
T=0s     Betting (30s)         ──► phase_changed { phase: "Betting" }
                                  Tickets ouverts a la creation
T=30s    BetsClosing (5s)      ──► phase_changed { phase: "BetsClosing" }
                                  Tickets refuses (400)
T=35s    Spinning (12s)        ──► phase_changed { phase: "Spinning", result: {...} }
T=46s                          ──► result_revealed { result: {...} }   (1s avant la fin)
T=47s                          ──► stats_updated { stats: {...} }
                               ──► Redis publish "ROUND_FINISHED"      (ticket-service paye)
T=47s    Result (5s)           ──► phase_changed { phase: "Result", result: {...} }
T=52s    -> nouveau round
```

Le `round_id` change a chaque cycle (`ROUND-<unix_timestamp>`). C'est cette valeur que le POS doit renvoyer dans `POST /api/tickets/`.

---

## Variables d'environnement

Definies dans `docker-compose.yml`. **A surcharger en prod via secrets ECS / .env.**

| Variable | Service | Defaut | Description |
|---|---|---|---|
| `JWT_SECRET` | agent, ticket | `MonSuperSecretCasino2026!NePasPartager` | Cle de signature JWT |
| `ADMIN_API_KEY` | agent, ticket, roulette | `CleSuperSecreteBackoffice2026` | Cle admin pour `/admin/*` |
| `REDIS_URL` | ticket, roulette, display | `redis://casino_redis:6379/0` | URL Redis |
| `DATABASE_URL` | roulette | `postgresql+asyncpg://...` | DSN async Postgres |
| `ROOT_PATH` | agent, ticket, roulette | `/api/agents` etc. | Prefix Traefik (Swagger fonctionne) |

> Les credentials Postgres (`casino_admin` / `super_secret_password`) sont en clair dans `docker-compose.yml`. **A bouger dans des secrets pour la prod.**

---

## Provably fair

Pour chaque round, le moteur :
1. Genere un `server_seed` aleatoire de 32 hex chars (`secrets.token_hex(16)`).
2. Calcule `server_seed_hash = sha256(server_seed)`.
3. Calcule le numero gagnant : `int(hmac_sha256(server_seed, round_id)[:8], 16) % 37`.
4. Stocke `server_seed` + `server_seed_hash` + `round_id` + `winning_number` dans `roulette_rounds`.

Apres le round, le `server_seed` est expose via `GET /api/roulette/admin/history` pour audit. Un joueur peut recalculer `hmac_sha256(seed, round_id) % 37` et verifier que le numero correspond.

---

## Bases de donnees

Trois bases distinctes (isolation par bounded context) sur **une seule instance Postgres 16** :

| Database | Tables principales |
|---|---|
| `casino_agent_db` | `agents`, `cash_registers`, `cash_register_transactions` |
| `casino_ticket_db` | `tickets`, `ticket_bets` |
| `casino_roulette_db` | `roulette_rounds` |

Les migrations Alembic se lancent automatiquement au demarrage (commande `alembic upgrade head` avant `uvicorn`). Pour creer une nouvelle migration apres modification de modele :
```bash
docker compose exec ticket-service alembic revision --autogenerate -m "add new field"
docker compose exec ticket-service alembic upgrade head
```

---

## Depannage

| Symptome | Cause / Fix |
|---|---|
| `503 Le jeu est actuellement hors ligne` lors de `POST /api/tickets/` | `game-roulette-service` pas demarre. Verifier `docker compose ps`. |
| `400 Round invalide` | Le `round_id` envoye est decale — toujours le lire depuis le dernier `welcome` ou `phase_changed` recu en WS. |
| WebSocket se reconnecte en boucle | Verifier que Traefik route bien `PathPrefix(\`/ws/roulette\`)` (cf. `docker-compose.yml:135`). |
| Stats vides apres redemarrage | `redis:7-alpine` n'a pas de volume — l'historique est volatile. Ajouter un volume si besoin. |
| `npm install` modifie le `package-lock.json` puis Vite ne resout pas | Recreer le conteneur : `docker compose rm -sf <web-service> && docker compose up -d --force-recreate --build <web-service>`. Le volume anonyme `/app/node_modules` est purge. |

---

## Roadmap

- [x] Roulette europeenne (provably fair, 10 types de paris, settlement auto)
- [x] POS agent (web)
- [x] Backoffice multi-jeux (stats roulette live, agents, transactions, settings placeholder)
- [x] Pipeline CI/CD ECS + ALB
- [ ] Client Unity (en cours, integration en suivant ce README)
- [ ] Autres jeux (a venir : blackjack, paris sportifs)

---

## Licence

Proprietaire — AGDTech Bet. Tous droits reserves.
