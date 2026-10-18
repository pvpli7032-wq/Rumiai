'use client';
import { zhError } from '@/lib/copy/zh';
import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';

interface User {
  id: string;
  username: string;
  email: string;
  avatarUrl?: string | null;
  tier: string;
  coins: number;
  streakCount: number;
  /**
   * Reader preferences. GET /api/users/me already returns these; the chat reads them from
   * here so a change on the profile page takes effect after refreshUser() without a
   * separate request per chat.
   */
  readingMode?: boolean;
  bannedWords?: string | null;
  shortcuts?: string | null;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (displayName: string, email: string, password: string, consents?: {ageConfirmed?:boolean;termsAccepted?:boolean;privacyAccepted?:boolean}) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const sessionToken = useRef<string | null>(null);

  useEffect(() => {
    const storedToken = localStorage.getItem('khuiai_token');
    if (storedToken) {
      sessionToken.current = storedToken;
      setToken(storedToken);
      fetchMe(storedToken).finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  async function fetchMe(t: string) {
    try {
      const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${t}` } });
      if (sessionToken.current !== t) return;
      if (res.ok) {
        const data = await res.json();
        if (sessionToken.current !== t) return;
        setUser(data.user);
      } else {
        sessionToken.current = null;
        localStorage.removeItem('khuiai_token');
        setToken(null);
        setUser(null);
      }
    } catch {
      if (sessionToken.current === t) setUser(null);
    }
  }

  async function refreshUser() {
    if (token) await fetchMe(token);
  }

  async function login(email: string, password: string) {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: zhError(data.error || '') || 'Login failed' };
      sessionToken.current = data.token;
      localStorage.setItem('khuiai_token', data.token);
      setToken(data.token);
      setUser(data.user);
      return { success: true };
    } catch {
      return { success: false, error: 'Network error' };
    }
  }

  /**
   * `displayName` is what the form labels "昵称", and it is sent as `name`.
   *
   * It used to be sent as `username`, which the API reads as a handle the user picked for
   * themselves — so a taken handle came back as 409 and two people who typed the same
   * display name could not both register. It also stored the raw text as the @handle,
   * which is why seeded rows have handles like "张三 爱聊天" that need URL-encoding.
   * Sending `name` lets the server allocate a free handle from the email instead.
   */
  async function register(displayName: string, email: string, password: string, consents?: {ageConfirmed?:boolean;termsAccepted?:boolean;privacyAccepted?:boolean}) {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: displayName, email, password, consents }),
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: zhError(data.error || '') || 'Registration failed' };
      sessionToken.current = data.token;
      localStorage.setItem('khuiai_token', data.token);
      setToken(data.token);
      setUser(data.user);
      return { success: true };
    } catch {
      return { success: false, error: 'Network error' };
    }
  }

  function logout() {
    sessionToken.current = null;
    // Tell the server first so the token is revoked rather than merely forgotten;
    // a token only dropped from storage stayed valid for the rest of its week.
    // Local state is cleared regardless, so a failed request still signs you out here.
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        keepalive: true,
      }).catch(() => {});
    }
    localStorage.removeItem('khuiai_token');
    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
