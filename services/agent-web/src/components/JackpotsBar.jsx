import React from 'react';
import { Globe2, Gamepad2, MapPin, Crown, Gem, Sparkles } from 'lucide-react';
import { useT } from '../i18n';

// Tout le bandeau est calé sur une palette dorée — distinction par scope/tier
// via nuances de doré + iconographie, plus de variations bleues/violettes.
const SCOPE_META = {
  GLOBAL: { color: '#fde047', Icon: Crown },     // jaune lumineux (réseau)
  GAME:   { color: '#eab308', Icon: Gamepad2 },  // or moyen (par jeu)
  LOCAL:  { color: '#f59e0b', Icon: MapPin },    // ambre (local kiosque)
};

const TIER_META = {
  BRONZE: { color: '#b45309', Icon: Gem },
  SILVER: { color: '#cbd5e1', Icon: Gem },
  GOLD:   { color: '#fde047', Icon: Crown },
};

const FONT_777 = "'Faster', 'Bebas Neue', sans-serif"; // slot-machine display

const PotCard = ({ pot }) => {
  const { t, fmtN } = useT();
  const scope = SCOPE_META[pot.scope] || SCOPE_META.GLOBAL;
  const tier = pot.tier ? TIER_META[pot.tier] : null;
  const ScopeIcon = scope.Icon;
  const TierIcon = tier?.Icon;
  const accent = tier ? tier.color : scope.color;
  const isGold = pot.tier === 'GOLD';

  const headline = pot.scope === 'GLOBAL'
    ? t('jackpots.scope.GLOBAL')
    : (pot.scope === 'GAME'
        ? (pot.tier
            ? `${pot.game_id || ''} · ${t(`jackpots.tier.${pot.tier}`)}`
            : `${pot.game_id || ''} · ${t('jackpots.scope.GAME')}`)
        : `${t('jackpots.scope.LOCAL')} · ${t(`jackpots.tier.${pot.tier}`)}`);

  return (
    <div style={{
      position: 'relative',
      minWidth: 220, padding: '12px 16px 12px 14px', borderRadius: 12,
      background: '#15171d',
      border: `1px solid ${accent}55`,
      boxShadow: isGold
        ? `0 0 16px ${accent}55`
        : `inset 0 0 0 1px ${accent}1A`,
      display: 'flex', alignItems: 'center', gap: 12,
      overflow: 'hidden',
      animation: isGold ? 'jackpot-gold-pulse 2.4s ease-in-out infinite' : undefined,
    }}>
      {isGold && (
        <Sparkles size={11} style={{
          position: 'absolute', top: 6, right: 8,
          color: accent, opacity: 0.7,
          animation: 'jackpot-twinkle 1.6s ease-in-out infinite',
        }} />
      )}

      {/* Icon medallion — couleur tier unie (pas de degrade) */}
      <div style={{
        width: 38, height: 38, borderRadius: 10,
        background: accent, color: '#0a0c10',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `0 0 10px ${accent}55`,
      }}>
        {TierIcon ? <TierIcon size={18} strokeWidth={2.4} /> : <ScopeIcon size={18} strokeWidth={2.4} />}
      </div>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontFamily: FONT_777,
          fontStyle: 'italic',
          fontSize: 13, letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: accent,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          marginBottom: 2,
          lineHeight: 1,
        }}>
          {headline}
        </div>
        <div style={{
          fontFamily: FONT_777,
          fontStyle: 'italic',
          fontSize: 24, fontWeight: 400,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1, letterSpacing: '0.01em',
          color: accent,
          textShadow: isGold ? `0 0 12px ${accent}80` : 'none',
        }}>
          {fmtN(pot.current_amount)}
          <span style={{
            fontSize: 11, fontFamily: "'Bebas Neue', sans-serif",
            fontStyle: 'normal', opacity: 0.75, marginLeft: 6,
            letterSpacing: '0.15em',
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

  // Tier no-tier (= "le" jackpot du scope) en tete, puis Or > Argent > Bronze.
  const TIER_ORDER = { GOLD: 1, SILVER: 2, BRONZE: 3 };
  const SCOPE_ORDER = { GLOBAL: 0, GAME: 1, LOCAL: 2 };
  const sorted = [...pots].sort((a, b) => {
    const s = SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope];
    if (s !== 0) return s;
    return (a.tier ? TIER_ORDER[a.tier] : 0) - (b.tier ? TIER_ORDER[b.tier] : 0);
  });

  return (
    <div style={{
      position: 'relative',
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '10px 14px', borderRadius: 12,
      background: '#14171c',
      border: '1px solid rgba(234, 179, 8, 0.25)',
      boxShadow: 'inset 0 0 0 1px rgba(234, 179, 8, 0.05)',
      overflow: 'hidden',
    }}>
      <style>{`
        @keyframes jackpot-gold-pulse {
          0%, 100% { box-shadow: 0 0 16px rgba(253,224,71,0.4); }
          50%      { box-shadow: 0 0 28px rgba(253,224,71,0.75); }
        }
        @keyframes jackpot-twinkle {
          0%, 100% { opacity: 0.4; transform: scale(0.85); }
          50%      { opacity: 1;   transform: scale(1.15); }
        }
      `}</style>

      {/* Title block — police casino */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        paddingRight: 14, borderRight: '1px solid rgba(234, 179, 8, 0.18)',
      }}>
        <Crown size={20} style={{
          color: '#fde047',
          filter: 'drop-shadow(0 0 4px rgba(253,224,71,0.6))',
        }} />
        <div style={{
          fontFamily: FONT_777,
          fontStyle: 'italic',
          fontSize: 20, letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: '#fde047',
          lineHeight: 1,
        }}>
          {t('jackpots.bar.title')}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', flex: 1, paddingBottom: 2 }}>
        {sorted.map(p => <PotCard key={p.id} pot={p} />)}
      </div>
    </div>
  );
};

export default JackpotsBar;
