import { useState, useEffect, useCallback } from 'react';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

interface AuthState {
  isAuthenticated: boolean | null; // null = loading
  isLoading: boolean;
  /** The workspace requires two-factor and this member must turn it on first. */
  mfaEnrollmentRequired: boolean;
  refetch: () => void;
}

export function useAuth(): AuthState {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mfaEnrollmentRequired, setMfaEnrollmentRequired] = useState(false);

  const check = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/me`);
      const data = await res.json() as { authenticated: boolean; mfa?: { enrollmentRequired?: boolean } };
      setIsAuthenticated(data.authenticated === true);
      setMfaEnrollmentRequired(data.mfa?.enrollmentRequired === true);
    } catch {
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  return { isAuthenticated, isLoading, mfaEnrollmentRequired, refetch: check };
}
