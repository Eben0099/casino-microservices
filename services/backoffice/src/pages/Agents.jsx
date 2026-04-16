import React from 'react';
import { LayoutDashboard, Users, Receipt, Settings, LogOut, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

function Agents() {
    const navigate = useNavigate();

    const handleLogout = () => {
        localStorage.removeItem('admin_key');
        navigate('/login');
    };

    return (
        <div
            className="min-h-screen bg-casino-dark bg-cover bg-center bg-no-repeat flex overflow-hidden font-body"
            style={{ backgroundImage: "url('https://images.unsplash.com/photo-1596838132731-3301c3fd4317?q=80&w=2070&auto=format&fit=crop')" }}
        >
            <div className="absolute inset-0 bg-casino-dark/80 backdrop-blur-sm z-0"></div>

            {/* Sidebar */}
            <aside className="relative z-10 w-64 bg-casino-card/50 border-r border-white/5 flex flex-col backdrop-blur-md">
                <div className="p-6 border-b border-white/5">
                    <h1 className="text-2xl font-bold tracking-wider text-white font-title">
                        AGD <span className="text-casino-accent">ADMIN</span>
                    </h1>
                </div>

                <nav className="flex-1 p-4 space-y-2">
                    <button onClick={() => navigate('/dashboard')} className="w-full flex items-center gap-3 px-4 py-3 text-slate-300 hover:bg-white/5 hover:text-white rounded-xl transition-colors font-medium">
                        <LayoutDashboard size={20} />
                        <span>Tableau de bord</span>
                    </button>
                    <button onClick={() => navigate('/agents')} className="w-full flex items-center gap-3 px-4 py-3 bg-casino-accent/10 text-casino-accent rounded-xl transition-colors border border-casino-accent/20 font-medium">
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
                        <h2 className="text-3xl font-bold text-white font-title uppercase tracking-wider">Gestion des Caissiers</h2>
                        <p className="text-slate-400 text-sm mt-1 font-light">Gérez vos agents et leurs habilitations</p>
                    </div>
                    <button className="bg-casino-accent hover:bg-orange-400 text-casino-dark px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-casino-accent/10 transition-all uppercase">
                        <Plus size={20} />
                        NOUVEAU CAISSIER
                    </button>
                </header>

                <div className="bg-casino-card/60 backdrop-blur-md border border-white/5 rounded-3xl shadow-2xl overflow-hidden">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="border-b border-white/5 bg-white/5">
                                <th className="px-6 py-4 text-xs font-medium text-slate-400 capitalize tracking-widest font-body">Nom de l'Agent</th>
                                <th className="px-6 py-4 text-xs font-medium text-slate-400 capitalize tracking-widest font-body">Rôle</th>
                                <th className="px-6 py-4 text-xs font-medium text-slate-400 capitalize tracking-widest font-body">Solde Caisse</th>
                                <th className="px-6 py-4 text-xs font-medium text-slate-400 capitalize tracking-widest font-body">Dernière Connexion</th>
                                <th className="px-6 py-4 text-xs font-medium text-slate-400 capitalize tracking-widest font-body">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            <tr className="hover:bg-white/5 transition-colors group">
                                <td className="px-6 py-6">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 flex items-center justify-center text-casino-accent font-bold group-hover:scale-110 transition-transform border border-white/5 rounded-lg">AA</div>
                                        <div>
                                            <p className="text-white font-bold">Admin Agent</p>
                                            <p className="text-xs text-slate-500">+237 ...</p>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-6">
                                    <span className="px-2 py-1 bg-blue-500/10 text-blue-400 text-[10px] font-medium rounded-full capitalize tracking-tighter">Administrateur</span>
                                </td>
                                <td className="px-6 py-6 font-bold text-white">50,000 XAF</td>
                                <td className="px-6 py-6 text-slate-400 text-sm italic">Il y a 5 min</td>
                                <td className="px-6 py-6">
                                    <button className="text-casino-accent hover:text-white transition-colors text-sm font-medium capitalize tracking-widest">Détails</button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                    <div className="p-10 text-center text-slate-500">
                        <p>Aucun autre agent enregistré pour le moment.</p>
                    </div>
                </div>
            </main>
        </div>
    );
}

export default Agents;
