import { describe, it, expect } from 'vitest';
import { groupClientBookings, type OverviewBooking } from './clientBookingsOverview';

const NOW = new Date('2026-08-25T12:00:00').getTime();

const booking = (over: Partial<OverviewBooking> & { id: string }): OverviewBooking => ({
  status: 'confirmed',
  date: '2026-09-10',
  start_time: '09:00:00',
  duration_hours: 2,
  client_address: 'Marbella',
  gardener_id: 'g1',
  service_id: 's1',
  service_name: 'Poda de setos',
  gardener_name: 'Miguel Ángel Ruiz',
  total_price: 100,
  management_fee: 11.25,
  client_total_price: 101.25,
  management_fee_source: 'column',
  notes: null,
  media_urls: [],
  price_change_status: null,
  proposed_total_price: null,
  proposed_price_reason: null,
  review_rating: null,
  ...over,
});

describe('groupClientBookings', () => {
  it('lleva pendientes y confirmadas futuras a "próximas", ordenadas por fecha', () => {
    const result = groupClientBookings(
      [
        booking({ id: 'tarde', date: '2026-09-20' }),
        booking({ id: 'pronto', date: '2026-09-01' }),
        booking({ id: 'pendiente', date: '2026-09-10', status: 'pending' }),
      ],
      NOW,
    );
    expect(result.upcoming.map((b) => b.id)).toEqual(['pronto', 'pendiente', 'tarde']);
    expect(result.closed).toHaveLength(0);
  });

  it('separa las completadas según tengan valoración o no', () => {
    const result = groupClientBookings(
      [
        booking({ id: 'sin-valorar', status: 'completed', date: '2026-08-01' }),
        booking({ id: 'valorada', status: 'completed', date: '2026-08-02', review_rating: 4.5 }),
      ],
      NOW,
    );
    expect(result.toReview.map((b) => b.id)).toEqual(['sin-valorar']);
    expect(result.reviewed.map((b) => b.id)).toEqual(['valorada']);
  });

  it('mantiene una confirmada de hoy en "próximas" hasta 24 h después', () => {
    const result = groupClientBookings(
      [booking({ id: 'esta-manana', date: '2026-08-25', start_time: '08:00:00' })],
      NOW,
    );
    expect(result.upcoming.map((b) => b.id)).toEqual(['esta-manana']);
  });

  it('recoge en "otras" lo cancelado, lo caducado y cualquier estado desconocido', () => {
    const result = groupClientBookings(
      [
        booking({ id: 'cancelada', status: 'cancelled', date: '2026-08-01' }),
        booking({ id: 'caducada', status: 'confirmed', date: '2026-01-01' }),
        booking({ id: 'inventado', status: 'un_estado_futuro', date: '2026-08-01' }),
      ],
      NOW,
    );
    // Ninguna reserva puede evaporarse de la pantalla: lo que no encaja arriba, cae aquí.
    expect(result.closed.map((b) => b.id).sort()).toEqual(['caducada', 'cancelada', 'inventado']);
  });

  it('no pierde ni duplica ninguna reserva al repartir', () => {
    const rows = [
      booking({ id: 'a' }),
      booking({ id: 'b', status: 'completed', date: '2026-08-01' }),
      booking({ id: 'c', status: 'completed', date: '2026-08-02', review_rating: 5 }),
      booking({ id: 'd', status: 'cancelled', date: '2026-08-03' }),
    ];
    const { upcoming, toReview, reviewed, closed } = groupClientBookings(rows, NOW);
    const todas = [...upcoming, ...toReview, ...reviewed, ...closed].map((b) => b.id);
    expect(todas.sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(new Set(todas).size).toBe(4);
  });

  it('marca isEmpty solo cuando no hay ninguna reserva', () => {
    expect(groupClientBookings([], NOW).isEmpty).toBe(true);
    expect(groupClientBookings([booking({ id: 'a' })], NOW).isEmpty).toBe(false);
  });
});
