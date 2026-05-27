import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { useKenoWs } from '../hooks/useKenoWs';
import { BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { Radio, Flame, Snowflake, RefreshCw, TrendingUp } from 'lucide-react';

/* ─────────────  Helpers  ───────────── */

function useElementWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width || 0;
      setWidth(Math.floor(w));
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

const ChartBox = ({ height = 180, children }) => {
  const [ref, width] = useElementWidth();
  return (
    <div ref={ref} style={{ width: '100%', height }}>
      {width > 0 && children(width, height)}
    </div>
  );
};

const fmtNum = (n) => Math.round(Number(n) || 0).toLocaleString('fr-FR');

/* ─────────────  Atoms  ───────────── */

// Neutral keno chip — no red/black, uses a neutral palette scaled by optional
// frequency intensity (0..1). When `highlight` is true (last drawn) a bright
// accent ring is applied.
const KenoChip = ({ n, size = 'md', intensity = 0.5, highlight = false }) => {
  const dim = size === 'lg' ? 'w-12 h-12 text-base'
            : size === 'sm' ? 'w-7 h-7 text-[11px]'
            : 'w-9 h-9 text-sm';

  // Colour: blue range for hot (intensity near 1), grey for cold (intensity near 0)
  const alpha = 0.15 + intensity * 0.75;
  const bg = `rgba(59, 130, 246, ${alpha})`; // --blue base
  const textColor = intensity > 0.55 ? '#fff' : 'var(--text-primary)';

  return (
    <div
      className={`${dim} rounded-full flex items-center justify-center font-bold shrink-0`}
      style={{
        background: bg,
        color: textColor,
        border: highlight
          ? '2px solid var(--accent)'
          : '1px solid rgba(59,130,246,0.25)',
        boxShadow: highlight
          ? '0 0 0 2px rgba(245,158,11,0.35), 0 0 12px rgba(245,158,11,0.4)'
          : 'none',
      }}
    >
      {n}
    </div>
  );
};

const Card = ({ title, sub, children, className = '', noPad }) => (
  <div
    className={`rounded-xl ${noPad ? '' : 'p-5'} min-w-0 ${className}`}
    style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
  >
    {(title || sub) && (
      <div className={`${noPad ? 'p-5 pb-3' : 'mb-4'} flex items-center justify-between`}>
        {title && (
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>
            {title}
          </h3>
        )}
        {sub && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{sub}</span>}
      </div>
    )}
    {children}
  </div>
);

/* ─────────────  Phase status bar  ───────────── */

const PHASE_MAP = {
  idle:       ['Mises ouvertes',   'var(--green)'],
  preLaunch:  ['Fermeture des mises', 'var(--accent)'],
  draw:       ['Tirage en cours',  'var(--blue)'],
  results:    ['Résultats',        'var(--purple)'],
};

const PhaseStatus = ({ phase, connected, drawId }) => {
  const [label, color] = PHASE_MAP[phase] || ['En attente…', 'var(--text-muted)'];
  const isAnimated = phase === 'draw';
  return (
    <div
      className="flex items-center justify-between gap-4 px-5 py-4 rounded-xl"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold"
          style={{ background: `${color}1A`, color, border: `1px solid ${color}33` }}
        >
          <span
            className={isAnimated ? 'pulse-dot' : ''}
            style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: color }}
          />
          {label}
        </div>
        <div
          className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: connected ? 'var(--green)' : 'var(--red)' }}
        >
          <Radio size={12} />
          {connected ? 'En direct' : 'Déconnecté'}
        </div>
      </div>
      {drawId != null && (
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span className="font-semibold uppercase tracking-wider">Tirage</span>
          <span className="font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>#{drawId}</span>
        </div>
      )}
    </div>
  );
};

/* ─────────────  Heatmap 1–80 (10 cols × 8 rows)  ───────────── */

// Build a frequency map from stats snapshot.
// stats.hot and stats.cold are [{n, count}] arrays over the trend window.
// We reconstruct a full [1..80] count array from them, using a linear
// interpolation to assign relative intensities.
function buildFreqMap(stats) {
  if (!stats) return null;

  const freq = new Array(81).fill(0); // index 0 unused; 1..80

  // Combine hot and cold arrays — these are the entries with non-zero /
  // low counts respectively. Any number not in either list has count 0.
  const allEntries = [...(stats.hot || []), ...(stats.cold || [])];
  for (const { n, count } of allEntries) {
    if (n >= 1 && n <= 80) freq[n] = Math.max(freq[n], count);
  }

  return freq;
}

const KenoHeatmap = ({ stats, drawnNumbers }) => {
  const freq = buildFreqMap(stats);
  const drawnSet = new Set(drawnNumbers || []);

  // Compute intensity bounds
  let maxFreq = 1;
  if (freq) {
    for (let i = 1; i <= 80; i++) if (freq[i] > maxFreq) maxFreq = freq[i];
  }

  const intensityOf = (n) => {
    if (!freq) return 0.5;
    return maxFreq > 0 ? freq[n] / maxFreq : 0.5;
  };

  // Build 8 rows × 10 cols: row 0 = [1..10], row 1 = [11..20], …
  const rows = [];
  for (let row = 0; row < 8; row++) {
    const cells = [];
    for (let col = 0; col < 10; col++) {
      cells.push(row * 10 + col + 1);
    }
    rows.push(cells);
  }

  return (
    <div className="overflow-x-auto">
      {rows.map((cells, ri) => (
        <div key={ri} className="flex gap-1 mb-1">
          {cells.map((n) => {
            const intensity = intensityOf(n);
            const isDrawn = drawnSet.has(n);
            return (
              <div
                key={n}
                className="flex-1 aspect-square flex flex-col items-center justify-center rounded cursor-default select-none min-w-[28px]"
                style={{
                  background: isDrawn
                    ? 'var(--accent)'
                    : `rgba(59,130,246,${0.10 + intensity * 0.70})`,
                  border: isDrawn
                    ? '2px solid rgba(245,158,11,0.8)'
                    : '1px solid rgba(59,130,246,0.18)',
                  boxShadow: isDrawn ? '0 0 8px rgba(245,158,11,0.45)' : 'none',
                }}
                title={`Numéro ${n}${freq ? ` — ${freq[n]} fois` : ''}`}
              >
                <span
                  className="text-[10px] font-bold leading-none"
                  style={{ color: isDrawn ? '#000' : 'var(--text-primary)' }}
                >
                  {n}
                </span>
                {freq && (
                  <span
                    className="text-[7px] opacity-60 leading-none mt-[1px]"
                    style={{ color: isDrawn ? '#000' : 'var(--text-muted)' }}
                  >
                    {freq[n]}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

/* ─────────────  Hot / Cold lists  ───────────── */

const HotColdPanel = ({ stats }) => {
  if (!stats) return null;
  const hot  = (stats.hot  || []).slice(0, 6);
  const cold = (stats.cold || []).slice(0, 6);

  return (
    <Card>
      <div className="flex items-center gap-2 mb-3">
        <Flame size={14} style={{ color: 'var(--accent)' }} />
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
          Chauds
        </span>
        <span className="text-[10px] ml-auto" style={{ color: 'var(--text-muted)' }}>fenêtre 20 tirages</span>
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        {hot.map(({ n, count }) => (
          <div key={n} className="flex flex-col items-center gap-0.5">
            <KenoChip n={n} size="sm" intensity={0.85} />
            <span className="text-[9px] font-bold" style={{ color: 'var(--text-muted)' }}>{count}</span>
          </div>
        ))}
        {hot.length === 0 && (
          <span className="text-xs italic" style={{ color: 'var(--text-muted)' }}>—</span>
        )}
      </div>
      <div className="flex items-center gap-2 mb-3">
        <Snowflake size={14} style={{ color: 'var(--blue)' }} />
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--blue)' }}>
          Froids
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {cold.map(({ n, count }) => (
          <div key={n} className="flex flex-col items-center gap-0.5">
            <KenoChip n={n} size="sm" intensity={0.15} />
            <span className="text-[9px] font-bold" style={{ color: 'var(--text-muted)' }}>{count}</span>
          </div>
        ))}
        {cold.length === 0 && (
          <span className="text-xs italic" style={{ color: 'var(--text-muted)' }}>—</span>
        )}
      </div>
    </Card>
  );
};

/* ─────────────  Distribution bars  ───────────── */

const DistributionBars = ({ stats }) => {
  if (!stats) return null;

  const rowData = (stats.rowDistribution || []).map((v, i) => ({
    name: `${i * 10 + 1}–${i * 10 + 10}`,
    value: v,
  }));

  const colLabels = ['×1','×2','×3','×4','×5','×6','×7','×8','×9','×0'];
  const colData = (stats.colDistribution || []).map((v, i) => ({
    name: colLabels[i] || `c${i}`,
    value: v,
  }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card title="Distribution par lignes (dernier tirage)">
        <ChartBox height={140}>
          {(w, h) => (
            <BarChart width={w} height={h} data={rowData} barSize={18}>
              <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip formatter={(v) => [`${v}`, 'Tirés']} />
              <Bar dataKey="value" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
            </BarChart>
          )}
        </ChartBox>
      </Card>

      <Card title="Distribution par chiffre des unités (dernier tirage)">
        <ChartBox height={140}>
          {(w, h) => (
            <BarChart width={w} height={h} data={colData} barSize={18}>
              <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip formatter={(v) => [`${v}`, 'Tirés']} />
              <Bar dataKey="value" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
            </BarChart>
          )}
        </ChartBox>
      </Card>
    </div>
  );
};

/* ─────────────  Jackpot cards  ───────────── */

const JackpotBanner = ({ jackpot }) => {
  if (!jackpot) return null;
  return (
    <div className="grid grid-cols-2 gap-3 mb-4">
      <div
        className="rounded-xl p-4"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
      >
        <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--purple)' }}>
          Grand Jackpot
        </p>
        <p className="text-xl font-bold tabular-nums" style={{ color: 'var(--purple)' }}>
          {fmtNum(jackpot.generalAmount)}{' '}
          <span className="text-xs opacity-70 font-normal">XAF</span>
        </p>
      </div>
      <div
        className="rounded-xl p-4"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
      >
        <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--blue)' }}>
          Keno Jackpot
        </p>
        <p className="text-xl font-bold tabular-nums" style={{ color: 'var(--blue)' }}>
          {fmtNum(jackpot.volkenoAmount)}{' '}
          <span className="text-xs opacity-70 font-normal">XAF</span>
        </p>
      </div>
    </div>
  );
};

/* ─────────────  History table  ───────────── */

const HistoryTable = ({ recentDraws }) => {
  if (!recentDraws || recentDraws.length === 0) return null;

  // Display newest first
  const rows = [...recentDraws].reverse();

  return (
    <Card title={`Historique des tirages (${rows.length})`} noPad>
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto px-5 pb-5">
        <table className="w-full text-left">
          <thead className="sticky top-0" style={{ background: 'var(--bg-surface)' }}>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {['#', 'Tirage', 'Numéros tirés (20)', 'Heure'].map(h => (
                <th
                  key={h}
                  className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((draw, i) => (
              <tr key={draw.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td className="px-3 py-2 text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  {rows.length - i}
                </td>
                <td className="px-3 py-2 text-xs font-bold tabular-nums" style={{ color: 'var(--accent)' }}>
                  #{draw.id}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {[...(draw.numbers || [])].sort((a, b) => a - b).map(n => (
                      <span
                        key={n}
                        className="inline-block text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded"
                        style={{
                          background: 'rgba(59,130,246,0.18)',
                          color: 'var(--text-primary)',
                          border: '1px solid rgba(59,130,246,0.22)',
                        }}
                      >
                        {n}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                  {draw.time || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

/* ─────────────  Admin history fetch (REST fallback)  ───────────── */

function useAdminHistory() {
  const adminKey = localStorage.getItem('admin_key');
  const [adminDraws, setAdminDraws] = useState([]);
  const [histLoading, setHistLoading] = useState(false);

  const fetchHistory = useCallback(async () => {
    if (!adminKey) return;
    setHistLoading(true);
    try {
      const { data } = await axios.get('/api/keno/admin/history', {
        headers: { 'x-api-key': adminKey },
      });
      // Shape: { draws: [{round_id, drawn_numbers, created_at}] }
      const draws = (data.draws || []).map(d => ({
        id: d.round_id,
        numbers: [...(d.drawn_numbers || [])].sort((a, b) => a - b),
        time: d.created_at
          ? new Date(d.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false })
          : '—',
      })).reverse(); // API returns newest-first; reverse to oldest-first for table
      setAdminDraws(draws);
    } catch {
      // Silently fall back to WS stats snapshot
    } finally {
      setHistLoading(false);
    }
  }, [adminKey]);

  useEffect(() => {
    fetchHistory();
    const id = setInterval(fetchHistory, 10000);
    return () => clearInterval(id);
  }, [fetchHistory]);

  return { adminDraws, histLoading, fetchHistory };
}

/* ─────────────  Page  ───────────── */

function Keno() {
  const { connected, phase, drawId, drawnNumbers, stats, jackpot, medals } = useKenoWs();
  const { adminDraws, histLoading, fetchHistory } = useAdminHistory();

  // Prefer WS stats recentDraws when available, fall back to admin REST
  const recentDraws = stats?.recentDraws && stats.recentDraws.length > 0
    ? stats.recentDraws
    : adminDraws;

  // "Derniers tirés" — the 20 numbers of the latest completed draw,
  // displayed in draw reveal order (from drawnNumbers when in draw/results phase),
  // otherwise the last recentDraw's sorted numbers.
  const lastDrawNumbers = drawnNumbers
    || (recentDraws.length > 0 ? recentDraws[recentDraws.length - 1]?.numbers : null);

  return (
    <div className="animate-fade w-full">
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
            Keno — Vue en direct
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Suivi en temps réel du moteur VOLKENO — heatmap 1–80, historique et jackpots.
          </p>
        </div>
        <button
          onClick={fetchHistory}
          disabled={histLoading}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-secondary)',
            opacity: histLoading ? 0.6 : 1,
          }}
        >
          <RefreshCw size={14} className={histLoading ? 'animate-spin' : ''} />
          Actualiser
        </button>
      </div>

      {/* Phase status bar */}
      <div className="mb-4">
        <PhaseStatus phase={phase} connected={connected} drawId={drawId} />
      </div>

      {/* Jackpot banner */}
      <JackpotBanner jackpot={jackpot} />

      {/* Derniers tirés strip */}
      {lastDrawNumbers && lastDrawNumbers.length > 0 && (
        <Card
          title="Derniers tirés"
          sub={`${lastDrawNumbers.length} numéros${drawId ? ` — Tirage #${drawId}` : ''}`}
          className="mb-4"
        >
          <div className="flex flex-wrap gap-2 pb-1">
            {lastDrawNumbers.map((n, i) => (
              <KenoChip
                key={`${n}-${i}`}
                n={n}
                intensity={0.65}
                highlight={false}
              />
            ))}
          </div>
        </Card>
      )}

      {/* Main 2-column layout: heatmap + right panel */}
      <div className="grid gap-4" style={{ gridTemplateColumns: '1fr minmax(260px, 320px)' }}>

        {/* LEFT — Heatmap + distributions */}
        <div className="space-y-4 min-w-0">
          <Card title="Heatmap 1–80" sub="Fréquence sur 20 derniers tirages · cases en or = tirage actuel">
            {stats || drawnNumbers ? (
              <KenoHeatmap stats={stats} drawnNumbers={drawnNumbers} />
            ) : (
              <div className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
                En attente des données stats…
              </div>
            )}
          </Card>

          <DistributionBars stats={stats} />
        </div>

        {/* RIGHT — Summary + Hot/Cold */}
        <aside className="space-y-3 min-w-0">
          {/* Quick summary */}
          <Card noPad>
            <div className="px-5 py-4 flex items-center justify-between">
              <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                KENO — Live
              </div>
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {phase ? `Phase : ${phase}` : '—'}
              </div>
            </div>
          </Card>

          {/* Medals (per-kiosk; admin = global zeros) */}
          {medals && (
            <Card title="Médailles (kiosque)">
              <div className="grid grid-cols-3 gap-2">
                {[
                  ['bronze', '#b45309', 'Bronze'],
                  ['silver', '#94a3b8', 'Argent'],
                  ['gold',   '#eab308', 'Or'],
                ].map(([tier, color, label]) => (
                  <div key={tier} className="text-center">
                    <div className="text-xl font-bold tabular-nums" style={{ color }}>
                      {medals[tier] ?? 0}
                    </div>
                    <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{label}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Stats summary */}
          {stats && (
            <Card title="Aperçu rapide">
              <div className="space-y-2.5">
                <div className="flex justify-between text-xs">
                  <span style={{ color: 'var(--text-secondary)' }}>Tirages récents</span>
                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {(stats.recentDraws || []).length}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span style={{ color: 'var(--text-secondary)' }}>Numéro le + chaud</span>
                  <span className="font-semibold" style={{ color: 'var(--accent)' }}>
                    {stats.hot?.[0]?.n ?? '—'}{stats.hot?.[0] ? ` (${stats.hot[0].count})` : ''}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span style={{ color: 'var(--text-secondary)' }}>Numéro le + froid</span>
                  <span className="font-semibold" style={{ color: 'var(--blue)' }}>
                    {stats.cold?.[0]?.n ?? '—'}{stats.cold?.[0] ? ` (${stats.cold[0].count})` : ''}
                  </span>
                </div>
                {stats.consecutive && stats.consecutive.length > 0 && (
                  <div className="flex justify-between text-xs">
                    <span style={{ color: 'var(--text-secondary)' }}>Consécutif</span>
                    <span className="font-semibold" style={{ color: 'var(--purple)' }}>
                      {stats.consecutive[0].n} ({stats.consecutive[0].count}×)
                    </span>
                  </div>
                )}
              </div>
            </Card>
          )}

          <HotColdPanel stats={stats} />
        </aside>
      </div>

      {/* Full-width history table */}
      <div className="mt-4">
        <HistoryTable recentDraws={recentDraws} />
      </div>

      {/* Empty state */}
      {!stats && !lastDrawNumbers && (
        <div className="mt-4">
          <Card>
            <div className="text-center py-10">
              <TrendingUp size={32} className="mx-auto mb-3 opacity-30" style={{ color: 'var(--text-muted)' }} />
              <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                {connected ? 'En attente des premières statistiques…' : 'Connexion au moteur Keno…'}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Les données apparaîtront après le premier tirage ou la reconnexion.
              </p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

export default Keno;
