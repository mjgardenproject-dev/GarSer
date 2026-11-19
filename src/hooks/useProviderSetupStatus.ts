import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { ProviderSetupStatus } from '../shared/providerSetup';
import { useRefreshOnReturn } from './useRefreshOnReturn';
import { loadServiceActivation } from '../utils/serviceActivation';
import { isActivationDoneLocally } from '../activation/activationFlow';
import { SETUP_CHANGED_EVENT } from '../utils/setupEvents';

// Completar la cuenta profesional: el estado real de la cuenta proveedora con sesión
// (my_provider_setup_status). Se vuelve a pedir al volver a la app; mientras recarga, se queda el
// último estado a la vista.

export function useProviderSetupStatus({ enabled = true }: { enabled?: boolean } = {}) {
  const [status, setStatus] = useState<ProviderSetupStatus | null>(null);
  const [loading, setLoading] = useState(enabled);
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
      const next = (data ?? null) as unknown as ProviderSetupStatus | null;
      // El servidor no dice si el autónomo ya eligió la antelación y las semanas de agenda: se mira su
      // fila de ajustes. Si no se puede leer, el paso simplemente no se enseña.
      if (next && next.provider_kind === 'solo') {
        try {
          const { data: rules, error: rulesError } = await supabase
            .from('recurring_availability_settings')
            .select('gardener_id')
            .eq('gardener_id', next.provider_id)
            .maybeSingle();
          if (!rulesError) next.schedule_rules_configured = Boolean(rules);
        } catch {
          // sin dato: no se enseña el paso
        }
        if (mine !== seq.current) return;
      }
      // Servicios configurados pero sin activar: el servidor solo cuenta los activos. Si no se puede
      // leer, el paso se enseña como siempre.
      if (next) {
        try {
          const activation = await loadServiceActivation(next.provider_id);
          next.service_activation = activation.map((s) => ({ id: s.id, name: s.name, active: s.active, can_activate: s.canActivate }));
        } catch {
          // sin dato: paso de siempre
        }
        if (mine !== seq.current) return;
      }
      // ¿Terminó el cuestionario «Activa tu cuenta»? Este navegador lo sabe al instante; el servidor lo
      // sabe desde cualquier dispositivo (`activation_step = 'done'`).
      if (next) {
        let done = isActivationDoneLocally(next.provider_id);
        if (!done) {
          try {
            const { data: profile } = await supabase
              .from('gardener_profiles')
              .select('activation_step')
              .eq('user_id', next.provider_id)
              .maybeSingle();
            done = (profile as { activation_step?: string | null } | null)?.activation_step === 'done';
          } catch {
            // sin dato: se trata como no terminado, que es el comportamiento de siempre
          }
          if (mine !== seq.current) return;
        }
        next.activation_done = done;
      }
      setStatus(next);
      setError(null);
    }
    setLoading(false);
  }, []);

  // `enabled: false`: quien ya recibe el estado de otro (el panel lo comparte con la ayuda) no pide uno propio.
  useEffect(() => { if (enabled) void load(); }, [load, enabled]);
  useRefreshOnReturn(load, { minIntervalMs: 15_000, enabled });
  // Se guardó algo que cuenta para la ayuda (servicio activado, zona, horario): se relee al momento.
  useEffect(() => {
    if (!enabled) return undefined;
    const onChanged = () => { void load(); };
    window.addEventListener(SETUP_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(SETUP_CHANGED_EVENT, onChanged);
  }, [load, enabled]);

  return { status, loading, error, refresh: load };
}
