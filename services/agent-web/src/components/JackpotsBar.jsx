import React from 'react';
import { Globe2, Gamepad2, MapPin, Crown, Gem, Sparkles } from 'lucide-react';
import { useT } from '../i18n';

const SCOPE_META = {
  GLOBAL: { color: '#a855f7', soft: 'rgba(168,85,247,0.15)', Icon: Globe2 },
  GAME:   { color: '#3b82f6', soft: 'rgba(59,130,246,0.15)', Icon: Gamepad2 },
  LOCAL:  { color: '#f59e0b', soft: 'rgba(245,158,11,0.18)', Icon: MapPin },
};

// Palette tier : on traite Or comme la version la plus brillante (couronne + animation)
const TIER_META = {
  BRONZE: {
    primary: '#d97706', secondary: '#92400e',
    gradient: 'linear-gradient(135deg, #d97706 0%, #92400e 100%)',
    glow: 'rgba(217, 119, 6, 0.45)',
    Icon: Gem,
  },
  SILVER: {
    primary: '#cbd5e1', secondary: '#64748b',
    gradient: 'linear-gradient(135deg, #e2e8f0 0%, #64748b 100%)',
    glow: 'rgba(203, 213, 225, 0.55)',
    Icon: Gem,
  },
  GOLD: {
    primary: '#fde047', secondary: '#ca8a04',
    gradient: 'linear-gradient(135deg, #fde047 0%, #ca8a04 100%)',
    glow: 'rgba(253, 224, 71, 0.70)',
    Icon: Crown,
  },
};

const fontDisplay = "'Bebas Neue', 'Outfit', sans-serif";

const PotCard = ({ pot }) => {
  const { t, fmtN } = useT();
  const scope = SCOPE_META[pot.scope] || SCOPE_META.GLOBAL;
  const tier = pot.tier ? TIER_META[pot.tier] : null;
  const ScopeIcon = scope.Icon;
  const TierIcon = tier?.Icon;
  const accent = tier ? tier.primary : scope.color;
  const glow = tier ? tier.glow : `${scope.color}55`;
  const gradient = tier?.gradient || `linear-gradient(135deg, ${scope.color}, ${scope.color}aa)`;
  const isGold = pot.tier === 'GOLD';

  const headline = pot.scope === 'GLOBAL'
    ? t('jackpots.scope.GLOBAL')
    : (pot.scope === 'GAME'
        ? `${pot.game_id || ''} · ${t(`jackpots.tier.${pot.tier}`)}`
        : `${t('jackpots.scope.LOCAL')} · ${t(`jackpots.tier.${pot.tier}`)}`);

  return (
    <div style={{
      position: 'relative',
      minWidth: 220, padding: '12px 16px 12px 14px', borderRadius: 12,
      background: 'linear-gradient(160deg, #15171d 0%, #1d1f27 60%, #2a1e0a 100%)',
      border: `1px solid ${accent}66`,
      boxShadow: `0 0 0 1px ${accent}22 inset, 0 0 24px ${glow}`,
      display: 'flex', alignItems: 'center', gap: 12,
      overflow: 'hidden',
      animation: isGold ? 'jackpot-gold-pulse 2.4s ease-in-out infinite' : undefined,
    }}>
      {/* Decoratif : trait lumineux haut */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 1,
        background: `linear-gradient(90deg, transparent, ${accent}cc, transparent)`,
      }} />

      {/* Decoratif : sparkles or */}
      {isGold && (
        <Sparkles size={11} style={{
          position: 'absolute', top: 6, right: 8,
          color: '#fde047', opacity: 0.7,
          animation: 'jackpot-twinkle 1.6s ease-in-out infinite',
        }} />
      )}

      {/* Icon medallion */}
      <div style={{
        position: 'relative',
        width: 38, height: 38, borderRadius: 10,
        background: gradient, color: '#0a0c10',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `0 0 18px ${glow}, inset 0 -8px 16px rgba(0,0,0,0.25)`,
      }}>
        {TierIcon ? <TierIcon size={18} strokeWidth={2.4} /> : <ScopeIcon size={18} strokeWidth={2.4} />}
      </div>

      {/* Text block */}
      <div style={{ minWidth: 0, flex: 1, position: 'relative' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2,
        }}>
          <ScopeIcon size={9} style={{ color: scope.color, opacity: 0.85 }} />
          <div style={{
            fontFamily: fontDisplay,
            fontSize: 11, fontWeight: 400, letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'rgba(203, 213, 225, 0.85)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {headline}
          </div>
        </div>
        <div style={{
          fontFamily: "'Outfit', sans-serif",
          fontSize: 22, fontWeight: 900, fontVariantNumeric: 'tabular-nums',
          lineHeight: 1, letterSpacing: '0.005em',
          background: gradient,
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          textShadow: `0 0 14px ${glow}`,
          filter: `drop-shadow(0 0 8px ${glow})`,
        }}>
          {fmtN(pot.current_amount)}
          <span style={{
            fontSize: 10, fontWeight: 700, opacity: 0.7, marginLeft: 4,
            WebkitTextFillColor: accent, letterSpacing: '0.1em',
          }}>
            XAF
          </span>
        </div>
      </div>
    </div>
  );
};

const JackpotsBar = ({ pots }) => {
  const { t } = useT();
  if (!pots || pots.length === 0) return null;

  const TIER_ORDER = { GOLD: 0, SILVER: 1, BRONZE: 2 };
  const SCOPE_ORDER = { GLOBAL: 0, GAME: 1, LOCAL: 2 };
  const sorted = [...pots].sort((a, b) => {
    const s = SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope];
    if (s !== 0) return s;
    return (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99);
  });

  return (
    <div style={{
      position: 'relative',
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '10px 14px', borderRadius: 12,
      background: 'linear-gradient(90deg, rgba(20,23,28,1) 0%, rgba(26,21,9,1) 50%, rgba(20,23,28,1) 100%)',
      border: '1px solid rgba(234, 179, 8, 0.20)',
      boxShadow: '0 0 0 1px rgba(234, 179, 8, 0.06) inset, 0 4px 16px rgba(0,0,0,0.25)',
      overflow: 'hidden',
    }}>
      <style>{`
        @keyframes jackpot-gold-pulse {
          0%, 100% { box-shadow: 0 0 0 1px rgba(253,224,71,0.22) inset, 0 0 24px rgba(253,224,71,0.45); }
          50%      { box-shadow: 0 0 0 1px rgba(253,224,71,0.5) inset,  0 0 36px rgba(253,224,71,0.85); }
        }
        @keyframes jackpot-twinkle {
          0%, 100% { opacity: 0.4; transform: scale(0.85); }
          50%      { opacity: 1;   transform: scale(1.15); }
        }
        @keyframes jackpot-ribbon-shine {
          0%, 100% { transform: translateX(-100%); }
          50%      { transform: translateX(100%);  }
        }
      `}</style>

      {/* Ribbon shine animée */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '100%',
        background: 'linear-gradient(90deg, transparent 0%, rgba(253,224,71,0.05) 50%, transparent 100%)',
        animation: 'jackpot-ribbon-shine 6s ease-in-out infinite',
        pointerEvents: 'none',
      }} />

      {/* Title block */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        paddingRight: 14, borderRight: '1px solid rgba(234, 179, 8, 0.18)',
      }}>
        <Crown size={18} style={{
          color: '#fde047',
          filter: 'drop-shadow(0 0 6px rgba(253,224,71,0.7))',
        }} />
        <div style={{ lineHeight: 1 }}>
          <div style={{
            fontFamily: fontDisplay,
            fontSize: 16, fontWeight: 400, letterSpacing: '0.2em',
            textTransform: 'uppercase',
            background: 'linear-gradient(180deg, #fde047 0%, #ca8a04 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            {t('jackpots.bar.title')}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', flex: 1, paddingBottom: 2 }}>
        {sorted.map(p => <PotCard key={p.id} pot={p} />)}
      </div>
    </div>
  );
};

export default JackpotsBar;
