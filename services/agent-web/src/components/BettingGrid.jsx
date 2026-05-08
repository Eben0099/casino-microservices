import React, { useState } from 'react';
import { getNumberAtCoord, getCoordOfNumber, RED_NUMBERS } from './RouletteHelpers';

/* --------------------------------------------------------------------
 * BettingGrid — European roulette tapis with optional bet-mode lock.
 *
 * Props:
 *   addBet(type, target)    → place a bet
 *   isBettingOpen           → server phase = Betting
 *   betMode (string|null)   → if set, only this bet type is allowed;
 *                              other zones are dimmed and disabled.
 *                              Cells reroute clicks to STREET / SIX_LINE
 *                              when the matching mode is active.
 * -------------------------------------------------------------------- */

const BettingGrid = ({ addBet, isBettingOpen, betMode = null }) => {
  const [hovered, setHovered] = useState(null);
  const disabled = !isBettingOpen;
  const isRed = (n) => RED_NUMBERS.includes(n);

  // What is allowed for the current mode?
  const allow = (type) => betMode == null || betMode === type;

  // Cell click → either STRAIGHT, STREET (full column), SIX_LINE (col + neighbour) or no-op.
  const handleCellClick = (num, col) => {
    if (disabled) return;
    if (betMode == null || betMode === 'STRAIGHT') {
      addBet('STRAIGHT', String(num));
      return;
    }
    if (betMode === 'STREET') {
      const nums = [getNumberAtCoord(col, 0), getNumberAtCoord(col, 1), getNumberAtCoord(col, 2)];
      if (nums.every(Boolean)) addBet('STREET', nums.join(','));
      return;
    }
    if (betMode === 'SIX_LINE') {
      const baseCol = col >= 11 ? 10 : col;
      const nums = [];
      for (let c = baseCol; c <= baseCol + 1; c++)
        for (let r = 0; r <= 2; r++) nums.push(getNumberAtCoord(c, r));
      if (nums.every(Boolean)) addBet('SIX_LINE', nums.join(','));
      return;
    }
    // any other mode = cell is locked
  };

  const handleSplitH = (num, col, row) => {
    if (!allow('SPLIT')) return;
    const n = getNumberAtCoord(col + 1, row);
    if (n) addBet('SPLIT', `${num},${n}`);
  };
  const handleSplitV = (num, col, row) => {
    if (!allow('SPLIT')) return;
    const n = getNumberAtCoord(col, row - 1);
    if (n) addBet('SPLIT', `${num},${n}`);
  };
  const handleCorner = (num, col, row) => {
    if (!allow('CORNER')) return;
    const r = getNumberAtCoord(col + 1, row);
    const t = getNumberAtCoord(col, row - 1);
    const c = getNumberAtCoord(col + 1, row - 1);
    if (r && t && c) addBet('CORNER', `${num},${t},${r},${c}`);
  };

  const CELL = 54;
  const GOLD = '#d4a843';
  const GOLD_B = '#9a7b30';
  const RED = '#ff1744';
  const RED_HOVER = '#ff5252';
  const BLACK = '#111111';
  const BLACK_HOVER = '#333';
  const GREEN = '#1b7d40';
  const GREEN_HOVER = '#25a955';

  // visibility helpers driven by mode
  const cellsClickable = betMode == null || ['STRAIGHT', 'STREET', 'SIX_LINE'].includes(betMode);
  const showSplitH = ['SPLIT'].includes(betMode);   // make handles visible when explicitly in split mode
  const showSplitV = ['SPLIT'].includes(betMode);
  const showCorner = ['CORNER'].includes(betMode);
  const allowSplitHover = betMode == null;          // legacy hover handles only in "Tous"
  const allowCornerHover = betMode == null;

  // Dim a section that isn't allowed for the current mode
  const sectionDim = (type) => ({
    opacity: betMode != null && betMode !== type ? 0.32 : 1,
    pointerEvents: betMode != null && betMode !== type ? 'none' : 'auto',
    filter: betMode != null && betMode !== type ? 'grayscale(0.6)' : 'none',
    transition: 'opacity 0.2s, filter 0.2s',
  });

  // Number cell — dimmed if cells aren't clickable in this mode
  const NumCell = ({ num }) => {
    const { col, row } = getCoordOfNumber(num);
    const red = isRed(num);
    const isH = hovered === `n-${num}`;
    const bg = red ? RED : BLACK;
    const bgH = red ? RED_HOVER : BLACK_HOVER;

    const cellLocked = !cellsClickable;
    const localOpacity = cellLocked ? 0.45 : 1;
    const cursor = disabled || cellLocked ? 'not-allowed' : 'pointer';

    return (
      <div style={{ position: 'relative', height: CELL }}>
        <button
          onClick={() => handleCellClick(num, col)}
          disabled={disabled || cellLocked}
          onMouseEnter={() => setHovered(`n-${num}`)}
          onMouseLeave={() => setHovered(null)}
          style={{
            width: '100%', height: '100%',
            background: isH && !cellLocked ? bgH : bg,
            border: `1px solid ${GOLD_B}`,
            color: '#fff', fontWeight: '800', fontSize: '1.05rem',
            cursor,
            opacity: disabled ? 0.55 : localOpacity,
            textShadow: '1px 1px 2px rgba(0,0,0,0.9)',
            transition: 'background 0.1s, transform 0.1s, box-shadow 0.1s, opacity 0.2s',
            transform: isH && !cellLocked ? 'scale(1.15)' : 'scale(1)',
            zIndex: isH && !cellLocked ? 10 : 1,
            boxShadow: isH && !cellLocked
              ? `0 0 14px ${GOLD}88, 0 4px 12px rgba(0,0,0,0.5)`
              : `inset 0 1px 1px rgba(255,255,255,0.15), inset 0 -2px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.3)`,
            position: 'relative',
            fontFamily: "'Outfit', sans-serif",
          }}
        >
          {num}
        </button>

        {isBettingOpen && (
          <>
            {/* SPLIT handles — visible/clickable depending on mode */}
            {col < 11 && (
              <div
                onClick={(e) => { e.stopPropagation(); handleSplitH(num, col, row); }}
                onMouseEnter={() => setHovered(`sh-${num}`)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  position: 'absolute', top: '10%', right: -5, width: 10, height: '80%',
                  cursor: allow('SPLIT') ? 'pointer' : 'default',
                  zIndex: 15, borderRadius: 3,
                  background:
                    showSplitH ? `${GOLD}88`
                    : (allowSplitHover && hovered === `sh-${num}` ? `${GOLD}aa` : 'transparent'),
                  pointerEvents: allow('SPLIT') ? 'auto' : 'none',
                  transition: 'background 0.12s',
                }}
              />
            )}
            {row > 0 && (
              <div
                onClick={(e) => { e.stopPropagation(); handleSplitV(num, col, row); }}
                onMouseEnter={() => setHovered(`sv-${num}`)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  position: 'absolute', top: -5, left: '10%', width: '80%', height: 10,
                  cursor: allow('SPLIT') ? 'pointer' : 'default',
                  zIndex: 15, borderRadius: 3,
                  background:
                    showSplitV ? `${GOLD}88`
                    : (allowSplitHover && hovered === `sv-${num}` ? `${GOLD}aa` : 'transparent'),
                  pointerEvents: allow('SPLIT') ? 'auto' : 'none',
                  transition: 'background 0.12s',
                }}
              />
            )}
            {/* CORNER handle */}
            {col < 11 && row > 0 && (
              <div
                onClick={(e) => { e.stopPropagation(); handleCorner(num, col, row); }}
                onMouseEnter={() => setHovered(`cr-${num}`)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  position: 'absolute', top: -7, right: -7, width: 14, height: 14,
                  cursor: allow('CORNER') ? 'pointer' : 'default',
                  zIndex: 20, borderRadius: '50%',
                  background:
                    showCorner ? `${GOLD}dd`
                    : (allowCornerHover && hovered === `cr-${num}` ? `${GOLD}dd` : 'transparent'),
                  pointerEvents: allow('CORNER') ? 'auto' : 'none',
                  boxShadow: showCorner ? `0 0 6px ${GOLD}99` : 'none',
                  transition: 'background 0.12s, box-shadow 0.12s',
                }}
              />
            )}
          </>
        )}
      </div>
    );
  };

  // Outside button (1-18, PAIR, RED, BLACK, IMPAIR, 19-36, dozens, columns)
  const OutBtn = ({ label, onClick, id, bg, h, children, type }) => {
    const isH = hovered === id;
    const allowed = allow(type);
    const dim = !allowed && betMode != null;
    return (
      <button
        onClick={allowed ? onClick : undefined}
        disabled={disabled || !allowed}
        onMouseEnter={() => setHovered(id)}
        onMouseLeave={() => setHovered(null)}
        style={{
          padding: `${h || 11}px 0`,
          border: `1px solid ${GOLD_B}`,
          background: dim ? 'rgba(255,255,255,0.02)' : (isH ? (bg ? `${bg}dd` : `${GOLD}33`) : (bg || 'rgba(255,255,255,0.04)')),
          color: '#fff',
          fontWeight: '700', fontSize: '0.72rem',
          letterSpacing: '1.5px', textTransform: 'uppercase',
          cursor: disabled || !allowed ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.55 : (dim ? 0.35 : 1),
          filter: dim ? 'grayscale(0.6)' : 'none',
          transition: 'all 0.15s',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          fontFamily: "'Inter', sans-serif",
          textShadow: bg ? '0 1px 3px rgba(0,0,0,0.7)' : 'none',
        }}
      >
        {children || label}
      </button>
    );
  };

  const Diamond = () => (
    <svg width="20" height="20" viewBox="0 0 20 20">
      <rect x="4" y="4" width="12" height="12" rx="1.5" transform="rotate(45 10 10)" fill="#fff" fillOpacity="0.9" />
    </svg>
  );

  // Mode badge — small label that floats on the table to remind the user which mode is active
  const ModeBadge = () =>
    betMode == null ? null : (
      <div style={{
        position: 'absolute', top: 8, right: 12, zIndex: 5,
        padding: '4px 10px', borderRadius: 999,
        background: GOLD, color: '#000',
        fontSize: 10, fontWeight: 800, letterSpacing: '0.12em',
        textTransform: 'uppercase',
        boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
      }}>
        Mode {labelOf(betMode)}
      </div>
    );

  return (
    <div style={{
      background: `radial-gradient(ellipse at 30% 40%, #1f8c47 0%, #176e38 40%, #145f30 70%, #0f4d26 100%)`,
      padding: '18px',
      borderRadius: '14px',
      border: `3px solid ${GOLD}`,
      boxShadow: `inset 0 0 40px rgba(0,0,0,0.25), 0 8px 30px rgba(0,0,0,0.45), 0 0 0 1px ${GOLD_B}`,
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Felt texture */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.035, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(circle, #000 0.5px, transparent 0.5px)',
        backgroundSize: '3px 3px',
      }} />

      {/* Inner gold edge line */}
      <div style={{
        position: 'absolute', inset: 6, border: `1px solid ${GOLD}44`, borderRadius: 10,
        pointerEvents: 'none', zIndex: 0,
      }} />

      <ModeBadge />

      {/* Main row: Zero + Numbers + 2:1 columns */}
      <div style={{ display: 'flex', gap: 0, position: 'relative', zIndex: 1 }}>
        {/* Zero — STRAIGHT only */}
        <button
          onClick={() => allow('STRAIGHT') && addBet('STRAIGHT', '0')}
          disabled={disabled || !allow('STRAIGHT')}
          onMouseEnter={() => setHovered('zero')}
          onMouseLeave={() => setHovered(null)}
          style={{
            width: 52, minHeight: CELL * 3,
            background: hovered === 'zero' && allow('STRAIGHT') ? GREEN_HOVER : GREEN,
            border: `1px solid ${GOLD_B}`,
            borderRadius: '6px 0 0 6px',
            color: '#fff', fontWeight: '900', fontSize: '1.6rem',
            cursor: !allow('STRAIGHT') ? 'not-allowed' : (disabled ? 'not-allowed' : 'pointer'),
            opacity: disabled ? 0.55 : (allow('STRAIGHT') ? 1 : 0.35),
            filter: allow('STRAIGHT') ? 'none' : 'grayscale(0.5)',
            textShadow: '1px 2px 4px rgba(0,0,0,0.7)',
            transition: 'all 0.15s',
            transform: hovered === 'zero' && allow('STRAIGHT') ? 'scale(1.04)' : 'scale(1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Outfit', sans-serif",
          }}
        >
          0
        </button>

        {/* 1-36 grid */}
        <div style={{
          flex: 1, display: 'grid',
          gridTemplateColumns: 'repeat(12, 1fr)',
          gridTemplateRows: `repeat(3, ${CELL}px)`,
          gridAutoFlow: 'column', gap: 0,
        }}>
          {Array.from({ length: 36 }, (_, i) => <NumCell key={i + 1} num={i + 1} />)}
        </div>

        {/* 2:1 columns */}
        <div style={{
          display: 'grid', gridTemplateRows: `repeat(3, ${CELL}px)`, gap: 0, width: 44,
          ...sectionDim('COLUMN'),
        }}>
          {['Col3', 'Col2', 'Col1'].map((col, i) => {
            const isH = hovered === col;
            const allowed = allow('COLUMN');
            return (
              <button
                key={col}
                onClick={allowed ? () => addBet('COLUMN', col) : undefined}
                disabled={disabled || !allowed}
                onMouseEnter={() => setHovered(col)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  background: isH && allowed ? `${GOLD}44` : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${GOLD_B}`, color: '#fff',
                  fontWeight: '800', fontSize: '0.7rem', letterSpacing: '0.5px',
                  cursor: !allowed || disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.55 : 1, transition: 'all 0.1s',
                  borderRadius: i === 0 ? '0 6px 0 0' : i === 2 ? '0 0 6px 0' : '0',
                  fontFamily: "'Outfit', sans-serif",
                }}
              >
                2:1
              </button>
            );
          })}
        </div>
      </div>

      {/* LOW / HIGH — directement sous les chiffres concernes (1-18 / 19-36) */}
      <div style={{
        display: 'grid', gridTemplateColumns: '52px 1fr 1fr 44px', gap: 0,
        position: 'relative', zIndex: 1,
        ...sectionDim('HALF'),
      }}>
        <div />
        <OutBtn label="LOW"  id="low-row"  type="HALF" onClick={() => addBet('HALF', '1-18')} />
        <OutBtn label="HIGH" id="high-row" type="HALF" onClick={() => addBet('HALF', '19-36')} />
        <div />
      </div>

      {/* Dozens */}
      <div style={{
        display: 'grid', gridTemplateColumns: '52px 1fr 1fr 1fr 44px', gap: 0,
        position: 'relative', zIndex: 1,
        ...sectionDim('DOZEN'),
      }}>
        <div />
        {[{ l: '1re DOUZAINE', t: '1st' }, { l: '2e DOUZAINE', t: '2nd' }, { l: '3e DOUZAINE', t: '3rd' }].map(d => (
          <OutBtn key={d.t} label={d.l} id={`dz-${d.t}`} type="DOZEN" onClick={() => addBet('DOZEN', d.t)} />
        ))}
        <div />
      </div>

      {/* Outside bets */}
      <div style={{
        display: 'grid', gridTemplateColumns: '52px 1fr 1fr 1fr 1fr 1fr 1fr 44px', gap: 0,
        position: 'relative', zIndex: 1,
      }}>
        <div />
        <OutBtn label="1-18"   id="low"   type="HALF"     onClick={() => addBet('HALF', '1-18')} />
        <OutBtn label="PAIR"   id="even"  type="EVEN_ODD" onClick={() => addBet('EVEN_ODD', 'EVEN')} />
        <OutBtn id="red"   bg={RED}   type="COLOR" onClick={() => addBet('COLOR', 'RED')}><Diamond /></OutBtn>
        <OutBtn id="black" bg={BLACK} type="COLOR" onClick={() => addBet('COLOR', 'BLACK')}><Diamond /></OutBtn>
        <OutBtn label="IMPAIR" id="odd"   type="EVEN_ODD" onClick={() => addBet('EVEN_ODD', 'ODD')} />
        <OutBtn label="19-36"  id="high"  type="HALF"     onClick={() => addBet('HALF', '19-36')} />
        <div />
      </div>

      {/* Table branding */}
      <div style={{
        textAlign: 'center', marginTop: 12, fontSize: '0.58rem', letterSpacing: 5,
        textTransform: 'uppercase', color: `${GOLD}44`, fontWeight: '700',
        position: 'relative', zIndex: 1, fontFamily: "'Outfit', sans-serif",
      }}>
        Roulette Européenne &mdash; AGDTech
      </div>
    </div>
  );
};

const labelOf = (mode) => ({
  STRAIGHT: 'Plein',
  SPLIT:    'Cheval',
  STREET:   'Transversale',
  CORNER:   'Carré',
  SIX_LINE: 'Sixain',
  COLUMN:   'Colonne',
  DOZEN:    'Douzaine',
  COLOR:    'Couleur',
  EVEN_ODD: 'Pair / Impair',
  HALF:     'High / Low',
}[mode] || mode);

export default BettingGrid;
