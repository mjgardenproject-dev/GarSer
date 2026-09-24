import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

// Agenda de la empresa entre dos fechas (company_schedule, GarSer Empresas F6.1): equipo, horas
// libres de cada persona y trabajos con quién hace cada hora. Solo para el dueño.

export interface ScheduleMember { user_id: string; name: string; role: 'owner' | 'employee' | 'manager'; works: boolean }
export interface ScheduleFree { user_id: string; date: string; hours: number[] }
export interface ScheduleJob {
  booking_id: string;
  date: string;
  start_hour: number;
  duration: number;
  status: string;
  service: string;
  client_name: string | null;
  address: string | null;
  assignment_pending: boolean;
  hours: Array<{ hour: number; worker_id: string }>;
}
export interface CompanySchedule { members: ScheduleMember[]; free: ScheduleFree[]; jobs: ScheduleJob[] }

export function useCompanySchedule(from: string, to: string) {
  const [data, setData] = useState<CompanySchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    const { data: rows, error: rpcError } = await supabase.rpc('company_schedule', { p_from: from, p_to: to });
    if (mine !== seq.current) return;
    if (rpcError) setError(rpcError.message || 'No hemos podido cargar la agenda.');
    else {
      setData(rows as unknown as CompanySchedule);
      setError(null);
    }
    setLoading(false);
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  return { data, loading, error, refresh: load };
}

/** Quién hace qué horas de un trabajo, agrupado por persona y en orden. */
export function workersOfJob(job: ScheduleJob): Array<{ worker_id: string; hours: number[] }> {
  const map = new Map<string, number[]>();
  job.hours.forEach(({ hour, worker_id }) => map.set(worker_id, [...(map.get(worker_id) || []), hour]));
  return [...map.entries()]
    .map(([worker_id, hours]) => ({ worker_id, hours: hours.sort((a, b) => a - b) }))
    .sort((a, b) => a.hours[0] - b.hours[0]);
}

export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;
export const rangeLabel = (hours: number[]) =>
  hours.length ? `${hourLabel(Math.min(...hours))}–${hourLabel(Math.max(...hours) + 1)}` : '';
