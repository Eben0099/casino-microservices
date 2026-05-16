/**
 * Runtime configuration for agent-web.
 *
 * Vite exposes VITE_* env at build time via `import.meta.env`. We mirror
 * those into a stable object so the rest of the codebase doesn't
 * sprinkle `import.meta.env.X` everywhere — and so we can override at
 * runtime via the embed `postMessage` protocol if needed.
 *
 * INTEGRATION_MODE:
 *   - 'standalone' (default) : route every call to the Python services
 *     via the local Traefik proxy (/api). Zero regression target.
 *   - 'agd' : route every call to the AGD Techbet platform — login
 *     against agd-auth, sessions/spins against agd-casino-service,
 *     WS against the casino-service Socket.IO gateway.
 *
 * EMBED:
 *   When the page is opened inside a parent (typically the AGD terminal
 *   app webview) with `?embed=1`, we hide the global chrome (header,
 *   footer, nav, login UI) and receive the JWT either via
 *   `?token=<JWT>` or via window.postMessage. The parent is responsible
 *   for the user's auth in that case.
 */

const env = import.meta.env;

const search = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
const embedParam = search?.get("embed");
const tokenParam = search?.get("token");

export const INTEGRATION_MODE = (env.VITE_INTEGRATION_MODE || "standalone").toLowerCase();
export const IS_AGD = INTEGRATION_MODE === "agd";
export const IS_STANDALONE = !IS_AGD;
export const IS_EMBED = embedParam === "1" || embedParam === "true";

export const STANDALONE_API_URL = env.VITE_STANDALONE_API_URL || "/api";

export const AGD_API_URL = env.VITE_AGD_API_URL || "http://localhost:8880/api/v1/agd_casino";
export const AGD_AUTH_URL = env.VITE_AGD_AUTH_URL || "http://localhost:8880/api/v1/agd_auth";
export const AGD_WS_URL = env.VITE_AGD_WS_URL || "http://localhost:8880/casino/ws";
export const AGD_GAME_CODE = env.VITE_AGD_GAME_CODE || "ROULETTE_EU";

/**
 * The token bootstrap. In embed+agd mode, the parent typically appends
 * `?token=<JWT>` (one-shot) or sends a `postMessage({type:'agd:auth', token})`
 * after handshake. The token is then persisted under `agent_token` so
 * the rest of the app sees it like a normal login.
 */
export const INITIAL_TOKEN_FROM_URL = tokenParam || null;
