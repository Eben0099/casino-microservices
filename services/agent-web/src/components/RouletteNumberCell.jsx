// services/agent-web/src/components/RouletteNumberCell.jsx
import React from 'react';
import { RED_NUMBERS, getNumberAtCoord } from './RouletteHelpers';

const RouletteNumberCell = ({ num, col, row, addBet, isBettingOpen }) => {
  const isRed = RED_NUMBERS.includes(num);
  
  // Générer la cible d'un pari "À cheval" (Split) vers la droite
  const getRightSplitTarget = () => {
    const neighbor = getNumberAtCoord(col + 1, row);
    return neighbor ? `${num},${neighbor}` : null;
  };

  // Générer la cible d'un pari "À cheval" (Split) vers le haut (numéros plus petits dans la grille)
  const getTopSplitTarget = () => {
    const neighbor = getNumberAtCoord(col, row - 1);
    return neighbor ? `${num},${neighbor}` : null;
  };

  // Générer la cible d'un pari "Carré" (Corner) sur l'intersection en haut à droite
  const getTopRightCornerTarget = () => {
    const nRight = getNumberAtCoord(col + 1, row);
    const nTop = getNumberAtCoord(col, row - 1);
    const nCorner = getNumberAtCoord(col + 1, row - 1);
    if (nRight && nTop && nCorner) {
      return `${num},${nTop},${nRight},${nCorner}`;
    }
    return null;
  };

  const handleComplexBet = (e, type, target) => {
    if (!target) return;
    e.stopPropagation(); 
    addBet(type, target);
  };

  const splitR = getRightSplitTarget();
  const splitT = getTopSplitTarget();
  const cornerTR = getTopRightCornerTarget();

  return (
    <div style={{ position: 'relative', height: '60px' }}>
      {/* Le bouton du numéro Plein (Straight) */}
      <button 
        onClick={() => addBet('STRAIGHT', num.toString())}
        disabled={!isBettingOpen}
        style={{
          width: '100%',
          height: '100%',
          background: isRed ? '#dc2626' : '#1e293b',
          border: '1px solid rgba(255,255,255,0.1)',
          color: '#fff',
          fontWeight: 'bold',
          cursor: isBettingOpen ? 'pointer' : 'not-allowed',
          borderRadius: '4px',
          fontSize: '1.1rem'
        }}
      >
        {num}
      </button>

      {/* ZONES INVISIBLES POUR PARIS COMPLEXES */}
      {isBettingOpen && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          
          {/* À CHEVAL (Split) Horizontal : Zone sur la ligne verticale de droite */}
          {splitR && (
            <div 
              onClick={(e) => handleComplexBet(e, 'SPLIT', splitR)}
              style={{
                position: 'absolute', top: '10%', right: '-5px', width: '10px', height: '80%',
                background: 'rgba(255,255,0,0)', 
                cursor: 'pointer', pointerEvents: 'auto', zIndex: 10
              }}
              className="hover-reveal"
            />
          )}

          {/* À CHEVAL (Split) Vertical : Zone sur la ligne horizontale du haut */}
          {splitT && (
            <div 
              onClick={(e) => handleComplexBet(e, 'SPLIT', splitT)}
              style={{
                position: 'absolute', top: '-5px', left: '10%', width: '80%', height: '10px',
                background: 'rgba(255,255,0,0)',
                cursor: 'pointer', pointerEvents: 'auto', zIndex: 10
              }}
              className="hover-reveal"
            />
          )}

          {/* CARRÉ (Corner) : Zone à l'intersection en haut à droite */}
          {cornerTR && (
            <div 
              onClick={(e) => handleComplexBet(e, 'CORNER', cornerTR)}
              style={{
                position: 'absolute', top: '-8px', right: '-8px', width: '16px', height: '16px',
                background: 'rgba(255,255,0,0)',
                borderRadius: '50%', cursor: 'pointer', pointerEvents: 'auto', zIndex: 20
              }}
              className="hover-reveal"
            />
          )}
        </div>
      )}
    </div>
  );
};

export default RouletteNumberCell;
