import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Users, Receipt, Settings, LogOut, TrendingUp, UserCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

function Dashboard() {
    const navigate = useNavigate();
    const [stats, setStats] = useState({ totalWager: 0, totalPayout: 0, ticketsValidated: 0, activeAgents: 0 });
    const [performance, setPerformance] = useState([]);
    const [rouletteHistory, setRouletteHistory] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStats = async () => {
            const adminKey = localStorage.getItem('admin_key');
            if (!adminKey) return;
            try {
                const config = { headers: { 'x-api-key': adminKey } };

                const [ticketRes, agentRes, perfRes, allAgentsRes, historyRes] = await Promise.all([
                    axios.get('/api/tickets/admin/stats', config),
                    axios.get('/api/agents/admin/stats', config),
                    axios.get('/api/tickets/admin/agents-performance', config).catch(() => ({ data: [] })),
                    axios.get('/api/agents', config).catch(() => ({ data: [] })),
                    axios.get('/api/roulette/admin/history', config).catch(() => ({ data: [] }))
                ]);

                setStats({
                    totalWager: ticketRes.data.total_wager || 0,
                    totalPayout: ticketRes.data.total_payout || 0,
                    ticketsValidated: ticketRes.data.tickets_validated || 0,
                    activeAgents: agentRes.data.active_agents || 0
                });

                // Mapping Agent IDs to Names
                const agentsList = allAgentsRes.data || [];
                const perfData = (perfRes.data || []).map(p => {
                    const agentInfo = agentsList.find(a => String(a.id) === p.agent_id);
                    return { ...p, agent_name: agentInfo ? agentInfo.display_name : "Agent Inconnu" };
                });
                setPerformance(perfData);

                setRouletteHistory(historyRes.data || []);

            } catch (err) {
                console.error("Erreur de chargement des statistiques", err);
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, []);

    const handleLogout = () => {
        localStorage.removeItem('admin_key');
        navigate('/login');
    };

    return (
        <div
            className="min-h-screen bg-casino-dark bg-cover bg-center bg-no-repeat flex overflow-hidden font-body"
            style={{ backgroundImage: "url('https://images.unsplash.com/photo-1596838132731-3301c3fd4317?q=80&w=2070&auto=format&fit=crop')" }}
        >
            {/* Background Overlay */}
            <div className="absolute inset-0 bg-casino-dark/80 backdrop-blur-sm z-0"></div>

            {/* Sidebar */}
            <aside className="relative z-10 w-64 bg-casino-card/50 border-r border-white/5 flex flex-col backdrop-blur-md">
                <div className="p-6 border-b border-white/5">
                    <h1 className="text-2xl font-bold tracking-wider text-white font-title">
                        AGD <span className="text-casino-accent">ADMIN</span>
                    </h1>
                </div>

                <nav className="flex-1 p-4 space-y-2">
                    <button onClick={() => navigate('/dashboard')} className="w-full flex items-center gap-3 px-4 py-3 bg-casino-accent/10 text-casino-accent rounded-xl transition-colors border border-casino-accent/20 font-medium">
                        <LayoutDashboard size={20} />
                        <span>Tableau de bord</span>
                    </button>
                    <button onClick={() => navigate('/agents')} className="w-full flex items-center gap-3 px-4 py-3 text-slate-300 hover:bg-white/5 hover:text-white rounded-xl transition-colors font-medium">
                        <Users size={20} />
                        <span>Caissiers</span>
                    </button>
                    <button className="w-full flex items-center gap-3 px-4 py-3 text-slate-300 hover:bg-white/5 hover:text-white rounded-xl transition-colors font-medium">
                        <Receipt size={20} />
                        <span>Transactions</span>
                    </button>
                </nav>

                <div className="p-4 border-t border-white/5">
                    <button onClick={handleLogout} className="flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-red-400 w-full rounded-xl transition-colors font-medium">
                        <LogOut size={20} />
                        <span>Déconnexion</span>
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="relative z-10 flex-1 p-8 overflow-y-auto">
                <header className="flex justify-between items-center mb-10">
                    <div>
                        <h2 className="text-3xl font-bold text-white font-title uppercase tracking-wider">Vue d'ensemble</h2>
                        <p className="text-slate-400 text-sm mt-1">Bienvenue dans votre centre de contrôle</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="text-right">
                            <p className="text-sm font-medium text-white capitalize tracking-tighter">Super Admin</p>
                            <p className="text-xs text-casino-accent font-medium capitalize tracking-widest">Connecté</p>
                        </div>
                        <div className="w-12 h-12 rounded-2xl flex items-center justify-center border border-white/5 hover:bg-white/5 transition-colors group">
                            <Settings size={22} className="text-slate-400 group-hover:text-white transition-colors" />
                        </div>
                    </div>
                </header>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                    <div className="bg-casino-card/60 backdrop-blur-md border border-white/5 p-8 rounded-3xl shadow-2xl transition-all hover:scale-[1.02] group">
                        <div className="flex justify-between items-start mb-4">
                            <div className="flex items-center justify-center text-emerald-400 group-hover:scale-110 transition-transform">
                                <TrendingUp size={28} />
                            </div>
                            <span className="text-xs font-bold text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded-full">+12%</span>
                        </div>
                        <p className="text-slate-400 text-xs font-medium capitalize tracking-widest mb-1">Chiffre d'Affaires</p>
                        <p className="text-4xl font-bold text-white font-title tracking-tighter">
                            {loading ? "..." : stats.totalWager} <span className="text-sm font-normal text-slate-500">XAF</span>
                        </p>
                    </div>

                    <div className="bg-casino-card/60 backdrop-blur-md border border-white/5 p-8 rounded-3xl shadow-2xl transition-all hover:scale-[1.02] group relative overflow-hidden">
                        <div className="absolute -right-4 -top-4 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl"></div>
                        <div className="flex justify-between items-start mb-4 relative z-10">
                            <div className="flex items-center justify-center text-emerald-300 group-hover:scale-110 transition-transform">
                                <TrendingUp size={28} />
                            </div>
                        </div>
                        <p className="text-slate-400 text-xs font-medium capitalize tracking-widest mb-1 relative z-10">Profitabilité (GGR)</p>
                        <p className="text-4xl font-bold text-emerald-400 font-title tracking-tighter relative z-10">
                            {loading ? "..." : (stats.totalWager - stats.totalPayout)} <span className="text-sm font-normal text-emerald-500/50">XAF</span>
                        </p>
                    </div>

                    <div className="bg-casino-card/60 backdrop-blur-md border border-white/5 p-8 rounded-3xl shadow-2xl transition-all hover:scale-[1.02] group">
                        <div className="flex justify-between items-start mb-4">
                            <div className="flex items-center justify-center text-casino-accent group-hover:scale-110 transition-transform">
                                <Receipt size={28} />
                            </div>
                        </div>
                        <p className="text-slate-400 text-xs font-medium capitalize tracking-widest mb-1">Tickets Validés</p>
                        <p className="text-4xl font-bold text-white font-title tracking-tighter">{loading ? "..." : stats.ticketsValidated}</p>
                    </div>

                    <div className="bg-casino-card/60 backdrop-blur-md border border-white/5 p-8 rounded-3xl shadow-2xl transition-all hover:scale-[1.02] group">
                        <div className="flex justify-between items-start mb-4">
                            <div className="flex items-center justify-center text-blue-400 group-hover:scale-110 transition-transform">
                                <UserCheck size={28} />
                            </div>
                        </div>
                        <p className="text-slate-400 text-xs font-medium capitalize tracking-widest mb-1">Caissiers Actifs</p>
                        <p className="text-4xl font-bold text-white font-title tracking-tighter">{loading ? "..." : stats.activeAgents}</p>
                    </div>
                </div>

                {/* Advanced Data Tables */}
                <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Roulette Activity */}
                    <div className="bg-casino-card/60 backdrop-blur-md border border-white/5 p-8 rounded-3xl shadow-2xl">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold text-white font-title uppercase">Activité de la Roulette</h3>
                            <div className="flex items-center gap-2 text-xs font-medium text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full">
                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                                EN LIGNE
                            </div>
                        </div>
                        {loading ? (
                            <p className="text-slate-500 text-sm">Chargement des tirages...</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className="border-b border-white/5">
                                            <th className="pb-3 text-xs font-medium text-slate-400 capitalize">Round ID</th>
                                            <th className="pb-3 text-xs font-medium text-slate-400 capitalize">Statut</th>
                                            <th className="pb-3 text-xs font-medium text-slate-400 capitalize">Gagnant</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {rouletteHistory.map((round, idx) => (
                                            <tr key={idx} className="hover:bg-white/5 transition-colors">
                                                <td className="py-3 text-sm text-slate-300 font-mono">{round.round_id.replace('ROUND-', '#')}</td>
                                                <td className="py-3">
                                                    <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 text-[10px] font-medium rounded-full uppercase">Terminé</span>
                                                </td>
                                                <td className="py-3 text-white font-bold">{round.winning_number}</td>
                                            </tr>
                                        ))}
                                        {rouletteHistory.length === 0 && (
                                            <tr>
                                                <td colSpan="3" className="py-4 text-center text-slate-500 text-sm">Aucun historique disponible.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* Agent Performance */}
                    <div className="bg-casino-card/60 backdrop-blur-md border border-white/5 p-8 rounded-3xl shadow-2xl">
                        <h3 className="text-xl font-bold text-white font-title uppercase mb-6">Performance Agents (Top 5)</h3>
                        {loading ? (
                            <p className="text-slate-500 text-sm">Chargement des performances...</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className="border-b border-white/5">
                                            <th className="pb-3 text-xs font-medium text-slate-400 capitalize">Caissier</th>
                                            <th className="pb-3 text-xs font-medium text-slate-400 capitalize">Tickets</th>
                                            <th className="pb-3 text-xs font-medium text-slate-400 capitalize">Volume (XAF)</th>
                                            <th className="pb-3 text-xs font-medium text-slate-400 capitalize">Gains Payés</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {performance.map((perf, idx) => (
                                            <tr key={idx} className="hover:bg-white/5 transition-colors">
                                                <td className="py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-full bg-casino-accent/20 flex items-center justify-center text-casino-accent text-xs font-bold border border-casino-accent/30">
                                                            {idx + 1}
                                                        </div>
                                                        <span className="text-white font-medium text-sm">{perf.agent_name}</span>
                                                    </div>
                                                </td>
                                                <td className="py-4 text-sm text-slate-300 font-medium">{perf.tickets_sold}</td>
                                                <td className="py-4 text-sm text-emerald-400 font-bold">{perf.volume}</td>
                                                <td className="py-4 text-sm text-red-400 font-medium">{perf.payouts}</td>
                                            </tr>
                                        ))}
                                        {performance.length === 0 && (
                                            <tr>
                                                <td colSpan="4" className="py-4 text-center text-slate-500 text-sm">Aucune activité enregistrée.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}

export default Dashboard;
