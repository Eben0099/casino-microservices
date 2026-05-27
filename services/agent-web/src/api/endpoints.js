/**
 * Backwards-compatible facade over the apiAdapter.
 *
 * Pre-Phase 9 every page called `ticketApi.create(...)` etc. directly,
 * routing to the Python ticket-service through `./client.js`. Phase 9
 * adds the agdAdapter that exposes the same operations against
 * agd-casino-service.
 *
 * Rather than refactor every page now (and risk regression), this
 * facade keeps the original method signatures and dispatches to the
 * adapter selected by INTEGRATION_MODE. Pages that need richer
 * features (shift summary, jackpots, verify) can import `getAdapter()`
 * from `./adapters` directly.
 *
 * Default mode: standalone. Zero regression for the existing POS.
 */

import api from "./client";
import { getAdapter } from "./adapters";
import { IS_STANDALONE } from "../config";

export const ticketApi = {
  /**
   * Place a ticket. Body shape historically: { lines, replay_rounds, … }
   * In agd mode `replay_rounds` is collapsed to 1 (one spin per call).
   */
  // In agd mode the adapter already normalizes the spin into the legacy
  // "Python ticket" shape (snake_case, status WON/LOST/PENDING etc.) so we
  // return the normalized object as `data` directly. The standalone adapter
  // returns the Python service response verbatim — also snake_case — so the
  // contract is identical from the page's perspective.
  create: (data) =>
    getAdapter()
      .placeTicket({
        bets: data.lines || data.bets || [],
        replayRounds: data.replay_rounds ?? 1,
        gameCode: data.game_code,
        // Cyclic AGD needs the engine round_id for anti-décalage validation.
        // Standalone's ticket-service also requires agent_id/game_id/round_id
        // on TicketCreate, so forward them all through to the adapter.
        roundId: data.round_id,
        agentId: data.agent_id,
        gameId: data.game_id,
      })
      .then((t) => ({ data: t, normalized: t })),

  getDetails: (code) =>
    getAdapter()
      .getTicket(code)
      .then((t) => ({ data: t, normalized: t })),

  payout: (code) =>
    getAdapter()
      .payout(code)
      .then((t) => ({ data: t, normalized: t })),

  /**
   * Admin stats — only standalone exposes this today; in agd mode we
   * return null so callers can render an empty state.
   */
  getStats: () =>
    IS_STANDALONE
      ? api.get("/tickets/admin/stats")
      : Promise.resolve({ data: null }),
};

export const agentApi = {
  login: (phone, password) =>
    getAdapter()
      .login(phone, password)
      .then((session) => ({
        data: {
          access_token: session.token,
          agent_id: session.user.id,
          agent_name: session.user.name,
          kiosk_code: session.user.kiosk_code,
          kiosk_name: session.user.kiosk_name,
        },
      })),

  getDetails: (agentId) =>
    getAdapter()
      .getBalance(agentId)
      .then((b) => ({
        data: {
          caisse: { balance: b.balance, currency: b.currency },
          agent: {
            id: agentId,
            kiosk_code: b.kiosk_code,
            kiosk_name: b.kiosk_name,
          },
        },
      })),
};
