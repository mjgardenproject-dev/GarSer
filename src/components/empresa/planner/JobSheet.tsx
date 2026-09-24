import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2, MapPin, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import { hourLabel, type ScheduleJob, type ScheduleMember } from '../../../hooks/useCompanySchedule';

// Un trabajo en el planificador (GarSer Empresas F6.2): quién hace cada hora y cómo repartirlo
// (D10). Para cada hora solo se ofrece a quien puede hacer el trabajo; quien está ocupado a esa
// hora sale marcado y no se puede elegir: el conflicto se ve ANTES de guardar (F6-03). El
// servidor (assign_booking_hours) lo vuelve a comprobar todo.

interface HourOption { user_id: string; full_name: string; free_hours: number[]; current_hours: number[] }

interface Props {
  job: ScheduleJob;
  members: ScheduleMember[];
  onClose: () => void;
  onSaved: () => void;
}

const JobSheet: React.FC<Props> = ({ job, members, onClose, onSaved }) => {
  const hours = useMemo(() => Array.from({ length: job.duration }, (_, i) => job.start_hour + i), [job]);
  const initial = useMemo(() => hours.map((h) => job.hours.find((x) => x.hour === h)?.worker_id || ''), [hours, job]);
  const [plan, setPlan] = useState<string[]>(initial);
  const [options, setOptions] = useState<HourOption[] | null>(null);
  const [saving, setSaving] = useState(false);
  const editable = (job.status === 'pending' || job.status === 'confirmed') && job.date >= new Date().toISOString().slice(0, 10);
  const nameOf = (id: string) => members.find((m) => m.user_id === id)?.name || options?.find((o) => o.user_id === id)?.full_name || 'Sin asignar';

  useEffect(() => {
    if (!editable) return;
    void supabase.rpc('booking_hour_options', { p_booking_id: job.booking_id }).then(({ data, error }) => {
      if (error) toast.error(error.message || 'No hemos podido cargar quién puede ir.');
      setOptions((data || []) as HourOption[]);
    });
  }, [job.booking_id, editable]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const isFree = (userId: string, hour: number) => !!options?.find((o) => o.user_id === userId)?.free_hours.includes(hour);
  const conflicts = hours.filter((h, i) => plan[i] && options && !isFree(plan[i], h));
  const dirty = plan.some((w, i) => w !== initial[i]);

  const allTo = (userId: string) => setPlan(hours.map(() => userId));

  const save = async () => {
    setSaving(true);
    const { data, error } = await supabase.rpc('assign_booking_hours', { p_booking_id: job.booking_id, p_workers: plan });
    setSaving(false);
    if (error) {
      toast.error(error.message || 'No se ha podido guardar el reparto.');
      return;
    }
    // Avisos solo de trabajos confirmados: quien entra y quien se queda sin ninguna hora.
    if (job.status === 'confirmed') {
      const result = (data || {}) as { addedWorkerIds?: string[]; removedWorkerIds?: string[] };
      (result.addedWorkerIds || []).forEach((workerId) => {
        void supabase.functions.invoke('send-email-notification', { body: { type: 'job_assigned', bookingId: job.booking_id, workerId } });
      });
      (result.removedWorkerIds || []).forEach((workerId) => {
        void supabase.functions.invoke('send-email-notification', { body: { type: 'job_unassigned', bookingId: job.booking_id, workerId } });
      });
    }
    toast.success('Reparto guardado');
    onSaved();
  };

  return createPortal(
    <div className="fixed inset-0 z-[9998] flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="job-sheet-title" onClick={() => !saving && onClose()}>
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="job-sheet-title" className="text-lg font-bold text-gray-900">{job.service}</h2>
            <p className="text-sm text-gray-600">{hourLabel(job.start_hour)}–{hourLabel(job.start_hour + job.duration)}{job.client_name ? ` · ${job.client_name}` : ''}</p>
            {job.address && <p className="mt-1 flex items-start gap-1 text-xs text-gray-500"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />{job.address}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>

        {job.status === 'pending' && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Aún tienes que aceptar este trabajo (en «Solicitudes»).</p>}

        <h3 className="mt-4 text-sm font-bold text-gray-900">Quién hace cada hora</h3>
        {!editable ? (
          <ul className="mt-2 space-y-1.5">
            {hours.map((h, i) => (
              <li key={h} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
                <span className="font-medium text-gray-700">{hourLabel(h)}</span>
                <span className="text-gray-900">{nameOf(initial[i])}</span>
              </li>
            ))}
          </ul>
        ) : options === null ? (
          <Loader2 className="mx-auto mt-4 h-5 w-5 animate-spin text-gray-400" />
        ) : (
          <>
            <ul className="mt-2 space-y-1.5">
              {hours.map((h, i) => {
                const conflict = plan[i] && !isFree(plan[i], h);
                return (
                  <li key={h} className={`flex items-center gap-3 rounded-lg px-3 py-2 ${conflict ? 'bg-red-50' : 'bg-gray-50'}`}>
                    <label htmlFor={`hour-${h}`} className="w-12 shrink-0 text-sm font-medium text-gray-700">{hourLabel(h)}</label>
                    <select
                      id={`hour-${h}`}
                      value={plan[i]}
                      onChange={(e) => setPlan((p) => p.map((w, j) => (j === i ? e.target.value : w)))}
                      className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2 py-2 text-base"
                    >
                      {options.map((o) => (
                        <option key={o.user_id} value={o.user_id} disabled={!o.free_hours.includes(h)}>
                          {o.full_name}{o.free_hours.includes(h) ? '' : ' (ocupado)'}
                        </option>
                      ))}
                    </select>
                  </li>
                );
              })}
            </ul>
            {options.length > 1 && (
              <div className="mt-3">
                <p className="text-xs text-gray-500">Todo el trabajo a una persona:</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {options.filter((o) => hours.every((h) => o.free_hours.includes(h))).map((o) => (
                    <button key={o.user_id} type="button" onClick={() => allTo(o.user_id)} className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                      {o.full_name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {conflicts.length > 0 && (
              <p className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Alguien está ocupado a las {conflicts.map(hourLabel).join(', ')}. Elige a otra persona.
              </p>
            )}
            <button
              type="button"
              disabled={!dirty || saving || conflicts.length > 0 || plan.some((w) => !w)}
              onClick={() => void save()}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving && <Loader2 className="h-5 w-5 animate-spin" />} Guardar reparto
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default JobSheet;
