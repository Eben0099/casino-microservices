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
  return uuid ? `${uuid.slice(0, 8).toUpperCase()}` : null;
}

/**
 * Normalise a CasinoTicket (post-cyclic refactor) into the snake_case
 * shape consumed by TicketReceipt / Ventes. Tickets can be PENDING (no
 * winning_number yet) and bets flip to WON/LOST after settlement.
 *
 * Status mapping:
 *   - "PENDING"  → "PENDING"   (en attente du tirage)
 *   - "WON"      → "WON"
 *   - "LOST"     → "LOST"
 *   - "PAID"     → "PAID"
 *   - "CANCELLED"/ "VOIDED" → "VOIDED"
 */
function normalizeTicket(t) {
  if (!t) return null;
  const status = mapTicketStatus(t.status);
  const bets = (t.bets ?? []).map((b) => {
    const payout = Number(b.payout ?? 0);
    const isWinning = !!b.isWinning || b.result === "WON" || payout > 0;
    return {
      bet_type: b.betType,
      bet_target: b.betTarget,
      amount: Number(b.amount ?? 0),
      payout,
      is_winning: isWinning,
      result: b.result ?? (payout > 0 ? "won" : "lost"),
      // Computed by agd-casino-service from the settlement payout tables:
      // odds = max total-return multiplier (x36 straight, keno best line),
      // potential_payout = amount x odds. 0 when the API predates the field —
      // TicketReceipt falls back to its local catalogue.
      odds: Number(b.odds ?? 0),
      potential_payout: Number(b.potentialPayout ?? 0),
    };
  });
  const winningRaw = t.winningNumber ?? null;
  const winningNumber =
    winningRaw == null || winningRaw === "" ? null : Number(winningRaw);
  return {
    short_code: t.shortCode || shortenUuid(t.id),
    id: t.id,
    round_id: t.roundId,
    status,
    created_at: t.placedAt ?? null,
    settled_at: t.settledAt ?? null,
    winning_number: winningNumber,
    total_wager: Number(t.totalWager ?? 0),
    total_payout: Number(t.totalPayout ?? 0),
    // Σ potential_payout of non-VOID bets, served by the API (0 = absent).
    max_payout: Number(t.maxPayout ?? 0),
    bets,
    mode: ADAPTER_MODES.AGD,
    raw: t,
  };
}

function mapTicketStatus(raw) {
  switch (raw) {
    case "PENDING":
      return "PENDING";
    case "WON":
      return "WON";
    case "LOST":
      return "LOST";
    case "PAID":
      return "PAID";
    case "CANCELLED":
    case "VOIDED":
      return "VOIDED";
    default:
      return "PENDING";
  }
}

/**
 * Map a casino-service GameRound payload into the legacy "Python ticket"
 * shape that all of agent-web's UI consumes (TicketReceipt, Ventes table,
 * etc.). Keep this strictly snake_case so the existing components don't need
 * conditional accessors.
 *
 * Notable AGD → Python field mappings:
 *   id (uuid)          -> short_code (first 8 hex, uppercased) + round_id
 *   placedAt           -> created_at
 *   status:'settled'   -> 'WON' (if totalPayout > 0) or 'LOST'
 *   status:'pending'   -> 'PENDING'
 *   status:'voided'    -> 'VOIDED'
 *   winningOutcome     -> winning_number (cast to Number when possible)
 *   totalStake         -> total_wager
 *   totalPayout        -> total_payout (same)
 *   bets[].betType     -> bets[].bet_type
 *   bets[].betTarget   -> bets[].bet_target
 *   bets[].result      -> bets[].is_winning (true on 'won')
 */
function normalizeSpin(spin) {
  if (!spin) return null;

  const rawStatus = spin.status;
  let status;
  if (rawStatus === "voided") status = "VOIDED";
  else if (rawStatus === "settled") status = (spin.totalPayout ?? 0) > 0 ? "WON" : "LOST";
  else status = "PENDING";

  const winningRaw = spin.winningOutcome ?? null;
  const winningNumber =
    winningRaw == null || winningRaw === "" ? null : Number(winningRaw);

  const bets = (spin.bets ?? []).map((b) => {
    const result = b.result ?? ((b.payout ?? 0) > 0 ? "won" : "lost");
    return {
      bet_type: b.betType,
      bet_target: b.betTarget,
      amount: Number(b.amount ?? 0),
      payout: Number(b.payout ?? 0),
      is_winning: result === "won",
      result,
    };
  });

  // totalPayout from the server already aggregates bet payouts AND jackpot
  // wins (when the current player is the jackpot winner). So WON/LOST is
  // strictly a function of totalPayout — the bets-only sum is exposed
  // separately as bets_payout for break-down rendering.
  const jackpot = spin.jackpot ?? null;

  return {
    short_code: shortenUuid(spin.id),
    id: spin.id,
    round_id: spin.externalRoundId || spin.id,
    status,
    created_at: spin.placedAt ?? null,
    settled_at: spin.settledAt ?? null,
    winning_number: winningNumber,
    total_wager: Number(spin.totalStake ?? 0),
    total_payout: Number(spin.totalPayout ?? 0),
    bets_payout: Number(spin.betsPayout ?? 0),
    jackpot,
    bets,
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
        // Endpoint shape: { success, data: { found, wallet: { balance, currency: {code}, ... } }, meta }
        const data = peel(resp) ?? {};
        const w = data.wallet ?? data ?? {};
        const currencyCode =
          w.currency?.code ?? w.currencyCode ?? w.currency ?? "XAF";
        return {
          balance: Number(w.balance ?? 0),
          currency: currencyCode,
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

    async placeTicket({ bets, replayRounds = 1, gameCode, roundId }) {
      // The cyclic engine settles one round at a time — replay > 1 is a
      // standalone-only concept where the agent buys N future rounds at
      // once. In AGD we resolve to a single ticket per call (the cashier
      // can immediately place another ticket on the next Betting phase).
      if (replayRounds > 1 && import.meta.env.DEV) {
        console.info("[agd] replayRounds>1 ignored (cyclic engine, one ticket per round)");
      }
      const ctx = await this.getPlayContext();
      let sessionId = ctx.sessionId;
      if (!sessionId) sessionId = await getOrOpenSession(null);

      // round_id is required by the server's anti-décalage check: if the
      // cashier clicked "Valider" just as the phase rolled to BetsClosing,
      // the server rejects with ROUND_MISMATCH and the UI can re-prompt.
      if (!roundId) {
        throw new Error(
          "Round id missing — cycle ticker probably still initialising. Wait one second and retry.",
        );
      }

      const body = {
        session_id: sessionId,
        round_id: roundId,
        game_code: gameCode || "ROULETTE_EU",
        bets: bets.map((b) => ({
          bet_type: b.bet_type,
          bet_target: b.bet_target,
          amount: b.amount,
        })),
      };

      const resp = await casino.post(`/tickets`, body);
      const ticket = peel(resp);
      return normalizeTicket(ticket);
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
      // /tickets/:codeOrId accepts both the short_code (TK-…) and the UUID.
      const resp = await casino.get(`/tickets/${idOrCode}`);
      return normalizeTicket(peel(resp));
    },

    async payout(idOrCode) {
      // Transition WON → PAID server-side. Wallet was already credited at
      // settlement, so this is purely a status flip + audit event. The
      // server is idempotent — calling twice returns the same PAID ticket.
      const resp = await casino.post(`/tickets/${idOrCode}/payout`);
      return normalizeTicket(peel(resp));
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
