import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { ProviderSetupStatus } from '../shared/providerSetup';
import { useRefreshOnReturn } from './useRefreshOnReturn';

// Completar la cuenta profesional: el estado real de la cuenta proveedora con sesión
// (my_provider_setup_status). Se vuelve a pedir al volver a la app; mientras recarga, se queda el
// último estado a la vista.

export function useProviderSetupStatus() {
  const [status, setStatus] = useState<ProviderSetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc('my_provider_setup_status');
    if (mine !== seq.current) return;
    if (rpcError) {
      setError(rpcError.message || 'No hemos podido comprobar tu cuenta.');
    } else {
      setStatus((data ?? null) as unknown as ProviderSetupStatus | null);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useRefreshOnReturn(load, { minIntervalMs: 15_000 });

  return { status, loading, error, refresh: load };
}
