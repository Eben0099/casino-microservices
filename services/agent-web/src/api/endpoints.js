import api from './client';

export const ticketApi = {
  create: (data) => api.post('/tickets/', data),
  getDetails: (code) => api.get(`/tickets/${code}`),
  payout: (code) => api.post(`/tickets/${code}/payout`),
  getStats: () => api.get('/tickets/admin/stats'),
};

export const agentApi = {
  login: (phone, password) => api.post('/agents/login', { phone, password }),
  getDetails: (agentId) => api.get(`/agents/${agentId}`),
};
