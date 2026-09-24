import React, { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { CalendarClock, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import { hourLabel, type ScheduleJob } from '../../../hooks/useCompanySchedule';

// Mover un trabajo de fecha (GarSer Empresas F6.3, D9): la dueña elige día y hora entre las que
// alguien de su equipo puede hacer el trabajo, y se lo PROPONE al cliente. Si el cliente acepta se
// mueve solo; si no, no cambia nada.

const RescheduleSection: React.FC<{ job: ScheduleJob; onProposed: () => void }> = ({ job, onProposed }) => {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [hours, setHours] = useState<number[] | null>(null);
  const [hour, setHour] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!date) return;
    setHours(null);
    setHour(null);
    void supabase.rpc('reschedule_options', { p_booking_id: job.booking_id, p_date: date }).then(({ data, error }) => {
      if (error) toast.error(error.message || 'No hemos podido ver las horas.');
      setHours((data as number[] | null) || []);
    });
  }, [date, job.booking_id]);

  if (job.status !== 'confirmed') return null;

  if (job.reschedule_status === 'pending_client' && job.proposed_date) {
    return (
      <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
        Esperando al cliente: le has propuesto el {format(parseISO(job.proposed_date), "EEEE d 'de' MMMM", { locale: es })} a las {hourLabel(job.proposed_start_hour ?? 0)}.
      </p>
    );
  }

  const propose = async () => {
    if (!date || hour === null) return;
    setSending(true);
    const { error } = await supabase.rpc('propose_booking_reschedule', { p_booking_id: job.booking_id, p_date: date, p_start_hour: hour, p_reason: reason || undefined });
    setSending(false);
    if (error) {
      toast.error(error.message || 'No se ha podido proponer.');
      return;
    }
    void supabase.functions.invoke('send-email-notification', { body: { type: 'booking_reschedule_proposed', bookingId: job.booking_id } });
    toast.success('Propuesta enviada al cliente');
    onProposed();
  };

  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
          <CalendarClock className="h-4 w-4" /> Mover a otra fecha
        </button>
      ) : (
        <>
          <h3 className="text-sm font-bold text-gray-900">Mover a otra fecha</h3>
          <p className="text-xs text-gray-500">Se lo propondremos al cliente. Si acepta, se mueve solo; si no, se queda como está.</p>
          <label htmlFor="move-date" className="mt-3 block text-sm font-medium text-gray-700">Día</label>
          <input id="move-date" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-base" />
          {date && (
            hours === null ? (
              <Loader2 className="mx-auto mt-3 h-5 w-5 animate-spin text-gray-400" />
            ) : hours.length === 0 ? (
              <p className="mt-3 text-sm text-gray-600">Ese día no hay nadie de tu equipo libre para hacer este trabajo.</p>
            ) : (
              <div className="mt-3">
                <p className="text-sm font-medium text-gray-700">Hora de inicio</p>
                <div className="mt-1 grid grid-cols-4 gap-1.5">
                  {hours.map((h) => (
                    <button key={h} type="button" onClick={() => setHour(h)} aria-pressed={hour === h}
                      className={`rounded-lg border py-2 text-sm font-semibold ${hour === h ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-gray-200 bg-white text-gray-700'}`}>
                      {hourLabel(h)}
                    </button>
                  ))}
                </div>
              </div>
            )
          )}
          <label htmlFor="move-reason" className="mt-3 block text-sm font-medium text-gray-700">Motivo (lo verá el cliente)</label>
          <input id="move-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Por ejemplo: se prevé lluvia" className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-base" />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 font-bold text-gray-700">Cancelar</button>
            <button type="button" disabled={hour === null || sending} onClick={() => void propose()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 font-bold text-white disabled:opacity-50">
              {sending && <Loader2 className="h-4 w-4 animate-spin" />} Proponer
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default RescheduleSection;
