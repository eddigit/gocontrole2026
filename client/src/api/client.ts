import axios from 'axios';

const API_BASE = '/api';

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

// Inject JWT token into requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('gc_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('gc_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export default api;

// API functions
export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  me: () => api.get('/auth/me'),
  register: (data: { email: string; password: string; name: string; role?: string }) =>
    api.post('/auth/register', data),
};

export const dashboardApi = {
  summary: () => api.get('/dashboard/summary'),
};

export const targetApi = {
  list: () => api.get('/targets'),
  get: (id: string) => api.get(`/targets/${id}`),
  create: (data: { phoneNumber: string; label?: string; sessionId?: string }) =>
    api.post('/targets', data),
  delete: (id: string) => api.delete(`/targets/${id}`),
};

export const sessionApi = {
  list: () => api.get('/sessions'),
  create: (name: string) => api.post('/sessions', { name }),
  get: (id: string) => api.get(`/sessions/${id}`),
  delete: (id: string) => api.delete(`/sessions/${id}`),
};

export const alertApi = {
  list: () => api.get('/alerts'),
  create: (data: { targetId: string; triggerOn: string; channel?: string }) =>
    api.post('/alerts', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/alerts/${id}`, data),
  delete: (id: string) => api.delete(`/alerts/${id}`),
};

export const messageApi = {
  list: (targetId: string, params?: Record<string, string>) =>
    api.get(`/messages/${targetId}`, { params }),
  conversations: (targetId: string) =>
    api.get(`/messages/${targetId}/conversations`),
  stats: (targetId: string) =>
    api.get(`/messages/${targetId}/stats`),
  deleted: (targetId: string, params?: Record<string, string>) =>
    api.get(`/messages/${targetId}/deleted`, { params }),
  media: (targetId: string, params?: Record<string, string>) =>
    api.get(`/messages/${targetId}/media`, { params }),
  locations: (targetId: string) =>
    api.get(`/messages/${targetId}/locations`),
};

export const callApi = {
  list: (targetId: string, params?: Record<string, string>) =>
    api.get(`/calls/${targetId}`, { params }),
  stats: (targetId: string) =>
    api.get(`/calls/${targetId}/stats`),
};

export const groupApi = {
  list: (targetId: string, params?: Record<string, string>) =>
    api.get(`/groups/${targetId}`, { params }),
  summary: (targetId: string) =>
    api.get(`/groups/${targetId}/summary`),
};
