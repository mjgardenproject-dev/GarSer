import React, { createContext, useContext, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { clearBookingResumeStorage } from '../utils/bookingResumeStorage';
import { fetchCurrentUserProfileRole } from '../lib/adminAccess';
import { forgetThisDevicePush } from '../utils/pushNotifications';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  /** Devuelve el tipo de cuenta (profiles.role) para llevarla directa a su panel. */
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string, role: 'client' | 'gardener' | 'company', _applicationPayload?: any) => Promise<void>;
  /** Cierra la sesión SOLO en este dispositivo (R-06). */
  signOut: () => Promise<void>;
  /** Cierra la sesión en todos los dispositivos de la cuenta (botón explícito de «Mi cuenta»). */
  signOutEverywhere: () => Promise<void>;
  /**
   * La sesión se cerró sin que el usuario lo pidiera en esta pestaña (revocada desde otro
   * dispositivo, caducada o cerrada en otra pestaña). Guarda la ruta en la que estaba para
   * volver a ella al entrar. La consume <SessionEndedNotice/>, que vive dentro del router.
   */
  sessionEndedAt: string | null;
  clearSessionEnded: () => void;
}

// Solo en desarrollo: en producción la consola queda para los errores de verdad (R-01b).
const debugLog = (...args: unknown[]) => { if (import.meta.env.DEV) console.log(...args); };

/**
 * R-06: supabase-js cierra por defecto con `scope: 'global'`, que revoca TODAS las sesiones de
 * la cuenta. Un cierre de sesión en el móvil echaba sin aviso al ordenador (y la pestaña vieja
 * perdía el correo que estaba pidiendo). Las salidas normales son locales.
 */
export const SIGN_OUT_LOCAL = { scope: 'local' as const };

// Marca de «este SIGNED_OUT lo ha pedido el usuario en esta pestaña». Vive en el módulo (no en
// el estado) porque el evento llega antes de que React vuelva a pintar.
let intentionalSignOut = false;
export const markIntentionalSignOut = () => { intentionalSignOut = true; };

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [sessionEndedAt, setSessionEndedAt] = useState<string | null>(null);
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
      debugLog('🧽 Storage limpiado');
    } catch (e) {
      console.warn('No se pudo limpiar storage:', e);
    }
  };

  useEffect(() => {
    let mounted = true;
    let lastKnownUserId: string | null = null;

    const restoreSession = async () => {
      setLoading(true);
      debugLog('🕒', ts(), '🔐 Restaurando sesión inicial...');
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
            debugLog('🕒', ts(), '🔁 Intentando refreshSession...');
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
          lastKnownUserId = restoredUser.id;
          debugLog('✅ Session restored');
        } else {
          debugLog('ℹ️ No active session');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    restoreSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event: string, session: { user: User | null } | null) => {
      if (!mounted) return;
      const u = session?.user ?? null;
      switch (event) {
        case 'INITIAL_SESSION':
        case 'SIGNED_IN':
        case 'TOKEN_REFRESHED': {
          debugLog('🕒', ts(), event);
          setUser(u);
          lastKnownUserId = u?.id ?? null;
          // Una marca de cierre que no llegó a consumirse (p. ej. el signOut falló) no puede
          // tapar un cierre inesperado posterior.
          if (u) intentionalSignOut = false;
          setLoading(false);
          break;
        }
        case 'PASSWORD_RECOVERY': {
          debugLog('🕒', ts(), 'Recuperación de contraseña detectada');
          // Redirigir a la página de reset si no estamos ya allí
          if (window.location.pathname !== '/reset-password') {
             window.location.assign('/reset-password');
          }
          break;
        }
        case 'SIGNED_OUT': {
          debugLog('🕒', ts(), 'Signed out');
          // R-06: si había alguien dentro y no lo ha pedido en esta pestaña, se le avisa y se le
          // devuelve luego a la misma página, en vez de sacarle sin explicación.
          if (!intentionalSignOut && lastKnownUserId) {
            setSessionEndedAt(`${window.location.pathname}${window.location.search}`);
          }
          intentionalSignOut = false;
          
          // Limpiar progreso del wizard de jardineros
          try {
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key && key.startsWith('gardener_wizard_progress_')) {
                keysToRemove.push(key);
              }
            }
            keysToRemove.forEach(k => localStorage.removeItem(k));
            
            clearBookingResumeStorage({ userId: lastKnownUserId, flow: 'wizard', includeAnonFallback: true });
          } catch (e) {
            console.error('Error cleaning up wizard progress:', e);
          }

          lastKnownUserId = null;
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
    // Eliminamos setLoading(true) para no bloquear la UI globalmente y permitir que el componente hijo (AuthForm) maneje su feedback.
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (data?.user) {
        const { data: userInfo } = await supabase.auth.getUser();
        const fresh = userInfo?.user || data.user;
        const verified = !!(fresh as any)?.email_confirmed_at;
        if (!verified) {
          markIntentionalSignOut();
          await supabase.auth.signOut(SIGN_OUT_LOCAL);
          throw new Error('Verifica tu correo para continuar.');
        }
        let accountRole: string | null = null;
        try {
          // Tipo de cuenta desde profiles.role (F0 de GarSer Empresas), no desde user_metadata.
          accountRole = await fetchCurrentUserProfileRole(fresh.id);
          if (accountRole === 'gardener') {
            const { data: app } = await supabase
              .from('gardener_applications')
              .select('id,status')
              .eq('user_id', fresh.id)
              .maybeSingle();
            const st = (app?.status as any) || null;
            if (!st || st === 'draft') {
              await supabase
                .from('gardener_applications')
                .upsert({ user_id: fresh.id, status: 'draft', submitted_at: new Date().toISOString() }, { onConflict: 'user_id', ignoreDuplicates: true });
            }
          }
        } catch (bootstrapError) {
          console.warn('Bootstrapping warning (ignorable):', bootstrapError);
        }
        setUser(fresh);
        setSessionEndedAt(null);
        debugLog('✅ Signed in');
        // La navegación la decide el componente (postLoginPath).
        return accountRole;
      }
      console.warn('No user returned on signIn');
      return null;
    } catch (e: any) {
      console.error('Error on signIn:', e?.message || e);
      throw e;
    }
  };

  const signUp = async (email: string, password: string, role: 'client' | 'gardener' | 'company', _applicationPayload?: any) => {
    // Eliminamos setLoading(true) para no desmontar AuthForm durante el proceso
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { requested_role: role, role: role } },
      });
      if (error) throw error;
      // No hacemos escrituras en tablas protegidas aquí: aún no hay sesión confirmada.
      // Se bootstrappea en el primer signIn tras verificar el email.
      markIntentionalSignOut();
      await supabase.auth.signOut(SIGN_OUT_LOCAL);
      debugLog('ℹ️ Registro completado. Verifica tu correo para continuar.');
    } catch (e: any) {
      console.error('Error on signUp:', e?.message || e);
      throw e;
    }
  };

  const endSession = async (scope: 'local' | 'global') => {
    setLoading(true);
    try {
      markIntentionalSignOut();
      setSessionEndedAt(null);
      // F7: un dispositivo compartido no debe seguir recibiendo los avisos de esta cuenta. Como
      // mucho 1,5 s: cerrar sesión no espera a la red.
      await Promise.race([forgetThisDevicePush(), new Promise((resolve) => setTimeout(resolve, 1500))]);
      await supabase.auth.signOut({ scope });
      clearAuthStorage();
      clearBookingResumeStorage({ userId: user?.id, flow: 'wizard', includeAnonFallback: true });
      try { localStorage.removeItem('gardenerApplicationStatus'); localStorage.removeItem('gardenerApplicationJustSubmitted'); } catch {}
      setUser(null);
      debugLog('✅ Signed out');
      window.location.assign('/auth');
    } catch (e: any) {
      console.error('Error on signOut:', e?.message || e);
    } finally {
      setLoading(false);
    }
  };

  const signOut = () => endSession('local');
  const signOutEverywhere = () => endSession('global');
  const clearSessionEnded = () => setSessionEndedAt(null);

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut, signOutEverywhere, sessionEndedAt, clearSessionEnded }}>
      {children}
    </AuthContext.Provider>
  );
};
