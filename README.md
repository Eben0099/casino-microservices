# AGDTech Casino Backend

Multi-game casino platform (European roulette in production, more games coming) built on a FastAPI + Postgres + Redis microservices architecture, behind a Traefik gateway. Two React web clients are bundled (agent POS + admin backoffice). A Unity client connects to the game engine over WebSocket for real-time roulette.

---

## Table of contents

1. [Architecture](#architecture)
2. [Quick start (2 minutes)](#quick-start-2-minutes)
3. [URLs and entry points](#urls-and-entry-points)
4. [Authentication](#authentication)
5. [REST API — endpoints per service](#rest-api--endpoints-per-service)
6. [Roulette WebSocket protocol (Unity)](#roulette-websocket-protocol-unity)
7. [Jackpots integration (Unity)](#jackpots-integration-unity)
8. [Bet types (roulette)](#bet-types-roulette)
9. [Round lifecycle](#round-lifecycle)
10. [Environment variables](#environment-variables)
11. [Provably fair](#provably-fair)
12. [Databases](#databases)
13. [Troubleshooting](#troubleshooting)

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

| Service | Stack | Role | DB |
|---|---|---|---|
| `agent-service` | FastAPI + Postgres | Agents, cash registers, transactions, JWT login | `casino_agent_db` |
| `ticket-service` | FastAPI + Postgres + Redis | Ticket issuance/payout, automatic settlement | `casino_ticket_db` |
| `game-roulette-service` | FastAPI + Postgres + Redis | Game engine (state machine), RNG, WebSocket | `casino_roulette_db` |
| `display-service` | FastAPI + Redis | WebSocket relay for passive clients (TV displays) | (stateless) |
| `backoffice` | React 18 + Vite + Tailwind | Admin console (multi-game) | — |
| `agent-web` | React 18 + Vite + Tailwind | Agent POS | — |

**Inter-service communication:** synchronous HTTP (ticket -> agent for cash debit/credit) + Redis Pub/Sub (roulette -> ticket for settlement, roulette -> display for fan-out).

---

## Quick start (2 minutes)

### Requirements
- Docker Desktop >= 4.20
- Ports `80` and `8080` available

### Start

```bash
git clone https://github.com/agdtechbet/casino-backend.git
cd casino-backend
docker compose up -d --build
```

All services start automatically. Alembic migrations run on boot. The roulette engine begins its round loop immediately.

Verify everything is up:
```bash
docker compose ps         # all services should be "running" / "healthy"
docker compose logs -f game-roulette-service   # watch BETTING > SPINNING > RESULT cycle
```

### Stop / reset

```bash
docker compose down              # stop everything (Postgres data persists)
docker compose down -v           # stop + delete volumes (full reset)
```

---

## URLs and entry points

Everything is routed through Traefik on port **80**.

| URL | Service | Purpose |
|---|---|---|
| http://localhost/ | backoffice | Admin console (login with API key) |
| http://localhost/agents/pos | agent-web | Agent POS (login with phone/password) |
| http://localhost/api/agents/docs | agent-service | **Swagger** — agents/cash/auth |
| http://localhost/api/tickets/docs | ticket-service | **Swagger** — tickets |
| http://localhost/api/roulette/docs | game-roulette-service | **Swagger** — roulette |
| http://localhost/api/display/docs | display-service | **Swagger** — display |
| ws://localhost/ws/roulette | game-roulette-service | **Unity WebSocket (recommended)** |
| ws://localhost/api/display/ws/roulette | display-service | WebSocket relay (read-only) |
| http://localhost:8080 | traefik | Traefik dashboard |

> **For Unity**, prefer `ws://localhost/ws/roulette` which connects directly to the game engine. `display-service` is a relay intended for passive screens that don't need bidirectional load.

In production (ALB/ECS), replace `localhost` with the ALB DNS name. Paths (`/api/agents`, `/ws/roulette`, ...) stay identical.

---

## Authentication

Two mechanisms coexist:

### 1. JWT (agents / cashiers)
Used by `agent-service` and `ticket-service` to protect POS endpoints.

- Login: `POST /api/agents/login` with `{ phone, password }`
- Response: `{ access_token, token_type: "bearer", agent_id, agent_name }`
- Each protected request: header `Authorization: Bearer <access_token>`

Algo: HS256, secret from `JWT_SECRET` env var, `sub` = `agent_id` (UUID).

### 2. Admin API Key (backoffice)
Used for `/admin/*` endpoints (CRUD agents, global stats, history, ...).

- Header: `X-API-Key: <ADMIN_API_KEY>`
- Default key (replace in production): `CleSuperSecreteBackoffice2026`

> The roulette engine **does not protect any endpoint with JWT** — only admin endpoints (`/admin/history`) are key-guarded. The WebSocket is public (read-only stream).

---

## REST API — endpoints per service

### `agent-service` — `/api/agents`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/login` | public | Agent login (phone + password) |
| POST | `/` | admin key | Create an agent (+ cash register) |
| POST | `/register` | admin key | Same (alias) |
| GET | `/` | admin key | Paginated agents list |
| GET | `/admin/stats` | admin key | Active agents count |
| GET | `/admin/transactions?skip=&limit=` | admin key | All cash register transactions |
| GET | `/admin/{agent_id}` | admin key | Agent detail + cash register |
| PATCH | `/admin/{agent_id}` | admin key | Update agent (suspension, kiosk, ...) |
| GET | `/{agent_id}` | JWT | Agent detail (self) |
| PATCH | `/{agent_id}` | JWT | Update agent (self) |
| POST | `/{agent_id}/provision` | admin key | Credit / debit a cash register |
| GET | `/status` | public | Healthcheck |

**Agent schema:**
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

**Provision payload:**
```json
{
  "amount": 50000,
  "tx_type": "PROVISION | BET_RECEIVED | PAYOUT | REVERSAL | ADJUSTMENT | COMMISSION",
  "description": "string",
  "reference": "string|null"
}
```

### `ticket-service` — `/api/tickets`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/` | JWT | Create a ticket (multi-bet) |
| GET | `/{short_code}` | JWT | Read a ticket by short code |
| POST | `/{short_code}/payout` | JWT | Pay out a winning ticket |
| GET | `/admin/stats` | admin key | Total wager / payout / tickets |
| GET | `/admin/agents-performance` | admin key | Top 5 agents by volume |
| GET | `/status` | public | Healthcheck |

**Create a ticket** (`POST /api/tickets/`):
```json
{
  "agent_id": "agent-uuid",
  "game_id": "ROULETTE-TBL1",
  "round_id": "ROUND-1714986300",
  "bets": [
    { "bet_type": "STRAIGHT", "bet_target": "17", "amount": 1000 },
    { "bet_type": "COLOR",    "bet_target": "RED", "amount": 500 },
    { "bet_type": "DOZEN",    "bet_target": "2nd", "amount": 200 }
  ]
}
```

The server checks that the roulette is in the `Betting` phase **and** that `round_id` matches the current round. Otherwise: 400.

**Ticket response:**
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

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/status` | public | Current game state (round_id, phase, result) |
| GET | `/admin/history` | admin key | Last 10 rounds with revealed `server_seed` |
| WS | `/ws/roulette` | public | Main WebSocket (Unity) |
| WS | `/api/display/ws/roulette` | public | Traefik alias (same socket) |

### `display-service` — `/api/display`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/history` | public | Recent winning numbers (for stats) |
| WS | `/ws/roulette` | public | Read-only WebSocket relay |

---

## Roulette WebSocket protocol (Unity)

URL: `ws://localhost/ws/roulette` (local) or `ws://<alb-dns>/ws/roulette` (prod).

**No authentication** — the connection is open. Messages are JSON. All `serverTime` fields are UNIX `float` seconds.

### On connect: `welcome`
The server immediately pushes the current state.
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
> If the phase is `Spinning` or `Result`, `result` already contains `{ "number", "color", "isEven", "isHigh" }`.

### On phase transition: `phase_changed`
```json
{
  "type": "phase_changed",
  "serverTime": 1714986330.0,
  "gameId": "ROUND-1714986300",
  "phase": "BetsClosing",
  "duration": 5.0
}
```
**Phase order:** `Betting` (30s) -> `BetsClosing` (5s) -> `Spinning` (12s) -> `Result` (5s) -> next round.

### Result revealed early: `result_revealed`
Sent **at 11s into Spinning** (1s before the end) so Unity can pre-roll the wheel animation.
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
Possible colors: `"Red"`, `"Black"`, `"Green"` (zero only). `isHigh`: true if 19-36, false if 1-18, false for 0.

### Stats refreshed: `stats_updated`
Sent right after each spin.
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
- Percentages are **always integers that sum to 100** (largest remainder method).
- `numberFrequencies`: array of 37 ints, index = number.
- `history`: last 200 numbers, oldest -> newest.
- `hotNumbers` / `coldNumbers`: 7 entries each.

### Heartbeat: `ping` / `pong`
Client sends:
```json
{ "type": "ping", "clientTime": 1714986300.0 }
```
Server replies:
```json
{ "type": "pong", "clientTime": 1714986300.0, "serverTime": 1714986300.123 }
```
> Recommended for Unity: ping every 15s to compute RTT and detect dropped sockets.

### Reconnect
On disconnect, **reconnect with exponential backoff** (1s -> 2s -> 4s -> 8s -> 30s max). The next `welcome` resyncs the state.

---

## Jackpots integration (Unity)

Each kiosk has a short 4-character public code (`kiosk_code`) — printed on the physical machine and stored once in the Unity client config (e.g. `AGDTech.config: kiosk_code = "7H3X"`). All jackpot data is fetched with that single key, via **two public REST endpoints**. No authentication is required: these endpoints expose only public-safe data (no PINs, no balances, no JWTs).

### Endpoint 1 — Bootstrap : resolve the kiosk

```
GET /api/agents/by-code/{kiosk_code}
```

Use this once when Unity starts, to validate the configured code and obtain the kiosk metadata.

**Example:**
```
GET http://localhost/api/agents/by-code/7H3X
```
```json
{
  "agent_id": "27831149-f8ba-4bd4-9558-94747a0d4d86",
  "kiosk_code": "7H3X",
  "kiosk_name": "Kiosque Akwa",
  "kiosk_location": "Douala — Akwa, Bd de la Liberté",
  "is_active": true,
  "is_suspended": false
}
```

Errors :
- `404 { "detail": "Aucun kiosque trouve pour ce code" }` — bad code, ask the operator to re-enter / re-scan it
- `400 { "detail": "Code kiosque vide" }` — empty input

### Endpoint 2 — Live jackpots feed (poll)

```
GET /api/tickets/jackpots/by-kiosk/{kiosk_code}
```

Returns **every jackpot pot fed by tickets sold on this kiosk** :
- the unique **GLOBAL** pot (network-wide)
- the **GAME** pots for the games played here — the main no-tier pot + Bronze / Silver / Gold tiers
- the **LOCAL** pots tied to this specific kiosk — Bronze / Silver / Gold

The secret threshold of each pot is **never** exposed.

**Example:**
```
GET http://localhost/api/tickets/jackpots/by-kiosk/7H3X
```
```json
{
  "kiosk_code": "7H3X",
  "kiosk_name": "Kiosque Akwa",
  "kiosk_id": "27831149-f8ba-4bd4-9558-94747a0d4d86",
  "pots": [
    { "id": "uuid", "scope": "GLOBAL", "game_id": null,            "tier": null,     "current_amount": 1250000 },
    { "id": "uuid", "scope": "GAME",   "game_id": "ROULETTE-TBL1", "tier": null,     "current_amount":  340000 },
    { "id": "uuid", "scope": "GAME",   "game_id": "ROULETTE-TBL1", "tier": "BRONZE", "current_amount":   42000 },
    { "id": "uuid", "scope": "GAME",   "game_id": "ROULETTE-TBL1", "tier": "SILVER", "current_amount":  280000 },
    { "id": "uuid", "scope": "GAME",   "game_id": "ROULETTE-TBL1", "tier": "GOLD",   "current_amount": 4900000 },
    { "id": "uuid", "scope": "LOCAL",  "game_id": "ROULETTE-TBL1", "tier": "BRONZE", "current_amount":    8500 },
    { "id": "uuid", "scope": "LOCAL",  "game_id": "ROULETTE-TBL1", "tier": "SILVER", "current_amount":   45000 },
    { "id": "uuid", "scope": "LOCAL",  "game_id": "ROULETTE-TBL1", "tier": "GOLD",   "current_amount":  610000 }
  ]
}
```

### Polling strategy

Jackpots evolve at the rhythm of ticket sales — **a 5-second poll is plenty**. There is no WebSocket for jackpots in v1 (planned for v2). Recommended Unity loop:

```csharp
// Pseudocode — every 5 seconds
var resp = await http.GetAsync($"/api/tickets/jackpots/by-kiosk/{kioskCode}");
var data = JsonConvert.DeserializeObject<JackpotsResponse>(resp);
foreach (var pot in data.pots)
{
    // Build display key: scope + tier + game_id
    // GLOBAL                -> "GLOBAL"
    // GAME (no tier)        -> "GAME:<game_id>"
    // GAME with tier        -> "GAME:<game_id>:<tier>"
    // LOCAL with tier       -> "LOCAL:<game_id>:<tier>"
    UpdateMeter(pot);
}
```

### How to render each pot

| `scope` | `tier`  | Suggested label                            | Highlight |
|---------|---------|--------------------------------------------|-----------|
| GLOBAL  | null    | **GRAND JACKPOT**                          | brightest, on-stage |
| GAME    | null    | **`{game_id}` JACKPOT**                    | medium gold |
| GAME    | BRONZE  | `{game_id}` BRONZE                         | bronze |
| GAME    | SILVER  | `{game_id}` SILVER                         | silver |
| GAME    | GOLD    | `{game_id}` GOLD                           | bright gold + pulse |
| LOCAL   | BRONZE  | LOCAL BRONZE                               | dim bronze |
| LOCAL   | SILVER  | LOCAL SILVER                               | dim silver |
| LOCAL   | GOLD    | LOCAL GOLD                                 | dim gold |

### Detecting a HIT on this kiosk

When a ticket vendor sells a ticket and a jackpot is triggered, the **prize is attached to the ticket itself** (status `WON`, `total_payout` bumped). The Unity screen has two complementary signals :

1. **Pot reset** — the matching `current_amount` drops sharply on the next poll. Animate a celebration when you observe `current_amount` go down by more than (say) 20%.
2. **Audit endpoint** (`GET /api/tickets/admin/jackpots/wins`) — protected by `ADMIN_API_KEY`. Not recommended for Unity unless you have a secure channel. The pot-drop heuristic above is sufficient for visual feedback.

### CORS

These two endpoints accept any `Origin` (no JWT, no cookie required). They can be called directly from Unity's `UnityWebRequest` without preflight workarounds.

### Sample full flow (Unity startup)

```
1.  Load kiosk_code from local config (e.g. "7H3X")
2.  GET /api/agents/by-code/7H3X
        if 404 -> show "Kiosk not configured" + manual code entry
        if is_active=false or is_suspended=true -> show "Kiosk disabled" overlay
        else -> store agent_id, kiosk_name in memory
3.  GET /api/tickets/jackpots/by-kiosk/7H3X     (initial fetch)
4.  loop every 5s: refetch and update on-screen meters
5.  also keep the existing WebSocket ws://.../ws/roulette open for game state
```

---

## Bet types (roulette)

All `bet_target` values are strings.

### Inside bets

| `bet_type` | `bet_target` | Payout | Example |
|---|---|---|---|
| `STRAIGHT` | `"17"` | x36 | Straight up on 17 |
| `SPLIT` | `"17,20"` | x18 | Split between 17 and 20 |
| `STREET` | `"4,5,6"` | x12 | Street row 4-6 |
| `CORNER` | `"4,5,7,8"` | x9 | Corner 4-5-7-8 |
| `SIX_LINE` | `"4,5,6,7,8,9"` | x6 | Six line |

> Numbers in `bet_target` are comma-separated, **no spaces**.

### Outside bets

| `bet_type` | `bet_target` | Payout |
|---|---|---|
| `COLUMN` | `"Col1"` / `"Col2"` / `"Col3"` | x3 |
| `DOZEN` | `"1st"` / `"2nd"` / `"3rd"` | x3 |
| `COLOR` | `"RED"` / `"BLACK"` | x2 |
| `EVEN_ODD` | `"EVEN"` / `"ODD"` | x2 |
| `HALF` | `"1-18"` / `"19-36"` | x2 |

> **Zero loses every outside bet** (European rule).

The payout multiplier includes the original stake (net win = payout - 1). Example: a winning STRAIGHT of 1000 XAF returns `payout = 36000` (net 35000 + 1000 stake).

---

## Round lifecycle

```
T=0s     Betting (30s)         ──► phase_changed { phase: "Betting" }
                                  Tickets accepted via POST /api/tickets/
T=30s    BetsClosing (5s)      ──► phase_changed { phase: "BetsClosing" }
                                  Tickets rejected (400)
T=35s    Spinning (12s)        ──► phase_changed { phase: "Spinning", result: {...} }
T=46s                          ──► result_revealed { result: {...} }   (1s before end)
T=47s                          ──► stats_updated { stats: {...} }
                               ──► Redis publish "ROUND_FINISHED" (ticket-service settles)
T=47s    Result (5s)           ──► phase_changed { phase: "Result", result: {...} }
T=52s    -> next round
```

The `round_id` rotates each cycle (`ROUND-<unix_timestamp>`). The POS must echo this exact value in `POST /api/tickets/`.

---

## Environment variables

Defined in `docker-compose.yml`. **Override in production via ECS secrets / .env files.**

| Variable | Service | Default | Description |
|---|---|---|---|
| `JWT_SECRET` | agent, ticket | `MonSuperSecretCasino2026!NePasPartager` | JWT signing key |
| `ADMIN_API_KEY` | agent, ticket, roulette | `CleSuperSecreteBackoffice2026` | Admin key for `/admin/*` |
| `REDIS_URL` | ticket, roulette, display | `redis://casino_redis:6379/0` | Redis URL |
| `DATABASE_URL` | roulette | `postgresql+asyncpg://...` | Async Postgres DSN |
| `ROOT_PATH` | agent, ticket, roulette | `/api/agents` etc. | Traefik prefix (so Swagger works) |

> Postgres credentials (`casino_admin` / `super_secret_password`) are in clear text in `docker-compose.yml`. **Move them to secrets for production.**

---

## Provably fair

For each round, the engine:
1. Generates a random `server_seed` (32 hex chars from `secrets.token_hex(16)`).
2. Computes `server_seed_hash = sha256(server_seed)`.
3. Derives the winning number: `int(hmac_sha256(server_seed, round_id)[:8], 16) % 37`.
4. Persists `server_seed`, `server_seed_hash`, `round_id`, `winning_number` to `roulette_rounds`.

After the round, the `server_seed` is exposed via `GET /api/roulette/admin/history` for audit. A player can recompute `hmac_sha256(seed, round_id) % 37` and verify the winning number.

---

## Databases

Three separate databases (one per bounded context) on **a single Postgres 16 instance**:

| Database | Main tables |
|---|---|
| `casino_agent_db` | `agents`, `cash_registers`, `cash_register_transactions` |
| `casino_ticket_db` | `tickets`, `ticket_bets` |
| `casino_roulette_db` | `roulette_rounds` |

Alembic migrations run automatically on boot (`alembic upgrade head` runs before `uvicorn`). To create a new migration after a model change:
```bash
docker compose exec ticket-service alembic revision --autogenerate -m "add new field"
docker compose exec ticket-service alembic upgrade head
```

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `503 Le jeu est actuellement hors ligne` on `POST /api/tickets/` | `game-roulette-service` not started. Check `docker compose ps`. |
| `400 Round invalide` | The `round_id` is stale — always read it from the most recent `welcome` or `phase_changed` WS frame. |
| WebSocket reconnect loop | Check Traefik routes `PathPrefix(\`/ws/roulette\`)` (see `docker-compose.yml:135`). |
| Stats empty after restart | `redis:7-alpine` has no volume — history is volatile. Add a volume if persistence is needed. |
| `npm install` updates `package-lock.json` then Vite cannot resolve modules | Recreate the container: `docker compose rm -sf <web-service> && docker compose up -d --force-recreate --build <web-service>`. The anonymous `/app/node_modules` volume is purged. |

---

## Roadmap

- [x] European roulette (provably fair, 10 bet types, automatic settlement)
- [x] Agent POS (web)
- [x] Multi-game backoffice (live roulette stats, agents, transactions, settings placeholder)
- [x] CI/CD pipeline ECS + ALB
- [ ] Unity client (in progress, integrating against this README)
- [ ] More games (planned: blackjack, sports betting)

---

## License

Proprietary — AGDTech Bet. All rights reserved.
