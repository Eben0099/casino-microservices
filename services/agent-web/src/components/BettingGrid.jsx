import React, { useState } from 'react';
import { getNumberAtCoord, getCoordOfNumber, RED_NUMBERS } from './RouletteHelpers';
import { ENABLED_BET_TYPES } from './OddsTable';
import { useT } from '../i18n';

// 6 wheel sectors of 6 numbers each, sliced from the European wheel order
// starting after 0. Mirrors backend SECTORS in ticket-service/app/rules.py.
const WHEEL_SECTORS = {
  A: [32, 15, 19, 4, 21, 2],
  B: [25, 17, 34, 6, 27, 13],
  C: [36, 11, 30, 8, 23, 10],
  D: [5, 24, 16, 33, 1, 20],
  E: [14, 31, 9, 22, 18, 29],
  F: [7, 28, 12, 35, 3, 26],
};

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
  const { t } = useT();
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
  // SPLIT/CORNER handles only render if the type is currently enabled in the
  // POS. With the Unity-aligned allowlist they default to hidden.
  const splitEnabled = ENABLED_BET_TYPES.has('SPLIT');
  const cornerEnabled = ENABLED_BET_TYPES.has('CORNER');
  const columnEnabled = ENABLED_BET_TYPES.has('COLUMN');
  const showSplitH = splitEnabled && ['SPLIT'].includes(betMode);
  const showSplitV = splitEnabled && ['SPLIT'].includes(betMode);
  const showCorner = cornerEnabled && ['CORNER'].includes(betMode);
  const allowSplitHover = splitEnabled && betMode == null;
  const allowCornerHover = cornerEnabled && betMode == null;

  // Dim a section that isn't allowed for the current mode
  const sectionDim = (type) => ({
    opacity: betMode != null && betMode !== type ? 0.32 : 1,
    pointerEvents: betMode != null && betMode !== type ? 'none' : 'auto',
    filter: betMode != null && betMode !== type ? 'grayscale(0.6)' : 'none',
    transition: 'opacity 0.2s, filter 0.2s',
  });

  // Derive the currently hovered number (if a cell is being pointed at) so
  // STREET / SIX_LINE modes can light up the whole bet group, not just one cell.
  const hoveredNumber = hovered && hovered.startsWith('n-')
    ? parseInt(hovered.slice(2), 10)
    : null;
  const hoveredCoord = (hoveredNumber != null && !Number.isNaN(hoveredNumber) && hoveredNumber >= 1)
    ? getCoordOfNumber(hoveredNumber)
    : null;

  // When the user hovers an OUTSIDE bet button (HIGH/LOW, RED/BLACK, EVEN/ODD,
  // dozens, 2:1 columns, sectors A-F), light up the numbered cells that the
  // bet covers — same UX as STREET/SIX_LINE cell-group hover.
  const inHoveredOutsideGroup = (n) => {
    if (!hovered) return false;
    switch (hovered) {
      case 'low':
      case 'low-row':
        return n >= 1 && n <= 18;
      case 'high':
      case 'high-row':
        return n >= 19 && n <= 36;
      case 'even':
        return n % 2 === 0;
      case 'odd':
        return n % 2 === 1;
      case 'red':
        return RED_NUMBERS.includes(n);
      case 'black':
        return !RED_NUMBERS.includes(n);
      case 'dz-1st':
        return n >= 1 && n <= 12;
      case 'dz-2nd':
        return n >= 13 && n <= 24;
      case 'dz-3rd':
        return n >= 25 && n <= 36;
      case 'Col1':
        return n % 3 === 1;
      case 'Col2':
        return n % 3 === 2;
      case 'Col3':
        return n % 3 === 0;
      default:
        if (hovered.startsWith('sector-')) {
          const letter = hovered.slice(7);
          return WHEEL_SECTORS[letter]?.includes(n) ?? false;
        }
        if (hovered.startsWith('hc-')) {
          // Combination LOW/HIGH × RED/BLACK — 9 numbers each
          const combo = hovered.slice(3); // LOW_RED | LOW_BLACK | HIGH_RED | HIGH_BLACK
          const [half, color] = combo.split('_');
          const inHalf = half === 'LOW' ? (n >= 1 && n <= 18) : (n >= 19 && n <= 36);
          const isRed = RED_NUMBERS.includes(n);
          const inColor = color === 'RED' ? isRed : !isRed;
          return inHalf && inColor;
        }
        return false;
    }
  };

  // Number cell — dimmed if cells aren't clickable in this mode
  const NumCell = ({ num }) => {
    const { col, row } = getCoordOfNumber(num);
    const red = isRed(num);
    const isDirectHover = hovered === `n-${num}`;
    const bg = red ? RED : BLACK;
    const bgH = red ? RED_HOVER : BLACK_HOVER;

    const cellLocked = !cellsClickable;
    const localOpacity = cellLocked ? 0.45 : 1;
    const cursor = disabled || cellLocked ? 'not-allowed' : 'pointer';

    // Cell-group hover : in STREET mode, all 3 cells in the same column light
    // up. In SIX_LINE mode, the 6 cells of the relevant 2-column block do.
    let inCellGroup = false;
    if (!cellLocked && hoveredCoord) {
      if (betMode === 'STREET') {
        inCellGroup = hoveredCoord.col === col;
      } else if (betMode === 'SIX_LINE') {
        const baseCol = hoveredCoord.col >= 11 ? 10 : hoveredCoord.col;
        inCellGroup = col >= baseCol && col <= baseCol + 1;
      }
    }

    // Outside-group hover : the user hovers a HIGH / LOW / RED / BLACK /
    // PAIR / IMPAIR / DOZEN / COLUMN / SECTOR button → all the matching
    // numbered cells should preview which numbers the bet covers.
    const inOutsideGroup = inHoveredOutsideGroup(num);

    const isGroupMode = betMode === 'STREET' || betMode === 'SIX_LINE';
    const showHoverFx = inOutsideGroup || (!cellLocked && (isDirectHover || inCellGroup));
    // STRAIGHT/Tous direct hover keeps the scale pop. Group modes flatten.
    const lift = isDirectHover && !cellLocked && !isGroupMode && !inOutsideGroup;
    // When the outside-group preview is active, override the dimmed-locked
    // opacity so the covered cells read clearly through the lock greyout.
    const finalOpacity = disabled ? 0.55 : (inOutsideGroup ? 1 : localOpacity);

    return (
      <div style={{
        position: 'relative',
        height: CELL,
        // Place the cell at its logical roulette position so that 1 sits at
        // bottom-left and 36 at top-right — matches the 2:1 column buttons
        // (Col3 on top, Col1 at bottom) and the SPLIT-V handles.
        gridRow: row + 1,
        gridColumn: col + 1,
      }}>
        <button
          onClick={() => handleCellClick(num, col)}
          disabled={disabled || cellLocked}
          onMouseEnter={() => setHovered(`n-${num}`)}
          onMouseLeave={() => setHovered(null)}
          style={{
            width: '100%', height: '100%',
            background: showHoverFx ? bgH : bg,
            border: `1px solid ${showHoverFx ? GOLD : GOLD_B}`,
            color: '#fff', fontWeight: '800', fontSize: '1.05rem',
            cursor,
            opacity: finalOpacity,
            textShadow: '1px 1px 2px rgba(0,0,0,0.9)',
            transition: 'background 0.1s, transform 0.1s, box-shadow 0.1s, opacity 0.2s, border-color 0.1s',
            transform: lift ? 'scale(1.15)' : 'scale(1)',
            zIndex: lift ? 10 : (showHoverFx ? 5 : 1),
            boxShadow: showHoverFx
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
            {splitEnabled && col < 11 && (
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
            {splitEnabled && row > 0 && (
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
            {cornerEnabled && col < 11 && row > 0 && (
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
        {t('bet.table.modeLabel', { mode: t(`bet.type.${betMode}`) })}
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

        {/* 1-36 grid — cells placed in logical roulette positions:
            top row = Col3 (3,6,9,...,36), bottom row = Col1 (1,4,7,...,34). */}
        <div style={{
          flex: 1, display: 'grid',
          gridTemplateColumns: 'repeat(12, 1fr)',
          gridTemplateRows: `repeat(3, ${CELL}px)`,
          gap: 0,
        }}>
          {Array.from({ length: 36 }, (_, i) => <NumCell key={i + 1} num={i + 1} />)}
        </div>

        {/* 2:1 columns — hidden when COLUMN is not in the Unity-aligned allowlist.
            Slot kept at 44px so the dozens/half/sectors right-edge alignment stays. */}
        {columnEnabled ? (
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
        ) : (
          <div style={{ width: 44 }} aria-hidden />
        )}
      </div>

      {/* LOW / HIGH — directement sous les chiffres concernes (1-18 / 19-36) */}
      <div style={{
        display: 'grid', gridTemplateColumns: '52px 1fr 1fr 44px', gap: 0,
        position: 'relative', zIndex: 1,
        ...sectionDim('HALF'),
      }}>
        <div />
        <OutBtn label={t('bet.table.low')}  id="low-row"  type="HALF" onClick={() => addBet('HALF', '1-18')} />
        <OutBtn label={t('bet.table.high')} id="high-row" type="HALF" onClick={() => addBet('HALF', '19-36')} />
        <div />
      </div>

      {/* Dozens */}
      <div style={{
        display: 'grid', gridTemplateColumns: '52px 1fr 1fr 1fr 44px', gap: 0,
        position: 'relative', zIndex: 1,
        ...sectionDim('DOZEN'),
      }}>
        <div />
        {[
          { l: t('bet.dozen.short1'), tgt: '1st' },
          { l: t('bet.dozen.short2'), tgt: '2nd' },
          { l: t('bet.dozen.short3'), tgt: '3rd' },
        ].map(d => (
          <OutBtn key={d.tgt} label={d.l} id={`dz-${d.tgt}`} type="DOZEN" onClick={() => addBet('DOZEN', d.tgt)} />
        ))}
        <div />
      </div>

      {/* Outside bets */}
      <div style={{
        display: 'grid', gridTemplateColumns: '52px 1fr 1fr 1fr 1fr 1fr 1fr 44px', gap: 0,
        position: 'relative', zIndex: 1,
      }}>
        <div />
        <OutBtn label="1-18"             id="low"   type="HALF"     onClick={() => addBet('HALF', '1-18')} />
        <OutBtn label={t('bet.table.even')} id="even"  type="EVEN_ODD" onClick={() => addBet('EVEN_ODD', 'EVEN')} />
        <OutBtn id="red"   bg={RED}   type="COLOR" onClick={() => addBet('COLOR', 'RED')}><Diamond /></OutBtn>
        <OutBtn id="black" bg={BLACK} type="COLOR" onClick={() => addBet('COLOR', 'BLACK')}><Diamond /></OutBtn>
        <OutBtn label={t('bet.table.odd')}  id="odd"   type="EVEN_ODD" onClick={() => addBet('EVEN_ODD', 'ODD')} />
        <OutBtn label="19-36"            id="high"  type="HALF"     onClick={() => addBet('HALF', '19-36')} />
        <div />
      </div>

      {/* Half × Color combination — 4 bets covering 9 numbers each, payout x4.
          LOW-RED, LOW-BLACK, HIGH-RED, HIGH-BLACK. Same RTP 97.30% as the rest. */}
      <div style={{
        marginTop: 6,
        display: 'grid', gridTemplateColumns: '52px repeat(4, 1fr) 44px', gap: 0,
        position: 'relative', zIndex: 1,
        ...sectionDim('HALF_COLOR'),
      }}>
        <div />
        {[
          { combo: 'LOW_RED',    bg: RED,   half: t('bet.halfColor.lowShort'),  range: '1-18' },
          { combo: 'LOW_BLACK',  bg: BLACK, half: t('bet.halfColor.lowShort'),  range: '1-18' },
          { combo: 'HIGH_RED',   bg: RED,   half: t('bet.halfColor.highShort'), range: '19-36' },
          { combo: 'HIGH_BLACK', bg: BLACK, half: t('bet.halfColor.highShort'), range: '19-36' },
        ].map(({ combo, bg, half, range }) => (
          <OutBtn
            key={`hc-${combo}`}
            id={`hc-${combo}`}
            type="HALF_COLOR"
            bg={bg}
            h={14}
            onClick={() => addBet('HALF_COLOR', combo)}
          >
            <span style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1,
              fontFamily: "'Outfit', sans-serif",
            }}>
              <span style={{
                fontSize: '0.85rem', fontWeight: 900, letterSpacing: '0.06em',
              }}>
                {half}
              </span>
              <span style={{
                fontSize: '0.55rem', fontWeight: 700, opacity: 0.8,
                letterSpacing: '0.06em', marginTop: 2,
              }}>
                {range} · x4
              </span>
            </span>
          </OutBtn>
        ))}
        <div />
      </div>

      {/* Wheel sectors A-F — 6 sectors of 6 numbers each, payout x6 */}
      <div style={{
        marginTop: 6,
        display: 'grid', gridTemplateColumns: '52px repeat(6, 1fr) 44px', gap: 0,
        position: 'relative', zIndex: 1,
        ...sectionDim('SECTOR'),
      }}>
        <div />
        {['A', 'B', 'C', 'D', 'E', 'F'].map(letter => (
          <OutBtn
            key={`sector-${letter}`}
            id={`sector-${letter}`}
            type="SECTOR"
            onClick={() => addBet('SECTOR', letter)}
            h={14}
          >
            <span style={{
              fontSize: '1.1rem', fontWeight: 900, letterSpacing: '0.04em',
              fontFamily: "'Outfit', sans-serif",
            }}>
              {letter}
            </span>
            <span style={{
              fontSize: '0.55rem', fontWeight: 700, opacity: 0.75,
              letterSpacing: '0.06em',
            }}>
              x6
            </span>
          </OutBtn>
        ))}
        <div />
      </div>

      {/* Table branding */}
      <div style={{
        textAlign: 'center', marginTop: 12, fontSize: '0.58rem', letterSpacing: 5,
        textTransform: 'uppercase', color: `${GOLD}44`, fontWeight: '700',
        position: 'relative', zIndex: 1, fontFamily: "'Outfit', sans-serif",
      }}>
        {t('bet.table.branding')}
      </div>
    </div>
  );
};

export default BettingGrid;
