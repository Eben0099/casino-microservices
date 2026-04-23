import React, { createContext, useContext, useState, useEffect } from 'react';
import { agentApi } from '../api/endpoints';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchBalance = async (agentId) => {
    try {
      const res = await agentApi.getDetails(agentId);
      setBalance(res.data.caisse.balance);
    } catch (err) {
      console.error("Erreur balance:", err);
    }
  };

  useEffect(() => {
    const savedUser = localStorage.getItem('agent_user');
    if (savedUser) {
      const parsedUser = JSON.parse(savedUser);
      setUser(parsedUser);
      fetchBalance(parsedUser.id);
    }
    setLoading(false);
  }, []);

  const login = async (phone, password) => {
    const res = await agentApi.login(phone, password);
    const { access_token, agent_id, agent_name } = res.data;
    
    const userData = { id: agent_id, name: agent_name, phone: phone };
    localStorage.setItem('agent_token', access_token);
    localStorage.setItem('agent_user', JSON.stringify(userData));
    
    setUser(userData);
    await fetchBalance(agent_id);
  };

  const logout = () => {
    localStorage.removeItem('agent_token');
    localStorage.removeItem('agent_user');
    setUser(null);
    setBalance(0);
  };

  return (
    <AuthContext.Provider value={{ user, balance, login, logout, fetchBalance, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
