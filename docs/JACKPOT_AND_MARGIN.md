# Jackpots & the 30% house margin

This is the authoritative reference for how casino jackpots are calculated, when
they pay out, how the win is signalled to displays, and how the **30% net house
margin** is engineered. It complements `JACKPOT_SERVICE_PLAN.md` (service design)
and `KENO_IMPLEMENTATION_PLAN.md` (keno engine/paytable).

---

## 1. Jackpot pots

`jackpot-service` is the single source of truth for every pot. A pot accumulates
a slice of every qualifying bet and pays out when it crosses a secret threshold.

| Pot | Scope | Fed by | Contribution | Threshold range (XAF) |
|---|---|---|---|---|
| **Général** | `GLOBAL` | every bet, every game, every kiosk | **1.0%** | 10M – 50M |
| **Spin & Win** | `GAME` `ROULETTE-TBL1` | roulette bets only | **0.5%** | 5M – 20M |
| VOLKENO (keno) | `GAME` `KENO-DRAW1` | keno bets only | **0.5%** | 5M – 20M |
| Bronze / Silver / Gold | `LOCAL` per (game, kiosk) | that game at that kiosk | 0.5% / 0.3% / 0.1% | 0.5–2M / 2–8M / 8–30M |

Definitions live in `jackpot-service/app/main.py` (GLOBAL/GAME seeds) and
`jackpot-service/app/services.py` `_ensure_local_pots` (LOCAL tiers).

### How "General" vs "Spin & Win" differ
Both use the same percentage mechanism — `contribution = wager × pct / 100`
(`services.py:_compute_contribution`) — but differ in **scope and rate**:
- **Général** is `GLOBAL`: **1%** of *every* ticket across all games and kiosks.
- **Spin & Win** is a roulette-only `GAME` pot: **0.5%** of roulette stakes,
  never fed by keno.

Contribution happens **synchronously at ticket sale**: `ticket-service` calls
`POST /internal/contribute` (`ticket-service/app/main.py`), which feeds every
eligible pot in one transaction. It is idempotent per `ticket_id` and fail-open
(a jackpot-service outage never blocks a sale).

---

## 2. When a jackpot is won

"Must-hit-by" model (`services.py`):
1. Each pot holds a **secret threshold** drawn uniformly in `[min, max]`
   (`threshold.py`, crypto RNG). Never exposed to clients.
2. Each contribution atomically increments `current_amount`. If it reaches the
   threshold, a HIT is claimed under `SELECT … FOR UPDATE` (one winner per cycle).
3. **Winner** = the triggering ticket (`TRIGGER_TICKET`) or a random recent
   contributor (`RANDOM_RECENT`), configurable per pot in the backoffice.
4. **Payout** = `min(pot, max_payout)` (or the full pot); the remainder carries
   over. The pot resets (seed + carryover), draws a **new** threshold, and bumps
   its cycle. Recorded in `jackpot_wins`.

Because every contributed XAF is eventually paid out (carryover guarantees no
loss across a cycle), the jackpot slice is **deferred player return**, not house
profit — this is load-bearing for the margin math in §4.

---

## 3. Signalling a win to displays & cashiers

There are **two** distinct jackpot signals — don't conflate them:

- **Ticking amounts** (`jackpot_updated` / `medals_updated`): pots climbing in
  real time. jackpot-service publishes Redis `jackpot-updated`; engines relay to
  WS clients. Drives the rolling-digit displays.
- **Win event** (`jackpot_hit`): a pot was just won. **This is new** — previously
  no backend signal reached the displays, so the VOLKENO jackpot cinematic was
  wired to a local draw-match tier that never fires in display mode.

### The `jackpot_hit` pipeline
```
contribution crosses threshold
  → jackpot-service: _publish_hit()  →  Redis channel "jackpot-hit"
       payload: { hit_id, pot_id, scope, tier, game_id, kiosk_code,
                  payout, winner_ticket_id, cycle_number }
  → game-keno-service: consume_jackpot_hit() → broadcast_hit()
       WS frame: { type:"jackpot_hit", scope, tier, amount, drawId,
                   cycleNumber, hitId }
       targeting: GLOBAL/GAME → all displays; LOCAL → winning kiosk only
  → VOLKENO: protocol JackpotHitEvent → GameStateContext dispatches
       window.__volkenoEvents "beat:jackpot-hit"
       → EruptionDirector plays buildJackpotCinematic (phase-gated, deduped)
  → agent-web: useKenoWs `jackpot_hit` → Keno.jsx drives JackpotHitOverlay
```
- `hit_id` (`{potId}:{cycle}`) is carried end-to-end so every consumer dedupes
  (Redis pub/sub is at-least-once across reconnects).
- The cinematic is **deferred** if a hit lands mid-`draw`, and played at the next
  `idle`/`results` window so it never interrupts an in-progress ball reveal.
- Test the display path without a backend:
  `window.__volkenoMockFeed.triggerJackpotHit()`.

> Roulette parity (`game-roulette-service`) is the same two additions
> (`consume_jackpot_hit` + `broadcast_hit`); keno is wired first.

---

## 4. The 30% net house margin

> **Net** = what the company keeps **after** funding the jackpots. Since jackpot
> contributions are returned to players (§2), they count as deferred player
> return, so the base game must give back *less* to leave 30% net.

### The math
- Net margin target **30%** ⇒ total player return **70%**.
- Guaranteed jackpot slice = GLOBAL 1% + KENO game 0.5% = **1.5%** (the LOCAL
  0.9% only exists when a `kiosk_code` is present — designing against 1.5% is the
  conservative choice; with a kiosk the player gets *slightly more* back, ~29.1%
  net, never less).
- So the **base keno paytable** must target RTP = `0.70 − 0.015 = 0.685`
  (base house edge ≈ 31.5%).

House edge comes **entirely from the paytable's expected value** — the draw RNG
is provably-fair and unbiased (`game-keno-service/app/keno_rng.py`). For a `k`-spot
bet, matching exactly `m` of the 20 drawn is hypergeometric:
`P(m|k) = C(k,m)·C(80−k, 20−m) / C(80,20)`, and `RTP(k) = Σ P(m|k)·multiplier(k,m)`.

### Why "uniform per spot count" matters
Before this work the paytable was **not** uniform — RTP ranged 68–84%, and
**spot-10 returned 84%** (16% edge). A rational player just picked 10 spots. The
fix tunes **every** spot count to the same 68.5% RTP, so no choice beats the house.

| spots | RTP | base edge | net @1.5% |
|---|---|---|---|
| 1 | 68.50% | 31.50% | 30.00% |
| 2 | 68.60% | 31.40% | 29.90% |
| 3 | 68.41% | 31.59% | 30.09% |
| 4 | 68.50% | 31.50% | 30.00% |
| 5 | 68.56% | 31.44% | 29.94% |
| 6 | 68.53% | 31.47% | 29.97% |
| 7 | 68.40% | 31.60% | 30.10% |
| 8 | 68.47% | 31.53% | 30.03% |
| 9 | 68.45% | 31.55% | 30.05% |
| 10 | 68.56% | 31.44% | 29.94% |
| 11 | 68.48% | 31.52% | 30.02% |
| **blended** | **68.50%** | **31.50%** | **30.00%** |

### "30% on average, with swings like 35/24/27%"
You **cannot** force a fixed margin over a specific window without breaking
provable fairness — the RNG is honest, so a single round can pay out far more or
less than 30%. What is engineered is the **expectation**: every bet has an
expected house take of 30%, and by the **Law of Large Numbers** the realized
margin converges to 30% over many draws. Variance is real and rises with spot
count — the spots-11 ×500000 top prize dominates per-round swings (see the CoV
column in `keno_rtp_check.py`). That is the source of the 35/24/27% you expect to
see round to round.

### Tooling (this is how we *stay* at 30%)
- **`tools/keno_paytable.py`** — generates the paytable: keeps each prize-curve
  *shape*, fixes aspirational top prizes (the jackpot hook), and rescales every
  row to 68.5% RTP. `--emit-python` / `--emit-js` produce the committed tables.
- **`tools/keno_rtp_check.py`** — prints RTP / edge / net margin / CoV per spot
  and the blended margin. Run after any paytable change.
- **`services/ticket-service/tests/test_keno_rtp.py`** — asserts every spot count
  stays at 68.5% ± 0.5pp, the prize curve is sane (monotonic, consolation ≤ 2×),
  and the agent-web `KenoGrid.jsx` display mirror matches the backend table
  (drift guard). A bad paytable edit fails the test.

The canonical paytable is `ticket-service/app/keno_rules.py` (the only copy that
moves money). Multipliers are fractional for low spots (e.g. 1 spot = 2.74×, not
3× = 75%) because integer-only cannot hit 68.5% there; `calculate_keno_payout`
floors the payout to whole XAF (house-favorable).

> **Product note:** retuning is player-visible. The biggest change is spot-10
> (84% → 68.5%); spots 1 and 3 also tighten. Top prizes are preserved. This is a
> deliberate margin decision, not a silent edit.
