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
  return {
    code: raw.code,
    id: raw.code,
    placedAt: raw.placed_at || raw.created_at || null,
    settledAt: raw.settled_at || null,
    status: raw.status || (raw.settled_at ? "settled" : "pending"),
    totalWager: raw.total_wager ?? raw.total_amount ?? 0,
    totalPayout: raw.total_payout ?? 0,
    winningNumber: raw.winning_number ?? null,
    bets:
      raw.lines?.map((l) => ({
        bet_type: l.bet_type,
        bet_target: l.bet_target,
        amount: l.amount,
        payout: l.payout ?? 0,
        result: l.result || (l.payout > 0 ? "won" : "lost"),
      })) ?? [],
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

    async placeTicket({ bets, replayRounds, gameCode }) {
      const body = { lines: bets, replay_rounds: replayRounds ?? 1 };
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
