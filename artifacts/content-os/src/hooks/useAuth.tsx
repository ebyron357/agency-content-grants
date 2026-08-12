import React, { createContext, useContext, useEffect, useState } from "react";

export interface AuthUser {
  id: string;
  username: string;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/api/auth/me")
      .then((data) => setUser(data as AuthUser))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(username: string, password: string) {
    const data = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    setUser(data as AuthUser);
  }

  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    window.location.href = `${BASE}/login`;
  }

  async function register(username: string, password: string) {
    const data = await apiFetch("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    setUser(data as AuthUser);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, register }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
