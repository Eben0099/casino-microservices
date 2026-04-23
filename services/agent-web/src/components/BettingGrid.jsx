// services/agent-web/src/components/BettingGrid.jsx
import React from 'react';
import RouletteNumberCell from './RouletteNumberCell';
import { getNumberAtCoord, getCoordOfNumber } from './RouletteHelpers';

const BettingGrid = ({ addBet, isBettingOpen }) => {
  
  // Helper pour générer un pari Transversale (Street) pour une colonne donnée
  const handleStreetBet = (col) => {
    const num1 = getNumberAtCoord(col, 2);
    const num2 = getNumberAtCoord(col, 1);
    const num3 = getNumberAtCoord(col, 0);
    if (num1 && num2 && num3) {
      addBet('STREET', `${num1},${num2},${num3}`);
    }
  };

  // Helper pour générer un pari Sixain (Six Line) entre deux colonnes adjacentes
  const handleSixLineBet = (col) => {
    const nums = [];
    for(let c = col; c <= col + 1; c++) {
      for(let r = 0; r <= 2; r++) {
        nums.push(getNumberAtCoord(c, r));
      }
    }
    if (nums.every(n => n !== null)) {
      addBet('SIX_LINE', nums.join(','));
    }
  };

  return (
    <div style={{ 
      background: 'rgba(15, 23, 42, 0.6)', 
      padding: '1.5rem', 
      borderRadius: '1rem',
      border: '1px solid var(--border-glow)',
      display: 'flex', 
      gap: '8px',
      overflowX: 'auto'
    }}>
      
      {/* 1. Zone du Zéro */}
      <div style={{ width: '70px', height: '196px' }}>
        <button 
          onClick={() => addBet('STRAIGHT', '0')}
          disabled={!isBettingOpen}
          style={{ 
            width: '100%', 
            height: '100%', 
            background: '#059669', 
            border: '1px solid rgba(255,255,255,0.1)', 
            color: 'white', 
            fontWeight: 'bold', 
            cursor: isBettingOpen ? 'pointer' : 'not-allowed', 
            borderRadius: '8px',
            fontSize: '1.2rem',
            opacity: isBettingOpen ? 1 : 0.5
          }}
        >
          0
        </button>
      </div>

      {/* 2. Zone Principale */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        
        <div style={{ position: 'relative', display: 'flex', gap: '8px' }}>
          
          {/* Grille (1-36) */}
          <div style={{ 
            flex: 1, 
            display: 'grid', 
            gridTemplateColumns: 'repeat(12, 1fr)', 
            gridTemplateRows: 'repeat(3, 1fr)', 
            gridAutoFlow: 'column', 
            gap: '8px' 
          }}>
            {Array.from({ length: 36 }, (_, i) => i + 1).map(num => {
              const { col, row } = getCoordOfNumber(num);
              return (
                <RouletteNumberCell 
                  key={num} 
                  num={num} 
                  col={col} 
                  row={row} 
                  addBet={addBet} 
                  isBettingOpen={isBettingOpen} 
                />
              );
            })}
          </div>

          {/* Zones pour STREET et SIX_LINE (en haut) */}
          <div style={{ position: 'absolute', top: '-12px', left: '0', width: '100%', height: '24px', pointerEvents: 'none', display: 'flex' }}>
            {Array.from({ length: 12 }).map((_, col) => (
              <div key={`col-top-${col}`} style={{ flex: 1, position: 'relative' }}>
                <div 
                  onClick={() => handleStreetBet(col)}
                  style={{ position: 'absolute', top: 0, left: '10%', width: '80%', height: '12px', background: 'rgba(255,255,0,0)', cursor: 'pointer', pointerEvents: 'auto', zIndex: 30 }}
                  className="hover-reveal"
                />
                {col < 11 && (
                  <div 
                    onClick={() => handleSixLineBet(col)}
                    style={{ position: 'absolute', top: '-4px', right: '-10px', width: '20px', height: '20px', borderRadius: '50%', background: 'rgba(255,255,0,0)', cursor: 'pointer', pointerEvents: 'auto', zIndex: 40 }}
                    className="hover-reveal"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Douzaines */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
          <button className="outside-btn" onClick={() => addBet('DOZEN', '1st')} disabled={!isBettingOpen}>1st 12</button>
          <button className="outside-btn" onClick={() => addBet('DOZEN', '2nd')} disabled={!isBettingOpen}>2nd 12</button>
          <button className="outside-btn" onClick={() => addBet('DOZEN', '3rd')} disabled={!isBettingOpen}>3rd 12</button>
        </div>

        {/* Chances Simples */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px' }}>
          <button className="outside-btn" onClick={() => addBet('HALF', '1-18')} disabled={!isBettingOpen}>1-18</button>
          <button className="outside-btn" onClick={() => addBet('EVEN_ODD', 'EVEN')} disabled={!isBettingOpen}>EVEN</button>
          <button className="outside-btn" style={{ background: '#dc2626' }} onClick={() => addBet('COLOR', 'RED')} disabled={!isBettingOpen}>RED</button>
          <button className="outside-btn" style={{ background: '#1e293b' }} onClick={() => addBet('COLOR', 'BLACK')} disabled={!isBettingOpen}>BLACK</button>
          <button className="outside-btn" onClick={() => addBet('EVEN_ODD', 'ODD')} disabled={!isBettingOpen}>ODD</button>
          <button className="outside-btn" onClick={() => addBet('HALF', '19-36')} disabled={!isBettingOpen}>19-36</button>
        </div>
      </div>

      {/* Colonnes */}
      <div style={{ display: 'grid', gridTemplateRows: 'repeat(3, 1fr)', gap: '8px', width: '60px' }}>
        <button className="outside-btn" onClick={() => addBet('COLUMN', 'Col3')} disabled={!isBettingOpen}>2:1</button>
        <button className="outside-btn" onClick={() => addBet('COLUMN', 'Col2')} disabled={!isBettingOpen}>2:1</button>
        <button className="outside-btn" onClick={() => addBet('COLUMN', 'Col1')} disabled={!isBettingOpen}>2:1</button>
      </div>

      <style>{`
        .outside-btn {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          color: white;
          padding: 12px 0;
          font-weight: bold;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
          font-size: 0.9rem;
        }
        .outside-btn:hover:not(:disabled) {
          background: rgba(255,255,255,0.15);
          border-color: var(--accent-primary);
        }
        .outside-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .hover-reveal:hover {
          background: rgba(255, 255, 0, 0.3) !important;
          box-shadow: 0 0 10px rgba(255, 255, 0, 0.5);
        }
      `}</style>
    </div>
  );
};

export default BettingGrid;
