import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { fetchCurrentUser } from '../api/auth';
import { getStoredToken, setStoredToken } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(getStoredToken());
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const handleUnauthorized = () => {
      setStoredToken(null);
      setToken(null);
      setUser(null);
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);

    const syncUser = async () => {
      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }
      try {
        const currentUser = await fetchCurrentUser();
        if (active) setUser(currentUser);
      } catch {
        if (active) handleUnauthorized();
      } finally {
        if (active) setLoading(false);
      }
    };

    syncUser();
    return () => {
      active = false;
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, [token]);

  const login = (nextToken, nextUser) => {
    setStoredToken(nextToken);
    setToken(nextToken);
    setUser(nextUser);
  };

  const logout = () => {
    setStoredToken(null);
    setToken(null);
    setUser(null);
  };

  const value = useMemo(() => ({ user, token, login, logout, loading, isAuthenticated: Boolean(token && user) }), [user, token, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
