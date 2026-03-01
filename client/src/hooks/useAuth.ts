import { useState, useEffect, useCallback } from 'react';
import { authApi } from '../api/client';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

export function useAuth() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('gc_token'));
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      authApi.me()
        .then((res) => setUser(res.data.user))
        .catch(() => {
          localStorage.removeItem('gc_token');
          setToken(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    const { token: newToken, user: userData } = res.data;
    localStorage.setItem('gc_token', newToken);
    setToken(newToken);
    setUser(userData);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('gc_token');
    setToken(null);
    setUser(null);
  }, []);

  return { token, user, loading, login, logout };
}
