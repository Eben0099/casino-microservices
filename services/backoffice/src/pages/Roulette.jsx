import React from 'react';
import { useRouletteWs } from '../hooks/useRouletteWs';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Radio, Flame, Snowflake } from 'lucide-react';

const RED_NUMBERS = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
const getColor = (n) => n === 0 ? 'var(--roulette-green)' : RED_NUMBERS.includes(n) ? 'var(--roulette-red)' : 'var(--roulette-black)';
const getColorHex = (n) => n === 0 ? '#10b981' : RED_NUMBERS.includes(n) ? '#ef4444' : '#1e293b';
const getLabel = (n) => n === 0 ? 'Vert' : RED_NUMBERS.includes(n) ? 'Rouge' : 'Noir';

const Card = ({ title, children, className = '' }) => (
  <div className={`rounded-xl p-5 ${className}`} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-sm)' }}>
    {title && <h3 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-muted)' }}>{title}</h3>}
    {children}
  </div>
);

const NumberPill = ({ n, size = 'md', glow }) => {
  const s = size === 'lg' ? 'w-11 h-11 text-base' : size === 'sm' ? 'w-7 h-7 text-[10px]' : 'w-9 h-9 text-sm';
  return (
    <div className={`${s} rounded-full flex items-center justify-center font-bold text-white shrink-0`}
      style={{ background: getColorHex(n), boxShadow: glow ? `0 0 10px ${getColorHex(n)}66` : 'none' }}>
      {n}
    </div>
  );
};

function Roulette() {
  const { connected, phase, lastNumber, stats } = useRouletteWs();

  const phaseMap = { Betting: ['Mise en cours', 'var(--accent)'], BetsClosing: ['Fermeture', 'var(--accent)'], Spinning: ['Tirage...', 'var(--blue)'], Result: ['Resultat', 'var(--green)'] };
  const [phaseLabel, phaseColor] = phaseMap[phase] || ['Connexion...', 'var(--text-muted)'];

  const colorData = stats ? [
    { name: 'Rouge', value: stats.redPercent, fill: '#ef4444' },
    { name: 'Noir', value: stats.blackPercent, fill: '#1e293b' },
    { name: 'Vert', value: stats.greenPercent, fill: '#10b981' },
  ] : [];

  const dozensData = stats ? [
    { name: '1-12', value: stats.dozensPercents[0] },
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

  // Heatmap: frequency interpolation
  const freqs = stats?.numberFrequencies || Array(37).fill(0);
  const maxFreq = Math.max(...freqs, 1);
  const minFreq = Math.min(...freqs);

  const interpolate = (val) => {
    const ratio = maxFreq === minFreq ? 0.5 : (val - minFreq) / (maxFreq - minFreq);
    const r = Math.round(245 * (1 - ratio) + 245 * ratio);
    const g = Math.round(245 * (1 - ratio) + 158 * ratio);
    const b = Math.round(245 * (1 - ratio) + 11 * ratio);
    return `rgb(${r},${g},${b})`;
  };

  return (
    <div className="animate-fade space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-title" style={{ color: 'var(--text-primary)' }}>Roulette</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Statistiques en temps reel</p>
        </div>
        <div className="flex items-center gap-4">
          {lastNumber != null && <NumberPill n={lastNumber} size="lg" glow />}
          <div className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold" style={{ background: `${phaseColor}15`, color: phaseColor, border: `1px solid ${phaseColor}30` }}>
            <div className="w-2 h-2 rounded-full" style={{ background: phaseColor, animation: phase === 'Spinning' ? 'pulse-dot 1s infinite' : 'none' }} />
            {phaseLabel}
          </div>
          <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: connected ? 'var(--green)' : 'var(--red)' }}>
            <Radio size={14} />
            {connected ? 'EN DIRECT' : 'DECONNECTE'}
          </div>
        </div>
      </div>

      {/* Last numbers strip */}
      {last20.length > 0 && (
        <Card title="Derniers numeros">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {last20.map((r, i) => <NumberPill key={i} n={r.number} />)}
          </div>
        </Card>
      )}

      {/* Charts row: Colors + Even/Odd + High/Low */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card title="Couleurs">
            <div className="flex items-center justify-center" style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={colorData} dataKey="value" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} strokeWidth={0}>
                    {colorData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Pie>
                  <Tooltip formatter={(v) => `${v.toFixed(1)}%`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-4 mt-2">
              {colorData.map(d => (
                <div key={d.name} className="flex items-center gap-1.5 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: d.fill }} />
                  <span style={{ color: 'var(--text-secondary)' }}>{d.name} {d.value.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Pair / Impair">
            <div className="space-y-4 pt-4">
              {[['Pair', stats.evenPercent, 'var(--chart-2)'], ['Impair', stats.oddPercent, 'var(--chart-4)']].map(([l, v, c]) => (
                <div key={l}>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span style={{ color: 'var(--text-secondary)' }}>{l}</span>
                    <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{v.toFixed(1)}%</span>
                  </div>
                  <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${v}%`, background: c }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Haut / Bas">
            <div className="space-y-4 pt-4">
              {[['Haut (19-36)', stats.highPercent, 'var(--chart-3)'], ['Bas (1-18)', stats.lowPercent, 'var(--chart-1)']].map(([l, v, c]) => (
                <div key={l}>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span style={{ color: 'var(--text-secondary)' }}>{l}</span>
                    <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{v.toFixed(1)}%</span>
                  </div>
                  <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${v}%`, background: c }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Dozens + Columns */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card title="Douzaines">
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dozensData} barSize={40}>
                  <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 50]} />
                  <Tooltip formatter={(v) => `${v.toFixed(1)}%`} />
                  <Bar dataKey="value" fill="var(--chart-1)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="Colonnes">
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={columnsData} barSize={40}>
                  <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 50]} />
                  <Tooltip formatter={(v) => `${v.toFixed(1)}%`} />
                  <Bar dataKey="value" fill="var(--chart-2)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {/* Hot & Cold */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Flame size={16} style={{ color: 'var(--accent)' }} />
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>Numeros Chauds</span>
            </div>
            <div className="flex gap-2">
              {(stats.hotNumbers || []).map((n, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <NumberPill n={n} glow />
                  <span className="text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>{freqs[n]}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Snowflake size={16} style={{ color: 'var(--blue)' }} />
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--blue)' }}>Numeros Froids</span>
            </div>
            <div className="flex gap-2">
              {(stats.coldNumbers || []).map((n, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <NumberPill n={n} />
                  <span className="text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>{freqs[n]}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Frequency heatmap */}
      {stats && (
        <Card title="Frequences des numeros">
          <div className="grid grid-cols-10 gap-1.5">
            {freqs.map((freq, n) => (
              <div key={n} className="relative group">
                <div
                  className="aspect-square rounded-lg flex flex-col items-center justify-center cursor-default transition-transform hover:scale-110"
                  style={{ background: interpolate(freq), color: freq > (maxFreq * 0.6) ? '#000' : 'var(--text-primary)' }}
                >
                  <span className="text-xs font-bold">{n}</span>
                  <span className="text-[9px] opacity-70">{freq}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* History table */}
      {last50.length > 0 && (
        <Card title={`Historique (${last50.length} derniers)`}>
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-left">
              <thead className="sticky top-0" style={{ background: 'var(--bg-surface)' }}>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {['#', 'Numero', 'Couleur', 'Parite', 'Douzaine'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {last50.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{last50.length - i}</td>
                    <td className="px-4 py-2"><NumberPill n={r.number} size="sm" /></td>
                    <td className="px-4 py-2 text-sm" style={{ color: getColorHex(r.number) }}>{getLabel(r.number)}</td>
                    <td className="px-4 py-2 text-sm" style={{ color: 'var(--text-secondary)' }}>{r.number === 0 ? '-' : r.isEven ? 'Pair' : 'Impair'}</td>
                    <td className="px-4 py-2 text-sm" style={{ color: 'var(--text-secondary)' }}>{r.number === 0 ? '-' : r.number <= 12 ? '1ere' : r.number <= 24 ? '2eme' : '3eme'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* No data */}
      {!stats && (
        <Card className="text-center py-16">
          <p className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            {connected ? 'En attente des premieres statistiques...' : 'Connexion au serveur de roulette...'}
          </p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Les donnees apparaitront apres le premier tirage.
          </p>
        </Card>
      )}
    </div>
  );
}

export default Roulette;
