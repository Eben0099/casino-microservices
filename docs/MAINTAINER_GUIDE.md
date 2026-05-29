# Maintainer Onboarding Guide — casino-microservices

A practical map for anyone inheriting this repo: what it does, how to launch it
locally, and where to make changes safely. The root `CLAUDE.md` is a condensed
reference; this is the human-readable companion.

---

## 1. What the project is (one paragraph)

A multi-game casino backend. Two games run in production: **European roulette** and
**Keno (VOLKENO)**. It's a microservice system: each concern is its own small
**FastAPI (Python)** service with its own Postgres database, plus two **React + Vite**
web apps (a cashier POS and an admin backoffice). Everything sits behind one
**Traefik** reverse proxy on port **80**, so the browser/Unity client only ever talks
to `localhost`. Services coordinate two ways: **synchronous HTTP** for money movements
and **Redis pub/sub** for game events. A dedicated `jackpot-service` is the single
source of truth for all jackpot money.

## 2. The pieces (services)

Python services — all the same shape (`app/main.py`, `app/models.py`, `alembic/`,
`entrypoint.sh`), each owns one DB:

| Service | What it does | Database |
|---|---|---|
| `agent-service` | Cashiers/agents, their cash registers (caisses), transactions, JWT login | `casino_agent_db` |
| `ticket-service` | Sells tickets, **settles** them when a round ends, handles payouts/cancels | `casino_ticket_db` |
| `game-roulette-service` | The roulette engine: a timed loop (Betting→Spinning→Result), RNG, `/ws/roulette` | `casino_roulette_db` |
| `game-keno-service` | The Keno engine: timed loop (idle→preLaunch→draw→results), 80-ball RNG, `/ws/keno` | `casino_keno_db` |
| `jackpot-service` | **Owns all jackpot pots** (global/game/local), contributions, hit detection | `casino_jackpot_db` |
| `display-service` | Stateless WebSocket relay for passive TV screens | (none) |

Frontends (React + Vite, served as live dev servers inside Docker on port 5173):

| App | URL | Purpose |
|---|---|---|
| `backoffice` | `http://localhost/` | Admin: agents, transactions, game monitoring, jackpot config |
| `agent-web` | `http://localhost/agents/pos` | Cashier POS: sell tickets, pay out, view shift |

## 3. How a request flows (the mental model)

**Selling + settling a roulette ticket — the core loop:**
1. Cashier logs in on `agent-web` → `agent-service POST /login` → gets a JWT.
2. Cashier sells a ticket → `ticket-service POST /` (with JWT). ticket-service then:
   - calls `agent-service` to **debit** the cashier's cash register (HTTP),
   - calls `jackpot-service POST /internal/contribute` to add to the pots (HTTP),
   - publishes a `ticket_created` event on Redis `admin-events` (backoffice sees it live).
3. The **roulette engine runs on its own clock** — Betting 30s → BetsClosing 5s →
   Spinning 12s → Result 5s, forever (in `cyclic` mode). When a round ends it publishes
   `ROUND_FINISHED` (with the winning number) on Redis channel `roulette-events`.
4. `ticket-service` is **subscribed** to `roulette-events`. On `ROUND_FINISHED` it runs
   `process_settlement()`: marks every ticket for that round WON/LOST, computes payouts.
5. Cashier pays a winning ticket → `ticket-service POST /{code}/payout` → debits the caisse.

Keno is the same pattern on channel `keno-events` with `process_keno_settlement()`.

**Who talks to whom:**
- **HTTP (money / validation):** ticket→agent (debit/credit), ticket→jackpot (contribute),
  engines→jackpot (read current pots), engines→agent (validate a kiosk at WS connect).
- **Redis pub/sub (events):** engines publish `roulette-events`/`keno-events`;
  ticket-service consumes them to settle. jackpot-service publishes `jackpot-updated`;
  engines consume it and fan it out to their WebSocket clients. ticket-service publishes
  `admin-events`; the backoffice dashboards subscribe for live updates.
- **Key rule:** game engines do **not** store jackpot balances. They read pots from
  `jackpot-service`. Don't reintroduce jackpot state into an engine.

## 4. The single most important thing: two deployment modes

The repo ships **two production modes, kept in sync but never merged.** Always know
which one you're touching.

| | **standalone** (default) | **integrated-agd** |
|---|---|---|
| Compose file | `docker-compose.yml` | `docker-compose.integrated-agd.yml` |
| Roulette engine (`ENGINE_MODE`) | `cyclic` — runs its own continuous round loop, Unity connects to `/ws/roulette` | `on_demand` — no loop; AGD's platform calls `POST /internal/spins` per spin |
| POS backend (`VITE_INTEGRATION_MODE` build flag in agent-web) | `standalone` → talks to this repo's `ticket-service` | `agd` → talks to the external AGD platform |
| Money / auth | this repo's `agent-service` JWT + cash registers | AGD's JWT + AGD wallet |

The roulette engine code and the agent-web code are **shared** — one codebase, behavior
switched by env var / build flag. `docs/DEPLOYMENT_MODES.md` is the authority here.
For day-to-day local maintenance you almost always want **standalone**.

## 5. How to launch it locally

Prerequisites: **Docker Desktop** running, ports **80** and **8080** free. No `.env`
needed for standalone — dev secrets are hardcoded in `docker-compose.yml`.

```bash
cd "/path/to/casino-microservices"

docker compose up -d --build        # build + start everything
docker compose ps                   # confirm all services are up/healthy
docker compose logs -f game-roulette-service   # watch the BETTING→SPINNING→RESULT loop
```

On boot, Postgres auto-creates the databases (`init-databases.sql`), then each service
runs `alembic upgrade head` (applies DB migrations) before starting uvicorn. This is
automatic and idempotent.

Then open:
- `http://localhost/` — backoffice (admin). Login key: `CleSuperSecreteBackoffice2026`
- `http://localhost/agents/pos` — cashier POS (you'll need an agent; create one in the
  backoffice Agents page, which provisions a cash register).
- `http://localhost/api/agents/docs`, `/api/tickets/docs`, `/api/roulette/docs` — Swagger.
- `http://localhost:8080` — Traefik dashboard (which routes are live).

Stop / reset:
```bash
docker compose down        # stop; Postgres data persists
docker compose down -v     # stop AND wipe all data (full reset)
```

Other compose files (don't need them for normal work):
- `docker-compose.prod.yml` — EC2 + managed RDS, images pulled from GHCR, real `.env`.
- `docker-compose.scale.yml` — load-testing overlay (`--scale ticket-service=4` etc.).
- `docker-compose.integrated-agd.yml` — the AGD-integrated mode (needs AGD infra running).

## 6. How to make common changes

**Change a Python endpoint / game logic:** edit `services/<svc>/app/main.py`. Containers
run uvicorn with `--reload`, so saving re-loads automatically (code is volume-mounted).

**Change a DB model:** edit `services/<svc>/app/models.py`, then generate a migration:
```bash
docker compose exec ticket-service alembic revision --autogenerate -m "describe change"
docker compose exec ticket-service alembic upgrade head
```
(ticket-service has the most migrations — 11; others have 1–2.)

**Change the frontend:** edit files under `services/agent-web/src` or
`services/backoffice/src`. Vite hot-reloads in the browser. The integration-mode switch
for agent-web lives in `services/agent-web/src/config.js` with adapters in
`src/api/adapters/` (`standaloneAdapter.js` vs `agdAdapter.js`). API base URL config is
in `src/api/client.js`.

**Change routing / add a service to the gateway:** Traefik rules live in
`traefik/dynamic_conf.yml` (dev) — `PathPrefix(...)` rules map URLs to services.

**Adjust round timing / stake limits:** roulette/keno timings live in Redis
(`roulette:settings`) and via `PATCH /admin/settings`; defaults in `app/settings.py`.

## 7. Where to look when something breaks

- A service won't start → `docker compose logs <service>`.
- Tickets fail with `503 jeu hors ligne` → the roulette engine isn't running.
- `400 Round invalide` → stale round_id; the client must read the latest from the WS.
- Stats/jackpots empty after restart → Redis has **no volume** (data is intentionally
  volatile); this is expected.
- Frontend can't resolve modules after `npm install` → recreate the container:
  `docker compose rm -sf <web-service> && docker compose up -d --force-recreate --build <web-service>`.
- Reading code: `README.md` is the API/protocol spec; `docs/` has the design docs
  (`DEPLOYMENT_MODES.md`, `JACKPOT_SERVICE_PLAN.md`, `KENO_IMPLEMENTATION_PLAN.md`,
  `integration-contract.md`); `CLAUDE.md` is the condensed root reference.

## 8. Things to know before you touch anything

- **No automated test suite.** Verification is manual via the scripts in `tools/`
  (`load_test_tickets.py`, `jackpot_e2e_sim.py`, `realistic_simulator.py`, observers).
  See `docs/simulator-guide.md`. Test changes by running the stack and exercising it.
- **Code comments and logs are largely in French.** Match that when editing.
- **Money is in integer XAF** (no decimals) — balances/amounts are BigInt.
- **Roulette is provably fair:** per round, `server_seed = secrets.token_hex(16)`,
  winning number = `int(hmac_sha256(server_seed, round_id)[:8],16) % 37`. Don't break this.
- Default branch is `develop`; PRs target `main`. Push to `main` triggers the GHCR build +
  EC2 deploy in `.github/workflows/deploy.yml`.
