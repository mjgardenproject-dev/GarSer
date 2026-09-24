import React, { useEffect, useState } from 'react';
import { UserRound } from 'lucide-react';
import { supabase } from '../../lib/supabase';

// Quién va a hacer el trabajo, para el cliente de una empresa (GarSer Empresas F5.4, D6): nombre
// y foto, y solo desde el día antes. El servidor decide si toca (booking_worker_for_client); aquí
// solo se evita preguntar por reservas que no pueden tenerlo.

const WhoIsComing: React.FC<{ bookingId: string; status: string; date: string }> = ({ bookingId, status, date }) => {
  const [worker, setWorker] = useState<{ name: string | null; avatar_url: string | null } | null>(null);

  const today = new Date();
  const dayBefore = new Date(`${date}T00:00:00`);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const inWindow = status === 'confirmed' && today >= dayBefore && today <= new Date(`${date}T23:59:59`);

  useEffect(() => {
    if (!inWindow) return;
    let cancelled = false;
    void supabase.rpc('booking_worker_for_client', { p_booking_id: bookingId }).then(({ data }) => {
      if (!cancelled) setWorker((data as { name: string | null; avatar_url: string | null } | null) ?? null);
    });
    return () => { cancelled = true; };
  }, [bookingId, inWindow]);

  if (!worker?.name) return null;
  return (
    <div className="mt-2 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2">
      {worker.avatar_url ? (
        <img src={worker.avatar_url} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" width="32" height="32" />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-emerald-700"><UserRound className="h-4 w-4" /></span>
      )}
      <span className="text-sm text-emerald-900">Irá <span className="font-semibold">{worker.name}</span></span>
    </div>
  );
};

export default WhoIsComing;
