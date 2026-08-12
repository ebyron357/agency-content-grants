import { useState, useEffect, useCallback } from 'react';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

interface AuthState {
  isAuthenticated: boolean | null; // null = loading
  isLoading: boolean;
  refetch: () => void;
}

export function useAuth(): AuthState {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const check = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/me`);
      const data = await res.json() as { authenticated: boolean };
      setIsAuthenticated(data.authenticated === true);
    } catch {
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  return { isAuthenticated, isLoading, refetch: check };
}
