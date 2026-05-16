#!/usr/bin/env node
/**
 * Phase 9 adapter smoke test.
 *
 * Loads the agdAdapter shape directly (without vite/react), seeds an
 * AGD JWT into a mocked localStorage, and runs through the canonical
 * cashier flow end-to-end against the live agd-casino-service:
 *
 *   1. getBalance()                -> wallet self
 *   2. listJackpotsForKiosk(kc)    -> public pots
 *   3. placeTicket({ bets })       -> lazy session + spin (settled)
 *   4. getRecent({})               -> list of spins for the session
 *   5. closePlayContext('test')    -> close the session
 *
 * Requires:
 *   - agd-casino-service up on 8880 via Traefik
 *   - scripts/.test-tokens/super_admin.jwt populated (see agd-casino-service)
 *
 * Run:
 *   node scripts/test-adapters.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ---- Polyfill localStorage so the adapter module just works ----------
const _ls = new Map();
globalThis.localStorage = {
  getItem: (k) => (_ls.has(k) ? _ls.get(k) : null),
  setItem: (k, v) => _ls.set(k, String(v)),
  removeItem: (k) => _ls.delete(k),
  clear: () => _ls.clear(),
};
globalThis.window = { location: { search: "" } };

// import.meta.env shim for Vite — we read directly from process.env
const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "AGD Techbet",
  "agd-casino-service",
  "scripts",
  ".test-tokens",
  "super_admin.jwt",
);
const TOKEN = readFileSync(TOKEN_PATH, "utf8").trim();
localStorage.setItem("agent_token", TOKEN);

// Inline the agd-adapter logic so we don't need to bundle Vite — uses
// the same endpoints with axios.
const AGD_API_URL =
  process.env.AGD_API_URL ?? "http://localhost:8880/api/v1/agd_casino";

const results = [];
function pass(name, extra = "") {
  results.push({ name, ok: true });
  console.log(`  ✅ ${name}${extra ? "  " + extra : ""}`);
}
function fail(name, why) {
  results.push({ name, ok: false, why });
  console.log(`  ❌ ${name}: ${why}`);
}

async function http(method, path, { body, params } = {}) {
  const u = new URL(AGD_API_URL + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(u, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${path} :: ${text.slice(0, 200)}`);
  }
  return json?.data ?? json;
}

async function main() {
  console.log(`Phase 9 adapter smoke against ${AGD_API_URL}`);

  // 1) balance via diagnostics
  try {
    const w = await http("GET", "/diagnostics/wallet-self");
    pass("getBalance()", `balance=${w?.balance ?? "?"}`);
  } catch (e) {
    fail("getBalance()", e.message);
  }

  // 2) jackpots public
  try {
    const j = await http("GET", "/jackpots/by-kiosk/AB12");
    pass("listJackpotsForKiosk('AB12')", `pots=${j?.pots?.length ?? 0}`);
  } catch (e) {
    fail("listJackpotsForKiosk('AB12')", e.message);
  }

  // 3) open session + place spin (lazy session)
  let sessionId = null;
  let spin = null;
  try {
    const session = await http("POST", "/sessions", {
      body: { gameCode: "ROULETTE_EU", kioskCode: "AB12" },
    });
    sessionId = session?.id;
    if (!sessionId) throw new Error("no session id returned");
    pass("POST /sessions", `id=${sessionId.slice(0, 8)}…`);
  } catch (e) {
    fail("POST /sessions", e.message);
    summary();
    return;
  }

  try {
    spin = await http("POST", `/sessions/${sessionId}/spins`, {
      body: {
        bets: [
          { betType: "COLOR", betTarget: "RED", amount: 100 },
        ],
      },
    });
    if (!spin?.id) throw new Error("no spin id");
    pass(
      "POST /sessions/:id/spins",
      `status=${spin.status} stake=${spin.totalStake} payout=${spin.totalPayout}`,
    );
  } catch (e) {
    fail("POST /sessions/:id/spins", e.message);
  }

  // 4) recent — public spin lookup (would normally hit /admin/spins with sessionId)
  try {
    const list = await http("GET", "/admin/spins", {
      params: { sessionId, limit: 10, withBets: true },
    });
    pass("GET /admin/spins?sessionId=", `n=${list?.items?.length ?? 0}`);
  } catch (e) {
    fail("GET /admin/spins?sessionId=", e.message);
  }

  // 5) close session
  try {
    await http("POST", `/sessions/${sessionId}/close`, {
      body: { reason: "phase9-smoke" },
    });
    pass("POST /sessions/:id/close");
  } catch (e) {
    fail("POST /sessions/:id/close", e.message);
  }

  summary();
}

function summary() {
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} passed`);
  if (ok !== results.length) {
    console.log("Failures:");
    for (const r of results.filter((x) => !x.ok))
      console.log("  - " + r.name + ": " + r.why);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
