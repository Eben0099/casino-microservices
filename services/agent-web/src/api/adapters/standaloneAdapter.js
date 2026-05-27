import axios from "axios";
import { STANDALONE_API_URL } from "../../config";
import { ADAPTER_MODES } from "./types";

const TOKEN_KEY = "agent_token";

const http = axios.create({ baseURL: STANDALONE_API_URL });
http.interceptors.request.use((cfg) => {
  const tok = localStorage.getItem(TOKEN_KEY);
  if (tok) cfg.headers.Authorization = `Bearer ${tok}`;
  return cfg;
});

/**
 * Bridge object exposing the legacy Python ticket-service /
 * agent-service surface through the new apiAdapter contract.
 *
 * Zero behaviour change vs. pre-Phase-9: every method maps 1:1 to the
 * historical endpoint. The only normalization we do is shape the
 * returned object into a NormalizedTicket so the page layer is the same
 * for both modes.
 */
function normalizeTicket(raw) {
  if (!raw) return null;
  // ticket-service returns snake_case (`short_code`, `round_id`, `total_wager`,
  // `bets`). TicketReceipt reads those snake_case fields directly, while other
  // consumers use the camelCase aliases below — so we keep BOTH. Bets may come
  // back as `bets` (current API) or legacy `lines`.
  const betsSrc = raw.bets ?? raw.lines ?? [];
  return {
    ...raw,
    code: raw.short_code ?? raw.code,
    id: raw.short_code ?? raw.code,
    placedAt: raw.placed_at || raw.created_at || null,
    settledAt: raw.settled_at || null,
    status: raw.status || (raw.settled_at ? "settled" : "pending"),
    totalWager: raw.total_wager ?? raw.total_amount ?? 0,
    totalPayout: raw.total_payout ?? 0,
    winningNumber: raw.winning_number ?? null,
    bets: betsSrc.map((l) => ({
      bet_type: l.bet_type,
      bet_target: l.bet_target,
      amount: l.amount,
      payout: l.payout ?? 0,
      is_winning: l.is_winning ?? (l.payout > 0),
      result: l.result || (l.payout > 0 ? "won" : "lost"),
    })),
    mode: ADAPTER_MODES.STANDALONE,
    raw,
  };
}

export function createStandaloneAdapter() {
  return {
    mode: ADAPTER_MODES.STANDALONE,

    async login(phone, password) {
      const { data } = await http.post("/agents/login", { phone, password });
      localStorage.setItem(TOKEN_KEY, data.access_token);
      return {
        token: data.access_token,
        user: {
          id: data.agent_id,
          name: data.agent_name,
          phone,
          kiosk_code: data.kiosk_code,
          kiosk_name: data.kiosk_name,
        },
      };
    },

    async getBalance(userId) {
      const { data } = await http.get(`/agents/${userId}`);
      return {
        balance: data.caisse?.balance ?? 0,
        currency: "XAF",
        kiosk_code: data.agent?.kiosk_code ?? null,
        kiosk_name: data.agent?.kiosk_name ?? null,
      };
    },

    async getPlayContext() {
      // No session in standalone — agent-web computes per-ticket
      return { sessionId: null, kioskCode: null };
    },

    async placeTicket({ bets, replayRounds, gameCode, agentId, gameId, roundId }) {
      // ticket-service's TicketCreate requires agent_id / game_id / round_id /
      // bets. Forward them all (the cashier page supplies them); keep `lines`
      // and `game_code` for backward compatibility with any older handler.
      const body = {
        agent_id: agentId,
        game_id: gameId,
        round_id: roundId != null ? String(roundId) : undefined,
        bets,
        lines: bets,
        replay_rounds: replayRounds ?? 1,
      };
      if (gameCode) body.game_code = gameCode;
      const { data } = await http.post("/tickets/", body);
      return normalizeTicket(data);
    },

    async getRecent({ minutes = 15, limit = 100 } = {}) {
      const { data } = await http.get("/tickets/me/recent", {
        params: { minutes, limit },
      });
      const items = Array.isArray(data) ? data : data.items ?? [];
      return items.map(normalizeTicket);
    },

    async getTicket(code) {
      const { data } = await http.get(`/tickets/${code}`);
      return normalizeTicket(data);
    },

    async payout(code) {
      const { data } = await http.post(`/tickets/${code}/payout`);
      return normalizeTicket(data);
    },

    async getShiftSummary({ minutes = 720 } = {}) {
      const { data } = await http.get("/tickets/me/shift", {
        params: { minutes },
      });
      return {
        tickets: data.tickets ?? 0,
        totalStaked: data.total_wager ?? 0,
        totalPaid: data.total_payout ?? 0,
        ggr: (data.total_wager ?? 0) - (data.total_payout ?? 0),
        mode: ADAPTER_MODES.STANDALONE,
        raw: data,
      };
    },

    async listJackpotsForKiosk(kioskCode) {
      const { data } = await http.get(`/jackpots/by-kiosk/${kioskCode}`);
      return data.pots ?? [];
    },

    async verifyTicket(code) {
      const { data } = await http.get(`/tickets/${code}/verify`);
      return data;
    },

    async getActivePlans() {
      const { data } = await http.get("/tickets/plans/active");
      return data;
    },

    /** Standalone has no notion of session.close — no-op. */
    async closePlayContext() {
      return;
    },
  };
}
