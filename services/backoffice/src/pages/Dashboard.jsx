import React, { useState, useEffect } from 'react';
import { TrendingUp, Receipt, UserCheck, DollarSign } from 'lucide-react';
import axios from 'axios';
import StatCard from '../components/StatCard';

function Dashboard() {
  const [stats, setStats] = useState({ totalWager: 0, totalPayout: 0, ticketsValidated: 0, activeAgents: 0 });
  const [performance, setPerformance] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      const adminKey = localStorage.getItem('admin_key');
      if (!adminKey) return;
      const config = { headers: { 'x-api-key': adminKey } };
      try {
        const [ticketRes, agentRes, perfRes, allAgentsRes] = await Promise.all([
          axios.get('/api/tickets/admin/stats', config),
          axios.get('/api/agents/admin/stats', config),
          axios.get('/api/tickets/admin/agents-performance', config).catch(() => ({ data: [] })),
          axios.get('/api/agents', config).catch(() => ({ data: [] })),
        ]);
        setStats({
          totalWager: ticketRes.data.total_wager || 0,
          totalPayout: ticketRes.data.total_payout || 0,
          ticketsValidated: ticketRes.data.tickets_validated || 0,
          activeAgents: agentRes.data.active_agents || 0,
        });
        const agentsList = allAgentsRes.data || [];
        setPerformance((perfRes.data || []).map(p => {
          const agent = agentsList.find(a => String(a.id) === p.agent_id);
          return { ...p, agent_name: agent ? agent.display_name : 'Agent Inconnu' };
        }));
      } catch (err) {
        console.error('Erreur chargement stats', err);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  const ggr = stats.totalWager - stats.totalPayout;

  return (
    <div className="animate-fade w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Vue d'ensemble</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tableau de bord global AGDTech</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={TrendingUp} label="Chiffre d'Affaires" value={loading ? '...' : stats.totalWager.toLocaleString('fr-FR')} unit="XAF" color="var(--accent)" />
        <StatCard icon={DollarSign} label="Profitabilite (GGR)" value={loading ? '...' : ggr.toLocaleString('fr-FR')} unit="XAF" color="var(--green)" trendUp={ggr > 0} trend={ggr > 0 ? 'Positif' : 'Negatif'} />
        <StatCard icon={Receipt} label="Tickets Valides" value={loading ? '...' : stats.ticketsValidated.toLocaleString('fr-FR')} color="var(--blue)" />
        <StatCard icon={UserCheck} label="Caissiers Actifs" value={loading ? '...' : stats.activeAgents} color="var(--purple)" />
      </div>

      {/* Performance Table */}
      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-sm)' }}>
        <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <h2 className="text-lg font-bold font-title" style={{ color: 'var(--text-primary)' }}>Performance Agents (Top 5)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>#</th>
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Caissier</th>
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Tickets</th>
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Volume (XAF)</th>
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Gains Payes</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="5" className="px-6 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Chargement...</td></tr>
              ) : performance.length === 0 ? (
                <tr><td colSpan="5" className="px-6 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Aucune activite enregistree.</td></tr>
              ) : performance.map((p, idx) => (
                <tr key={idx} className="transition-colors" style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td className="px-6 py-4">
                    <span className="w-7 h-7 rounded-full inline-flex items-center justify-center text-xs font-bold" style={{ background: 'var(--accent)', color: '#000' }}>{idx + 1}</span>
                  </td>
                  <td className="px-6 py-4 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{p.agent_name}</td>
                  <td className="px-6 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>{p.tickets_sold}</td>
                  <td className="px-6 py-4 text-sm font-semibold" style={{ color: 'var(--green)' }}>{(p.volume || 0).toLocaleString('fr-FR')}</td>
                  <td className="px-6 py-4 text-sm" style={{ color: 'var(--red)' }}>{(p.payouts || 0).toLocaleString('fr-FR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
