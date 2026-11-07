import { useState, useEffect, useCallback } from 'react';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

interface AuthState {
  isAuthenticated: boolean | null; // null = loading
  isLoading: boolean;
  /** The workspace requires two-factor and this member must turn it on first. */
  mfaEnrollmentRequired: boolean;
  /**
   * Self sign-up is open: the server's switch (SELF_SIGNUP_ENABLED=true, or its alias
   * SELF_SERVE_SIGNUP=on) is set and email can be sent (docs/SELF_SIGNUP.md).
   */
  signupOpen: boolean;
  /** A workspace its owner signed up for, with the getting-started checklist not hidden: it opens on the checklist. */
  firstRun: boolean;
  refetch: () => void;
}

export function useAuth(): AuthState {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mfaEnrollmentRequired, setMfaEnrollmentRequired] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);
  const [firstRun, setFirstRun] = useState(false);

  const check = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/me`);
      const data = await res.json() as {
        authenticated: boolean;
        signupOpen?: boolean;
        mfa?: { enrollmentRequired?: boolean };
        workspace?: { firstRun?: boolean } | null;
      };
      setIsAuthenticated(data.authenticated === true);
      setSignupOpen(data.signupOpen === true);
      setMfaEnrollmentRequired(data.mfa?.enrollmentRequired === true);
      setFirstRun(data.workspace?.firstRun === true);
    } catch {
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  return { isAuthenticated, isLoading, mfaEnrollmentRequired, signupOpen, firstRun, refetch: check };
}
