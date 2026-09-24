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
