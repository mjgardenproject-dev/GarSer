/**
 * QA-070: qué trabajos tiene asignados cada persona del equipo. Hasta ahora solo lo enseñaba la
 * agenda; la pestaña «Equipo» no decía quién iba a qué. La asignación real son las horas de cada
 * reserva en `booking_blocks.assignee_id` (la misma fuente que usa la agenda).
 */

export interface UpcomingBookingRow {
  id: string;
  date: string;
  start_time: string | null;
  service_name: string | null;
}

export interface UpcomingBlockRow {
  booking_id: string | null;
  assignee_id: string | null;
}

export interface MemberUpcomingJobs {
  count: number;
  next: { bookingId: string; date: string; startTime: string; serviceName: string | null } | null;
}

export function summarizeUpcomingJobs(
  bookings: UpcomingBookingRow[],
  blocks: UpcomingBlockRow[],
): Record<string, MemberUpcomingJobs> {
  const byId = new Map(bookings.map((b) => [b.id, b]));
  const bookingsByPerson = new Map<string, Set<string>>();
  for (const block of blocks) {
    if (!block.assignee_id || !block.booking_id || !byId.has(block.booking_id)) continue;
    const set = bookingsByPerson.get(block.assignee_id) || new Set<string>();
    set.add(block.booking_id);
    bookingsByPerson.set(block.assignee_id, set);
  }

  const summary: Record<string, MemberUpcomingJobs> = {};
  for (const [person, ids] of bookingsByPerson) {
    const sorted = [...ids]
      .map((id) => byId.get(id)!)
      .sort((a, b) => `${a.date} ${a.start_time || ''}`.localeCompare(`${b.date} ${b.start_time || ''}`));
    const first = sorted[0];
    summary[person] = {
      count: ids.size,
      next: first
        ? { bookingId: first.id, date: first.date, startTime: String(first.start_time || '').slice(0, 5), serviceName: first.service_name }
        : null,
    };
  }
  return summary;
}
