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

describe('ClientBookingCard: valoración enviada (QA-116)', () => {
  afterEach(() => cleanup());

  it('se puede abrir para verla y corregirla', async () => {
    const { fireEvent, screen } = await import('@testing-library/react');
    const onReview = vi.fn();
    render(<ClientBookingCard booking={{ ...base, status: 'completed', review_rating: 4 }} onReview={onReview} />);
    expect(screen.queryByText('Dejar mi valoración')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Ver o editar mi valoración/ }));
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it('sin valorar ofrece «Dejar mi valoración»', async () => {
    const { screen } = await import('@testing-library/react');
    render(<ClientBookingCard booking={{ ...base, status: 'completed', review_rating: null }} onReview={vi.fn()} />);
    expect(screen.getByText('Dejar mi valoración')).toBeTruthy();
  });
});

describe('ClientBookingCard: solicitud caducada (QA-161)', () => {
  afterEach(() => cleanup());

  it('ofrece volver a reservar y no habla de dinero pendiente', async () => {
    const { fireEvent, screen } = await import('@testing-library/react');
    const onRebook = vi.fn();
    render(
      <ClientBookingCard
        booking={{ ...base, status: 'expired', total_price: 180, management_fee: 3.6, management_fee_source: 'payment_attempt' } as never}
        onRebook={onRebook}
      />,
    );
    expect(screen.queryByText('Pendiente de pagar al profesional')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Volver a reservar/ }));
    expect(onRebook).toHaveBeenCalledTimes(1);
  });
});
