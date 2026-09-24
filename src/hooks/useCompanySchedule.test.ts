import { describe, expect, it } from 'vitest';
import { daysOfJob, isTeamJob, rangeLabel, workersOfJob, type ScheduleJob } from './useCompanySchedule';

const job = (hours: Array<[number, string]>): ScheduleJob => ({
  booking_id: 'b', date: '2026-10-01', start_hour: hours[0][0], duration: hours.length, status: 'confirmed',
  service: 'Corte de césped', client_name: 'Laura', address: null, assignment_pending: false,
  hours: hours.map(([hour, worker_id]) => ({ hour, worker_id })),
});

describe('workersOfJob / rangeLabel (GarSer Empresas F6.2)', () => {
  it('agrupa las horas por persona, en orden de entrada', () => {
    expect(workersOfJob(job([[11, 'luis'], [9, 'ana'], [10, 'luis']]))).toEqual([
      { worker_id: 'ana', hours: [9] },
      { worker_id: 'luis', hours: [10, 11] },
    ]);
  });
  it('rango legible de unas horas', () => {
    expect(rangeLabel([10, 11])).toBe('10:00–12:00');
    expect(rangeLabel([])).toBe('');
  });
});

describe('trabajos de equipo y de varios días (GarSer Empresas F7)', () => {
  const multi: ScheduleJob = {
    booking_id: 'm', date: '2026-10-05', start_hour: 8, duration: 4, status: 'confirmed', service: 'Césped',
    client_name: null, address: null, assignment_pending: false, end_date: '2026-10-06', labour_hours: 12,
    hours: [
      { date: '2026-10-05', hour: 8, worker_id: 'ana' }, { date: '2026-10-05', hour: 8, worker_id: 'luis' },
      { date: '2026-10-05', hour: 9, worker_id: 'ana' }, { date: '2026-10-05', hour: 9, worker_id: 'luis' },
      { date: '2026-10-06', hour: 15, worker_id: 'luis' }, { date: '2026-10-06', hour: 16, worker_id: 'luis' },
    ],
  };
  it('reparte por día y persona', () => {
    expect(daysOfJob(multi)).toEqual(['2026-10-05', '2026-10-06']);
    expect(workersOfJob(multi, '2026-10-06')).toEqual([{ worker_id: 'luis', hours: [15, 16] }]);
    expect(workersOfJob(multi, '2026-10-05').map((w) => w.worker_id)).toEqual(['ana', 'luis']);
    expect(isTeamJob(multi)).toBe(true);
    expect(isTeamJob(job([[9, 'ana']]))).toBe(false);
  });
});
