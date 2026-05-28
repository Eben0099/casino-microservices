import React, { useState } from 'react';
import { useT } from '../i18n';

/**
 * KenoGrid — an 8×10 grid of toggleable number buttons (1..80).
 *
 * Controlled: parent owns `picks` (array of ints) and `onToggle(n)`.
 * The component enforces `maxSpots` — toggling a new number when the
 * limit is reached is a no-op (visual hint: button dims + cursor
 * not-allowed).
 *
 * When `isBettingOpen` is false the entire grid is disabled; picks
 * can still be read by the parent but no interaction is possible.
 *
 * Props
 * -----
 * picks          int[]      Currently selected numbers (controlled).
 * onToggle       (n) => void  Called when the user clicks a number.
 * maxSpots       number     Maximum picks allowed (default 10, range 1..11).
 * isBettingOpen  boolean    Whether betting is currently open.
 * drawnNumbers   int[]|null Last draw result — shown as a highlight overlay.
 */

// Paytable from §6.3 of the plan.  Used for the max-gain preview chip.
// KENO_PAYTABLE[spots][matches] = multiplier (0 = no payout)
// Paytable VOLK officielle (cf. services/ticket-service/app/keno_rules.py).
// Tenir les deux en phase : le backend règle, le front sert juste à calculer
// le gain max affichable dans la grille (cf. maxMultiplier).
const KENO_PAYTABLE = [
  [],                                                     // index 0 unused
  [0, 3],                                                 // spots 1
  [0, 1, 5],                                              // spots 2
  [0, 0, 3, 25],                                          // spots 3
  [0, 0, 1, 4, 100],                                      // spots 4
  [0, 0, 0, 2, 20, 450],                                  // spots 5
  [0, 0, 0, 1, 7, 50, 1600],                              // spots 6
  [0, 0, 0, 1, 3, 20, 100, 5000],                         // spots 7
  [0, 0, 0, 0, 2, 10, 50, 1000, 15000],                   // spots 8
  [0, 0, 0, 0, 1, 5, 25, 200, 4000, 40000],               // spots 9
  [2, 0, 0, 0, 1, 2, 20, 80, 500, 10000, 100000],         // spots 10
  [2, 0, 0, 0, 0, 1, 10, 50, 250, 1500, 15000, 500000],   // spots 11
];

/**
 * Compute the theoretical max multiplier for a given spots count.
 * That is the last (highest) non-zero multiplier in the row.
 */
const maxMultiplier = (spots) => {
  const row = KENO_PAYTABLE[spots];
  if (!row) return 0;
  for (let i = row.length - 1; i >= 0; i--) {
    if (row[i] > 0) return row[i];
  }
  return 0;
};

const KenoGrid = ({
  picks = [],
  onToggle,
  maxSpots = 10,
  isBettingOpen = true,
  drawnNumbers = null,
}) => {
  const { t, fmtN } = useT();
  const [hovered, setHovered] = useState(null);

  const picksSet = new Set(picks);
  const drawnSet = new Set(drawnNumbers || []);
  const atMax = picks.length >= maxSpots;

  const handleClick = (n) => {
    if (!isBettingOpen) return;
    if (!picksSet.has(n) && atMax) return; // can't add more
    onToggle(n);
  };

  // Max-gain preview based on current picks count and best paytable row
  const mult = maxMultiplier(picks.length);

  const ROWS = 8;
  const COLS = 10;

  return (
    <div>
      {/* Pick counter + max-gain hint */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 10,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: 'var(--text-muted)',
          }}>
            {t('keno.spots')}
          </span>
          <span style={{
            padding: '3px 12px', borderRadius: 999,
            background: picks.length > 0 ? 'var(--accent)' : 'var(--bg-tile)',
            color: picks.length > 0 ? 'var(--text-on-accent)' : 'var(--text-secondary)',
            fontWeight: 900, fontSize: 13,
            border: picks.length > 0 ? '1.5px solid var(--accent)' : '1px solid var(--border-subtle)',
            transition: 'background 0.15s, color 0.15s',
          }}>
            {t('keno.picksCounter', { c: picks.length, max: maxSpots })}
          </span>
        </div>

        {/* Max-gain preview chip */}
        {picks.length > 0 && mult > 0 && (
          <div style={{
            fontSize: 11, fontWeight: 700, color: 'var(--success)',
            padding: '3px 10px', borderRadius: 999,
            background: 'rgba(34,197,94,0.1)',
            border: '1px solid rgba(34,197,94,0.3)',
          }}>
            ×{fmtN(mult)} max
          </div>
        )}
      </div>

      {/* 8×10 grid */}
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        padding: 14,
        opacity: isBettingOpen ? 1 : 0.7,
        transition: 'opacity 0.2s',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${COLS}, 1fr)`,
          gridTemplateRows: `repeat(${ROWS}, 1fr)`,
          gap: 5,
        }}>
          {Array.from({ length: 80 }, (_, i) => {
            const n = i + 1;
            const isPick = picksSet.has(n);
            const isDrawn = drawnSet.has(n);
            const isPickAndDrawn = isPick && isDrawn;

            // Interaction state
            const isHovered = hovered === n;
            const canSelect = isBettingOpen && (isPick || !atMax);
            const cursor = !isBettingOpen
              ? 'not-allowed'
              : isPick
                ? 'pointer'
                : atMax
                  ? 'not-allowed'
                  : 'pointer';

            // Visual priority:
            //   pick + drawn → strong green ring
            //   pick only    → accent ring
            //   drawn only   → muted blue
            //   hover + can  → subtle lift
            const bg = isPick
              ? 'var(--accent)'
              : isDrawn
                ? 'rgba(99, 179, 237, 0.18)'
                : isHovered && canSelect
                  ? 'var(--bg-elevated)'
                  : 'var(--bg-tile)';

            const border = isPickAndDrawn
              ? '2px solid var(--success)'
              : isPick
                ? '2px solid var(--accent)'
                : isDrawn
                  ? '1.5px solid rgba(99,179,237,0.6)'
                  : isHovered && canSelect
                    ? '1px solid var(--border-strong)'
                    : '1px solid var(--border-subtle)';

            const color = isPick
              ? 'var(--text-on-accent)'
              : 'var(--text-primary)';

            const opacity = !isBettingOpen ? 0.6 : (!isPick && atMax) ? 0.4 : 1;

            return (
              <button
                key={n}
                onClick={() => handleClick(n)}
                onMouseEnter={() => isBettingOpen && setHovered(n)}
                onMouseLeave={() => setHovered(null)}
                disabled={!isBettingOpen || (!isPick && atMax)}
                aria-pressed={isPick}
                aria-label={`${n}`}
                style={{
                  // Maintain a square aspect ratio; min to stay readable
                  aspectRatio: '1 / 1',
                  minWidth: 0,
                  minHeight: 28,
                  padding: 0,
                  background: bg,
                  border,
                  borderRadius: 6,
                  color,
                  fontWeight: isPick ? 900 : 700,
                  fontSize: 12,
                  cursor,
                  opacity,
                  transition: 'background 0.1s, border-color 0.1s, opacity 0.15s, transform 0.1s',
                  transform: isPick && isHovered ? 'scale(1.1)' : 'scale(1)',
                  zIndex: isPick ? 2 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: "'Outfit', sans-serif",
                  boxShadow: isPick
                    ? '0 2px 8px rgba(0,0,0,0.25)'
                    : isPickAndDrawn
                      ? '0 0 8px rgba(34,197,94,0.4)'
                      : 'none',
                }}
              >
                {n}
              </button>
            );
          })}
        </div>

        {/* Drawn-numbers annotation strip */}
        {drawnNumbers && drawnNumbers.length > 0 && (
          <div style={{
            marginTop: 10,
            padding: '6px 10px', borderRadius: 6,
            background: 'rgba(99,179,237,0.08)',
            border: '1px solid rgba(99,179,237,0.2)',
            display: 'flex', alignItems: 'center', gap: 6,
            flexWrap: 'wrap',
          }}>
            <span style={{
              fontSize: 9, fontWeight: 800, letterSpacing: '0.15em',
              textTransform: 'uppercase', color: 'rgba(99,179,237,0.8)',
              flexShrink: 0,
            }}>
              {t('keno.drawn')}
            </span>
            {[...drawnNumbers].sort((a, b) => a - b).map((n) => {
              const isMyPick = picksSet.has(n);
              return (
                <span key={n} style={{
                  fontSize: 10, fontWeight: 800, padding: '1px 5px',
                  borderRadius: 4,
                  background: isMyPick ? 'var(--success)' : 'rgba(99,179,237,0.2)',
                  color: isMyPick ? '#fff' : 'rgba(99,179,237,1)',
                  fontFamily: 'monospace',
                }}>
                  {n}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Disabled overlay hint */}
      {!isBettingOpen && (
        <div style={{
          textAlign: 'center', marginTop: 8,
          fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: 'var(--text-muted)',
        }}>
          {t('keno.drawInProgress')}
        </div>
      )}
    </div>
  );
};

export default KenoGrid;
