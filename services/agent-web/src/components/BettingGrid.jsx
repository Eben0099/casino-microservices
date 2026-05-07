import React, { useState } from 'react';
import { getNumberAtCoord, getCoordOfNumber, RED_NUMBERS } from './RouletteHelpers';

const BettingGrid = ({ addBet, isBettingOpen }) => {
  const [hovered, setHovered] = useState(null);
  const disabled = !isBettingOpen;
  const isRed = (n) => RED_NUMBERS.includes(n);

  const handleStreetBet = (col) => {
    const nums = [getNumberAtCoord(col, 0), getNumberAtCoord(col, 1), getNumberAtCoord(col, 2)];
    if (nums.every(Boolean)) addBet('STREET', nums.join(','));
  };
  const handleSixLineBet = (col) => {
    const nums = [];
    for (let c = col; c <= col + 1; c++)
      for (let r = 0; r <= 2; r++) nums.push(getNumberAtCoord(c, r));
    if (nums.every(Boolean)) addBet('SIX_LINE', nums.join(','));
  };
  const handleSplitH = (num, col, row) => {
    const n = getNumberAtCoord(col + 1, row);
    if (n) addBet('SPLIT', `${num},${n}`);
  };
  const handleSplitV = (num, col, row) => {
    const n = getNumberAtCoord(col, row - 1);
    if (n) addBet('SPLIT', `${num},${n}`);
  };
  const handleCorner = (num, col, row) => {
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

  const NumCell = ({ num }) => {
    const { col, row } = getCoordOfNumber(num);
    const red = isRed(num);
    const isH = hovered === `n-${num}`;
    const bg = red ? RED : BLACK;
    const bgH = red ? RED_HOVER : BLACK_HOVER;

    return (
      <div style={{ position: 'relative', height: CELL }}>
        <button
          onClick={() => addBet('STRAIGHT', num.toString())}
          disabled={disabled}
          onMouseEnter={() => setHovered(`n-${num}`)}
          onMouseLeave={() => setHovered(null)}
          style={{
            width: '100%', height: '100%',
            background: isH ? bgH : bg,
            border: `1px solid ${GOLD_B}`,
            color: '#fff', fontWeight: '800', fontSize: '1.05rem',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.55 : 1,
            textShadow: '1px 1px 2px rgba(0,0,0,0.9)',
            transition: 'background 0.1s, transform 0.1s, box-shadow 0.1s',
            transform: isH ? 'scale(1.15)' : 'scale(1)',
            zIndex: isH ? 10 : 1,
            boxShadow: isH
              ? `0 0 14px ${GOLD}88, 0 4px 12px rgba(0,0,0,0.5)`
              : `inset 0 1px 1px rgba(255,255,255,0.15), inset 0 -2px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.3)`,
            position: 'relative',
            fontFamily: "'Outfit', sans-serif"
          }}
        >{num}</button>
        {isBettingOpen && (
          <>
            {col < 11 && <div onClick={(e) => { e.stopPropagation(); handleSplitH(num, col, row); }}
              onMouseEnter={() => setHovered(`sh-${num}`)} onMouseLeave={() => setHovered(null)}
              style={{ position: 'absolute', top: '10%', right: -5, width: 10, height: '80%',
                cursor: 'pointer', zIndex: 15, borderRadius: 3,
                background: hovered === `sh-${num}` ? `${GOLD}aa` : 'transparent', transition: 'background 0.1s' }} />}
            {row > 0 && <div onClick={(e) => { e.stopPropagation(); handleSplitV(num, col, row); }}
              onMouseEnter={() => setHovered(`sv-${num}`)} onMouseLeave={() => setHovered(null)}
              style={{ position: 'absolute', top: -5, left: '10%', width: '80%', height: 10,
                cursor: 'pointer', zIndex: 15, borderRadius: 3,
                background: hovered === `sv-${num}` ? `${GOLD}aa` : 'transparent', transition: 'background 0.1s' }} />}
            {col < 11 && row > 0 && <div onClick={(e) => { e.stopPropagation(); handleCorner(num, col, row); }}
              onMouseEnter={() => setHovered(`cr-${num}`)} onMouseLeave={() => setHovered(null)}
              style={{ position: 'absolute', top: -7, right: -7, width: 14, height: 14,
                cursor: 'pointer', zIndex: 20, borderRadius: '50%',
                background: hovered === `cr-${num}` ? `${GOLD}dd` : 'transparent', transition: 'background 0.1s' }} />}
          </>
        )}
      </div>
    );
  };

  const OutBtn = ({ label, onClick, id, bg, h, children }) => {
    const isH = hovered === id;
    return (
      <button onClick={onClick} disabled={disabled}
        onMouseEnter={() => setHovered(id)} onMouseLeave={() => setHovered(null)}
        style={{
          padding: `${h || 11}px 0`,
          border: `1px solid ${GOLD_B}`,
          background: isH ? (bg ? `${bg}dd` : `${GOLD}33`) : (bg || 'rgba(255,255,255,0.04)'),
          color: '#fff', fontWeight: '700', fontSize: '0.72rem',
          letterSpacing: '1.5px', textTransform: 'uppercase',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.55 : 1,
          transition: 'all 0.1s',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          fontFamily: "'Inter', sans-serif",
          textShadow: bg ? '0 1px 3px rgba(0,0,0,0.7)' : 'none'
        }}
      >{children || label}</button>
    );
  };

  const Diamond = () => (
    <svg width="20" height="20" viewBox="0 0 20 20">
      <rect x="4" y="4" width="12" height="12" rx="1.5" transform="rotate(45 10 10)" fill="#fff" fillOpacity="0.9" />
    </svg>
  );

  return (
    <div style={{
      background: `radial-gradient(ellipse at 30% 40%, #1f8c47 0%, #176e38 40%, #145f30 70%, #0f4d26 100%)`,
      padding: '18px',
      borderRadius: '14px',
      border: `3px solid ${GOLD}`,
      boxShadow: `inset 0 0 40px rgba(0,0,0,0.25), 0 8px 30px rgba(0,0,0,0.45), 0 0 0 1px ${GOLD_B}`,
      position: 'relative', overflow: 'hidden'
    }}>
      {/* Felt texture */}
      <div style={{ position: 'absolute', inset: 0, opacity: 0.035, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(circle, #000 0.5px, transparent 0.5px)', backgroundSize: '3px 3px' }} />

      {/* Inner gold edge line */}
      <div style={{
        position: 'absolute', inset: 6, border: `1px solid ${GOLD}44`, borderRadius: 10, pointerEvents: 'none', zIndex: 0
      }} />

      {/* Main row: Zero + Numbers + 2:1 */}
      <div style={{ display: 'flex', gap: 0, position: 'relative', zIndex: 1 }}>

        {/* Zero */}
        <button
          onClick={() => addBet('STRAIGHT', '0')}
          disabled={disabled}
          onMouseEnter={() => setHovered('zero')}
          onMouseLeave={() => setHovered(null)}
          style={{
            width: 52, minHeight: CELL * 3,
            background: hovered === 'zero' ? GREEN_HOVER : GREEN,
            border: `1px solid ${GOLD_B}`,
            borderRadius: '6px 0 0 6px',
            color: '#fff', fontWeight: '900', fontSize: '1.6rem',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.55 : 1,
            textShadow: '1px 2px 4px rgba(0,0,0,0.7)',
            transition: 'all 0.12s',
            transform: hovered === 'zero' ? 'scale(1.04)' : 'scale(1)',
            boxShadow: hovered === 'zero'
              ? `0 0 18px ${GOLD}66, inset 0 0 15px rgba(255,255,255,0.1)`
              : 'inset 0 1px 2px rgba(255,255,255,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Outfit', sans-serif"
          }}
        >0</button>

        {/* 1-36 grid */}
        <div style={{
          flex: 1, display: 'grid',
          gridTemplateColumns: 'repeat(12, 1fr)',
          gridTemplateRows: `repeat(3, ${CELL}px)`,
          gridAutoFlow: 'column', gap: 0
        }}>
          {Array.from({ length: 36 }, (_, i) => <NumCell key={i + 1} num={i + 1} />)}
        </div>

        {/* 2:1 columns */}
        <div style={{ display: 'grid', gridTemplateRows: `repeat(3, ${CELL}px)`, gap: 0, width: 44 }}>
          {['Col3', 'Col2', 'Col1'].map((col, i) => {
            const isH = hovered === col;
            return (
              <button key={col} onClick={() => addBet('COLUMN', col)} disabled={disabled}
                onMouseEnter={() => setHovered(col)} onMouseLeave={() => setHovered(null)}
                style={{
                  background: isH ? `${GOLD}44` : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${GOLD_B}`, color: '#fff',
                  fontWeight: '800', fontSize: '0.7rem', letterSpacing: '0.5px',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.55 : 1, transition: 'all 0.1s',
                  borderRadius: i === 0 ? '0 6px 0 0' : i === 2 ? '0 0 6px 0' : '0',
                  fontFamily: "'Outfit', sans-serif"
                }}
              >2:1</button>
            );
          })}
        </div>
      </div>

      {/* Dozens */}
      <div style={{ display: 'grid', gridTemplateColumns: '52px 1fr 1fr 1fr 44px', gap: 0, position: 'relative', zIndex: 1 }}>
        <div />
        {[{ l: '1re DOUZAINE', t: '1st' }, { l: '2e DOUZAINE', t: '2nd' }, { l: '3e DOUZAINE', t: '3rd' }].map(d => (
          <OutBtn key={d.t} label={d.l} id={`dz-${d.t}`} onClick={() => addBet('DOZEN', d.t)} />
        ))}
        <div />
      </div>

      {/* Outside bets */}
      <div style={{ display: 'grid', gridTemplateColumns: '52px 1fr 1fr 1fr 1fr 1fr 1fr 44px', gap: 0, position: 'relative', zIndex: 1 }}>
        <div />
        <OutBtn label="1-18" id="low" onClick={() => addBet('HALF', '1-18')} />
        <OutBtn label="PAIR" id="even" onClick={() => addBet('EVEN_ODD', 'EVEN')} />
        <OutBtn id="red" bg={RED} onClick={() => addBet('COLOR', 'RED')}><Diamond /></OutBtn>
        <OutBtn id="black" bg={BLACK} onClick={() => addBet('COLOR', 'BLACK')}><Diamond /></OutBtn>
        <OutBtn label="IMPAIR" id="odd" onClick={() => addBet('EVEN_ODD', 'ODD')} />
        <OutBtn label="19-36" id="high" onClick={() => addBet('HALF', '19-36')} />
        <div />
      </div>

      {/* Table branding */}
      <div style={{
        textAlign: 'center', marginTop: 12, fontSize: '0.58rem', letterSpacing: 5,
        textTransform: 'uppercase', color: `${GOLD}44`, fontWeight: '700',
        position: 'relative', zIndex: 1, fontFamily: "'Outfit', sans-serif"
      }}>
        Roulette Europeenne &mdash; AGDTech
      </div>
    </div>
  );
};

export default BettingGrid;
