import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// Quién va a cada reserva de una empresa (GarSer Empresas F4): la persona de sus horas en la
// agenda (booking_blocks.assignee_id), y si es solo una propuesta (modo «yo elijo quién va»).
// Para un autónomo no aporta nada (siempre es él): quien lo usa lo activa solo para empresas.

export interface BookingWorker {
  workerId: string;
  name: string | null;
  isMe: boolean;
  pending: boolean;
  /** F6 (D10): todas las personas del trabajo, con sus horas, si está repartido. */
  people: Array<{ workerId: string; name: string | null; isMe: boolean; hours: number[] }>;
}

export function useBookingWorkers(
  bookings: Array<{ id: string; assignment_pending?: boolean | null }>,
  { enabled, myId, version = 0 }: { enabled: boolean; myId?: string | null; version?: number },
) {
  const [workers, setWorkers] = useState<Record<string, BookingWorker>>({});
  const key = bookings.map((b) => `${b.id}:${b.assignment_pending ? 1 : 0}`).join(',');

  useEffect(() => {
    if (!enabled || bookings.length === 0) {
      setWorkers({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const ids = bookings.map((b) => b.id);
      const [{ data: blocks }, { data: rows }] = await Promise.all([
        supabase.from('booking_blocks').select('booking_id, assignee_id, hour_block').in('booking_id', ids),
        supabase.from('bookings').select('id, assignment_pending').in('id', ids),
      ]);
      const pendingById = new Map((rows || []).map((r) => [r.id, Boolean(r.assignment_pending)]));
      const byBooking = new Map<string, Map<string, number[]>>();
      (blocks || []).forEach((row) => {
        if (!row.booking_id || !row.assignee_id) return;
        const people = byBooking.get(row.booking_id) || new Map<string, number[]>();
        people.set(row.assignee_id, [...(people.get(row.assignee_id) || []), Number(row.hour_block)]);
        byBooking.set(row.booking_id, people);
      });
      const workerIds = [...new Set([...byBooking.values()].flatMap((people) => [...people.keys()]))];
      const { data: people } = workerIds.length
        ? await supabase.from('profiles').select('user_id, full_name').in('user_id', workerIds)
        : { data: [] };
      const names = new Map<string, string | null>();
      (people || []).forEach((p) => { if (p.user_id) names.set(p.user_id, p.full_name); });
      if (cancelled) return;
      const next: Record<string, BookingWorker> = {};
      bookings.forEach((b) => {
        const people = [...(byBooking.get(b.id) || new Map<string, number[]>()).entries()]
          .map(([id, hours]) => ({ workerId: id, name: names.get(id)?.trim() || null, isMe: id === myId, hours: hours.sort((x, y) => x - y) }))
          .sort((x, y) => x.hours[0] - y.hours[0]);
        if (people.length === 0) return;
        next[b.id] = {
          workerId: people[0].workerId,
          name: people[0].name,
          isMe: people[0].isMe,
          pending: pendingById.get(b.id) ?? Boolean(b.assignment_pending),
          people,
        };
      });
      setWorkers(next);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, myId, version]);

  return workers;
}
