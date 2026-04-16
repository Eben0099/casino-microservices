import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, User, Shield } from 'lucide-react';

function Login() {
    const [apiKey, setApiKey] = useState('');
    const navigate = useNavigate();

    const handleLogin = (e) => {
        e.preventDefault();
        // Pour l'instant, on stocke juste la clé admin en local
        if (apiKey === 'CleSuperSecreteBackoffice2026') {
            localStorage.setItem('admin_key', apiKey);
            navigate('/dashboard');
        } else {
            alert('Clé API invalide');
        }
    };

    return (
        <div
            className="min-h-screen bg-casino-dark bg-cover bg-center flex items-center justify-center p-4 font-body"
            style={{ backgroundImage: "url('https://images.unsplash.com/photo-1596838132731-3301c3fd4317?q=80&w=2070&auto=format&fit=crop')" }}
        >
            <div className="absolute inset-0 bg-casino-dark/80 backdrop-blur-sm"></div>

            <div className="relative z-10 w-full max-w-md">
                <div className="bg-casino-card/60 backdrop-blur-xl border border-white/10 p-8 rounded-3xl shadow-2xl">
                    <div className="text-center mb-8">
                        <h1 className="text-4xl font-bold font-title text-white tracking-widest uppercase mb-2">
                            AGD <span className="text-casino-accent">Admin</span>
                        </h1>
                        <p className="text-slate-400">Identification requise</p>
                    </div>

                    <form onSubmit={handleLogin} className="space-y-6">
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-slate-400 capitalize tracking-widest ml-1">Clé API Administrateur</label>
                            <div className="relative group">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500 group-focus-within:text-casino-accent transition-colors">
                                    <Lock size={18} />
                                </div>
                                <input
                                    type="password"
                                    value={apiKey}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 text-white pl-11 pr-4 py-4 rounded-xl focus:outline-none focus:border-casino-accent/50 focus:bg-white/10 transition-all"
                                    placeholder="Saisissez votre clé secrète..."
                                    required
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            className="w-full bg-casino-accent hover:bg-orange-400 text-casino-dark font-bold py-4 rounded-xl shadow-lg shadow-casino-accent/20 transition-all hover:-translate-y-0.5"
                        >
                            SE CONNECTER
                        </button>
                    </form>

                    <p className="text-center text-slate-500 text-xs mt-8 capitalize tracking-tighter">
                        Accès réservé au personnel autorisé
                    </p>
                </div>
            </div>
        </div>
    );
}

export default Login;
