/**
 * apiAdapter — common contract that both standaloneAdapter and agdAdapter
 * must implement.
 *
 * agent-web does NOT couple to either backend directly; pages call
 * `getAdapter()` (see `./index.js`) and use whichever implementation
 * the runtime mode selects. New backend implementations only have to
 * fulfil this contract.
 *
 * Why this exists
 * ---------------
 * Per CASINO_INTEGRATION_PLAN §9, the POS must run BOTH against the
 * legacy Python `ticket-service` (standalone mode) AND against
 * `agd-casino-service` REST (integrated AGD mode), without forking
 * the codebase or regressing the standalone path. The adapter
 * pattern keeps the page layer mode-agnostic.
 *
 * Shape
 * -----
 *
 *   login(phone, password) -> Session
 *     Authenticates the operator. In agd mode the credentials are an
 *     AGD email/password against agd-auth; in standalone they are the
 *     historical phone/PIN against agent-service.
 *
 *   getBalance(userId?) -> { balance, currency }
 *     Cashier (standalone) or wallet owner (agd) balance.
 *
 *   getPlayContext() -> { sessionId | null, kioskCode | null }
 *     Returns context used by jackpot widget + bet placement. In
 *     standalone the concept of a session doesn't exist; sessionId
 *     is always null. In agd a session is opened lazily on the first
 *     spin and reused for the rest of the shift.
 *
 *   placeTicket({ bets, replayRounds, gameCode }) -> NormalizedTicket
 *     `bets`: [{ bet_type, bet_target, amount }]
 *     `replayRounds`: int 1..10 (standalone only — agd silently
 *       ignores >1 in V1 since AGD does one spin per call)
 *     Returns a normalized ticket shape, see NormalizedTicket below.
 *
 *   getRecent({ minutes, limit }) -> NormalizedTicket[]
 *     Recent activity for the operator. In agd we list spins for
 *     the active session.
 *
 *   getTicket(code) -> NormalizedTicket
 *     Single ticket / spin lookup. `code` is the ticket id (standalone)
 *     or the spin UUID (agd).
 *
 *   payout(code) -> NormalizedTicket
 *     Claim winnings. In agd this resolves to "settled is already
 *     credited" — the helper returns the latest ticket state with
 *     a `payout_claimed_at` field set.
 *
 *   getShiftSummary({ minutes }) -> ShiftSummary
 *     Aggregates of the current shift (standalone /tickets/me/shift,
 *     agd computed from the spins+transactions for the session).
 *
 *   listJackpotsForKiosk(kioskCode) -> JackpotPotPublic[]
 *     Both modes expose `GET /jackpots/by-kiosk/:code` — agd's lives
 *     at /api/v1/agd_casino/jackpots/by-kiosk/:code, standalone at
 *     /api/jackpots/by-kiosk/:code. The shape is identical (id, scope,
 *     gameCode, tier, currentAmount).
 *
 *   verifyTicket(code) -> VerifyResult
 *     Public provably-fair verification. Standalone hits
 *     /tickets/:code/verify; agd hits /verify/:roundId (Phase 10).
 *
 * NormalizedTicket
 * ----------------
 *   {
 *     code: string,           // user-visible code; standalone TXC123, agd shortened UUID
 *     id: string,             // canonical id (standalone same as code, agd spin UUID)
 *     placedAt: string,       // ISO 8601
 *     settledAt: string|null,
 *     status: 'pending'|'settled'|'voided'|'paid',
 *     totalWager: number,
 *     totalPayout: number,    // 0 until settled
 *     winningNumber: string|null,
 *     bets: [{ bet_type, bet_target, amount, payout, result }],
 *     mode: 'standalone'|'agd',
 *     raw: object,            // original backend payload for fallback rendering
 *   }
 *
 * ShiftSummary
 * ------------
 *   {
 *     tickets: number,        // count of operations
 *     totalStaked: number,
 *     totalPaid: number,
 *     ggr: number,            // staked - paid (operator perspective)
 *     mode: 'standalone'|'agd',
 *   }
 */

export const ADAPTER_MODES = Object.freeze({
  STANDALONE: "standalone",
  AGD: "agd",
});
