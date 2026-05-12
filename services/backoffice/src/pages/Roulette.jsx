import React, { useState, useEffect, useRef } from 'react';
import { useRouletteWs } from '../hooks/useRouletteWs';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { Radio, Flame, Snowflake } from 'lucide-react';

/* ─────────────  Helpers  ───────────── */
const RED_NUMBERS = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
const isRed = (n) => RED_NUMBERS.includes(n);
const isBlack = (n) => n !== 0 && !isRed(n);
const colorOf = (n) => n === 0 ? 'green' : isRed(n) ? 'red' : 'black';
const hexOf = (n) => n === 0 ? '#10b981' : isRed(n) ? '#ef4444' : '#1f2937';
const labelOf = (n) => n === 0 ? 'Vert' : isRed(n) ? 'Rouge' : 'Noir';

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

/* ─────────────  Atoms  ───────────── */
const NumberChip = ({ n, size = 'md', glow }) => {
  const dim = size === 'lg' ? 'w-12 h-12 text-base'
            : size === 'sm' ? 'w-7 h-7 text-[11px]'
            : 'w-9 h-9 text-sm';
  return (
    <div
      className={`${dim} rounded-full flex items-center justify-center font-bold text-white shrink-0`}
      style={{
        background: hexOf(n),
        boxShadow: glow ? `0 0 0 2px rgba(255,255,255,0.06), 0 0 16px ${hexOf(n)}99` : 'none',
      }}
    >
      {n}
    </div>
  );
};

const Card = ({ title, sub, children, className = '', noPad }) => (
  <div className={`rounded-xl ${noPad ? '' : 'p-5'} min-w-0 ${className}`}
    style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
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

/* ─────────────  Game tiles (left column)  ───────────── */
const GAMES = [
  { code: 'SW', label: 'Spin & Win',  active: true,  available: true  },
  { code: 'VK', label: 'VolKeno',     active: false, available: false },
  { code: 'S3', label: 'Super 3',     active: false, available: false },
  { code: 'CR', label: 'Crash',       active: false, available: false },
  { code: 'LO', label: 'Loto',        active: false, available: false },
];

const GameTile = ({ code, label, active, available }) => {
  const base = 'rounded-xl px-3 py-4 flex flex-col items-center gap-1 select-none transition-colors text-center';
  const styleActive = {
    background: 'var(--accent)',
    color: 'var(--text-on-accent)',
    border: '1px solid var(--accent)',
    boxShadow: '0 0 0 3px rgba(245,158,11,0.18)',
  };
  const styleIdle = {
    background: 'var(--bg-tile)',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border-subtle)',
    cursor: available ? 'pointer' : 'not-allowed',
    opacity: available ? 1 : 0.55,
  };
  return (
    <div className={base} style={active ? styleActive : styleIdle}>
      <span className={`text-lg font-black tracking-wide`} style={{ fontFamily: 'Raleway' }}>{code}</span>
      <span className={`text-[12px] font-semibold ${active ? '' : ''}`}>{label}</span>
      {!available && (
        <span className="text-[9px] font-bold tracking-widest mt-1 px-1.5 py-0.5 rounded"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
          BIENTÔT
        </span>
      )}
    </div>
  );
};

/* ─────────────  Roulette grid (european layout)  ───────────── */
/* Order on a real european table — top row: 3,6,9,…,36 ; middle: 2,5,…,35 ; bottom: 1,4,…,34 */
const buildEuropeanRows = () => {
  const rows = [[], [], []];
  for (let col = 0; col < 12; col++) {
    rows[0].push(3 + col * 3);
    rows[1].push(2 + col * 3);
    rows[2].push(1 + col * 3);
  }
  return rows;
};
const EUROPEAN_ROWS = buildEuropeanRows();

const NumberSquare = ({ n, last }) => (
  <div className="relative aspect-square min-w-0 rounded-md flex items-center justify-center text-[13px] font-bold text-white"
    style={{
      background: hexOf(n),
      border: last ? '2px solid #fff' : '1px solid rgba(255,255,255,0.06)',
      boxShadow: last ? '0 0 0 2px rgba(245,158,11,0.6), 0 0 14px rgba(245,158,11,0.5)' : 'none',
    }}>
    {n}
  </div>
);

const RouletteGrid = ({ lastNumber }) => {
  return (
    <div className="flex gap-1.5">
      {/* Zero — full height left */}
      <div className="flex-shrink-0">
        <div className="h-full w-12 rounded-md flex items-center justify-center text-base font-bold text-white"
          style={{
            background: hexOf(0),
            border: lastNumber === 0 ? '2px solid #fff' : '1px solid rgba(255,255,255,0.06)',
            boxShadow: lastNumber === 0 ? '0 0 0 2px rgba(245,158,11,0.6), 0 0 14px rgba(245,158,11,0.5)' : 'none',
            minHeight: '100%',
          }}>
          0
        </div>
      </div>

      {/* 12 columns × 3 rows */}
      <div className="grid grid-rows-3 grid-cols-12 gap-1.5 flex-1">
        {EUROPEAN_ROWS.flat().map((n) => (
          <NumberSquare key={n} n={n} last={lastNumber === n} />
        ))}
      </div>
    </div>
  );
};

const OutsideBets = () => {
  const cell = (label, color) => (
    <div className="rounded-md py-2.5 text-center text-[12px] font-bold tracking-wider"
      style={{
        background: color || 'var(--bg-tile)',
        color: color ? '#fff' : 'var(--text-secondary)',
        border: '1px solid var(--border-subtle)',
      }}>
      {label}
    </div>
  );
  return (
    <div className="grid grid-cols-6 gap-1.5">
      {cell('1-18')}
      {cell('PAIR')}
      {cell('ROUGE', '#ef4444')}
      {cell('NOIR', '#1f2937')}
      {cell('IMPAIR')}
      {cell('19-36')}
    </div>
  );
};

/* ─────────────  Live phase / status header  ───────────── */
const PhaseStatus = ({ phase, connected, lastNumber }) => {
  const phaseMap = {
    Betting: ['Mise en cours', 'var(--accent)'],
    BetsClosing: ['Fermeture des mises', 'var(--accent)'],
    Spinning: ['Tirage…', 'var(--blue)'],
    Result: ['Résultat', 'var(--green)'],
    Maintenance: ['Maintenance', 'var(--text-muted)'],
  };
  const [label, color] = phaseMap[phase] || ['En attente…', 'var(--text-muted)'];
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4 rounded-xl"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold"
          style={{ background: `${color}1A`, color, border: `1px solid ${color}33` }}>
          <span className={`w-1.5 h-1.5 rounded-full ${phase === 'Spinning' ? 'pulse-dot' : ''}`} style={{ background: color }} />
          {label}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: connected ? 'var(--green)' : 'var(--red)' }}>
          <Radio size={12} />
          {connected ? 'En direct' : 'Déconnecté'}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {lastNumber != null && (
          <>
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Dernier
            </span>
            <NumberChip n={lastNumber} size="lg" glow />
          </>
        )}
      </div>
    </div>
  );
};

/* ─────────────  Right panel — Live stats summary  ───────────── */
const SummaryRow = ({ label, value, color }) => (
  <div className="flex items-center justify-between gap-3">
    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
    <span className="text-xs font-semibold tabular-nums" style={{ color: color || 'var(--text-primary)' }}>{value}</span>
  </div>
);

const ProgressBar = ({ pct, color }) => (
  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
  </div>
);

/* ─────────────  Page  ───────────── */
function Roulette() {
  const { connected, phase, lastNumber, stats } = useRouletteWs();

  const colorData = stats ? [
    { name: 'Rouge', value: stats.redPercent,   fill: '#ef4444' },
    { name: 'Noir',  value: stats.blackPercent, fill: '#1f2937' },
    { name: 'Vert',  value: stats.greenPercent, fill: '#10b981' },
  ] : [];

  const dozensData = stats ? [
    { name: '1-12',  value: stats.dozensPercents[0] },
    { name: '13-24', value: stats.dozensPercents[1] },
    { name: '25-36', value: stats.dozensPercents[2] },
  ] : [];

  const columnsData = stats ? [
    { name: 'Col 1', value: stats.columnsPercents[0] },
    { name: 'Col 2', value: stats.columnsPercents[1] },
    { name: 'Col 3', value: stats.columnsPercents[2] },
  ] : [];

  const history = stats?.history || [];
  const last20 = history.slice(-20).reverse();
  const last50 = history.slice(-50).reverse();
  const freqs = stats?.numberFrequencies || Array(37).fill(0);
  const maxFreq = Math.max(...freqs, 1);
  const minFreq = Math.min(...freqs);
  const interpolate = (val) => {
    const ratio = maxFreq === minFreq ? 0.5 : (val - minFreq) / (maxFreq - minFreq);
    const alpha = 0.12 + ratio * 0.88;
    return `rgba(245, 158, 11, ${alpha})`;
  };

  return (
    <div className="animate-fade w-full">
      <div className="mb-5">
        <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Jeux</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sélectionnez un jeu pour visualiser son état en direct.</p>
      </div>

      {/* 3-column layout — match keno reference */}
      <div className="grid gap-5" style={{ gridTemplateColumns: 'minmax(120px, 132px) 1fr minmax(280px, 360px)' }}>
        {/* LEFT — Game selector */}
        <aside className="space-y-2">
          {GAMES.map((g) => (
            <GameTile key={g.code} {...g} />
          ))}
        </aside>

        {/* CENTER — Phase + roulette grid + outside bets + history strip */}
        <section className="space-y-4 min-w-0">
          <PhaseStatus phase={phase} connected={connected} lastNumber={lastNumber} />

          <Card title="Tapis Spin & Win — 0 à 36">
            <RouletteGrid lastNumber={lastNumber} />
            <div className="mt-2 grid grid-cols-12 gap-1.5 ml-[54px]">
              <div className="col-span-4 rounded-md py-1.5 text-center text-[11px] font-bold tracking-wider"
                style={{ background: 'var(--bg-tile)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
                1-12
              </div>
              <div className="col-span-4 rounded-md py-1.5 text-center text-[11px] font-bold tracking-wider"
                style={{ background: 'var(--bg-tile)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
                13-24
              </div>
              <div className="col-span-4 rounded-md py-1.5 text-center text-[11px] font-bold tracking-wider"
                style={{ background: 'var(--bg-tile)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
                25-36
              </div>
            </div>
            <div className="mt-3">
              <OutsideBets />
            </div>
          </Card>

          {last20.length > 0 && (
            <Card title="Derniers numéros" sub={`${last20.length} derniers`}>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {last20.map((r, i) => <NumberChip key={i} n={r.number} />)}
              </div>
            </Card>
          )}

          {stats && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card title="Couleurs">
                <ChartBox height={150}>
                  {(w, h) => (
                    <PieChart width={w} height={h}>
                      <Pie data={colorData} dataKey="value" cx="50%" cy="50%" innerRadius={36} outerRadius={60} paddingAngle={3} strokeWidth={0}>
                        {colorData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                      </Pie>
                      <Tooltip formatter={(v) => `${v.toFixed(1)}%`} />
                    </PieChart>
                  )}
                </ChartBox>
                <div className="flex justify-center flex-wrap gap-3 mt-1">
                  {colorData.map(d => (
                    <div key={d.name} className="flex items-center gap-1.5 text-[11px]">
                      <div className="w-2 h-2 rounded-full" style={{ background: d.fill }} />
                      <span style={{ color: 'var(--text-secondary)' }}>{d.name} {d.value.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </Card>

              <Card title="Douzaines">
                <ChartBox height={150}>
                  {(w, h) => (
                    <BarChart width={w} height={h} data={dozensData} barSize={32}>
                      <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} domain={[0, 50]} />
                      <Tooltip formatter={(v) => `${v.toFixed(1)}%`} />
                      <Bar dataKey="value" fill="var(--chart-1)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  )}
                </ChartBox>
              </Card>

              <Card title="Colonnes">
                <ChartBox height={150}>
                  {(w, h) => (
                    <BarChart width={w} height={h} data={columnsData} barSize={32}>
                      <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} domain={[0, 50]} />
                      <Tooltip formatter={(v) => `${v.toFixed(1)}%`} />
                      <Bar dataKey="value" fill="var(--chart-2)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  )}
                </ChartBox>
              </Card>
            </div>
          )}

          {/* Heatmap */}
          {stats && (
            <Card title="Fréquences des numéros" sub="0–36">
              <div className="grid grid-cols-[repeat(19,minmax(0,1fr))] gap-1">
                {freqs.map((freq, n) => (
                  <div key={n}
                    className="aspect-square rounded-md flex flex-col items-center justify-center cursor-default"
                    style={{ background: interpolate(freq), color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}>
                    <span className="text-[10px] font-bold leading-none">{n}</span>
                    <span className="text-[8px] opacity-70 leading-none mt-0.5">{freq}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </section>

        {/* RIGHT — Live info panel */}
        <aside className="space-y-3 min-w-0">
          {/* Header strip */}
          <Card noPad>
            <div className="px-5 py-4 flex items-center justify-between">
              <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                AGD ADMIN — Live
              </div>
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {phase ? `→ Phase ${phase}` : '—'}
              </div>
            </div>
          </Card>

          {/* Last 20 numbers grid (10 cols x 2 rows) */}
          {last20.length > 0 && (
            <Card title="20 derniers tirages">
              <div className="grid grid-cols-10 gap-1.5">
                {last20.slice(0, 20).map((r, i) => (
                  <div key={i} className="aspect-square rounded-full flex items-center justify-center text-[11px] font-bold text-white"
                    style={{ background: hexOf(r.number) }}>
                    {r.number}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Mise / commission summary */}
          {stats && (
            <Card title="Aperçu rapide">
              <div className="space-y-3">
                <SummaryRow label="Tirages enregistrés" value={history.length} />
                <SummaryRow label="Numéro le plus chaud" value={(stats.hotNumbers && stats.hotNumbers[0] != null) ? stats.hotNumbers[0] : '—'} color="var(--accent)" />
                <SummaryRow label="Numéro le plus froid" value={(stats.coldNumbers && stats.coldNumbers[0] != null) ? stats.coldNumbers[0] : '—'} color="var(--blue)" />
                <SummaryRow label="% Rouge" value={`${stats.redPercent.toFixed(1)}%`} color="#ef4444" />
                <SummaryRow label="% Noir"  value={`${stats.blackPercent.toFixed(1)}%`} />
                <SummaryRow label="% Vert"  value={`${stats.greenPercent.toFixed(1)}%`} color="#10b981" />
              </div>
            </Card>
          )}

          {/* Pair / Impair  ·  Haut / Bas */}
          {stats && (
            <Card title="Pair / Impair">
              <div className="space-y-3">
                {[['Pair', stats.evenPercent, 'var(--chart-2)'], ['Impair', stats.oddPercent, 'var(--chart-4)']].map(([l, v, c]) => (
                  <div key={l}>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span style={{ color: 'var(--text-secondary)' }}>{l}</span>
                      <span className="font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{v.toFixed(1)}%</span>
                    </div>
                    <ProgressBar pct={v} color={c} />
                  </div>
                ))}
              </div>
            </Card>
          )}

          {stats && (
            <Card title="Haut / Bas">
              <div className="space-y-3">
                {[['Haut (19-36)', stats.highPercent, 'var(--chart-3)'], ['Bas (1-18)', stats.lowPercent, 'var(--chart-1)']].map(([l, v, c]) => (
                  <div key={l}>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span style={{ color: 'var(--text-secondary)' }}>{l}</span>
                      <span className="font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{v.toFixed(1)}%</span>
                    </div>
                    <ProgressBar pct={v} color={c} />
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Hot / Cold */}
          {stats && (
            <Card>
              <div className="flex items-center gap-2 mb-3">
                <Flame size={14} style={{ color: 'var(--accent)' }} />
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>Chauds</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {(stats.hotNumbers || []).slice(0, 7).map((n, i) => (
                  <div key={i} className="flex flex-col items-center gap-0.5">
                    <NumberChip n={n} size="sm" glow />
                    <span className="text-[9px] font-bold" style={{ color: 'var(--text-muted)' }}>{freqs[n]}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-4 mb-3">
                <Snowflake size={14} style={{ color: 'var(--blue)' }} />
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--blue)' }}>Froids</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {(stats.coldNumbers || []).slice(0, 7).map((n, i) => (
                  <div key={i} className="flex flex-col items-center gap-0.5">
                    <NumberChip n={n} size="sm" />
                    <span className="text-[9px] font-bold" style={{ color: 'var(--text-muted)' }}>{freqs[n]}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </aside>
      </div>

      {/* Full-width history table */}
      {last50.length > 0 && (
        <div className="mt-5">
          <Card title={`Historique des tirages (${last50.length} derniers)`} noPad>
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto px-5 pb-5">
              <table className="w-full text-left">
                <thead className="sticky top-0" style={{ background: 'var(--bg-surface)' }}>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    {['#', 'Numéro', 'Couleur', 'Parité', 'Douzaine', 'Colonne'].map(h => (
                      <th key={h} className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {last50.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td className="px-3 py-2 text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>{last50.length - i}</td>
                      <td className="px-3 py-2"><NumberChip n={r.number} size="sm" /></td>
                      <td className="px-3 py-2 text-xs font-medium" style={{ color: hexOf(r.number) === '#1f2937' ? 'var(--text-primary)' : hexOf(r.number) }}>
                        {labelOf(r.number)}
                      </td>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {r.number === 0 ? '—' : r.isEven ? 'Pair' : 'Impair'}
                      </td>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {r.number === 0 ? '—' : r.number <= 12 ? '1ʳᵉ' : r.number <= 24 ? '2ᵉ' : '3ᵉ'}
                      </td>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {r.number === 0 ? '—' : `${((r.number - 1) % 3) + 1}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Empty state */}
      {!stats && (
        <div className="mt-5">
          <Card>
            <div className="text-center py-10">
              <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                {connected ? 'En attente des premières statistiques…' : 'Connexion au serveur de roulette…'}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Les données apparaîtront après le premier tirage.
              </p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

export default Roulette;
