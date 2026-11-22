import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Solicitudes de reserva sin responder (status = 'pending') de este profesional. Caducan si no se
 * responden, así que el cuestionario «Activa tu cuenta», que ocupa toda la pantalla, tiene que avisar de
 * ellas (QA-062: antes solo se veían por la insignia del Chat). Sin dato o con error, 0: no se avisa.
 */
export function usePendingRequestCount(userId: string | undefined): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { count: pending, error } = await supabase
          .from('bookings')
          .select('id', { count: 'exact', head: true })
          .eq('gardener_id', userId)
          .eq('status', 'pending');
        if (!cancelled && !error) setCount(pending ?? 0);
      } catch {
        // sin dato: no se avisa
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);
  return count;
}
