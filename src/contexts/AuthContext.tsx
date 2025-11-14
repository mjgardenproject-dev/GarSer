import React, { createContext, useContext, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, role: 'client' | 'gardener') => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const ts = () => new Date().toISOString();

  const clearAuthStorage = () => {
    try {
      // Eliminar claves de autenticación de Supabase
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i) || '';
        if (key.startsWith('sb-') || key === 'supabase.auth.token') {
          localStorage.removeItem(key);
        }
      }
      sessionStorage.clear();
      console.log('🧽 Storage limpiado');
    } catch (e) {
      console.warn('No se pudo limpiar storage:', e);
    }
  };

  useEffect(() => {
    let mounted = true;

    const restoreSession = async () => {
      setLoading(true);
      console.log('🕒', ts(), '🔐 Restaurando sesión inicial...');
      try {
        // Pequeño retry para absorber delays de hidratación tras F5
        let restoredUser: User | null = null;
        let attempts = 0;
        while (attempts < 3) {
          const { data, error } = await supabase.auth.getSession();
          if (error) {
            console.warn('⚠️ getSession error:', error.message);
          }
          if (data?.session?.user) {
            restoredUser = data.session.user;
            break;
          }
          attempts++;
          await new Promise(r => setTimeout(r, 200));
        }

        if (!restoredUser) {
          // Intento explícito de refresh si hay token en storage
          const hasToken = Object.keys(localStorage).some(k => k.startsWith('sb-'));
          if (hasToken) {
            console.log('🕒', ts(), '🔁 Intentando refreshSession...');
            try {
              const { data, error } = await supabase.auth.refreshSession();
              if (error) {
                console.warn('⚠️ refreshSession error:', error.message);
              }
              restoredUser = data?.session?.user ?? null;
            } catch (e) {
              console.warn('⚠️ refreshSession lanzó excepción:', e);
            }
          }
        }

        if (mounted && restoredUser) {
          setUser(restoredUser);
          console.log('✅ Session restored');
        } else {
          console.log('ℹ️ No active session');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    restoreSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      const u = session?.user ?? null;
      switch (event) {
        case 'INITIAL_SESSION': {
          console.log('🕒', ts(), 'INITIAL_SESSION');
          setUser(u);
          setLoading(false);
          break;
        }
        case 'SIGNED_IN': {
          console.log('🕒', ts(), 'Signed in');
          setUser(u);
          setLoading(false);
          break;
        }
        case 'TOKEN_REFRESHED': {
          console.log('🕒', ts(), 'Token refreshed');
          setUser(u);
          break;
        }
        case 'TOKEN_REFRESH_FAILED': {
          console.warn('🕒', ts(), 'Token refresh failed → signOut');
          clearAuthStorage();
          try { await supabase.auth.signOut(); } catch {}
          setUser(null);
          setLoading(false);
          if (window.location.pathname !== '/auth') {
            window.location.assign('/auth');
          }
          break;
        }
        case 'SIGNED_OUT': {
          console.log('🕒', ts(), 'Signed out');
          clearAuthStorage();
          setUser(null);
          setLoading(false);
          if (window.location.pathname !== '/auth') {
            window.location.assign('/auth');
          }
          break;
        }
        default: {
          // Otros eventos: USER_UPDATED, PASSWORD_RECOVERY, etc.
          break;
        }
      }
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (data?.user) {
        setUser(data.user);
        console.log('✅ Signed in');
        window.location.assign('/dashboard');
      } else {
        console.warn('No user returned on signIn');
      }
    } catch (e: any) {
      console.error('Error on signIn:', e?.message || e);
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (email: string, password: string, role: 'client' | 'gardener') => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { role } },
      });
      if (error) throw error;
      const user = data?.user ?? data?.session?.user ?? null;
      if (user) {
        setUser(user);
        console.log('✅ Signed up');
        window.location.assign('/dashboard');
      } else {
        console.log('ℹ️ Sign up requires email confirmation');
      }
    } catch (e: any) {
      console.error('Error on signUp:', e?.message || e);
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    setLoading(true);
    try {
      await supabase.auth.signOut();
      clearAuthStorage();
      setUser(null);
      console.log('✅ Signed out');
      window.location.assign('/auth');
    } catch (e: any) {
      console.error('Error on signOut:', e?.message || e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};