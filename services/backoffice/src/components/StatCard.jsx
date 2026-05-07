import React from 'react';

const StatCard = ({ icon: Icon, label, value, unit, trend, trendUp, color = 'var(--accent)' }) => (
  <div
    className="rounded-xl p-5 transition-all duration-200 hover:translate-y-[-2px]"
    style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-sm)' }}
  >
    <div className="flex items-center justify-between mb-3">
      <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${color}18`, color }}>
        <Icon size={20} />
      </div>
      {trend && (
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${trendUp ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
          {trend}
        </span>
      )}
    </div>
    <p className="text-xs font-medium mb-1 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</p>
    <p className="text-2xl font-bold font-title" style={{ color: 'var(--text-primary)' }}>
      {value} {unit && <span className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}>{unit}</span>}
    </p>
  </div>
);

export default StatCard;
