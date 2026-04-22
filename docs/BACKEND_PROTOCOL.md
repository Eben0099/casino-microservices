# Roulette WebSocket Protocol — Backend Integration Guide

**Version:** 1.0
**Last Updated:** 2026-04-22
**For:** Backend team implementing the roulette game server

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
  "result": null
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
S→C: phase_changed { gameId: "15565302", phase: "Result", duration: 5 }

[T+47s — Result phase ends]
S→C: phase_changed { gameId: "15565303", phase: "Betting", duration: 30 }
  ↑ new gameId for next round

[and so on...]
```

**Message ordering contract:**
- `phase_changed(Spinning)` must arrive before `result_revealed`
- `result_revealed` must arrive before `stats_updated`
- `stats_updated` must arrive before `phase_changed(Result)` (so stats are shown on the result screen)

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

---

## Quick Reference — All Message Types

| Type | Direction | When |
|---|---|---|
| `welcome` | S→C | On every connection |
| `phase_changed` | S→C | At every phase transition |
| `result_revealed` | S→C | Once per round, ≥1s before Spinning ends |
| `stats_updated` | S→C | Once per round, after result_revealed |
| `ping` | C→S | Every 25 seconds |
| `pong` | S→C | Response to ping |
