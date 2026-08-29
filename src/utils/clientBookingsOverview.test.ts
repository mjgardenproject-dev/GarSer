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
  confirmation_deadline_at: null,
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

  it('mantiene una confirmada de hoy en "próximas" mientras el servicio no haya terminado', () => {
    // Empieza a las 11:00, dura 2 h → termina a las 13:00. NOW son las 12:00: todavía en curso.
    const result = groupClientBookings(
      [booking({ id: 'en-curso', date: '2026-08-25', start_time: '11:00:00', duration_hours: 2 })],
      NOW,
    );
    expect(result.upcoming.map((b) => b.id)).toEqual(['en-curso']);
    expect(result.toConfirm).toHaveLength(0);
  });

  it('mueve a "toConfirm" -no a "próximas"- una confirmada cuyo servicio ya terminó', () => {
    // Antes esta reserva se quedaba en "próximas" durante 24 h desde el INICIO y luego
    // desaparecía sin más: el hueco exacto que permitía cobrar un servicio sin preguntar nada.
    // Empieza a las 08:00, dura 2 h → termina a las 10:00. NOW son las 12:00: ya terminó.
    const result = groupClientBookings(
      [booking({ id: 'esta-manana', date: '2026-08-25', start_time: '08:00:00', duration_hours: 2 })],
      NOW,
    );
    expect(result.toConfirm.map((b) => b.id)).toEqual(['esta-manana']);
    expect(result.upcoming).toHaveLength(0);
  });

  it('"toConfirm" va antes que "upcoming" y ordena por fecha de servicio', () => {
    const result = groupClientBookings(
      [
        booking({ id: 'tarde', date: '2026-08-20', start_time: '08:00:00', duration_hours: 1 }),
        booking({ id: 'pronto', date: '2026-08-10', start_time: '08:00:00', duration_hours: 1 }),
      ],
      NOW,
    );
    expect(result.toConfirm.map((b) => b.id)).toEqual(['pronto', 'tarde']);
  });

  it('agrupa las incidencias abiertas en "inReview", sin cerrarlas ni cobrarlas', () => {
    const result = groupClientBookings(
      [booking({ id: 'disputada', status: 'disputed', date: '2026-08-01' })],
      NOW,
    );
    expect(result.inReview.map((b) => b.id)).toEqual(['disputada']);
    expect(result.closed).toHaveLength(0);
  });

  it('recoge en "otras" lo cancelado y cualquier estado desconocido', () => {
    const result = groupClientBookings(
      [
        booking({ id: 'cancelada', status: 'cancelled', date: '2026-08-01' }),
        booking({ id: 'inventado', status: 'un_estado_futuro', date: '2026-08-01' }),
      ],
      NOW,
    );
    // Ninguna reserva puede evaporarse de la pantalla: lo que no encaja arriba, cae aquí.
    expect(result.closed.map((b) => b.id).sort()).toEqual(['cancelada', 'inventado']);
  });

  it('una confirmada muy antigua sigue pidiendo confirmación, no se esconde en "otras"', () => {
    // Si por lo que sea el reloj no la cerró, es más honesto seguir pidiendo la confirmación
    // que darla por perdida en el cajón de sastre.
    const result = groupClientBookings(
      [booking({ id: 'caducada', status: 'confirmed', date: '2026-01-01' })],
      NOW,
    );
    expect(result.toConfirm.map((b) => b.id)).toEqual(['caducada']);
    expect(result.closed).toHaveLength(0);
  });

  it('no pierde ni duplica ninguna reserva al repartir', () => {
    const rows = [
      booking({ id: 'a' }),
      booking({ id: 'b', status: 'completed', date: '2026-08-01' }),
      booking({ id: 'c', status: 'completed', date: '2026-08-02', review_rating: 5 }),
      booking({ id: 'd', status: 'cancelled', date: '2026-08-03' }),
    ];
    const { toConfirm, upcoming, toReview, reviewed, inReview, closed } = groupClientBookings(rows, NOW);
    const todas = [...toConfirm, ...upcoming, ...toReview, ...reviewed, ...inReview, ...closed].map((b) => b.id);
    expect(todas.sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(new Set(todas).size).toBe(4);
  });

  it('marca isEmpty solo cuando no hay ninguna reserva', () => {
    expect(groupClientBookings([], NOW).isEmpty).toBe(true);
    expect(groupClientBookings([booking({ id: 'a' })], NOW).isEmpty).toBe(false);
  });
});
