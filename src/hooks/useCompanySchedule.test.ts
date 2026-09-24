import { describe, expect, it } from 'vitest';
import { rangeLabel, workersOfJob, type ScheduleJob } from './useCompanySchedule';

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
