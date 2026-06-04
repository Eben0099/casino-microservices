/**
 * Maps the pot entries returned by `listJackpotsForKiosk`
 * (`[{ id, scope, gameCode, tier, currentAmount }]`, normalised by the AGD
 * adapter from the engine display proxy `GET /jackpots?gameCode&kioskCode`)
 * into the card shape `<JackpotsBar>` consumes (`{ id, scope, tier,
 * current_amount, game_id }`).
 *
 * Keeps the network-wide GLOBAL pot plus the pots of the requested game
 * (`gameCode`); pots of other games are filtered out so the roulette bar
 * doesn't show keno pots and vice-versa.
 *
 * @param {Array} pots       — raw pots from `listJackpotsForKiosk`
 * @param {string} gameCode  — AGD game code, e.g. "ROULETTE_EU" / "KENO"
 * @param {string} gameLabel — display label, e.g. "Roulette" / "Keno"
 */
export const agdPotsToCards = (pots, gameCode, gameLabel) =>
  (pots || [])
    .filter((p) => p.scope === 'GLOBAL' || p.gameCode === gameCode)
    .map((p) => ({
      id: p.id,
      scope: p.scope,
      tier: p.tier || undefined,
      game_id: p.scope === 'GLOBAL' ? undefined : gameLabel,
      current_amount: Number(p.currentAmount ?? 0),
    }));

export default agdPotsToCards;
