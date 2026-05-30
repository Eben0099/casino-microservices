import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * Jackpot win celebration for the cashier — mirrors the VOLKENO display design
 * (dark card, pulsing halo, per-pot accent, amount, winning-ticket badge).
 * The theme depends on the pot won (general / volkeno / bronze / silver / gold)
 * and the on-screen duration is driven by `durationMs` (admin-set
 * `celebration_duration_ms`). All copy is English.
 */
const POT_PALETTE = {
  general: { label: 'GENERAL JACKPOT', sub: 'The network grand prize!', accent: '#fde047', glow: 'rgba(250,204,21,0.55)', ring: '#ca8a04' },
  volkeno: { label: 'VOLKENO JACKPOT', sub: 'The eruption pays big!',   accent: '#fb923c', glow: 'rgba(249,115,22,0.55)', ring: '#c2410c' },
  bronze:  { label: 'BRONZE MEDAL',    sub: 'Bronze tier won',          accent: '#d98a4e', glow: 'rgba(180,83,9,0.5)',    ring: '#92400e' },
  silver:  { label: 'SILVER MEDAL',    sub: 'Silver tier won',          accent: '#d7dee8', glow: 'rgba(148,163,184,0.5)', ring: '#64748b' },
  gold:    { label: 'GOLD MEDAL',      sub: 'Gold tier won!',           accent: '#fbbf24', glow: 'rgba(245,158,11,0.55)', ring: '#b45309' },
};

function potKey(scope, tier) {
  const s = (scope || '').toUpperCase();
  if (s === 'LOCAL') {
    const tn = (tier || '').toUpperCase();
    return tn === 'BRONZE' ? 'bronze' : tn === 'SILVER' ? 'silver' : 'gold';
  }
  return s === 'GAME' ? 'volkeno' : 'general';
}

// Confetti rain — the lively motion from the original cashier celebration.
const CONFETTI_COLORS = ['#fde047', '#f59e0b', '#ef4444', '#ec4899', '#a855f7', '#3b82f6', '#10b981', '#ffffff'];
const CONFETTI = Array.from({ length: 44 }).map((_, i) => ({
  left: (i * 71) % 100,
  size: 6 + (i % 5),
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  drift: ((i * 89) % 120) - 60,
  delay: ((i * 137) % 1500) / 1000,
  duration: 2.6 + ((i * 53) % 1600) / 1000,
}));

const JackpotHitOverlay = ({ amount, ticketCode, onClose, scope, tier, durationMs = 8000 }) => {
  const theme = POT_PALETTE[potKey(scope, tier)] || POT_PALETTE.general;

  useEffect(() => {
    const id = setTimeout(onClose, durationMs || 8000);
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(id); window.removeEventListener('keydown', onKey); };
  }, [onClose, durationMs]);

  return (
    <AnimatePresence>
      <motion.div
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4 }}
        style={{
          position: 'fixed', inset: 0, zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'radial-gradient(60% 60% at 50% 45%, rgba(0,0,0,0.6), rgba(0,0,0,0.85))',
        }}
      >
        <style>{`@keyframes jp-confetti {
          0%   { transform: translate3d(0, -110%, 0) rotate(0deg); opacity: 0; }
          8%   { opacity: 1; }
          100% { transform: translate3d(var(--drift, 0px), 110vh, 0) rotate(720deg); opacity: 0.65; }
        }`}</style>
        {/* confetti rain */}
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
          {CONFETTI.map((c, i) => (
            <span key={i} style={{
              position: 'absolute', top: '-6%', left: `${c.left}%`,
              width: c.size, height: c.size * 0.45, borderRadius: 2, background: c.color,
              '--drift': `${c.drift}px`,
              animation: `jp-confetti ${c.duration}s linear ${c.delay}s infinite`,
            }} />
          ))}
        </div>

        <motion.div
          onClick={(e) => e.stopPropagation()}
          initial={{ scale: 0.6, y: 24 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.85, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 220, damping: 16 }}
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
            padding: '2.6rem 3.4rem', borderRadius: 28,
            border: `2px solid ${theme.ring}`,
            background: 'linear-gradient(180deg, rgba(20,14,8,0.94), rgba(8,6,4,0.97))',
            boxShadow: `0 0 90px ${theme.glow}, inset 0 0 40px rgba(0,0,0,0.6)`,
          }}
        >
          {/* pulsing halo */}
          <motion.div
            aria-hidden
            animate={{ scale: [1, 1.18, 1], opacity: [0.5, 0.85, 0.5] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            style={{
              position: 'absolute', width: 240, height: 240, borderRadius: '50%',
              background: `radial-gradient(circle, ${theme.glow}, transparent 70%)`,
              top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 0,
            }}
          />

          <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ fontSize: 13, letterSpacing: '0.35em', color: '#fff7e6', opacity: 0.8, fontWeight: 800 }}>
              WINNER
            </div>
            <div style={{
              marginTop: 8, fontSize: 40, fontWeight: 900, letterSpacing: '0.04em',
              color: theme.accent, textShadow: `0 0 24px ${theme.glow}`,
            }}>
              {theme.label}
            </div>
            <motion.div
              animate={{ scale: [1, 1.04, 1] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
              style={{
                marginTop: 16, fontSize: 70, fontWeight: 900, lineHeight: 1,
                color: '#fffdf7', fontFamily: 'Arial, system-ui, sans-serif',
                fontVariantNumeric: 'tabular-nums', textShadow: `0 0 36px ${theme.glow}`,
              }}
            >
              {Number(amount || 0).toLocaleString('en-US')}
              <span style={{ fontSize: 28, marginLeft: 10, color: theme.accent }}>XAF</span>
            </motion.div>
            <div style={{ marginTop: 14, fontSize: 15, color: '#e8d9bf', opacity: 0.85 }}>
              {theme.sub}
            </div>

            {ticketCode && (
              <div style={{
                marginTop: 18, display: 'inline-flex', alignItems: 'center', gap: 10,
                padding: '8px 18px', borderRadius: 999,
                background: 'rgba(0,0,0,0.45)', border: `1px solid ${theme.ring}`,
              }}>
                <span style={{ fontSize: 11, letterSpacing: '0.2em', color: '#cbbfa6', fontWeight: 800, textTransform: 'uppercase' }}>
                  Winning ticket
                </span>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 18, fontWeight: 900, color: theme.accent, letterSpacing: '0.05em' }}>
                  {ticketCode}
                </span>
              </div>
            )}

            <button
              onClick={onClose}
              style={{
                marginTop: 26, padding: '12px 36px', borderRadius: 12,
                background: `linear-gradient(135deg, ${theme.accent}, ${theme.ring})`,
                color: '#1a0f00', border: 'none', cursor: 'pointer',
                fontSize: 14, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase',
                boxShadow: `0 8px 24px ${theme.glow}`,
              }}
            >
              Close
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default JackpotHitOverlay;
