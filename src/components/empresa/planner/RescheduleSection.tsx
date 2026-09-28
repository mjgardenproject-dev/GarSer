import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { ArrowLeft, CalendarClock, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import { hourLabel, isTeamJob, type ScheduleJob } from '../../../hooks/useCompanySchedule';
import { isMultiDay } from '../../../utils/jobShape';

// Mover un trabajo de fecha (GarSer Empresas F6.3, D9): la dueña elige día y hora entre las que
// alguien de su equipo puede hacer el trabajo, y se lo PROPONE al cliente. Si el cliente acepta se
// mueve solo; si no, no cambia nada.
//
// H-42 (2026-09-28): antes era un bloque al final de la hoja del trabajo, con un selector de fecha
// nativo que en el móvil no respeta el ancho: la hoja hacía scroll lateral y los botones se iban
// con el scroll. Ahora es una página fija a pantalla completa: cabecera arriba, días en rejilla
// (sin scroll lateral), horas con inicio y fin, y «Cancelar / Proponer» siempre abajo.

const DAYS_AHEAD = 28;
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const RescheduleSection: React.FC<{ job: ScheduleJob; onProposed: () => void }> = ({ job, onProposed }) => {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [hours, setHours] = useState<number[] | null>(null);
  const [hour, setHour] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  // En equipo o varios días el fin exacto lo recalcula el servidor al aceptar: solo el inicio.
  const simpleShape = !isTeamJob(job) && !isMultiDay({ date: job.date, endDate: job.end_date });
  const range = (start: number) => (simpleShape ? `${hourLabel(start)}–${hourLabel(start + job.duration)}` : `desde ${hourLabel(start)}`);

  const days = useMemo(() => {
    const start = new Date();
    return Array.from({ length: DAYS_AHEAD }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return { iso: isoDay(d), weekday: format(d, 'EEE', { locale: es }), day: d.getDate(), month: format(d, 'MMM', { locale: es }) };
    });
  }, []);

  useEffect(() => {
    if (!date) return;
    setHours(null);
    setHour(null);
    void supabase.rpc('reschedule_options', { p_booking_id: job.booking_id, p_date: date }).then(({ data, error }) => {
      if (error) toast.error(error.message || 'No hemos podido ver las horas.');
      setHours((data as number[] | null) || []);
    });
  }, [date, job.booking_id]);

  // Página fija: el fondo no se mueve mientras está abierta.
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  if (job.status !== 'confirmed') return null;

  if (job.reschedule_status === 'pending_client' && job.proposed_date) {
    return (
      <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="min-w-0 break-words">
          Esperando al cliente: le has propuesto el {format(parseISO(job.proposed_date), "EEEE d 'de' MMMM", { locale: es })}, {range(job.proposed_start_hour ?? 0)}.
        </span>
      </p>
    );
  }

  const close = () => {
    if (sending) return;
    setOpen(false);
  };

  const propose = async () => {
    if (!date || hour === null) return;
    setSending(true);
    const { error } = await supabase.rpc('propose_booking_reschedule', { p_booking_id: job.booking_id, p_date: date, p_start_hour: hour, p_reason: reason || undefined });
    setSending(false);
    if (error) {
      toast.error(error.message || 'No se ha podido proponer.');
      return;
    }
    // El correo al cliente lo apunta el servidor al guardar la propuesta (prueba real F3).
    toast.success('Propuesta enviada al cliente');
    setOpen(false);
    onProposed();
  };

  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
        <CalendarClock className="h-4 w-4" /> Mover a otra fecha
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[9999] flex flex-col overflow-hidden bg-white" role="dialog" aria-modal="true" aria-labelledby="move-title">
          <header className="flex shrink-0 items-start gap-2 border-b border-gray-200 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
            <button type="button" onClick={close} aria-label="Volver" className="-ml-1 rounded-lg p-1.5 text-gray-600 hover:bg-gray-100">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h2 id="move-title" className="text-lg font-bold text-gray-900">Mover a otra fecha</h2>
              <p className="break-words text-sm text-gray-600">
                {job.service} · ahora el {format(parseISO(job.date), "EEEE d 'de' MMMM", { locale: es })}, {range(job.start_hour)}
              </p>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-4">
            <p className="text-sm text-gray-600">Se lo propondremos al cliente. Si acepta, se mueve solo; si no, se queda como está.</p>

            <h3 className="mt-4 text-sm font-bold text-gray-900">Día</h3>
            <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
              {days.map((d) => (
                <button
                  key={d.iso}
                  type="button"
                  onClick={() => setDate(d.iso)}
                  aria-pressed={date === d.iso}
                  aria-label={`Elegir ${d.weekday} ${d.day} de ${d.month}`}
                  className={`flex min-w-0 flex-col items-center rounded-xl border px-1 py-2 ${date === d.iso ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-gray-200 bg-white text-gray-800'}`}
                >
                  <span className="text-[11px] uppercase">{d.weekday}</span>
                  <span className="text-base font-bold leading-tight">{d.day}</span>
                  <span className="text-[11px]">{d.month}</span>
                </button>
              ))}
            </div>

            {date && (
              <>
                <h3 className="mt-5 text-sm font-bold text-gray-900">Hora</h3>
                {hours === null ? (
                  <Loader2 className="mx-auto mt-3 h-5 w-5 animate-spin text-gray-400" />
                ) : hours.length === 0 ? (
                  <p className="mt-2 text-sm text-gray-600">Ese día no hay nadie de tu equipo libre para hacer este trabajo.</p>
                ) : (
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {hours.map((h) => (
                      <button key={h} type="button" onClick={() => setHour(h)} aria-pressed={hour === h}
                        className={`rounded-xl border py-2.5 text-sm font-semibold ${hour === h ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-gray-200 bg-white text-gray-700'}`}>
                        {range(h)}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            <label htmlFor="move-reason" className="mt-5 block text-sm font-bold text-gray-900">Motivo <span className="font-normal text-gray-500">(lo verá el cliente)</span></label>
            <input id="move-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Por ejemplo: se prevé lluvia" className="mt-1 w-full min-w-0 rounded-xl border border-gray-200 px-3 py-2.5 text-base" />
          </div>

          <footer className="grid shrink-0 grid-cols-2 gap-2 border-t border-gray-200 bg-white px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
            <button type="button" onClick={close} className="rounded-xl border border-gray-200 bg-white px-4 py-3 font-bold text-gray-700">Cancelar</button>
            <button type="button" disabled={hour === null || sending} onClick={() => void propose()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white disabled:opacity-50">
              {sending && <Loader2 className="h-4 w-4 animate-spin" />} Proponer al cliente
            </button>
          </footer>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default RescheduleSection;
