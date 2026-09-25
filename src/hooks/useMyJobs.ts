import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

// Trabajos de quien tiene la sesión entre dos fechas (my_jobs, GarSer Empresas F5.2): solo los
// suyos, con lo justo para hacerlos.

export interface MyJob {
  booking_id: string;
  date: string;
  start_time: string;
  duration_hours: number;
  status: string;
  service_name: string;
  client_address: string | null;
  client_name: string | null;
  client_phone: string | null;
  notes: string | null;
  company_name: string | null;
  assignment_pending: boolean;
  finished_at: string | null;
  service_start: string | null;
  /** F6 (D10): las horas del trabajo que son de esta persona (si está repartido, no todas). */
  my_hours: number[] | null;
  /** F7: último día (varios días), horas de trabajo (equipo o varios días) y cuántos van. */
  end_date?: string | null;
  labour_hours?: number | null;
  team_size?: number | null;
  /** F7: las horas de esta persona en cada día del trabajo. */
  my_days?: Array<{ date: string; hours: number[] }> | null;
}

/** Un día de trabajo de esta persona: un trabajo de varios días sale una vez por día. */
export interface MyJobDay { job: MyJob; date: string; hours: number[] }

/**
 * F7: los trabajos de la persona, día a día (solo los días en que va), entre dos fechas. Sin el
 * detalle por días (versión anterior), el trabajo sale en su fecha con sus horas.
 */
export function expandMyJobDays(jobs: MyJob[], from?: string, to?: string): MyJobDay[] {
  const out: MyJobDay[] = [];
  jobs.forEach((job) => {
    const days = job.my_days && job.my_days.length > 0
      ? job.my_days
      : [{ date: job.date, hours: job.my_hours || [] }];
    days.forEach((d) => {
      const date = String(d.date).slice(0, 10);
      if ((from && date < from) || (to && date > to)) return;
      out.push({ job, date, hours: [...(d.hours || [])].sort((a, b) => a - b) });
    });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.hours[0] ?? 0) - (b.hours[0] ?? 0));
}

export function useMyJobs(from: string, to: string) {
  const [jobs, setJobs] = useState<MyJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc('my_jobs', { p_from: from, p_to: to });
    if (mine !== seq.current) return;
    if (rpcError) setError(rpcError.message || 'No hemos podido cargar tus trabajos.');
    else {
      setJobs((data || []) as unknown as MyJob[]);
      setError(null);
    }
    setLoading(false);
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  return { jobs, loading, error, refresh: load };
}
