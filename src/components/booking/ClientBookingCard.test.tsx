// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./WhoIsComing', () => ({ default: () => null }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));

import ClientBookingCard, { type ClientBookingCardBooking } from './ClientBookingCard';

// H-44: tras cambiar la fecha o la duración, el cliente solo veía la hora de inicio.
const base: ClientBookingCardBooking = {
  id: 'b1', status: 'confirmed', date: '2026-10-05', start_time: '09:00:00', duration_hours: 4,
  service_name: 'Corte de césped', gardener_name: 'Jardines Sol', gardener_is_company: true,
};
const text = (booking: ClientBookingCardBooking) => {
  const { container } = render(<ClientBookingCard booking={booking} />);
  return container.textContent || '';
};

describe('ClientBookingCard: hora de fin (H-44)', () => {
  afterEach(() => cleanup());

  it('la reserva enseña inicio y fin', () => {
    expect(text(base)).toContain('09:00 – 13:00 · 4 h');
  });

  it('la propuesta de otra fecha dice de qué hora a qué hora', () => {
    const t = text({ ...base, reschedule_status: 'pending_client', proposed_date: '2026-09-30', proposed_start_time: '12:00:00' });
    expect(t).toContain('de 12:00 a 16:00');
  });

  it('propuesta solo de duración: no dice «nuevo precio» y enseña el nuevo fin (H-40)', () => {
    const t = text({ ...base, duration_hours: 2, total_price: 54, price_change_status: 'pending_client_acceptance', proposed_total_price: 54, proposed_duration_hours: 3 });
    expect(t).toContain('propone cambiar la duración del servicio');
    expect(t).not.toContain('nuevo precio del servicio');
    expect(t).toContain('Nueva duración: 3 h (fin a las 12:00) — antes 2 h');
    expect(t).toContain('Aceptar el cambio');
  });

  it('en un trabajo de equipo la propuesta dice «desde» (el fin se calcula al aceptar)', () => {
    const t = text({ ...base, labour_hours: 8, reschedule_status: 'pending_client', proposed_date: '2026-09-30', proposed_start_time: '12:00:00' });
    expect(t).toContain('desde las 12:00');
    expect(t).not.toContain('de 12:00 a');
  });
});
