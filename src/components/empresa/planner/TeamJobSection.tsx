import React, { useEffect, useState } from 'react';
import { Loader2, Repeat } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import { daysOfJob, rangeLabel, workersOfJob, type ScheduleJob, type ScheduleMember } from '../../../hooks/useCompanySchedule';
import { formatWeekdayDay } from '../../../utils/jobShape';

// Trabajo de equipo o de varios días en la hoja del trabajo (GarSer Empresas F7, A-41): quién va
// cada día y a qué horas, y cambiar a una persona por otra en todo lo que le queda del trabajo.
// No se reparte hora a hora: con varias personas a la vez o varios días no tiene sentido.

interface Candidate { user_id: string; full_name: string; is_free: boolean }

const ReplaceRow: React.FC<{ job: ScheduleJob; workerId: string; name: string; editable: boolean; onReplaced: () => void }> = ({ job, workerId, name, editable, onReplaced }) => {
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    void supabase.rpc('booking_replace_candidates', { p_booking_id: job.booking_id, p_from: workerId }).then(({ data, error }) => {
      if (error) toast.error(error.message || 'No hemos podido ver quién puede ir.');
      setCandidates((data || []) as Candidate[]);
    });
  }, [open, job.booking_id, workerId]);

  const replace = async (to: Candidate) => {
    setSaving(true);
    const { data, error } = await supabase.rpc('replace_booking_worker', { p_booking_id: job.booking_id, p_from: workerId, p_to: to.user_id });
    setSaving(false);
    if (error) {
      toast.error(error.message || 'No se ha podido cambiar.');
      return;
    }
    // Avisos solo de trabajos confirmados, como al repartir (A-36).
    if (job.status === 'confirmed') {
      const result = (data || {}) as { addedWorkerIds?: string[]; removedWorkerIds?: string[] };
      (result.addedWorkerIds || []).forEach((id) => {
        void supabase.functions.invoke('send-email-notification', { body: { type: 'job_assigned', bookingId: job.booking_id, workerId: id } });
      });
      (result.removedWorkerIds || []).forEach((id) => {
        void supabase.functions.invoke('send-email-notification', { body: { type: 'job_unassigned', bookingId: job.booking_id, workerId: id } });
      });
    }
    toast.success(`${to.full_name} va en lugar de ${name}`);
    onReplaced();
  };

  return (
    <li className="rounded-lg bg-gray-50 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 break-words text-sm font-medium text-gray-900">{name}</span>
        {editable && (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-emerald-700 hover:bg-emerald-50">
            <Repeat className="h-4 w-4" /> Cambiar
          </button>
        )}
      </div>
      {open && (
        candidates === null ? <Loader2 className="mx-auto mt-2 h-4 w-4 animate-spin text-gray-400" /> : (
          <div className="mt-2">
            <p className="text-xs text-gray-500">Quién puede ir en su lugar (en todo lo que le queda del trabajo):</p>
            {candidates.length === 0 ? <p className="mt-1 text-sm text-gray-600">No hay nadie más que haga este servicio.</p> : (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {candidates.map((c) => (
                  <button key={c.user_id} type="button" disabled={!c.is_free || saving} onClick={() => void replace(c)}
                    className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">
                    {c.full_name}{c.is_free ? '' : ' (ocupado)'}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      )}
    </li>
  );
};

const TeamJobSection: React.FC<{ job: ScheduleJob; members: ScheduleMember[]; editable: boolean; onChanged: () => void }> = ({ job, members, editable, onChanged }) => {
  const nameOf = (id: string) => members.find((m) => m.user_id === id)?.name || 'Sin nombre';
  const days = daysOfJob(job);
  const people = workersOfJob(job);

  return (
    <>
      <h3 className="mt-4 text-sm font-bold text-gray-900">{days.length > 1 ? 'Quién va cada día' : 'Quién va'}</h3>
      <ul className="mt-2 space-y-1.5">
        {days.map((d) => (
          <li key={d} className="rounded-lg border border-gray-100 px-3 py-2 text-sm">
            {days.length > 1 && <p className="font-semibold capitalize text-gray-800">{formatWeekdayDay(d)}</p>}
            <ul className="text-gray-700">
              {workersOfJob(job, d).map((w) => (
                <li key={w.worker_id} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 break-words">{nameOf(w.worker_id)}</span>
                  <span className="shrink-0 tabular-nums">{rangeLabel(w.hours)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <h3 className="mt-4 text-sm font-bold text-gray-900">Personas</h3>
      <ul className="mt-2 space-y-1.5">
        {people.map((p) => (
          <ReplaceRow key={p.worker_id} job={job} workerId={p.worker_id} name={nameOf(p.worker_id)} editable={editable} onReplaced={onChanged} />
        ))}
      </ul>
    </>
  );
};

export default TeamJobSection;
