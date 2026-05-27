import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import Layout from './components/Layout';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Agents from './pages/Agents';
import Transactions from './pages/Transactions';
import Roulette from './pages/Roulette';
import Keno from './pages/Keno';
import Jackpots from './pages/Jackpots';
import Parametres from './pages/Parametres';

const ProtectedRoute = ({ children }) => {
  const isAuth = localStorage.getItem('admin_key') === 'CleSuperSecreteBackoffice2026';
  if (!isAuth) return <Navigate to="/login" replace />;
  return children;
};

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />

          {/* Protected — Layout with Outlet */}
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="/dashboard"    element={<Dashboard />}    />
            <Route path="/roulette"     element={<Roulette />}     />
            <Route path="/keno"         element={<Keno />}         />
            <Route path="/jackpots"     element={<Jackpots />}     />
            <Route path="/agents"       element={<Agents />}       />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/parametres"   element={<Parametres />}   />
          </Route>

          {/* Redirections */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
