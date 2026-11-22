import { describe, expect, it } from 'vitest';

import { summarizeUpcomingJobs } from './teamUpcomingJobs';

describe('próximos trabajos de cada persona del equipo (QA-070)', () => {
  const bookings = [
    { id: 'b1', date: '2026-11-20', start_time: '10:00:00', service_name: 'Corte de césped' },
    { id: 'b2', date: '2026-11-19', start_time: '08:00:00', service_name: 'Poda de setos' },
    { id: 'b3', date: '2026-11-21', start_time: '09:00:00', service_name: 'Poda de palmeras' },
  ];

  it('cuenta cada reserva una vez por persona y da la más próxima', () => {
    const blocks = [
      { booking_id: 'b1', assignee_id: 'marta' }, { booking_id: 'b1', assignee_id: 'marta' },
      { booking_id: 'b2', assignee_id: 'marta' },
      { booking_id: 'b3', assignee_id: 'antonio' },
    ];
    const summary = summarizeUpcomingJobs(bookings, blocks);
    expect(summary.marta).toEqual({ count: 2, next: { bookingId: 'b2', date: '2026-11-19', startTime: '08:00', serviceName: 'Poda de setos' } });
    expect(summary.antonio.count).toBe(1);
  });

  it('un trabajo repartido entre dos personas cuenta para las dos', () => {
    const summary = summarizeUpcomingJobs(bookings, [
      { booking_id: 'b3', assignee_id: 'marta' }, { booking_id: 'b3', assignee_id: 'antonio' },
    ]);
    expect(summary.marta.count).toBe(1);
    expect(summary.antonio.count).toBe(1);
  });

  it('ignora horas sin persona o de reservas que no están en la lista', () => {
    const summary = summarizeUpcomingJobs(bookings, [
      { booking_id: 'b1', assignee_id: null }, { booking_id: 'otra', assignee_id: 'marta' },
    ]);
    expect(summary).toEqual({});
  });
});
