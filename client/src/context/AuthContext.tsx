import React, { createContext, useContext, useState, useEffect } from 'react';
import * as api from '@/lib/api';
import { User } from '@/lib/api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<{ user: User; token: string }>;
  register: (username: string, fullName: string, email: string, password: string, hallOfResidence: string) => Promise<{ user: User; token: string }>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Checks if a JWT token is expired or malformed.
 * Includes a 10-second grace window to prevent edge-case race conditions.
 */
export function isTokenExpired(token: string | null): boolean {
  if (!token) return true;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const decoded = JSON.parse(jsonPayload);
    if (!decoded.exp) return false;
    return Date.now() >= decoded.exp * 1000 - 10000;
  } catch {
    return true;
  }
}

/**
 * Returns remaining milliseconds until token expiry, or 0 if expired.
 */
export function getTokenRemainingMs(token: string | null): number {
  if (!token) return 0;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return 0;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const decoded = JSON.parse(jsonPayload);
    if (!decoded.exp) return Infinity;
    return Math.max(0, decoded.exp * 1000 - Date.now());
  } catch {
    return 0;
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Validate token on initialization - if expired, purge immediately
  const [token, setToken] = useState<string | null>(() => {
    const storedToken = localStorage.getItem('auth_token');
    if (!storedToken || isTokenExpired(storedToken)) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user_info');
      return null;
    }
    return storedToken;
  });

  const [user, setUser] = useState<User | null>(() => {
    const storedToken = localStorage.getItem('auth_token');
    if (!storedToken || isTokenExpired(storedToken)) {
      return null;
    }
    const stored = localStorage.getItem('user_info');
    try {
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logout = React.useCallback(() => {
    api.logout();
    setUser(null);
    setToken(null);
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_info');
  }, []);

  // Monitor token expiration, timeout, and window focus/visibility changes
  useEffect(() => {
    if (!token) return;

    if (isTokenExpired(token)) {
      logout();
      return;
    }

    const remainingMs = getTokenRemainingMs(token);
    let timerId: ReturnType<typeof setTimeout> | undefined;

    if (Number.isFinite(remainingMs) && remainingMs > 0) {
      // 32-bit signed int max is ~24.8 days
      const safeTimeout = Math.min(remainingMs, 2147483647);
      timerId = setTimeout(() => {
        logout();
      }, safeTimeout);
    }

    const checkExpiry = () => {
      if (isTokenExpired(token)) {
        logout();
      }
    };

    window.addEventListener('focus', checkExpiry);
    document.addEventListener('visibilitychange', checkExpiry);

    return () => {
      if (timerId) clearTimeout(timerId);
      window.removeEventListener('focus', checkExpiry);
      document.removeEventListener('visibilitychange', checkExpiry);
    };
  }, [token, logout]);

  // Sync with localStorage if changed elsewhere (multi-tab) and listen for 401 unauthorized events
  useEffect(() => {
    const handleStorageChange = () => {
      const storedToken = localStorage.getItem('auth_token');
      if (!storedToken || isTokenExpired(storedToken)) {
        setUser(null);
        setToken(null);
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user_info');
      } else {
        const storedUser = localStorage.getItem('user_info');
        try {
          setUser(storedUser ? JSON.parse(storedUser) : null);
        } catch {
          setUser(null);
        }
        setToken(storedToken);
      }
    };

    const handleUnauthorized = () => {
      logout();
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('auth:unauthorized', handleUnauthorized);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, [logout]);

  async function login(username: string, password: string) {
    setLoading(true);
    setError(null);
    try {
      const { user, token } = await api.login(username, password);
      setUser(user);
      setToken(token);
      localStorage.setItem('auth_token', token);
      localStorage.setItem('user_info', JSON.stringify(user));
      setLoading(false);
      return { user, token };
    } catch (err: unknown) {
      setError((err as Error).message);
      setLoading(false);
      throw err;
    }
  }

  async function register(username: string, fullName: string, email: string, password: string, hallOfResidence: string) {
    setLoading(true);
    setError(null);
    try {
      const { user, token } = await api.register(username, fullName, email, password, hallOfResidence);
      setUser(user);
      setToken(token);
      localStorage.setItem('auth_token', token);
      localStorage.setItem('user_info', JSON.stringify(user));
      setLoading(false);
      return { user, token };
    } catch (err: unknown) {
      setError((err as Error).message);
      setLoading(false);
      throw err;
    }
  }

  return (
    <AuthContext.Provider value={{
      user,
      token,
      loading,
      error,
      login,
      register,
      logout,
      isAuthenticated: !!user && !!token && !isTokenExpired(token)
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuthContext = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuthContext must be used within an AuthProvider');
    }
    return context;
};
