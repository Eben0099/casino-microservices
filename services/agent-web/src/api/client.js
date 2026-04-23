import axios from 'axios';

const api = axios.create({
  baseURL: '/api', // On utilise le proxy Traefik
});

// Ajouter le token JWT à chaque requête si disponible
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('agent_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
