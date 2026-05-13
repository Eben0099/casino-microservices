import React from 'react';
import { Target, RotateCcw } from 'lucide-react';
import { useT } from '../i18n';

export const BET_MODES = [
  { id: 'STRAIGHT',   mult: 36 },
  { id: 'MIRROR',     mult: 18 },
  { id: 'SPLIT',      mult: 18 },
  { id: 'STREET',     mult: 12 },
  { id: 'CORNER',     mult: 9  },
  { id: 'SIX_LINE',   mult: 6  },
  { id: 'SECTOR',     mult: 6  },
  { id: 'HALF_COLOR', mult: 4  },
  { id: 'COLUMN',     mult: 3  },
  { id: 'DOZEN',      mult: 3  },
  { id: 'COLOR',      mult: 2  },
  { id: 'EVEN_ODD',   mult: 2  },
  { id: 'HALF',       mult: 2  },
  { id: 'LINES',      mult: 2  },
];

// Restrict the POS to the bet types the Unity Pay Table actually exposes.
// The rest of BET_MODES stays defined so we can flip them back on later — just
// add the ID to this Set to reactivate.
export const ENABLED_BET_TYPES = new Set([
  'STRAIGHT',
  'MIRROR',
  'DOZEN',
  'COLOR',
  'EVEN_ODD',
  'HALF',
  'HALF_COLOR',
  'SECTOR',
  'LINES',
]);

/* Three groups for visual breathing room — same idea as the bet slip rows */
const GROUPS = [
  { titleKey: 'oddsTable.groups.straights', ids: ['STRAIGHT', 'MIRROR', 'SPLIT', 'STREET', 'CORNER', 'SIX_LINE'] },
  { titleKey: 'oddsTable.groups.sections',  ids: ['SECTOR', 'HALF_COLOR', 'COLUMN', 'DOZEN', 'LINES'] },
  { titleKey: 'oddsTable.groups.outside',   ids: ['COLOR', 'EVEN_ODD', 'HALF'] },
];

const Row = ({ mode, label, active, onClick }) => {
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
      <span>{label}</span>
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
  const { t } = useT();
  const activeMode = BET_MODES.find(m => m.id === value);
  const modeLabel = (id) => t(`bet.type.${id}`);

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
            {t('oddsTable.title')}
          </span>
        </div>
        {value && (
          <button
            onClick={() => onChange(null)}
            title={t('oddsTable.resetTitle')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 8px', borderRadius: 999,
              background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              fontSize: 10, fontWeight: 700, cursor: 'pointer',
              letterSpacing: '0.05em', textTransform: 'uppercase',
            }}>
            <RotateCcw size={11} />
            {t('oddsTable.all')}
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
          {t('oddsTable.activeMode')}
        </div>
        <div style={{
          fontSize: 14, fontWeight: 800, marginTop: 2,
          color: activeMode ? 'var(--accent)' : 'var(--text-primary)',
        }}>
          {activeMode ? `${modeLabel(activeMode.id)} · x${activeMode.mult}` : t('oddsTable.allBets')}
        </div>
      </div>

      {/* Groups list */}
      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '12px',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        {GROUPS.map(group => {
          const visibleIds = group.ids.filter(id => ENABLED_BET_TYPES.has(id));
          if (visibleIds.length === 0) return null;
          return (
          <div key={group.titleKey}>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
              color: 'var(--text-muted)', textTransform: 'uppercase',
              marginBottom: 6, paddingLeft: 2,
            }}>
              {t(group.titleKey)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {visibleIds.map(id => {
                const mode = BET_MODES.find(m => m.id === id);
                if (!mode) return null;
                return (
                  <Row
                    key={id}
                    mode={mode}
                    label={modeLabel(id)}
                    active={value === id}
                    onClick={() => onChange(value === id ? null : id)}
                  />
                );
              })}
            </div>
          </div>
          );
        })}
      </div>

      {/* Footer hint */}
      <div style={{
        padding: '10px 14px',
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg-elevated)',
        fontSize: 11, color: 'var(--text-muted)',
        lineHeight: 1.4,
      }}>
        {(() => {
          const hint = t('oddsTable.hint', { lock: '__LOCK__' });
          const parts = hint.split('__LOCK__');
          return (
            <>
              {parts[0]}
              <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{t('oddsTable.hintLock')}</span>
              {parts[1]}
            </>
          );
        })()}
      </div>
    </div>
  );
};

export default OddsTable;
