import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from '../lib/supabase';
import { fetchCurrentUserProfileRole } from '../lib/adminAccess';
import type { AccountRole } from '../lib/accountRole';
import { fetchProviderMode, type ProviderModeInfo } from '../lib/providerMode';

// Tipo de cuenta del usuario con sesión, leído UNA vez por sesión de `profiles.role` y
// compartido por toda la app. Sustituye a las deducciones sueltas desde `user_metadata` y
// `localStorage` (GarSer Empresas, F0 — docs/garser-empresas/02-HALLAZGOS.md H-06).
//
// `role === null` con `loading === false` significa: sin sesión, o sin perfil legible. Quien
// lo consuma debe tratarlo con el mínimo privilegio (como un cliente), nunca como jardinero
// ni admin.
//
// Para un profesional (`gardener`) también se lee su MODO (individual o equipo, D32): lo decide el
// servidor y no se guarda en el navegador. Se carga junto al rol, para que la app pinte el panel
// que toca desde el primer momento, y se vuelve a pedir (sin poner nada en «cargando») al volver a
// la app y tras invitar o dar de baja a alguien (D39: sin tiempo real). Quien lo consume es
// `useProviderMode()`.

interface AccountContextType {
  role: AccountRole | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /** Modo del profesional; `null` si no es profesional o aún no se ha podido leer. */
  providerMode: ProviderModeInfo | null;
  /** La última lectura del modo falló (y no hay una anterior buena). */
  providerModeError: boolean;
  /** Vuelve a leer el modo sin tocar `loading`; ante un fallo conserva el anterior. */
  refreshProviderMode: () => Promise<ProviderModeInfo | null>;
}

const AccountContext = createContext<AccountContextType | undefined>(undefined);

export const useAccount = () => {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccount must be used within AccountProvider');
  return ctx;
};

/** Al volver a la app, el modo se relee si lo último que se supo tiene más de esto. */
const MODE_STALE_MS = 20_000;

export const AccountProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const [role, setRole] = useState<AccountRole | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [providerMode, setProviderMode] = useState<ProviderModeInfo | null>(null);
  const [providerModeError, setProviderModeError] = useState(false);
  // Evita que la respuesta de una sesión anterior pise la de la actual si el usuario cambia
  // rápido (cerrar sesión y entrar con otra cuenta).
  const requestSeq = useRef(0);
  // Lo mismo para el modo: una relectura lenta no pisa una más nueva ni la de otra sesión.
  const modeSeq = useRef(0);
  const roleRef = useRef<AccountRole | null>(null);
  const lastModeReadAt = useRef(0);
  roleRef.current = role;

  const load = useCallback(async (targetUserId: string | null) => {
    const seq = ++requestSeq.current;
    modeSeq.current += 1;
    if (!targetUserId) {
      setRole(null);
      setProviderMode(null);
      setProviderModeError(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const nextRole = await fetchCurrentUserProfileRole(targetUserId);
      if (seq !== requestSeq.current) return;
      if (nextRole === 'gardener') {
        // El modo se lee antes de dar la cuenta por cargada: así `/dashboard` no enseña un panel y
        // salta a otro. Un fallo aquí no tumba la sesión: se cae al panel individual.
        try {
          const mode = await fetchProviderMode();
          if (seq !== requestSeq.current) return;
          lastModeReadAt.current = Date.now();
          setProviderMode(mode);
          setProviderModeError(false);
        } catch (error) {
          if (seq !== requestSeq.current) return;
          console.error('Error cargando el modo de la cuenta:', error);
          setProviderMode(null);
          setProviderModeError(true);
        }
      } else {
        setProviderMode(null);
        setProviderModeError(false);
      }
      setRole(nextRole);
    } catch (error) {
      // Si la sesión ya cambió, este fallo es de una consulta obsoleta y no significa nada.
      // Pasa al registrarse: signUp abre sesión un instante y la cierra (AuthContext.signUp),
      // y la consulta llega al servidor ya sin token. Solo se informa del fallo vigente.
      if (seq === requestSeq.current) {
        console.error('Error cargando el tipo de cuenta:', error);
        setRole(null);
        setProviderMode(null);
        setProviderModeError(false);
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    void load(userId);
  }, [authLoading, userId, load]);

  // Se relee con la sesión ACTUAL, no con el usuario de cuando se pintó quien llama: quien acaba
  // de entrar y en el mismo paso pide refrescar (el invitado que crea su cuenta en /invitacion,
  // D21) tenía aquí aún `null` y borraba el tipo de cuenta que se estaba cargando.
  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    await load(data.session?.user?.id ?? null);
  }, [load]);

  const refreshProviderMode = useCallback(async (): Promise<ProviderModeInfo | null> => {
    if (roleRef.current !== 'gardener') return null;
    const seq = ++modeSeq.current;
    try {
      const mode = await fetchProviderMode();
      if (seq !== modeSeq.current) return null;
      lastModeReadAt.current = Date.now();
      setProviderMode(mode);
      setProviderModeError(false);
      return mode;
    } catch (error) {
      // Sin red no se sabe nada nuevo: se queda lo último que se supo.
      console.error('Error actualizando el modo de la cuenta:', error);
      return null;
    }
  }, []);

  // Al volver a la app (otra pestaña, el móvil desbloqueado, la PWA que vuelve a primer plano) el
  // equipo puede haber cambiado desde otro dispositivo: el invitado acepta con el titular mirando.
  useEffect(() => {
    if (role !== 'gardener' || typeof document === 'undefined') return undefined;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastModeReadAt.current < MODE_STALE_MS) return;
      void refreshProviderMode();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [role, refreshProviderMode]);

  return (
    <AccountContext.Provider
      value={{ role, loading: authLoading || loading, refresh, providerMode, providerModeError, refreshProviderMode }}
    >
      {children}
    </AccountContext.Provider>
  );
};
