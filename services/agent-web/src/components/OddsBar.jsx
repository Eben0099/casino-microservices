import React from 'react';

export const BET_MODES = [
  { id: 'STRAIGHT', label: 'Plein',         mult: 36 },
  { id: 'SPLIT',    label: 'Cheval',        mult: 18 },
  { id: 'STREET',   label: 'Transversale',  mult: 12 },
  { id: 'CORNER',   label: 'Carré',         mult: 9  },
  { id: 'SIX_LINE', label: 'Sixain',        mult: 6  },
  { id: 'COLUMN',   label: 'Colonne',       mult: 3  },
  { id: 'DOZEN',    label: 'Douzaine',      mult: 3  },
  { id: 'COLOR',    label: 'Couleur',       mult: 2  },
  { id: 'EVEN_ODD', label: 'Pair / Impair', mult: 2  },
  { id: 'HALF',     label: 'Manque / Passe',mult: 2  },
];

const Pill = ({ active, accent = 'var(--accent)', onClick, children, sub }) => (
  <button
    onClick={onClick}
    style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '6px 12px', borderRadius: 999,
      background: active ? accent : 'var(--bg-tile)',
      color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)',
      border: '1px solid ' + (active ? accent : 'var(--border-subtle)'),
      fontSize: 12, fontWeight: 700,
      cursor: 'pointer', whiteSpace: 'nowrap',
      transition: 'all 0.12s',
      letterSpacing: '0.02em',
    }}
  >
    {children}
    {sub && (
      <span style={{
        padding: '2px 7px', borderRadius: 999,
        background: active ? 'rgba(0,0,0,0.18)' : 'var(--bg-elevated)',
        color: active ? 'var(--text-on-accent)' : 'var(--accent)',
        fontSize: 11, fontWeight: 800,
        letterSpacing: '0.02em',
      }}>
        {sub}
      </span>
    )}
  </button>
);

const OddsBar = ({ value, onChange }) => {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 14px', borderRadius: 10,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        overflowX: 'auto', flexWrap: 'nowrap',
      }}
    >
      <span style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
        textTransform: 'uppercase', color: 'var(--text-muted)',
        whiteSpace: 'nowrap', marginRight: 4,
      }}>
        Cotes
      </span>

      <Pill active={!value} onClick={() => onChange(null)}>
        Tous
      </Pill>

      <span style={{
        width: 1, alignSelf: 'stretch',
        background: 'var(--border-subtle)', margin: '0 2px',
      }} />

      {BET_MODES.map(m => (
        <Pill
          key={m.id}
          active={value === m.id}
          onClick={() => onChange(value === m.id ? null : m.id)}
          sub={`x${m.mult}`}
        >
          {m.label}
        </Pill>
      ))}
    </div>
  );
};

export default OddsBar;
