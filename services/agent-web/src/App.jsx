import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { I18nProvider } from './i18n';
import Layout from './components/Layout';
import { Login } from './pages/Login';
import { Jeux } from './pages/Jeux';
import { Keno } from './pages/Keno';
import { Ventes } from './pages/Ventes';
import { Verify } from './pages/Verify';
import { Shift } from './pages/Shift';

const PrivateRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? children : <Navigate to="/login" replace />;
};

const PublicRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Navigate to="/jeux" replace /> : children;
};

function App() {
  return (
    <I18nProvider>
      <ThemeProvider>
        <AuthProvider>
          <Router basename="/agents/pos">
            <Routes>
              <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />

              <Route element={<PrivateRoute><Layout /></PrivateRoute>}>
                <Route path="/jeux"   element={<Jeux />} />
                <Route path="/keno"   element={<Keno />} />
                <Route path="/ventes" element={<Ventes />} />
                <Route path="/verify" element={<Verify />} />
                <Route path="/shift"  element={<Shift />} />
              </Route>

              <Route path="/" element={<Navigate to="/jeux" replace />} />
              <Route path="/dashboard" element={<Navigate to="/jeux" replace />} />
              <Route path="*" element={<Navigate to="/jeux" replace />} />
            </Routes>
          </Router>
        </AuthProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

export default App;
