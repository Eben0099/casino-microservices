# VOLKENO WebSocket Protocol — Backend Integration Guide

**Version:** 1.1
**Last Updated:** 2026-05-26
**For:** Backend team implementing the VOLKENO game server.

**Changelog**
- `1.1` (2026-05-26): **Kiosk authentication is now mandatory.** The frontend collects a `kiosk_id` from the agent on a start overlay (persisted in `localStorage`) and appends `?kiosk_id=<id>` to the WS URL. Backend rejects unknown ids with HTTP `403 Forbidden` during the handshake. `bronze`/`silver`/`gold` medal counts are now **per-kiosk**; `generalAmount`/`volkenoAmount` jackpots remain **global**. Frontend treats "socket closed before `welcome`" as auth rejection → clears the persisted id and re-shows the overlay.

---

## Overview

This document describes exactly what the VOLKENO display client expects from the backend server over WebSocket. Follow this spec and the frontend will work without any code change on the display side.

**Transport:** WebSocket (`ws://` for local dev, `wss://` for production)
**Encoding:** JSON, UTF-8
**Direction labels:** `S→C` = server to client, `C→S` = client to server.

The TypeScript shape of every payload lives at `app/lib/feed/protocol.ts`. This document is the human-readable mirror — keep them in sync.

---

## Why WebSocket

VOLKENO is a real-time, phase-based game. The client switches screens at every phase transition (`idle` → `preLaunch` → `draw` → `results` → `idle`) and the volcano cinematic must begin within the same animation frame the server enters the `draw` phase. WebSocket gives us persistent, low-latency push — no polling, no per-phase HTTP round-trip.

---

## What this client is and is not

VOLKENO is a **public display** (lobby kiosk, casino floor screen). It is **not** an interactive terminal — players don't pick numbers, don't stake, don't bet from this client. The protocol is therefore **almost entirely server → client**. The only message the client sends is `ping`.

If you later wire an interactive variant, add C→S messages here under §5 — the abstraction is ready for them.

---

## Connection lifecycle

```
[Agent types kiosk_id on the start overlay → frontend persists to localStorage]

Client opens WS:  ws://<host>/ws/volkeno?kiosk_id=<URL-encoded id>
    │
    ├── Backend rejects unknown id → HTTP 403 Forbidden during handshake
    │       └── Client clears localStorage, re-shows the overlay
    │
    └── Backend accepts → sends `welcome` immediately
            │
            └── Client sends "ping" every 20 seconds (keep-alive + clock sync)
                    │
                    └── Server responds with "pong"

On disconnect (after welcome): client reconnects with exponential backoff
(0.5s → 1s → 2s → 4s → 8s, cap 15s, infinite attempts), resets on welcome.

On page-visibility hidden ≥ 60 s: client closes the socket. On visible: reconnects.
```

The client handles reconnection completely by itself. Your server just needs to send a `welcome` immediately on every new connection (including reconnections).

If `welcome` does not arrive within 5 seconds of the WebSocket opening, the client treats the connection as soft-failed and reconnects. Keep `welcome` cheap.

### Kiosk authentication

The `kiosk_id` query parameter is the **only** credential for the WS session. The backend is the single authority deciding whether a kiosk is known.

- **Read** `kiosk_id` from the WS URL query string (FastAPI: `websocket.query_params.get("kiosk_id")`).
- **Validate** it BEFORE accepting the upgrade. Unknown / missing / malformed ids must be rejected with **HTTP `403 Forbidden`** during the handshake. No frame is ever sent on the socket; the upgrade just fails. Example:
  ```
  GET /ws/volkeno?kiosk_id=BAD  HTTP/1.1
  …
  HTTP/1.1 403 Forbidden
  Content-Length: 0
  ```
- The frontend (`WebSocketGameFeed`) tracks whether `welcome` was received on the current socket. If the socket closes **before** any `welcome` arrives, it interprets that as `auth_rejected`, suspends the reconnect loop, clears the persisted id, and re-shows the start overlay with "Identifiant kiosque invalide". Once `welcome` lands, any subsequent close goes through the normal reconnect path.

This means the backend doesn't need to emit an error frame or a custom close code — just rejecting the handshake is enough. If a future deployment wants to send a custom message, include it in the HTTP 403 body; the client logs it but still surfaces the generic message to the agent.

---

## Message format

Every message is a JSON object. Every server → client message has a `type` field (string) and a `serverTime` field (epoch milliseconds, integer or float).

```json
{
  "type": "<message-type>",
  "serverTime": 1748202900123,
  /* ...other fields... */
}
```

---

## Server → Client messages

### 1. `welcome`

**When to send:** Immediately after a client connects or reconnects.

**Why it exists:** The client may reconnect mid-phase (e.g. after a network hiccup). `welcome` gives it everything needed to restore the correct visual state in one frame — which screen to show, how much time is left, what the current draw id is, the 20 numbers if a draw is in flight, and the stats / jackpot / medals payloads so the dashboard renders on first paint without a flash of empty state.

```json
{
  "type": "welcome",
  "serverTime": 1748202900123,
  "currentDrawId": 1617,
  "phase": "idle",
  "phaseStartedAt": 1748202895000,
  "phaseDurationMs": 30000,
  "drawnNumbers": null,
  "stats": { /* StatsSnapshot — see §3 below */ },
  "jackpot": { /* JackpotState — see §4 */ },
  "medals": { /* MedalsState — see §4 */ }
}
```

| Field | Type | Description |
|---|---|---|
| `serverTime` | int (epoch ms) | Server clock at send. The client uses it to estimate offset for the local countdown. |
| `currentDrawId` | int | The round id currently shown in the footer / StatusOverlay pill / recent-draws highlight. |
| `phase` | enum string | One of `"idle"`, `"preLaunch"`, `"draw"`, `"results"`. |
| `phaseStartedAt` | int (epoch ms) | When the current phase began on the server. Client computes `remainingMs = phaseStartedAt + phaseDurationMs - now`. |
| `phaseDurationMs` | int (ms) | Total duration of the current phase. Authoritative — overrides the client's fallback. |
| `drawnNumbers` | `int[20]` or `null` | The 20 drawn numbers if `phase === 'draw'` or `'results'`; `null` otherwise. Reconnecting clients use this to snap balls to their slots without the eruption animation. |
| `stats` | object | See `StatsSnapshot` in §3. |
| `jackpot` | object | See `JackpotState` in §5. Global — same for every kiosk. |
| `medals` | object | See `MedalsState` in §6. **Scoped to the `kiosk_id` on the WS URL.** |

**Example — reconnecting during `draw` with the 20 numbers already determined:**

```json
{
  "type": "welcome",
  "serverTime": 1748202944000,
  "currentDrawId": 1617,
  "phase": "draw",
  "phaseStartedAt": 1748202907000,
  "phaseDurationMs": 67000,
  "drawnNumbers": [3, 7, 12, 18, 21, 25, 28, 33, 39, 42, 47, 51, 56, 58, 62, 67, 70, 73, 76, 79],
  "stats": { /* ... */ },
  "jackpot": { /* ... */ },
  "medals": { /* ... */ }
}
```

---

### 2. `phase_changed`

**When to send:** At the start of every phase transition, for every connected client.

**Why it exists:** Main synchronization signal. The client uses it to advance the visual state machine and reset the countdown.

```json
{
  "type": "phase_changed",
  "serverTime": 1748202907012,
  "drawId": 1617,
  "phase": "draw",
  "startedAt": 1748202907000,
  "durationMs": 67000
}
```

| Field | Type | Description |
|---|---|---|
| `drawId` | int | The round id this phase belongs to. Increments only on `idle` entry (the server increments before sending the `idle` `phase_changed`). |
| `phase` | enum string | One of `"idle"`, `"preLaunch"`, `"draw"`, `"results"`. |
| `startedAt` | int (epoch ms) | Phase start on the server. |
| `durationMs` | int (ms) | Authoritative duration. Overrides client defaults. |

**Important — ordering contract:**

- `phase_changed(phase=draw)` MUST be sent **before** `draw_locked` for the same round. WebSocket is ordered, so just send them in sequence.
- `stats_updated` for round N MUST be sent **before** `phase_changed(phase=results)` for round N, so the results screen renders the new snapshot with the just-completed draw at the top of recent-draws.

---

### 3. `draw_locked`

**When to send:** Immediately after `phase_changed(phase=draw)`, in the same writer flush. Carries the 20 numbers for this round.

**Why all 20 numbers up front:** The per-ball eruption animation is a frame-accurate GSAP timeline (~3.3 s per ball). Per-ball server pushes would inject network jitter into a 60 Hz timeline. A real RNG-certified backend commits all 20 numbers atomically at the moment of draw lock; revealing them in sequence is purely presentational.

```json
{
  "type": "draw_locked",
  "serverTime": 1748202907020,
  "drawId": 1617,
  "numbers": [3, 7, 12, 18, 21, 25, 28, 33, 39, 42, 47, 51, 56, 58, 62, 67, 70, 73, 76, 79],
  "lockedAt": 1748202907018
}
```

| Field | Type | Description |
|---|---|---|
| `drawId` | int | Must match the `drawId` of the preceding `phase_changed(phase=draw)`. |
| `numbers` | int[20] | 20 unique integers in `[1, 80]`. **Array index = ball slot index** — `numbers[0]` is the first ball to erupt, `numbers[19]` the last. |
| `lockedAt` | int (epoch ms) | When the numbers were committed server-side. |

**Constraints:**

- Exactly 20 elements.
- Every element in `[1, 80]`.
- No duplicates within the array.

The client does **not** validate these (it trusts the server). Sending malformed numbers will produce undefined visuals.

---

### 4. `stats_updated`

**When to send:** Once per round, after the draw is complete and **before** `phase_changed(phase=results)`. The snapshot must already include the just-completed draw at the end of `recentDraws`.

**Why it exists:** The recent-draws panel, hot/cold numbers, distributions all consume this. Sending it before the results screen mounts means the new data is visible the instant the dashboard re-renders.

**Replace semantics:** the client does **not** merge — it stores the full snapshot. Send the complete shape every time.

```json
{
  "type": "stats_updated",
  "serverTime": 1748202974000,
  "snapshot": { /* StatsSnapshot — see below */ }
}
```

**`StatsSnapshot` shape:**

```json
{
  "recentDraws": [
    {
      "id": 1608,
      "numbers": [2, 5, 11, 13, 18, 22, 27, 31, 34, 39, 44, 49, 55, 58, 62, 66, 70, 73, 77, 80],
      "time": "21:45"
    },
    /* ... 8 more, chronological — oldest first ... */
    {
      "id": 1617,
      "numbers": [3, 7, 12, 18, 21, 25, 28, 33, 39, 42, 47, 51, 56, 58, 62, 67, 70, 73, 76, 79],
      "time": "22:18"
    }
  ],
  "hot":         [ { "n": 18, "count": 7 }, { "n": 39, "count": 6 }, /* ...up to 6 entries... */ ],
  "cold":        [ { "n": 1,  "count": 0 }, { "n": 14, "count": 0 }, /* ...up to 6... */ ],
  "consecutive": [ { "n": 30, "count": 4 }, { "n": 53, "count": 3 }, /* ...up to 6... */ ],
  "rowDistribution": [3, 2, 3, 1, 2, 3, 3, 3],
  "colDistribution": [2, 3, 1, 3, 2, 2, 2, 2, 1, 2]
}
```

| Field | Type | Constraint |
|---|---|---|
| `recentDraws` | array of `DrawRecord` | Up to 10 entries, chronological — **oldest first**, newest last. The newest entry's `id` must equal the `drawId` of the round that just completed. |
| `recentDraws[i].id` | int | Round id. |
| `recentDraws[i].numbers` | int[20] | Sorted ascending. |
| `recentDraws[i].time` | string (`"HH:MM"`) | Wall-clock time string. The client renders it as-is — pick the timezone you want viewers to see. |
| `hot` | array | Up to 6 `{ n, count }` — most frequent numbers in the trend window. |
| `cold` | array | Up to 6 `{ n, count }` — least frequent. |
| `consecutive` | array | Up to 6 `{ n, count }` — numbers appearing in 2+ consecutive draws within the window. |
| `rowDistribution` | int[8] | Counts per row of 10 (`1-10`, `11-20`, …, `71-80`) for the **latest** draw only. |
| `colDistribution` | int[10] | Counts per units digit (`1`, `2`, …, `9`, then `0` for multiples of 10) for the **latest** draw only. |

The trend window the server should use is up to **the last 20 draws**, but the client treats the values as opaque — if you want a different window size, the dashboard will display whatever you send.

---

### 5. `jackpot_updated`

**When to send:** As often as you want (every 3 s, on every wager, on every hit — your call). The client doesn't throttle on receive; React batching keeps render cost trivial.

```json
{
  "type": "jackpot_updated",
  "serverTime": 1748202903000,
  "jackpot": {
    "generalAmount": 1500127,
    "volkenoAmount": 500001284,
    "currency": "XAF",
    "lastHitDrawId": null
  }
}
```

| Field | Type | Scope | Description |
|---|---|---|---|
| `generalAmount` | int | **Global** | Whole XAF. No decimals — XAF is integer-only. Same value across every connected client. Seed suggestion: `1_500_000`. |
| `volkenoAmount` | int | **Global** | Whole XAF. Same value across every connected client. Seed suggestion: `500_000_000`. |
| `currency` | string | n/a | Always `"XAF"` for now. |
| `lastHitDrawId` | int or null | n/a | The round that last hit the jackpot, or `null` if never hit since rollover. Currently unused in the UI but reserved for a future "last hit" badge. |

`generalAmount` and `volkenoAmount` are global counters: every kiosk sees identical values. They grow from the sum of stakes across all kiosks.

---

### 6. `medals_updated`

**When to send:** At the end of every results phase, with the new cumulative tier counts **for the kiosk identified by `kiosk_id` on the connecting socket**.

```json
{
  "type": "medals_updated",
  "serverTime": 1748202975000,
  "medals": {
    "bronze": 12,
    "silver": 4,
    "gold": 1
  }
}
```

| Field | Type | Scope | Description |
|---|---|---|---|
| `bronze` | int ≥ 0 | **Per-kiosk** | Bronze-tier wins for this `kiosk_id`. |
| `silver` | int ≥ 0 | **Per-kiosk** | Silver-tier wins for this `kiosk_id`. |
| `gold` | int ≥ 0 | **Per-kiosk** | Gold-tier wins for this `kiosk_id`. |

**Per-kiosk scoping.** The three medal counts are isolated per `kiosk_id`. Broadcast `medals_updated` only to clients connected with the affected kiosk id. Persist per kiosk (suggestion: `medal_state(kiosk_id TEXT, name TEXT, value INT, PRIMARY KEY(kiosk_id, name))`).

The client maps these directly to the three cards in the idle-phase footer. Whatever tier/threshold mapping you use server-side is fine — VOLKENO doesn't have an opinion. (For reference: today the mock feed uses the same tier names; see `tierForMatches` in `app/lib/gameState.ts`.)

---

## Client → Server messages

### `ping`

**When:** Every 20 seconds while the connection is open.

**Why:** Two purposes — keeps the WebSocket alive through NAT/firewalls, and lets the client estimate the server/client clock offset for accurate countdowns.

```json
{
  "type": "ping",
  "clientTime": 1748202903123
}
```

### `pong` (server response to ping)

Echo `clientTime` unchanged, plus your current server time.

```json
{
  "type": "pong",
  "clientTime": 1748202903123,
  "serverTime": 1748202903145
}
```

The client uses `rtt = now - clientTime` and `serverTimeOffset ≈ serverTime + rtt/2 - now` to refine clock sync. Even an approximate offset improves the visible countdown alignment across thousands of viewers.

**Silence timeout:** if 30 s pass with no message of any kind from the server (no events, no pong), the client treats the connection as dead and reconnects. Keep at least one message flowing every < 30 s — `pong` to a ping is enough.

---

## Round flow — complete example

One full round as the server should write it, message by message:

```
[Client connects]
S→C: welcome { phase: "idle", currentDrawId: 1617, phaseStartedAt: T-5s, phaseDurationMs: 30000, drawnNumbers: null, stats: {...}, jackpot: {...}, medals: {...} }

[T+25s — idle ends]
S→C: phase_changed { drawId: 1617, phase: "preLaunch", startedAt: T+25s, durationMs: 2000 }

[T+27s — preLaunch ends, draw begins]
S→C: phase_changed { drawId: 1617, phase: "draw",      startedAt: T+27s, durationMs: 67000 }
S→C: draw_locked   { drawId: 1617, numbers: [3,7,12,…,79], lockedAt: T+27s }
  ↑ same writer flush — draw_locked MUST arrive after phase_changed(draw)

[T+94s — draw ends, results begins]
S→C: stats_updated { snapshot: { /* recentDraws ends with { id: 1617, numbers: [3,7,12,…,79], time: "..." } */ } }
S→C: phase_changed { drawId: 1617, phase: "results", startedAt: T+94s, durationMs: 5000 }
  ↑ stats_updated FIRST, then results phase_changed

[T+95s]
S→C: medals_updated { medals: { bronze: 13, silver: 4, gold: 1 } }
  ↑ if this round produced a tier hit; optional otherwise

[T+99s — results ends]
S→C: phase_changed { drawId: 1618, phase: "idle", startedAt: T+99s, durationMs: 30000 }
  ↑ drawId bumped to 1618 — new round

[…idle, next round, repeat]
```

**Ordering contract recap:**
1. `phase_changed(phase=draw)` before `draw_locked` (for the same round).
2. `stats_updated` before `phase_changed(phase=results)` (for the same round).
3. `drawId` bumps on `idle` entry.

---

## Default phase durations

These match the mock feed (`MockGameFeed.durationFor`). Your server can use different values — the client reads `durationMs` from each `phase_changed`.

| Phase | Demo (mock) | Production target |
|---|---:|---:|
| `idle` | 30 s | 240 s (4 min stake selection) |
| `preLaunch` | 2 s | 2 s |
| `draw` | 67 s | 67 s (20 balls × ~3.3 s + 1 s tail) |
| `results` | 5 s | 35 s (payout window) |

The `draw` phase is the longest. If you change it, change the per-ball pacing constants in `app/lib/gameState.ts` too — the ball animation runs off those, not off `durationMs`. The two should agree.

---

## Number layout reference

Keno numbers are `1..80`, no colors, no parity meaning. The client uses the row/column distribution arrays in `stats.rowDistribution` and `stats.colDistribution` for the dashboard bars:

- **Rows of 10:** indices `0..7` = `[1–10]`, `[11–20]`, …, `[71–80]`.
- **Columns by units digit:** index `0..9` = `[1, 11, 21, …, 71]`, `[2, 12, …, 72]`, …, `[9, 19, …, 79]`, then index `9` = `[10, 20, …, 80]` (multiples of 10).

The trend window for `hot` / `cold` / `consecutive` should be the last 20 draws but is not enforced — send what you want; the client renders it as-is.

---

## Reconnect semantics

The client opens a fresh WebSocket and expects a `welcome` within 5 s. If `welcome.phase` is in flight (`draw` or `results`), the welcome's `drawnNumbers` field carries the 20 numbers and the client snaps balls into slots without playing the eruption animation. If the reconnect spans a phase boundary, the `welcome` reflects the **new** phase — there's no "replay the missed events" mechanism.

If the reconnect window crosses multiple draws, the client picks up at whatever `currentDrawId` the server reports. The recent-draws panel populates from `welcome.stats.recentDraws`, so any draws missed during the disconnect appear there immediately.

---

## Testing checklist

Use this to verify your implementation before connecting to the VOLKENO display.

- [ ] Server sends `welcome` immediately on every new connection (including reconnects).
- [ ] `phase` values are exact strings: `"idle"`, `"preLaunch"`, `"draw"`, `"results"`.
- [ ] `drawId` is monotonic; bumps **only** on `idle` entry.
- [ ] Within one round, footer pill, StatusOverlay pill, and the latest `recentDraws[].id` all match.
- [ ] `phase_changed(phase=draw)` arrives before `draw_locked` for the same round.
- [ ] `stats_updated` arrives before `phase_changed(phase=results)` for the same round.
- [ ] `recentDraws` is chronological, oldest first, maximum 10 entries.
- [ ] `recentDraws[i].numbers` is sorted ascending, length 20, no duplicates, in `[1, 80]`.
- [ ] `draw_locked.numbers` is in **reveal order** (the order the balls erupt), length 20, no duplicates, in `[1, 80]`.
- [ ] `pong` echoes `clientTime` unchanged.
- [ ] `serverTime` is monotonic (no backward clock jumps).
- [ ] At least one server message every < 30 s, otherwise the client will assume the connection is dead.
- [ ] WS server reads `kiosk_id` from the URL query string on connect.
- [ ] **Missing / malformed / unknown `kiosk_id`** → handshake rejected with `HTTP 403 Forbidden`, no `welcome` ever sent.
- [ ] Valid `kiosk_id` → handshake succeeds and server sends `welcome` immediately.
- [ ] `medals` returned to a client reflect THAT client's `kiosk_id` (not someone else's).
- [ ] `jackpot.generalAmount` / `jackpot.volkenoAmount` are identical across every connected client.
- [ ] `medals_updated` is broadcast only to clients connected with the affected kiosk id.
- [ ] Medal state survives a backend restart, scoped per kiosk.

---

## Quick reference — all message types

| Type | Direction | Frequency |
|---|---|---|
| `welcome` | S→C | Once per connection (including reconnects). |
| `phase_changed` | S→C | At every phase transition. |
| `draw_locked` | S→C | Once per round, immediately after `phase_changed(phase=draw)`. |
| `stats_updated` | S→C | Once per round, before `phase_changed(phase=results)`. |
| `jackpot_updated` | S→C | Whenever you want. |
| `medals_updated` | S→C | At the end of every round (optional if no change). |
| `ping` | C→S | Every 20 s. |
| `pong` | S→C | In response to each `ping`. |

---

## Environment variables (frontend)

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_VOLKENO_FEED` | `mock` | Set to `ws` to use the WebSocket feed. |
| `NEXT_PUBLIC_VOLKENO_WS_URL` | *(unset)* | `wss://your-server/volkeno`. Required when `NEXT_PUBLIC_VOLKENO_FEED=ws`; falls back to the mock feed with a warning if empty. |
