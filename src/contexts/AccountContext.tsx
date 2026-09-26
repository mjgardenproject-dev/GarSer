import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from '../lib/supabase';
import { fetchCurrentUserProfileRole } from '../lib/adminAccess';
import type { AccountRole } from '../lib/accountRole';

// Tipo de cuenta del usuario con sesión, leído UNA vez por sesión de `profiles.role` y
// compartido por toda la app. Sustituye a las deducciones sueltas desde `user_metadata` y
// `localStorage` (GarSer Empresas, F0 — docs/garser-empresas/02-HALLAZGOS.md H-06).
//
// `role === null` con `loading === false` significa: sin sesión, o sin perfil legible. Quien
// lo consuma debe tratarlo con el mínimo privilegio (como un cliente), nunca como jardinero
// ni admin.

interface AccountContextType {
  role: AccountRole | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const AccountContext = createContext<AccountContextType | undefined>(undefined);

export const useAccount = () => {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccount must be used within AccountProvider');
  return ctx;
};

export const AccountProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const [role, setRole] = useState<AccountRole | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  // Evita que la respuesta de una sesión anterior pise la de la actual si el usuario cambia
  // rápido (cerrar sesión y entrar con otra cuenta).
  const requestSeq = useRef(0);

  const load = useCallback(async (targetUserId: string | null) => {
    const seq = ++requestSeq.current;
    if (!targetUserId) {
      setRole(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const nextRole = await fetchCurrentUserProfileRole(targetUserId);
      if (seq === requestSeq.current) setRole(nextRole);
    } catch (error) {
      // Si la sesión ya cambió, este fallo es de una consulta obsoleta y no significa nada.
      // Pasa al registrarse: signUp abre sesión un instante y la cierra (AuthContext.signUp),
      // y la consulta llega al servidor ya sin token. Solo se informa del fallo vigente.
      if (seq === requestSeq.current) {
        console.error('Error cargando el tipo de cuenta:', error);
        setRole(null);
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

  return (
    <AccountContext.Provider value={{ role, loading: authLoading || loading, refresh }}>
      {children}
    </AccountContext.Provider>
  );
};
