# Deployment modes — operational guide

This casino platform ships in **two parallel modes**, both
production-grade, both maintained:

1. **standalone** — historical product: Unity table + agent POS +
   ticket-service + agent-service + backoffice + roulette engine in
   `cyclic` mode.
2. **integrated-agd** — AGD platform integration: roulette engine in
   `on_demand` mode, called by `agd-casino-service` on behalf of an
   AGD player's wallet. The cashier POS embeds inside
   `agd_terminal_web_app`.

This guide is the single source of truth for **how to deploy each
mode, how to operate it, and how to switch between them**.

---

## 1. Decision matrix — which mode do you want?

| If your venue has...                                                | Use this mode    |
|---------------------------------------------------------------------|------------------|
| No AGD platform deployed alongside                                  | standalone       |
| An AGD platform with player wallets in `agd-wallet-service`         | integrated-agd   |
| Standalone Unity table + a cashier counter                          | standalone       |
| AGD `agd_terminal_web_app` terminals as the customer-facing surface | integrated-agd   |
| A mix of both (some kiosks AGD, some not)                           | both — see §5    |

The two modes can coexist on different hosts pointing at the **same
casino DB** for shared catalog/analytics, but most deployments choose
one or the other.

---

## 2. Network topology

### standalone

```
                ┌────────────────────────────────┐
                │ Traefik :80 (this repo)        │
                └────────────────────────────────┘
                              │
   ┌──────────┬───────────┬───┴────────────┬───────────────────┬──────────────┐
   ▼          ▼           ▼                ▼                   ▼              ▼
agent-svc  ticket-svc  display-svc  game-roulette-svc        backoffice    agent-web
                                    + WS /ws/roulette                       mode=standalone
                                    + cyclic loop
```

All on the `casino_network` Docker bridge. Unity binds to
`ws://<host>:80/ws/roulette`. Cashier opens `<host>:80/agents/pos/`.

### integrated-agd

```
                ┌──────────────────────────────────┐
                │ Traefik :8880 (AGD repo)          │
                └──────────────────────────────────┘
                              │
        ┌─────────────────────┼──────────────────────────┐
        ▼                     ▼                          ▼
agd-casino-service     agd-wallet-service          agd-casino-admin-web
        │   │   ▲
        │   │   └────────────────────────┐
        │   │ Socket.IO /casino/ws       │
        │   └─────────► agent-web mode=agd (?embed=1)
        │
        │ HTTP on_demand
        ▼
casino-roulette-engine (this repo, ENGINE_MODE=on_demand)
        │
        ▼
casino_roulette_db  (Postgres)
```

The Python engine still runs in this repo, but only the
`game-roulette-service` is started, in `on_demand` mode (no cyclic
loop, no WebSocket loop required, but the WS surface is still up so
public-screen displays keep working).

---

## 3. Docker compose files

| File                                  | Mode             | What it brings up                                                                                                              |
|---------------------------------------|------------------|--------------------------------------------------------------------------------------------------------------------------------|
| `docker-compose.yml`                  | standalone       | Postgres + Redis + Traefik + agent-service + ticket-service + display-service + game-roulette-service(cyclic) + backoffice + agent-web (mode=standalone) |
| `docker-compose.integrated-agd.yml`   | integrated-agd   | game-roulette-service (ENGINE_MODE=on_demand only). Assumes Postgres / Redis come from elsewhere (typically the AGD infra)     |
| `docker-compose.scale.yml`            | both             | Overrides for horizontal scale-out tests                                                                                       |

### Bring up — standalone

```bash
# from this repo root
docker compose up -d
```

Verify :

```bash
curl http://localhost:80/health
curl http://localhost:80/agents/pos/
```

### Bring up — integrated-agd

```bash
# 1) Start the AGD infra (Postgres / Rabbit / Redis / Traefik)
cd ../AGD\ Techbet/agd
POSTGRES_PORT=5433 docker compose up -d

# 2) Start the AGD applicative services
for d in agd-auth agd-wallet-service agd-betslip-service agd-provider-cosumer agd-websocket-gateway agd-casino-service agd-casino-admin-web; do
  (cd "../$d" && docker compose up -d)
done

# 3) Start the Python engine in on_demand mode (this repo)
cd ../../casino-microservices
docker compose -f docker-compose.integrated-agd.yml up -d
```

Verify :

```bash
curl http://localhost:8880/api/v1/agd_casino/health/live
curl http://localhost:8880/casino-admin/login
```

---

## 4. Environment variables — by mode

### Shared (always set)

```env
POSTGRES_HOST=...        # standalone: casino_db ; integrated-agd: agd-postgres
POSTGRES_PORT=5432
REDIS_HOST=...           # standalone: casino_redis ; integrated-agd: agd-redis
RABBITMQ_URL=...         # integrated-agd only
JWT_AUTH_SECRET=...      # must MATCH the agd-auth secret in integrated-agd
```

### game-roulette-service (the dual-mode service)

```env
ENGINE_MODE=cyclic        # standalone — default
ENGINE_MODE=on_demand     # integrated-agd
INTERNAL_API_KEY=...      # only on_demand: agd-casino-service authenticates calls
```

### agent-web

```env
VITE_INTEGRATION_MODE=standalone
VITE_STANDALONE_API_URL=/api

# OR

VITE_INTEGRATION_MODE=agd
VITE_AGD_API_URL=http://<host>:8880/api/v1/agd_casino
VITE_AGD_AUTH_URL=http://<host>:8880/api/v1/agd_auth
VITE_AGD_WS_URL=http://<host>:8880/casino/ws
VITE_AGD_GAME_CODE=ROULETTE_EU
```

Note these are **build-time** values. Switching modes requires a
rebuild + redeploy.

---

## 5. Coexistence — running both on the same host

It is **possible** to run both modes at once, pointing at the same
underlying engine. The engine accepts both surfaces concurrently —
just make sure ports don't collide.

Typical layout :

- `docker-compose.yml` brings up engine with `ENGINE_MODE=cyclic` AND
  the on_demand HTTP route is also active because the FastAPI router
  registers both unconditionally (the only effect of `ENGINE_MODE` is
  whether the cyclic loop coroutine starts).
- `agd-casino-service` calls `POST /internal/spins` regardless of the
  loop state.

The DB schema and round id space are shared, so a verify URL is valid
across modes.

If you don't need the Unity loop in a deployment that targets AGD
only, set `ENGINE_MODE=on_demand` to skip the cyclic coroutine and
save the resources.

---

## 6. Scaling

### Engine

- Single instance can sustain ~500 spins/sec (Phase 11 target,
  established by the original Python benchmarks).
- Horizontal scale-out is supported but not required for V1; replicas
  share the Postgres `roulette_rounds` table.
- The cyclic loop should run in **only one replica** in standalone
  (uses Redis lock if multiple are configured). The on_demand HTTP
  surface scales freely.

### agd-casino-service

- Stateless NestJS; replicate freely behind Traefik.
- Socket.IO uses Redis adapter so replicas share rooms (Phase 7).
- Traefik sticky cookie `casino_ws_affinity` keeps reconnecting
  clients on the same replica when possible.

---

## 7. Observability

| Signal                                       | Where to look                                             |
|----------------------------------------------|-----------------------------------------------------------|
| Engine spin latency                          | `casino-roulette-engine` JSON logs / Grafana panel        |
| agd-casino-service request latency           | `agd-casino-service` JSON logs, `HTTP` log lines          |
| RabbitMQ queue depth                         | RabbitMQ management UI on `:15672`                        |
| Wallet failure rate                          | `WALLET_DEBIT_FAILED` / `WALLET_CREDIT_FAILED` log lines  |
| Jackpot conservation drift                   | `scripts/jackpot-e2e-sim.mjs` (nightly)                   |
| Provably-fair recompute drift                | `scripts/e2e-verify-test.mjs`                             |
| WS connect rejections                        | `WS connection rejected:` in casino-service logs          |

Loki + Grafana ship with the AGD infra (`agd-loki`, `agd-grafana`).
Casino logs land there automatically.

---

## 8. Rollback (integrated-agd mode)

If an incident takes down the integrated flow but standalone is still
needed, here's the playbook :

1. **Stop the integrated path** — the offending replica only :
   ```bash
   docker compose -f agd-casino-service/docker-compose.yml stop
   ```
2. **Switch agent-web** back to standalone (only if it was deployed in
   `agd` mode and you can rebuild quickly) :
   ```bash
   export VITE_INTEGRATION_MODE=standalone
   (cd services/agent-web && docker compose up -d --build)
   ```
3. **Tell ops :** the casino product is back to the standalone
   surface — `<host>:80/agents/pos/`. AGD players who have an in-flight
   bet will see their session marked SUSPENDED next time they connect
   (no money lost — wallet was debited *and* refunded by the saga).
4. **Drain** `agd.events` queues if there's a backlog :
   ```bash
   docker exec agd-rabbitmq rabbitmqadmin -u agd -p ... \
     get queue=agd.casino-service.ws-relay count=100 ackmode=ack_requeue_false
   ```
   then bring casino-service back up — the events buffer is durable so
   no settled spin is lost.
5. **Post-mortem :** check the `WALLET_DEBIT_FAILED` / `engine timeout`
   counters; if jackpot contributions are mid-flight, the conservation
   sim should still pass once stable.

There is no rollback from standalone → integrated-agd that needs
documenting: the integrated platform is purely additive.

---

## 9. CI matrix

| Workflow                                   | Mode covered     |
|--------------------------------------------|------------------|
| `agd-casino-service/.github/workflows/ci.yml`        | integrated-agd backend |
| `agd-casino-admin-web/.github/workflows/ci.yml`      | integrated-agd UI |
| `casino-microservices/.github/workflows/ci.yml`     | standalone — TODO if not present |

Both modes are tested in PRs; the load + jackpot sims are nightly.

---

## 10. Known issues / open requests

- **REQ-011** : wallet ↔ profile binding drifts in integrated-agd —
  see `../AGD Techbet/docs/AGD_INTEGRATION_REQUESTS.md`. Workaround
  documented; blocking real 500 spins/sec live runs.
- **Multi-instance cyclic loop** : in standalone mode, only one replica
  must run the loop. Enforced by a Redis lock today; consider a
  dedicated leader-election service if scale-out is required.
- **Time-zone consistency** : engine writes timestamps as UTC; admin
  UIs render in user locale. Make sure JIRA reports use UTC.

---

## See also

- `../README.md` — overall product description
- `../AGD Techbet/agd-casino-service/README.md` — integrated backend
- `../AGD Techbet/agd-casino-service/docs/INTEGRATION_GUIDE.md` — consumers
- `../AGD Techbet/agd-casino-service/docs/RUNBOOK.md` — on-call runbook
- `../AGD Techbet/docs/CASINO_INTEGRATION_PLAN.md` — the 13-phase plan
- `../AGD Techbet/docs/AGD_INTEGRATION_REQUESTS.md` — pending AGD-side gaps
