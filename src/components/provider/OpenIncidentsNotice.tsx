import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { supabase } from '../../lib/supabase';

/**
 * QA-192: aviso en el Panel del profesional cuando un cliente ha abierto una incidencia sobre uno de
 * sus trabajos y todavía no ha contado su versión. Antes solo se enteraba quien abría «Reservas».
 * Las RLS de `booking_incidents` ya limitan la lectura a las incidencias de sus reservas.
 */
export default function OpenIncidentsNotice({ userId }: { userId: string | undefined }) {
  const navigate = useNavigate();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('booking_incidents')
        .select('id, gardener_response, bookings!inner(gardener_id)')
        .eq('bookings.gardener_id', userId)
        .eq('reporter_role', 'client')
        .in('status', ['open', 'in_review']);
      if (cancelled || error) return;
      setPendingCount((data || []).filter((row: { gardener_response: string | null }) => !row.gardener_response).length);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (pendingCount === 0) return null;

  return (
    <div role="status" className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        {pendingCount === 1
          ? 'Un cliente ha abierto una incidencia sobre tu trabajo'
          : `Tienes ${pendingCount} incidencias abiertas sobre tus trabajos`}
      </p>
      <p className="mt-1 text-sm text-amber-800">
        La revisa el equipo de GarSer y tu versión cuenta para decidir. Mientras tanto, esa reserva no se cierra ni se cobra sola.
      </p>
      <button
        type="button"
        onClick={() => navigate('/bookings')}
        className="mt-3 inline-flex min-h-[44px] items-center rounded-xl bg-amber-600 px-4 text-sm font-semibold text-white hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
      >
        Contar mi versión
      </button>
    </div>
  );
}
