import React from 'react';
import { Target, RotateCcw } from 'lucide-react';

export const BET_MODES = [
  { id: 'STRAIGHT', label: 'Plein',           mult: 36 },
  { id: 'SPLIT',    label: 'Cheval',          mult: 18 },
  { id: 'STREET',   label: 'Transversale',    mult: 12 },
  { id: 'CORNER',   label: 'Carré',           mult: 9  },
  { id: 'SIX_LINE', label: 'Sixain',          mult: 6  },
  { id: 'COLUMN',   label: 'Colonne',         mult: 3  },
  { id: 'DOZEN',    label: 'Douzaine',        mult: 3  },
  { id: 'COLOR',    label: 'Couleur',         mult: 2  },
  { id: 'EVEN_ODD', label: 'Pair / Impair',   mult: 2  },
  { id: 'HALF',     label: 'Manque / Passe',  mult: 2  },
];

/* Three groups for visual breathing room — same idea as the bet slip rows */
const GROUPS = [
  { title: 'Pleins & combinaisons', ids: ['STRAIGHT', 'SPLIT', 'STREET', 'CORNER', 'SIX_LINE'] },
  { title: 'Sections',              ids: ['COLUMN', 'DOZEN'] },
  { title: 'Paris extérieurs',      ids: ['COLOR', 'EVEN_ODD', 'HALF'] },
];

const Row = ({ mode, active, onClick }) => {
  const accent = 'var(--accent)';
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px', borderRadius: 8,
        background: active ? accent : 'var(--bg-tile)',
        color: active ? 'var(--text-on-accent)' : 'var(--text-primary)',
        border: '1px solid ' + (active ? accent : 'var(--border-subtle)'),
        borderLeft: `3px solid ${active ? accent : 'transparent'}`,
        cursor: 'pointer',
        fontSize: 13, fontWeight: 700,
        transition: 'all 0.12s',
        textAlign: 'left',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-tile-hover)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-tile)'; }}
    >
      <span>{mode.label}</span>
      <span style={{
        padding: '3px 9px', borderRadius: 999,
        background: active ? 'rgba(0,0,0,0.18)' : 'var(--bg-elevated)',
        color: active ? 'var(--text-on-accent)' : accent,
        fontSize: 11, fontWeight: 800,
        letterSpacing: '0.02em',
      }}>
        x{mode.mult}
      </span>
    </button>
  );
};

const OddsTable = ({ value, onChange }) => {
  const activeMode = BET_MODES.find(m => m.id === value);

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 12,
      display: 'flex', flexDirection: 'column',
      maxHeight: 'calc(100vh - 120px)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Target size={15} style={{ color: 'var(--accent)' }} />
          <span style={{
            fontSize: 11, fontWeight: 600, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: 'var(--text-muted)',
          }}>
            Cotes & Modes
          </span>
        </div>
        {value && (
          <button
            onClick={() => onChange(null)}
            title="Réinitialiser le mode"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 8px', borderRadius: 999,
              background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              fontSize: 10, fontWeight: 700, cursor: 'pointer',
              letterSpacing: '0.05em', textTransform: 'uppercase',
            }}>
            <RotateCcw size={11} />
            Tous
          </button>
        )}
      </div>

      {/* Active mode banner */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--border-subtle)',
        background: activeMode ? 'rgba(245,158,11,0.08)' : 'transparent',
      }}>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
          color: 'var(--text-muted)', textTransform: 'uppercase',
        }}>
          Mode actif
        </div>
        <div style={{
          fontSize: 14, fontWeight: 800, marginTop: 2,
          color: activeMode ? 'var(--accent)' : 'var(--text-primary)',
        }}>
          {activeMode ? `${activeMode.label} · x${activeMode.mult}` : 'Tous les paris'}
        </div>
      </div>

      {/* Groups list */}
      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '12px',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        {GROUPS.map(group => (
          <div key={group.title}>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
              color: 'var(--text-muted)', textTransform: 'uppercase',
              marginBottom: 6, paddingLeft: 2,
            }}>
              {group.title}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {group.ids.map(id => {
                const mode = BET_MODES.find(m => m.id === id);
                if (!mode) return null;
                return (
                  <Row
                    key={id}
                    mode={mode}
                    active={value === id}
                    onClick={() => onChange(value === id ? null : id)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer hint */}
      <div style={{
        padding: '10px 14px',
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg-elevated)',
        fontSize: 11, color: 'var(--text-muted)',
        lineHeight: 1.4,
      }}>
        Cliquez sur une cote pour <span style={{ color: 'var(--accent)', fontWeight: 700 }}>verrouiller</span> uniquement les zones de ce type sur le tapis.
      </div>
    </div>
  );
};

export default OddsTable;
