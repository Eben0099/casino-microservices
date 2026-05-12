import React, { useEffect, useMemo } from 'react';
import { Trophy, X, Sparkles, Crown } from 'lucide-react';
import { useT } from '../i18n';

/**
 * Plein-ecran modal affichee quand un ticket vendu vient de gagner un jackpot.
 * Style casino premium : confettis, shimmer dore, polices display.
 */
const JackpotHitOverlay = ({ amount, ticketCode, onClose }) => {
  const { t, fmtN } = useT();

  useEffect(() => {
    const id = setTimeout(onClose, 8000);
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(id); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  // 36 confettis avec positions/couleurs/delays pseudo-aleatoires deterministes
  const confetti = useMemo(() => {
    const COLORS = ['#fde047', '#f59e0b', '#ef4444', '#ec4899', '#a855f7', '#3b82f6', '#10b981', '#fff'];
    return Array.from({ length: 36 }).map((_, i) => ({
      key: i,
      left: (i * 71) % 100,                       // pseudo-random 0..99
      color: COLORS[i % COLORS.length],
      delay: ((i * 137) % 1000) / 1000,          // 0..1s
      duration: 2.4 + ((i * 53) % 1600) / 1000,  // 2.4..4s
      size: 6 + (i % 5),
      rotate: (i * 47) % 360,
    }));
  }, []);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'radial-gradient(ellipse at center, rgba(40,30,5,0.92) 0%, rgba(0,0,0,0.97) 70%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'jp-fade-in 0.4s ease-out',
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes jp-fade-in { from { opacity: 0 } to { opacity: 1 } }
        @keyframes jp-pop {
          0%   { transform: scale(0.5) rotate(-3deg); opacity: 0 }
          60%  { transform: scale(1.08) rotate(1deg); opacity: 1 }
          100% { transform: scale(1) rotate(0) }
        }
        @keyframes jp-glow {
          0%, 100% { box-shadow: 0 0 80px rgba(253,224,71,0.4), 0 0 160px rgba(234,179,8,0.2), inset 0 0 60px rgba(253,224,71,0.1); }
          50%      { box-shadow: 0 0 140px rgba(253,224,71,0.75), 0 0 240px rgba(234,179,8,0.45), inset 0 0 80px rgba(253,224,71,0.2); }
        }
        @keyframes jp-shimmer {
          0%   { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes jp-confetti {
          0%   { transform: translate3d(0, -120vh, 0) rotate(0); opacity: 0; }
          10%  { opacity: 1; }
          100% { transform: translate3d(var(--drift, 0px), 120vh, 0) rotate(720deg); opacity: 0.7; }
        }
        @keyframes jp-crown-bob {
          0%, 100% { transform: translateY(0) rotate(-4deg); }
          50%      { transform: translateY(-6px) rotate(4deg); }
        }
        @keyframes jp-twinkle-big {
          0%, 100% { opacity: 0; transform: scale(0.6) rotate(0); }
          50%      { opacity: 1; transform: scale(1.2) rotate(180deg); }
        }
        @keyframes jp-amount-glow {
          0%, 100% { filter: drop-shadow(0 0 18px rgba(253,224,71,0.7)) drop-shadow(0 0 36px rgba(234,179,8,0.4)); }
          50%      { filter: drop-shadow(0 0 28px rgba(253,224,71,1)) drop-shadow(0 0 56px rgba(234,179,8,0.7)); }
        }
      `}</style>

      {/* Confetti rain */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        {confetti.map(c => (
          <span key={c.key} style={{
            position: 'absolute', top: 0,
            left: `${c.left}%`,
            width: c.size, height: c.size * 1.6,
            background: c.color,
            borderRadius: 2,
            transform: `rotate(${c.rotate}deg)`,
            animation: `jp-confetti ${c.duration}s linear ${c.delay}s infinite`,
            ['--drift']: `${(c.key % 2 === 0 ? 1 : -1) * (c.key * 7 % 80)}px`,
          }} />
        ))}
      </div>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          padding: '52px 64px 44px', borderRadius: 28,
          background: 'linear-gradient(160deg, #0d0a04 0%, #1a1407 50%, #2b1f08 100%)',
          border: '3px solid transparent',
          backgroundClip: 'padding-box',
          textAlign: 'center', minWidth: 540, maxWidth: 680,
          animation: 'jp-pop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1), jp-glow 2.2s ease-in-out infinite',
        }}>
        {/* Bordure doree ornee */}
        <div style={{
          position: 'absolute', inset: -3, borderRadius: 28,
          background: 'linear-gradient(135deg, #fde047 0%, #ca8a04 25%, #fde047 50%, #ca8a04 75%, #fde047 100%)',
          backgroundSize: '300% 300%',
          animation: 'jp-shimmer 3s linear infinite',
          zIndex: -1,
        }} />

        <button onClick={onClose} aria-label="Close" style={{
          position: 'absolute', top: 16, right: 16,
          background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(253,224,71,0.2)',
          color: 'rgba(253,224,71,0.6)', cursor: 'pointer',
          padding: 6, borderRadius: 8, display: 'flex',
        }}>
          <X size={18} />
        </button>

        {/* Sparkles décor */}
        <Sparkles size={22} style={{
          position: 'absolute', top: 28, left: 36, color: '#fde047',
          animation: 'jp-twinkle-big 2s ease-in-out infinite',
        }} />
        <Sparkles size={16} style={{
          position: 'absolute', top: 56, right: 80, color: '#f59e0b',
          animation: 'jp-twinkle-big 1.6s ease-in-out 0.4s infinite',
        }} />
        <Sparkles size={20} style={{
          position: 'absolute', bottom: 60, left: 50, color: '#fde047',
          animation: 'jp-twinkle-big 2.3s ease-in-out 0.8s infinite',
        }} />
        <Sparkles size={14} style={{
          position: 'absolute', bottom: 90, right: 50, color: '#f59e0b',
          animation: 'jp-twinkle-big 1.9s ease-in-out 1.1s infinite',
        }} />

        {/* Crown + Trophy stack */}
        <div style={{ position: 'relative', height: 110, marginBottom: 12 }}>
          <Crown size={32} style={{
            position: 'absolute', top: -4, left: '50%', transform: 'translateX(-50%) rotate(-4deg)',
            color: '#fde047',
            filter: 'drop-shadow(0 0 12px rgba(253,224,71,0.9))',
            animation: 'jp-crown-bob 2s ease-in-out infinite',
          }} />
          <div style={{
            margin: '14px auto 0', width: 92, height: 92, borderRadius: 999,
            background: 'radial-gradient(circle at 30% 30%, #fde047 0%, #eab308 40%, #92400e 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 60px rgba(253,224,71,0.7), inset 0 -16px 24px rgba(0,0,0,0.4)',
            border: '3px solid rgba(253,224,71,0.6)',
          }}>
            <Trophy size={48} style={{ color: '#1a0f00', strokeWidth: 2.4 }} />
          </div>
        </div>

        {/* Title — Cinzel display */}
        <h1 style={{
          margin: '4px 0 6px',
          fontFamily: "'Cinzel', 'Outfit', serif",
          fontSize: 64, fontWeight: 900, letterSpacing: '0.12em',
          background: 'linear-gradient(180deg, #fff7c2 0%, #fde047 30%, #eab308 70%, #92400e 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          textShadow: '0 0 30px rgba(253,224,71,0.4)',
          lineHeight: 1,
          textTransform: 'uppercase',
        }}>
          {t('jackpots.hit.title')}
        </h1>

        {/* Decorative gold line */}
        <div style={{
          width: 220, height: 2, margin: '6px auto 16px',
          background: 'linear-gradient(90deg, transparent, #fde047 50%, transparent)',
        }} />

        <p style={{
          fontFamily: "'Outfit', sans-serif",
          fontSize: 15, color: '#cbd5e1', margin: '0 0 28px',
          fontWeight: 500,
        }}>
          {t('jackpots.hit.subtitle')}
        </p>

        {/* Montant — la star */}
        <div style={{
          padding: '24px 32px', borderRadius: 16,
          background: 'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(20,15,5,0.6) 100%)',
          border: '1px solid rgba(253,224,71,0.35)',
          marginBottom: 24,
          boxShadow: 'inset 0 0 30px rgba(253,224,71,0.08)',
        }}>
          <div style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 13, letterSpacing: '0.32em',
            color: '#94a3b8', marginBottom: 6,
          }}>
            {t('jackpots.hit.payoutLabel')}
          </div>
          <div style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: 76, fontWeight: 900, lineHeight: 1,
            fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em',
            background: 'linear-gradient(180deg, #fff7c2 0%, #fde047 40%, #ca8a04 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            animation: 'jp-amount-glow 1.8s ease-in-out infinite',
          }}>
            {fmtN(amount)}
            <span style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 28, marginLeft: 8, opacity: 0.85,
              letterSpacing: '0.15em',
              WebkitTextFillColor: '#eab308',
            }}>
              XAF
            </span>
          </div>
        </div>

        {ticketCode && (
          <div style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: 12, color: '#94a3b8',
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '6px 14px', borderRadius: 999,
            background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(148,163,184,0.2)',
          }}>
            <span style={{ letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700 }}>
              {t('jackpots.hit.ticket')}
            </span>
            <span style={{ fontFamily: 'ui-monospace, monospace', color: '#fde047', fontWeight: 700 }}>
              {ticketCode}
            </span>
          </div>
        )}

        <button onClick={onClose} style={{
          marginTop: 28, padding: '14px 40px', borderRadius: 12,
          background: 'linear-gradient(135deg, #fde047, #eab308 50%, #ca8a04)',
          color: '#1a0f00', border: 'none', cursor: 'pointer',
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 17, fontWeight: 400, letterSpacing: '0.22em',
          textTransform: 'uppercase',
          boxShadow: '0 8px 24px rgba(253,224,71,0.4), inset 0 -3px 8px rgba(0,0,0,0.2)',
          display: 'block', margin: '28px auto 0',
        }}>
          {t('jackpots.hit.dismiss')}
        </button>
      </div>
    </div>
  );
};

export default JackpotHitOverlay;
