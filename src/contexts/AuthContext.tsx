import React, { createContext, useContext, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, role: 'client' | 'gardener', applicationPayload?: any) => Promise<void>;
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
        case 'INITIAL_SESSION':
        case 'SIGNED_IN':
        case 'TOKEN_REFRESHED': {
          console.log('🕒', ts(), event);
          setUser(u);
          setLoading(false);
          break;
        }
        case 'SIGNED_OUT': {
          console.log('🕒', ts(), 'Signed out');
          setUser(null);
          setLoading(false);
          break;
        }
        case 'TOKEN_REFRESH_FAILED': {
          console.warn('🕒', ts(), 'Token refresh failed');
          setLoading(false);
          break;
        }
        default:
          break;
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
        const { data: userInfo } = await supabase.auth.getUser();
        const fresh = userInfo?.user || data.user;
        const verified = !!(fresh as any)?.email_confirmed_at;
        if (!verified) {
          await supabase.auth.signOut();
          throw new Error('Verifica tu correo para continuar.');
        }
        try {
          const isGardenerIntent = (fresh as any)?.user_metadata?.role === 'gardener' || (fresh as any)?.user_metadata?.requested_role === 'gardener';
          if (isGardenerIntent) {
            await supabase
              .from('profiles')
              .upsert({ id: fresh.id, role: 'gardener' }, { onConflict: 'id' });
            const { data: app } = await supabase
              .from('gardener_applications')
              .select('id,status')
              .eq('user_id', fresh.id)
              .maybeSingle();
            const st = (app?.status as any) || null;
            if (!st || st === 'draft') {
              await supabase
                .from('gardener_applications')
                .upsert({ user_id: fresh.id, status: 'draft', submitted_at: new Date().toISOString() }, { onConflict: 'user_id' });
            }
          }
        } catch {}
        setUser(fresh);
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

  const signUp = async (email: string, password: string, role: 'client' | 'gardener', applicationPayload?: any) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { requested_role: role, role: role } },
      });
      if (error) throw error;
      // No hacemos escrituras en tablas protegidas aquí: aún no hay sesión confirmada.
      // Se bootstrappea en el primer signIn tras verificar el email.
      await supabase.auth.signOut();
      console.log('ℹ️ Registro completado. Verifica tu correo para continuar.');
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
      try { localStorage.removeItem('gardenerApplicationStatus'); localStorage.removeItem('gardenerApplicationJustSubmitted'); } catch {}
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
