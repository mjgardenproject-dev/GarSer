import { useEffect, useState } from 'react';
import { format } from 'date-fns';

import { supabase } from '../lib/supabase';
import { summarizeUpcomingJobs, type MemberUpcomingJobs } from '../utils/teamUpcomingJobs';

/** QA-070: próximos trabajos (pendientes o confirmados, desde hoy) de cada persona de la empresa. */
export function useTeamUpcomingJobs(providerId: string | undefined, version = 0) {
  const [byPerson, setByPerson] = useState<Record<string, MemberUpcomingJobs>>({});

  useEffect(() => {
    if (!providerId) return;
    let cancelled = false;
    void (async () => {
      const today = format(new Date(), 'yyyy-MM-dd');
      const { data: bookings, error } = await supabase
        .from('bookings')
        .select('id, date, start_time, services(name)')
        .eq('gardener_id', providerId)
        .in('status', ['pending', 'confirmed'])
        .gte('date', today)
        .order('date', { ascending: true })
        .limit(200);
      if (cancelled || error || !bookings?.length) {
        if (!cancelled) setByPerson({});
        return;
      }
      const ids = bookings.map((b) => b.id);
      const { data: blocks } = await supabase.from('booking_blocks').select('booking_id, assignee_id').in('booking_id', ids);
      if (cancelled) return;
      setByPerson(
        summarizeUpcomingJobs(
          bookings.map((b) => ({
            id: b.id,
            date: b.date,
            start_time: b.start_time,
            service_name: (b as { services?: { name?: string | null } | null }).services?.name ?? null,
          })),
          blocks || [],
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [providerId, version]);

  return byPerson;
}
