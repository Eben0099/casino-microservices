# agent-web — cashier POS (React + Vite)

Cashier POS for the casino product. Runs in **two integration modes**
that share 100 % of the page code; only the API adapter is swapped at
build time.

| Mode             | Backend                                                         | Auth flow                          |
|------------------|-----------------------------------------------------------------|------------------------------------|
| **standalone**   | `ticket-service` + `agent-service` (this repo, FastAPI)         | Cashier phone + PIN                |
| **agd**          | `agd-casino-service` (`../AGD Techbet`, NestJS)                 | AGD JWT (login or embed handshake) |

The mode is decided by the build-time variable
`VITE_INTEGRATION_MODE`. Default is `standalone` so existing
deployments are not affected.

---

## Quick start

```bash
npm install
cp .env.example .env.local       # edit if needed
npm run dev                       # http://localhost:5173/agents/pos/
```

In production the app is served behind Traefik on `/agents/pos/*`
(see `vite.config.js` for the `base` setting).

---

## Configuration

| Variable                       | Default                                                     | Notes                                              |
|--------------------------------|-------------------------------------------------------------|----------------------------------------------------|
| `VITE_INTEGRATION_MODE`        | `standalone`                                                | `standalone` or `agd`                              |
| `VITE_STANDALONE_API_URL`      | `/api`                                                      | Used when mode = standalone                        |
| `VITE_AGD_API_URL`             | `http://localhost:8880/api/v1/agd_casino`                   | Used when mode = agd                               |
| `VITE_AGD_AUTH_URL`            | `http://localhost:8880/api/v1/agd_auth`                     | AGD login endpoint                                 |
| `VITE_AGD_WS_URL`              | `http://localhost:8880/casino/ws`                           | (Reserved for future Socket.IO support)            |
| `VITE_AGD_GAME_CODE`           | `ROULETTE_EU`                                               | Game catalog code passed to `POST /sessions`        |

Vite inlines these at build time. To switch a deployed binary from
standalone to agd, rebuild the container with the new env.

---

## Architecture

```
                 src/api/endpoints.js   <- legacy facade (unchanged signatures)
                          │
                          ▼
                src/api/adapters/index.js  (singleton, picks the impl at boot)
                   │                    │
                   ▼                    ▼
       standaloneAdapter.js          agdAdapter.js
         │                              │
         ▼                              ▼
   ticket-service +                agd-casino-service
   agent-service (this repo)       (../AGD Techbet)
```

The page layer (Jeux, Ventes, Verify, Shift) never calls a backend
directly — it goes through `ticketApi` / `agentApi`, which proxy to
the active adapter. This is why switching modes does not need any
page rewrite.

If you need richer features (sessions, jackpot widgets) you can
import `getAdapter()` directly from `src/api/adapters` and call any
of the contract methods documented in `src/api/adapters/types.js`.

---

## Embed mode (AGD terminal webview)

When mode is `agd` AND the page is opened with `?embed=1`, agent-web
hides its top bar, navigation, balance pill and logout button so the
host webview owns the chrome.

### URL bootstrap (simplest)

```
http://<host>:8880/agents/pos/?embed=1&token=<AGD_JWT>
```

The token is consumed on boot and stored under `localStorage.agent_token`.

### postMessage protocol (for cross-origin or sensitive flows)

```
iframe → parent : { type: 'agd:ready', mode: 'agd' }
parent → iframe : { type: 'agd:auth', token: '<JWT>', user: { id, name, … } }
parent → iframe : { type: 'agd:logout' }
iframe → parent : { type: 'agd:logout' }   // when the user logs out
```

A reproducible simulator HTML is bundled at
`public/agd-terminal-simulator.html`. Open it after starting the dev
server :

```
http://localhost:5173/agents/pos/agd-terminal-simulator.html
```

Paste a JWT, click "Send agd:auth", and watch the iframe authenticate.

---

## Scripts

```bash
npm run dev          # vite dev server (port 5173)
npm run build        # vite build (output: dist/)
npm run lint
```

### Adapter smoke

A Node smoke that exercises the agdAdapter end-to-end against
`agd-casino-service` is shipped at `scripts/test-adapters.mjs` :

```bash
node scripts/test-adapters.mjs    # 5/6 pass without REQ-011 fixed
```

It opens a session, places a spin, lists recent, and closes — the only
failure mode in current AGD test fixtures is the `PROFILE_ENFORCEMENT_VIOLATION`
documented in `../AGD Techbet/docs/AGD_INTEGRATION_REQUESTS.md` REQ-011.

---

## File layout

```
src/
├── App.jsx                  router + providers (Theme, I18n, Auth)
├── main.jsx
├── api/
│   ├── client.js            axios instance (standalone token interceptor)
│   ├── endpoints.js         backwards-compatible facade -> adapter
│   └── adapters/
│       ├── types.js         apiAdapter contract (documentation)
│       ├── index.js         getAdapter() singleton
│       ├── standaloneAdapter.js
│       └── agdAdapter.js
├── components/Layout.jsx    top bar + nav (hidden in embed mode)
├── context/AuthContext.jsx  postMessage handshake, URL token bootstrap
├── hooks/                   useRoulette, useKioskJackpots
├── pages/                   Jeux, Ventes, Verify, Shift, Login
├── config.js                INTEGRATION_MODE, IS_EMBED, *_URL constants
└── i18n/                    fr/en strings, useT(), LanguageToggle
```

---

## Behaviour differences between modes

| Concept              | standalone                                  | agd                                                   |
|----------------------|---------------------------------------------|-------------------------------------------------------|
| Login                | Phone + PIN against agent-service           | Email + password against agd-auth                     |
| Session              | Implicit (no concept)                       | Opened lazily on first spin; cached in localStorage   |
| Spin                 | One ticket can contain N replays            | One spin per call (`replay_rounds` collapses to 1)    |
| Wallet               | `agent.caisse.balance`                      | `GET /diagnostics/wallet-self`                        |
| Jackpot read         | `GET /api/jackpots/by-kiosk/:code`          | `GET /api/v1/agd_casino/jackpots/by-kiosk/:code`      |
| WebSocket            | Unity bus on `/ws/roulette` (live phases)   | Socket.IO `/casino/ws` (REST-only client today)       |
| Logout side-effect   | Clears local storage                        | Also `POST /sessions/:id/close` if a session is open  |

---

## License

UNLICENSED — Internal use only.
