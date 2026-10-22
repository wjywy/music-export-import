import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, getToken, setToken } from '../lib/api';
import type { User } from '../lib/types';

interface AuthContextValue {
  user: User | null;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<User>;
  signUp: (email: string, password: string, displayName: string) => Promise<User>;
  signOut: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const clear = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setReady(true);
      return;
    }
    try {
      setUser(await api.me());
    } catch {
      clear();
    } finally {
      setReady(true);
    }
  }, [clear]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onUnauthorized = () => clear();
    window.addEventListener('dukou:unauthorized', onUnauthorized);
    return () => window.removeEventListener('dukou:unauthorized', onUnauthorized);
  }, [clear]);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password);
    setToken(result.token);
    setUser(result.user);
    return result.user;
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      const result = await api.register(email, password, displayName);
      setToken(result.token);
      setUser(result.user);
      return result.user;
    },
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, ready, signIn, signUp, signOut: clear, refresh }),
    [user, ready, signIn, signUp, clear, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
