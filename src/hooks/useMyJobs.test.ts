import { describe, expect, it } from 'vitest';
import { expandMyJobDays, type MyJob } from './useMyJobs';

const base: MyJob = {
  booking_id: 'b', date: '2026-10-05', start_time: '08:00:00', duration_hours: 4, status: 'confirmed',
  service_name: 'Césped', client_address: null, client_name: null, client_phone: null, notes: null,
  company_name: null, assignment_pending: false, finished_at: null, service_start: null, my_hours: [8, 9, 10, 11],
};

describe('expandMyJobDays (GarSer Empresas F7)', () => {
  it('un trabajo de varios días sale en cada día en que la persona va, con sus horas de ese día', () => {
    const multi: MyJob = { ...base, end_date: '2026-10-07', my_days: [{ date: '2026-10-05', hours: [9, 8] }, { date: '2026-10-07', hours: [15, 16] }] };
    expect(expandMyJobDays([multi]).map((d) => `${d.date}:${d.hours.join('-')}`)).toEqual(['2026-10-05:8-9', '2026-10-07:15-16']);
    expect(expandMyJobDays([multi], '2026-10-06').map((d) => d.date)).toEqual(['2026-10-07']);
  });
  it('sin detalle por días (versión anterior), el trabajo sale en su fecha', () => {
    expect(expandMyJobDays([base]).map((d) => `${d.date}:${d.hours.length}`)).toEqual(['2026-10-05:4']);
  });
});
