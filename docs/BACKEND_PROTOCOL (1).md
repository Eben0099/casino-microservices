# Roulette WebSocket Protocol — Backend Integration Guide

**Version:** 1.1
**Last Updated:** 2026-05-13
**For:** Backend team implementing the roulette game server

**Changelog**
- `1.1` (2026-05-13): Added jackpot feed — new `jackpot_updated` message, `jackpots` field on `welcome`, and the `GET /jackpots` REST fallback. The Unity client already consumes these (see `WebSocketRouletteBackend.cs` → `ProcessJackpotUpdated` and `RouletteGameController.HandleJackpotUpdated`). Until the backend ships this feed the header + footer jackpot cards keep ticking locally with mock data.
- `1.1.1` (2026-05-13): Clarified **per-kiosk scoping** for `bronze`/`silver`/`gold` jackpots. The Unity client now sends `?kiosk_id=<id>` on the WS URL (collected from an operator login on the start overlay, persisted to PlayerPrefs). `general` and `spin2win` remain global.

---

## Overview

This document describes exactly what the Unity frontend client expects from the backend server over WebSocket. Follow this spec and the frontend will work without any code changes on the Unity side.

**Transport:** WebSocket (`ws://` or `wss://` for production)
**Encoding:** JSON, UTF-8
**Direction labels:** `S→C` = server to client, `C→S` = client to server

---

## Why WebSocket

The game runs in real-time phases (Betting → Bets Closing → Spinning → Result, then repeat). The client needs to know immediately when a phase changes so it can switch screens and start the wheel animation at the right moment. WebSocket gives us persistent, low-latency push from server to client — no polling.

---

## Connection Lifecycle

```
Client connects
    │
    └── Server sends "welcome" immediately
            │
            └── Client sends "ping" every 25 seconds (keep-alive + clock sync)
                    │
                    └── Server responds with "pong"

On disconnect: client reconnects automatically with exponential backoff
(3s → 6s → 12s → 24s → 30s max, resets on successful reconnect)
```

The client handles reconnection completely by itself. Your server just needs to send a `welcome` message on every new connection — including reconnections.

---

## Message Format

Every message is a JSON object. Every message has a `type` field (string) and a `serverTime` field (Unix timestamp in seconds, milliseconds precision as a float/double).

```json
{
  "type": "<message-type>",
  "serverTime": 1745332800.451,
  ... other fields ...
}
```

---

## Server → Client Messages

### 1. `welcome`

**When to send:** Immediately after a client connects or reconnects.

**Why it exists:** The client may reconnect mid-phase (e.g., after a mobile network drop). The `welcome` message gives it everything it needs to instantly restore the correct state — which screen to show, how much time is left, and what the result already is if the wheel is already spinning.

```json
{
  "type": "welcome",
  "serverTime": 1745332800.000,
  "currentGameId": "15565301",
  "currentPhase": "Betting",
  "phaseStartedAt": 1745332790.000,
  "phaseDuration": 30.0,
  "result": null,
  "jackpots": {
    "general":  1523500,
    "spin2win": 501234000,
    "bronze":   2512000,
    "silver":   25234000,
    "gold":     45178000
  }
}
```

| Field | Type | Description |
|---|---|---|
| `serverTime` | float (Unix seconds) | Current server clock. Used by client to calculate clock offset. |
| `currentGameId` | string | Current round/draw ID shown in the UI. |
| `currentPhase` | string enum | One of: `"Betting"`, `"BetsClosing"`, `"Spinning"`, `"Result"` |
| `phaseStartedAt` | float (Unix seconds) | When this phase began. Client computes: `remaining = (phaseStartedAt + phaseDuration) - now` |
| `phaseDuration` | float (seconds) | Total duration of the current phase. |
| `result` | object or `null` | Non-null only during `Spinning` or `Result` phase. Contains the winning number so reconnecting clients can display it. See RouletteResult format below. |
| `jackpots` | object **or omitted** | Current jackpot values in XAF. Same shape as the `jackpot_updated` payload (see §5). Optional on the wire — if absent, the client falls back to its local mock tick. Strongly recommended on every `welcome` so newly-connected clients display real values immediately instead of waiting one full round (~52s). |

**Example — reconnecting during Spinning with a result already known:**
```json
{
  "type": "welcome",
  "serverTime": 1745332842.100,
  "currentGameId": "15565301",
  "currentPhase": "Spinning",
  "phaseStartedAt": 1745332830.000,
  "phaseDuration": 12.0,
  "result": {
    "number": 17,
    "color": "Red",
    "isEven": false,
    "isHigh": false
  }
}
```

---

### 2. `phase_changed`

**When to send:** At the start of every phase transition, for every connected client.

**Why it exists:** This is the main synchronization signal. When the client receives this, it switches screens (Stats ↔ Spin overlay) and resets the countdown timer.

```json
{
  "type": "phase_changed",
  "serverTime": 1745332830.000,
  "gameId": "15565302",
  "phase": "Spinning",
  "duration": 12.0
}
```

| Field | Type | Description |
|---|---|---|
| `gameId` | string | The round ID for this new phase. Increments each Betting phase. |
| `phase` | string enum | `"Betting"`, `"BetsClosing"`, `"Spinning"`, or `"Result"` |
| `duration` | float (seconds) | How long this phase lasts. Client uses this to run its local countdown. |

**Important:** `phase_changed` must be sent **before** `result_revealed` and `stats_updated` for the same round. WebSocket is ordered, so send them in sequence.

---

### 3. `result_revealed`

**When to send:** During the `Spinning` phase, **at least 1 second before the Spinning phase ends**.

**Why the 1-second requirement:** The client's wheel animation uses the phase duration to calculate deceleration. It reads the result from the first `round_update` with a non-null result and starts spinning. The wheel takes `duration - 1` seconds to reach the winning pocket. Sending the result too late means the animation has already started decelerating to the wrong position.

Practically: if `Spinning` lasts 12 seconds, send `result_revealed` at t=11s (1 second before the phase ends). Send it at t=10s or earlier to be safe.

```json
{
  "type": "result_revealed",
  "serverTime": 1745332840.789,
  "gameId": "15565302",
  "result": {
    "number": 17,
    "color": "Red",
    "isEven": false,
    "isHigh": false
  }
}
```

**RouletteResult fields:**

| Field | Type | Values | Notes |
|---|---|---|---|
| `number` | int | 0–36 | 0 = green pocket |
| `color` | string | `"Green"`, `"Red"`, `"Black"` | **Must be a string, not an integer.** |
| `isEven` | bool | true/false | false for 0 (zero is neither even nor odd) |
| `isHigh` | bool | true/false | true for 19–36. false for 0–18. |

---

### 4. `stats_updated`

**When to send:** Once per round, after `result_revealed`, before the next `phase_changed(Betting)`.

**Why it exists:** The client's stats dashboard, history panel, and hot/cold numbers all update from this payload. Sending it after the result means the new winning number is already included in the stats.

```json
{
  "type": "stats_updated",
  "serverTime": 1745332841.100,
  "gameId": "15565302",
  "stats": {
    "redPercent": 51.0,
    "blackPercent": 46.0,
    "greenPercent": 3.0,
    "evenPercent": 49.0,
    "oddPercent": 51.0,
    "highPercent": 52.0,
    "lowPercent": 48.0,
    "dozensPercents": [34.0, 33.0, 33.0],
    "columnsPercents": [34.0, 33.0, 33.0],
    "sectorsPercents": [17.0, 17.0, 17.0, 17.0, 16.0, 16.0],
    "linesPercents": [17.0, 17.0, 17.0, 17.0, 16.0, 16.0],
    "hotNumbers": [17, 5, 32, 21, 9, 14, 26],
    "coldNumbers": [0, 3, 36, 11, 22, 7, 28],
    "numberFrequencies": [41, 57, 48, 39, 52, 61, 44, 38, 55, 47, 50, 43, 49, 53, 46, 58, 40, 62, 51, 44, 48, 56, 45, 59, 47, 60, 42, 53, 50, 44, 57, 48, 55, 41, 52, 46, 39],
    "history": [
      { "number": 17, "color": "Red",   "isEven": false, "isHigh": false },
      { "number": 0,  "color": "Green", "isEven": false, "isHigh": false },
      { "number": 32, "color": "Red",   "isEven": true,  "isHigh": true  }
    ]
  }
}
```

**Stats fields:**

| Field | Type | Constraint | Description |
|---|---|---|---|
| `redPercent` | float | sum with black+green ≈ 100 | % of results that were red |
| `blackPercent` | float | | % of results that were black |
| `greenPercent` | float | | % of results that were green (zero) |
| `evenPercent` | float | sum with odd = 100 | % even (excluding zero) |
| `oddPercent` | float | | % odd (excluding zero) |
| `highPercent` | float | sum with low = 100 | % 19–36 (excluding zero) |
| `lowPercent` | float | | % 1–18 (excluding zero) |
| `dozensPercents` | float[3] | sum = 100 | [1st dozen 1–12, 2nd 13–24, 3rd 25–36], excluding zero |
| `columnsPercents` | float[3] | sum = 100 | [col 1, col 2, col 3], excluding zero |
| `sectorsPercents` | float[6] | sum = 100 | 6 equal wheel sectors, all pockets including zero |
| `linesPercents` | float[6] | sum = 100 | 6 lines of 6 numbers (1-6, 7-12, ..., 31-36), excluding zero |
| `hotNumbers` | int[7] | | 7 most frequent numbers, most frequent first |
| `coldNumbers` | int[7] | | 7 least frequent numbers, least frequent first |
| `numberFrequencies` | int[37] | length exactly 37 | `numberFrequencies[n]` = count of times number `n` appeared. Index 0 = zero pocket. |
| `history` | array of RouletteResult | max 200 entries | Chronological order, **oldest first**, newest last. |

**Normalization note:** All percentage arrays must sum to exactly 100 (or within ±1 due to rounding). The client does not re-normalize — it uses your values directly. Use a largest-remainder normalization method to ensure the sum is correct.

---

### 5. `jackpot_updated`

**When to send:** Once per round, after `stats_updated`, before the next `phase_changed(Betting)`. Also send it any time you administratively change a jackpot value (e.g., after seeding or a reset) so all live clients pick up the change without a reconnect.

**Why it exists:** The Unity UI has five jackpot counters that must reflect real backend values:

| Display location | Jackpot keys |
|---|---|
| Header — top of every screen | `general`, `spin2win` |
| Footer — bronze / silver / gold medal cards | `bronze`, `silver`, `gold` |

The frontend animators (`HeaderJackpotAnimator.cs`, `JackpotMarqueeAnimator.cs`) currently use mock data that increments locally — the moment a real `jackpot_updated` arrives, the client calls `SetJackpot(...)` on both animators and the displayed values jump to the server's authoritative figures. Between updates the local tick continues, which gives the cards a "live ticking up" feel; each `jackpot_updated` re-anchors them to truth.

```json
{
  "type": "jackpot_updated",
  "serverTime": 1745332841.500,
  "jackpots": {
    "general":  1523500,
    "spin2win": 501234000,
    "bronze":   2512000,
    "silver":   25234000,
    "gold":     45178000
  }
}
```

**Jackpots payload fields:**

| Key | Type | Scope | Notes |
|---|---|---|---|
| `general`  | integer (long, XAF) | **Global** | Header — General Jackpot. Same value for every connected client. Seed suggestion: `1_500_000`. |
| `spin2win` | integer (long, XAF) | **Global** | Header — Spin 2 Win Jackpot. Same value for every connected client. Seed suggestion: `500_000_000`. |
| `bronze`   | integer (long, XAF) | **Per-kiosk** | Footer bronze medal card. Value depends on the `kiosk_id` the client sent. Seed suggestion per kiosk: `2_500_000`. |
| `silver`   | integer (long, XAF) | **Per-kiosk** | Footer silver medal card. Value depends on the `kiosk_id`. Seed suggestion per kiosk: `25_000_000`. |
| `gold`     | integer (long, XAF) | **Per-kiosk** | Footer gold medal card. Value depends on the `kiosk_id`. Seed suggestion per kiosk: `45_000_000`. |

**Hard requirements:**
- Keys MUST be exactly `general`, `spin2win`, `bronze`, `silver`, `gold` (lowercase, no underscores). The Unity model (`JackpotData` in `RouletteModels.cs`) maps fields by exact name.
- Values MUST be integers (no decimals — XAF has no sub-units). Send as JSON numbers, not strings.
- Values are **monotonically non-decreasing** between resets. The client formats them with a European thousand separator (`500138654` → `"500.138.654"`); negative or shrinking values would visibly glitch the marquee.
- All five keys SHOULD be present on every push. If one is missing, the client leaves that single value unchanged (the model uses C# `long` defaults), which is fine for partial updates but easy to overlook.

#### Kiosk scoping — `kiosk_id` query parameter

Bronze/Silver/Gold are **per-kiosk progressive pools** — every kiosk has its own values. To deliver the right ones, the Unity client identifies itself when it opens the socket:

```
ws://<host>/ws/roulette?kiosk_id=<URL-encoded id>
```

The kiosk id is typed by the agent on the Unity start overlay (text field with PlayerPrefs persistence) and forwarded by `WebSocketRouletteBackend.SetKioskId(...)` before `Connect()`. It is **opaque** to the client — the server decides what counts as a valid id (UUID, kiosk_name, short code, etc.).

**Backend responsibilities:**

1. **Read `kiosk_id` from the WS query string** (FastAPI: `websocket.query_params.get("kiosk_id")`).
2. If `kiosk_id` is missing or unknown:
   - Either accept the connection and return only the global jackpots (`general`, `spin2win`), leaving the three per-kiosk values at a documented fallback (e.g., `0`), OR
   - Close the socket with code `1008` (policy violation) and message `"unknown_kiosk"` so the client can surface an error to the operator.
   Decide which is best for the deployment; the Unity client tolerates both.
3. When the kiosk_id is valid, return that kiosk's persisted bronze/silver/gold in the `welcome.jackpots` block and in every subsequent `jackpot_updated`.
4. When bets settle on a round, increment **only that kiosk's** bronze/silver/gold (by `total_wager × contribution_pct`). The global `general`/`spin2win` are incremented from the sum of all bets across all kiosks.
5. Broadcast `jackpot_updated` to **only the clients of the affected kiosk** for bronze/silver/gold updates, and to all clients for general/spin2win updates. The simplest implementation maintains one connection list per kiosk plus the broadcast list, but a single per-connection filter on send is fine.

**Storage suggestion:** `jackpot_state(kiosk_id TEXT, name TEXT, value BigInt, contribution_pct Float, updated_at, PRIMARY KEY (kiosk_id, name))`. Use a reserved sentinel like `kiosk_id = '__GLOBAL__'` for `general` and `spin2win`, or split into two tables — either works as long as the wire format stays unchanged.

**REST endpoint:** `GET /jackpots?kiosk_id=<id>` returns the same merged payload (3 per-kiosk values + 2 global). `kiosk_id` is required; without it, return `400` or just the 2 global jackpots — backend's choice.

#### Growth model — recommended

We decided on **percentage of total bets placed per round**. Suggested implementation:

1. After settlement of each round, `ticket-service` publishes a Redis pub/sub event on a new channel `jackpot-events`:
   ```json
   { "event": "ROUND_SETTLED", "round_id": "ROUND-1745332842", "total_wager": 50000 }
   ```
2. `game-roulette-service` subscribes to that channel and applies, for each jackpot key, `value += floor(total_wager × contribution_pct)`.
3. After updating, `game-roulette-service` persists the new values (Postgres) and broadcasts the `jackpot_updated` message above.

Suggested default contribution percentages (tunable via an admin endpoint — see §REST):

| Jackpot | Contribution % of `total_wager` |
|---|---|
| `general`  | 0.3% |
| `spin2win` | 0.2% |
| `bronze`   | 0.5% |
| `silver`   | 0.3% |
| `gold`     | 0.1% |

These are tuning knobs, not contractual — the wire format is the contract.

#### Persistence

Values MUST survive a backend restart. Suggested storage:
- Postgres table `jackpot_state(name PK, value BigInt, contribution_pct Float, updated_at)` for durability.
- Redis keys `jackpot:{name}` as a fast read-cache, kept in sync on every write.

If the table is empty on first boot, seed from the values listed above so the cards aren't all zero.

#### Message ordering inside a round

```
phase_changed(Spinning) → result_revealed → stats_updated → jackpot_updated → phase_changed(Result)
```

`jackpot_updated` MUST arrive before `phase_changed(Result)` so the result screen shows the post-round figure.

---

## REST endpoints (jackpot)

Two HTTP endpoints round out the feature. They are **not** required for the WebSocket flow, but they make the admin UI and ops tooling much easier.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET`   | `/jackpots?kiosk_id=<id>` | public    | Returns the merged jackpot dict for that kiosk — same shape as the `jackpots` payload above (2 global values + 3 per-kiosk values). Used as a fallback if the Unity client wants to read values without opening a WebSocket. |
| `PATCH` | `/admin/jackpots` | admin key | Override jackpot values and/or contribution percentages. Body: `{ "<name>": { "value": <long>, "contribution_pct": <float>, "kiosk_id": "<id or null for global>" }, ... }`. Effect is immediate: the server persists, updates Redis, AND broadcasts a fresh `jackpot_updated` to the affected WS clients (global change → everyone; per-kiosk change → only that kiosk). |

Use the existing `X-API-Key` header for the admin route (same key as the rest of the admin surface — see the root README §Authentication).

---

## Client → Server Messages

### `ping`

**When:** Every 25 seconds after connection.

**Why:** Two purposes: (1) keeps the WebSocket alive through NAT/firewalls, (2) lets the client calculate the server/client clock offset for accurate timer display.

```json
{
  "type": "ping",
  "clientTime": 1745332800.000
}
```

### `pong` (server response to ping)

Echo back the `clientTime` unchanged, plus your current server time.

```json
{
  "type": "pong",
  "clientTime": 1745332800.000,
  "serverTime": 1745332800.012
}
```

The client uses `rtt = now - clientTime` and `serverTimeOffset = serverTime + rtt/2 - now` to refine its clock sync. This improves the accuracy of the phase countdown timer.

---

## Round Flow — Complete Example

Here is a full round from the server's perspective, showing every message in order:

```
[Client connects]
S→C: welcome { phase: "Betting", phaseStartedAt: T-5, phaseDuration: 30, result: null }

[T+25s — Betting phase ends]
S→C: phase_changed { gameId: "15565302", phase: "BetsClosing", duration: 5 }

[T+30s — BetsClosing ends]
S→C: phase_changed { gameId: "15565302", phase: "Spinning", duration: 12 }

[T+41s — 1 second before Spinning ends, result determined]
S→C: result_revealed { gameId: "15565302", result: { number: 17, color: "Red", ... } }

[T+42s — Spinning ends]
S→C: stats_updated { gameId: "15565302", stats: { ... includes number 17 in history ... } }
S→C: jackpot_updated { jackpots: { general, spin2win, bronze, silver, gold } }
S→C: phase_changed { gameId: "15565302", phase: "Result", duration: 5 }

[T+47s — Result phase ends]
S→C: phase_changed { gameId: "15565303", phase: "Betting", duration: 30 }
  ↑ new gameId for next round

[and so on...]
```

**Message ordering contract:**
- `phase_changed(Spinning)` must arrive before `result_revealed`
- `result_revealed` must arrive before `stats_updated`
- `stats_updated` must arrive before `jackpot_updated`
- `jackpot_updated` must arrive before `phase_changed(Result)` (so the result screen shows both fresh stats and fresh jackpots)

---

## Default Phase Durations

These match the mock backend defaults. Your server can use different values — the client reads `duration` from each `phase_changed` message.

| Phase | Duration |
|---|---|
| Betting | 30 seconds |
| BetsClosing | 5 seconds |
| Spinning | 12 seconds |
| Result | 5 seconds |

---

## Number Layout Reference

For calculating `color`, `isEven`, `isHigh`, `dozens`, `columns`, `sectors`, `lines`:

**Red numbers (18 total):** 1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36

**Black numbers (18 total):** 2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35

**Green:** 0 only

**Even:** 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36 (0 excluded)

**High (19–36):** 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36

**Dozens:**
- 1st: 1–12
- 2nd: 13–24
- 3rd: 25–36

**Columns** (based on roulette table layout):
- Column 1: 1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34
- Column 2: 2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35
- Column 3: 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36

**Lines** (6 rows of the betting table):
- Line 1: 1–6
- Line 2: 7–12
- Line 3: 13–18
- Line 4: 19–24
- Line 5: 25–30
- Line 6: 31–36

**Sectors** (6 divisions of the wheel, in physical wheel order starting from 0):
The wheel order is: 0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26

Because 37 doesn't divide evenly by 6, the **last** sector (F) gets the extra pocket. The client's `RouletteTable.cs` uses this exact split — match it or the stat percentages won't align with hot/cold highlighting:

| Sector | Wheel positions (inclusive) | Numbers |
|---|---|---|
| A | 0–5   (6 pockets) | 0, 32, 15, 19, 4, 21 |
| B | 6–11  (6 pockets) | 2, 25, 17, 34, 6, 27 |
| C | 12–17 (6 pockets) | 13, 36, 11, 30, 8, 23 |
| D | 18–23 (6 pockets) | 10, 5, 24, 16, 33, 1 |
| E | 24–29 (6 pockets) | 20, 14, 31, 9, 22, 18 |
| F | 30–36 (7 pockets) | 29, 7, 28, 12, 35, 3, 26 |

---

## Testing Checklist

Use this to verify your implementation before connecting to the Unity client:

- [ ] Server sends `welcome` immediately on every new connection (including reconnects)
- [ ] `phase` values are exact strings: `"Betting"`, `"BetsClosing"`, `"Spinning"`, `"Result"`
- [ ] `color` values are exact strings: `"Red"`, `"Black"`, `"Green"` (not integers)
- [ ] `result_revealed` is sent at least 1 second before Spinning phase ends
- [ ] `stats_updated` is sent after `result_revealed` and before `phase_changed(Result)`
- [ ] `numberFrequencies` array has exactly 37 elements (index 0 = zero pocket)
- [ ] `history` array has at most 200 entries, oldest first
- [ ] All percentage groups sum to 100 (within ±1 for rounding)
- [ ] `pong` echoes `clientTime` unchanged
- [ ] `serverTime` is always increasing (no backward clock jumps)
- [ ] Server handles client reconnect gracefully (sends `welcome` again)
- [ ] `welcome` includes a `jackpots` object with all 5 keys (`general`, `spin2win`, `bronze`, `silver`, `gold`)
- [ ] `jackpot_updated` is sent once per round, after `stats_updated`, before `phase_changed(Result)`
- [ ] Jackpot keys are exactly `general`, `spin2win`, `bronze`, `silver`, `gold` (lowercase)
- [ ] Jackpot values are integers (no decimals) and monotonically non-decreasing between resets
- [ ] Jackpot state survives a backend restart (Postgres persistence)
- [ ] WS server reads `kiosk_id` from the URL query string on connect
- [ ] `bronze`/`silver`/`gold` returned to a client reflect THAT client's `kiosk_id` (not someone else's)
- [ ] `general`/`spin2win` are identical across every connected client
- [ ] Missing/unknown `kiosk_id` is handled deterministically (either fallback values or `1008` close)
- [ ] `GET /jackpots?kiosk_id=...` returns the same merged shape as the WS payload
- [ ] `PATCH /admin/jackpots` triggers an immediate `jackpot_updated` broadcast to the affected scope (global → all, per-kiosk → only that kiosk)

---

## Quick Reference — All Message Types

| Type | Direction | When |
|---|---|---|
| `welcome` | S→C | On every connection (now carries optional `jackpots` snapshot) |
| `phase_changed` | S→C | At every phase transition |
| `result_revealed` | S→C | Once per round, ≥1s before Spinning ends |
| `stats_updated` | S→C | Once per round, after result_revealed |
| `jackpot_updated` | S→C | Once per round (after stats_updated) + on any admin override |
| `ping` | C→S | Every 25 seconds |
| `pong` | S→C | Response to ping |
