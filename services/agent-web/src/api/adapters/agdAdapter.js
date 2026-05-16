import axios from "axios";
import {
  AGD_API_URL,
  AGD_AUTH_URL,
  AGD_GAME_CODE,
} from "../../config";
import { ADAPTER_MODES } from "./types";

const TOKEN_KEY = "agent_token";
const AGD_SESSION_KEY = "agd_session_id";

/* -------------------------------------------------------------------------
 * AGD adapter — agent-web ↔ agd-casino-service (Phase 9, integrated mode)
 *
 * Logical mapping vs. standalone:
 *
 *   standalone                            agd
 *   ──────────────                        ─────────────────────────────────
 *   POST /agents/login              <->   POST /auth/login (against agd-auth)
 *   GET  /agents/:id                <->   GET  /diagnostics/wallet-self
 *   POST /tickets/ (one call)       <->   1) POST /sessions (lazy, cached)
 *                                          2) POST /sessions/:id/spins
 *   GET  /tickets/me/recent         <->   GET  /admin/spins?sessionId=…
 *                                          (falls back to public listing
 *                                          when the user has no analytics)
 *   POST /tickets/:c/payout         <->   no-op (AGD auto-credits at settle);
 *                                          we just refetch the spin
 *   GET  /jackpots/by-kiosk/:code   <->   GET  /jackpots/by-kiosk/:code
 *
 * AGD sessions are opened LAZILY on the first placeTicket() call so that
 * opening agent-web in agd mode doesn't immediately commit a session.
 * The active session id is cached in localStorage under `agd_session_id`
 * so reloading the page doesn't double-create.
 * ----------------------------------------------------------------------- */

const casino = axios.create({ baseURL: AGD_API_URL });
const auth = axios.create({ baseURL: AGD_AUTH_URL });

function attachBearer(client) {
  client.interceptors.request.use((cfg) => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (t) cfg.headers.Authorization = `Bearer ${t}`;
    return cfg;
  });
}
attachBearer(casino);
attachBearer(auth);

// AGD APIs respond as { success, data, meta } — peel `data` automatically.
function peel(resp) {
  const d = resp?.data;
  if (d && typeof d === "object" && "success" in d && "data" in d) return d.data;
  return d;
}

function shortenUuid(uuid) {
  return uuid ? `${uuid.slice(0, 8)}` : null;
}

function normalizeSpin(spin) {
  if (!spin) return null;
  const status =
    spin.status === "settled"
      ? "settled"
      : spin.status === "voided"
        ? "voided"
        : "pending";
  return {
    code: shortenUuid(spin.id) || spin.id,
    id: spin.id,
    placedAt: spin.placedAt || null,
    settledAt: spin.settledAt || null,
    status,
    totalWager: spin.totalStake ?? 0,
    totalPayout: spin.totalPayout ?? 0,
    winningNumber: spin.winningOutcome ?? null,
    bets:
      spin.bets?.map((b) => ({
        bet_type: b.betType,
        bet_target: b.betTarget,
        amount: b.amount,
        payout: b.payout ?? 0,
        result: b.result ?? (b.payout > 0 ? "won" : "lost"),
      })) ?? [],
    mode: ADAPTER_MODES.AGD,
    raw: spin,
  };
}

async function getOrOpenSession(kioskCode) {
  const cached = localStorage.getItem(AGD_SESSION_KEY);
  if (cached) {
    try {
      // Verify cached session is still OPEN; fall through to (re)open if not.
      const resp = await casino.get(`/sessions/${cached}`);
      const session = peel(resp);
      if (session?.status === "open") return cached;
    } catch {
      // expired/missing/forbidden — open a new one
    }
    localStorage.removeItem(AGD_SESSION_KEY);
  }

  const body = { gameCode: AGD_GAME_CODE };
  if (kioskCode) body.kioskCode = kioskCode;
  const resp = await casino.post("/sessions", body);
  const session = peel(resp);
  if (!session?.id) throw new Error("AGD session open failed: no id in response");
  localStorage.setItem(AGD_SESSION_KEY, session.id);
  return session.id;
}

export function createAgdAdapter() {
  return {
    mode: ADAPTER_MODES.AGD,

    async login(emailOrPhone, password) {
      // emailOrPhone is treated as email in AGD mode
      const resp = await auth.post("/auth/login", { email: emailOrPhone, password });
      const data = peel(resp);
      const token = data?.access_token ?? data?.accessToken;
      if (!token) throw new Error("AGD login: no access_token in response");
      localStorage.setItem(TOKEN_KEY, token);
      const u = data.user ?? {};
      return {
        token,
        user: {
          id: u.id ?? u.userId,
          name: u.name ?? u.email ?? "",
          phone: u.phone ?? null,
          email: u.email ?? null,
          kiosk_code: u.kiosk_code ?? null,
          kiosk_name: u.kiosk_name ?? null,
        },
      };
    },

    async getBalance() {
      try {
        const resp = await casino.get("/diagnostics/wallet-self");
        const w = peel(resp) ?? {};
        return {
          balance: Number(w.balance ?? 0),
          currency: w.currencyCode ?? w.currency ?? "XAF",
          kiosk_code: w.kioskCode ?? null,
          kiosk_name: w.kioskName ?? null,
        };
      } catch (err) {
        // Diagnostics may be locked down in some deployments — surface 0
        // rather than failing the whole UI.
        if (import.meta.env.DEV) console.warn("[agd] balance unavailable", err);
        return { balance: 0, currency: "XAF", kiosk_code: null, kiosk_name: null };
      }
    },

    async getPlayContext() {
      const cached = localStorage.getItem(AGD_SESSION_KEY);
      return { sessionId: cached, kioskCode: null };
    },

    async placeTicket({ bets, replayRounds = 1, gameCode }) {
      // AGD's session does one spin per call; replayRounds collapses to 1.
      if (replayRounds > 1 && import.meta.env.DEV) {
        console.info("[agd] replayRounds>1 ignored (AGD does one spin per call)");
      }
      const ctx = await this.getPlayContext();
      let sessionId = ctx.sessionId;
      if (!sessionId) sessionId = await getOrOpenSession(null);

      const body = {
        bets: bets.map((b) => ({
          betType: b.bet_type,
          betTarget: b.bet_target,
          amount: b.amount,
        })),
      };
      const resp = await casino.post(`/sessions/${sessionId}/spins`, body);
      const spin = peel(resp);
      // AGD returns a synchronously-settled spin (engine is on_demand)
      return normalizeSpin(spin);
    },

    async getRecent({ minutes = 15, limit = 100 } = {}) {
      const ctx = await this.getPlayContext();
      if (!ctx.sessionId) return [];
      const params = { sessionId: ctx.sessionId, limit, withBets: true };
      if (minutes > 0) {
        params.from = new Date(Date.now() - minutes * 60_000).toISOString();
      }
      const resp = await casino.get("/admin/spins", { params });
      const list = peel(resp);
      const items = list?.items ?? [];
      return items.map(normalizeSpin);
    },

    async getTicket(idOrCode) {
      // agent-web sometimes passes a shortened code; agd needs the UUID
      try {
        const resp = await casino.get(`/admin/spins/${idOrCode}`);
        return normalizeSpin(peel(resp));
      } catch {
        // fall back to public /spins/:id (no admin perms)
        const resp = await casino.get(`/spins/${idOrCode}`);
        return normalizeSpin(peel(resp));
      }
    },

    async payout(idOrCode) {
      // AGD settles + credits at spin time; payout is a no-op fetch.
      return this.getTicket(idOrCode);
    },

    async getShiftSummary({ minutes = 720 } = {}) {
      const ctx = await this.getPlayContext();
      if (!ctx.sessionId) {
        return {
          tickets: 0,
          totalStaked: 0,
          totalPaid: 0,
          ggr: 0,
          mode: ADAPTER_MODES.AGD,
        };
      }
      // Derive from /admin/spins (analytics perm bypass for SuperAdmin)
      const from = new Date(Date.now() - minutes * 60_000).toISOString();
      const resp = await casino.get("/admin/spins", {
        params: { sessionId: ctx.sessionId, from, limit: 500 },
      });
      const items = peel(resp)?.items ?? [];
      const totalStaked = items.reduce((s, x) => s + (x.totalStake ?? 0), 0);
      const totalPaid = items.reduce((s, x) => s + (x.totalPayout ?? 0), 0);
      return {
        tickets: items.length,
        totalStaked,
        totalPaid,
        ggr: totalStaked - totalPaid,
        mode: ADAPTER_MODES.AGD,
      };
    },

    async listJackpotsForKiosk(kioskCode) {
      if (!kioskCode) return [];
      const resp = await casino.get(`/jackpots/by-kiosk/${kioskCode}`);
      return peel(resp)?.pots ?? [];
    },

    async verifyTicket(idOrCode) {
      // Phase 10 will expose /verify/:roundId publicly. Until then we
      // fall back to the spin record (server_seed is in metadata once
      // settled).
      try {
        const resp = await casino.get(`/verify/${idOrCode}`);
        return peel(resp);
      } catch {
        const t = await this.getTicket(idOrCode);
        if (!t) return null;
        return {
          round_id: t.id,
          server_seed: t.raw?.serverSeed,
          seed_hash: t.raw?.seedHash,
          winning_number: t.winningNumber,
          algorithm: "HMAC_SHA256(server_seed, round_id)[:8] mod 37",
        };
      }
    },

    async getActivePlans() {
      // AGD has no equivalent yet — return an empty list so the page renders.
      return { plans: [] };
    },

    async closePlayContext(reason = "shift-end") {
      const cached = localStorage.getItem(AGD_SESSION_KEY);
      if (!cached) return;
      try {
        await casino.post(`/sessions/${cached}/close`, { reason });
      } finally {
        localStorage.removeItem(AGD_SESSION_KEY);
      }
    },
  };
}
