import React, { useState } from 'react';
import { Check, Loader2, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import type { BookingWorker } from '../../hooks/useBookingWorkers';
import BookingWorkerLine from './BookingWorkerLine';

// Quién va a un trabajo de la empresa y cómo cambiarlo (GarSer Empresas F5.3, A-34). La lista
// muestra solo a quien puede hacerlo (servicio y carnet) y avisa de quién está ocupado; el
// servidor lo vuelve a comprobar todo al elegir.

interface Candidate { user_id: string; full_name: string | null; is_current: boolean; is_free: boolean }

interface Props {
  bookingId: string;
  worker?: BookingWorker;
  onChanged: () => void;
  /** Trabajo ya confirmado: avisar por correo a quien pasa a ir y a quien deja de ir. */
  notify?: boolean;
}

const AssignWorkerControl: React.FC<Props> = ({ bookingId, worker, onChanged, notify = false }) => {
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  if (!worker) return null;

  const load = async () => {
    setOpen(true);
    setCandidates(null);
    const { data, error } = await supabase.rpc('booking_assignment_candidates', { p_booking_id: bookingId });
    if (error) {
      toast.error(error.message || 'No hemos podido cargar tu equipo.');
      setOpen(false);
      return;
    }
    setCandidates((data || []) as Candidate[]);
  };

  const assign = async (workerId: string) => {
    setSaving(workerId);
    const { data, error } = await supabase.rpc('assign_booking_worker', { p_booking_id: bookingId, p_worker_id: workerId });
    setSaving(null);
    if (error) {
      toast.error(error.message || 'No se ha podido asignar.');
      return;
    }
    if (notify) {
      // Avisos: a quien pasa a ir, y a cada persona que se queda sin ninguna hora del trabajo.
      const result = (data || {}) as { removedWorkerIds?: string[] };
      void supabase.functions.invoke('send-email-notification', { body: { type: 'job_assigned', bookingId, workerId } });
      (result.removedWorkerIds || []).forEach((removed) => {
        void supabase.functions.invoke('send-email-notification', { body: { type: 'job_unassigned', bookingId, workerId: removed } });
      });
    }
    toast.success(workerId === worker.workerId ? 'Confirmado' : 'Trabajo reasignado');
    setOpen(false);
    onChanged();
  };

  return (
    <div className="mb-3">
      <BookingWorkerLine worker={worker} />
      {!open && (
        <div className="mt-2 flex flex-wrap gap-2">
          {worker.pending && (
            <button
              type="button"
              disabled={saving !== null}
              onClick={() => void assign(worker.workerId)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Confirmar
            </button>
          )}
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            <Users className="h-4 w-4" /> {worker.pending ? 'Elegir a otra persona' : 'Cambiar quién va'}
          </button>
        </div>
      )}
      {open && (
        <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <p className="text-sm font-semibold text-gray-900">¿Quién va?</p>
          <p className="text-xs text-gray-500">Solo aparece quien hace este servicio{' '}y puede hacerlo.</p>
          {candidates === null ? (
            <Loader2 className="mx-auto mt-3 h-5 w-5 animate-spin text-gray-400" />
          ) : (
            <ul className="mt-2 space-y-1.5">
              {candidates.map((c) => {
                const label = c.full_name || 'Sin nombre';
                const disabled = !c.is_free || saving !== null;
                return (
                  <li key={c.user_id}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => void assign(c.user_id)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left text-sm ${
                        c.is_current ? 'border-emerald-600 bg-emerald-50' : 'border-gray-200 bg-white hover:bg-gray-50'
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <span className="font-medium text-gray-900">{label}</span>
                      <span className="shrink-0 text-xs text-gray-600">
                        {saving === c.user_id ? <Loader2 className="h-4 w-4 animate-spin" /> : c.is_current ? 'Va ahora' : c.is_free ? 'Libre' : 'Ocupado a esa hora'}
                      </span>
                    </button>
                  </li>
                );
              })}
              {candidates.length === 0 && <li className="text-sm text-gray-600">Nadie más de tu equipo hace este servicio.</li>}
            </ul>
          )}
          <button type="button" onClick={() => setOpen(false)} className="mt-2 text-sm font-semibold text-gray-600 underline">Cerrar</button>
        </div>
      )}
    </div>
  );
};

export default AssignWorkerControl;
