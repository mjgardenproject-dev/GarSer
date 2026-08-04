// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ClientBookingAmounts, GardenerBookingAmount } from './BookingAmounts';

const booking = {
  total_price: 158,
  management_fee: 19.75,
  management_fee_source: 'payment_attempt',
  status: 'confirmed',
};

afterEach(cleanup);

describe('ClientBookingAmounts', () => {
  it('muestra el total de la reserva y lo que queda por pagar al profesional', () => {
    render(<ClientBookingAmounts booking={booking} />);

    // Las dos preguntas del cliente respondidas sin restar de cabeza: cuánto pago en total
    // y cuánto le doy al jardinero.
    expect(screen.getByText('Total de la reserva')).toBeTruthy();
    expect(screen.getByText('177,75 €')).toBeTruthy();
    expect(screen.getByText('Pendiente de pagar al profesional')).toBeTruthy();
    expect(screen.getByText('158,00 €')).toBeTruthy();
    expect(document.body.textContent).toContain('19,75 € de gastos de gestión ya están pagados');
  });

  it('distingue la retención del cobro efectivo', () => {
    render(<ClientBookingAmounts booking={{ ...booking, status: 'pending' }} />);
    // El cargo de Stripe es una autorización: hasta que el profesional acepta no se cobra.
    expect(document.body.textContent).toContain('están retenidos');
    expect(document.body.textContent).toContain('solo se cobran cuando el profesional acepte');
  });

  it('no afirma que quede nada pendiente en una reserva cancelada', () => {
    render(<ClientBookingAmounts booking={{ ...booking, status: 'cancelled' }} />);
    expect(screen.queryByText('Pendiente de pagar al profesional')).toBeNull();
    expect(document.body.textContent).toContain('No se te ha cobrado nada');
  });

  it('dice "Pagado al profesional" cuando el servicio ya se completó', () => {
    render(<ClientBookingAmounts booking={{ ...booking, status: 'completed' }} />);
    expect(screen.getByText('Pagado al profesional')).toBeTruthy();
    expect(screen.queryByText('Pendiente de pagar al profesional')).toBeNull();
  });

  it('no inventa un total cuando la comisión no es fiable', () => {
    // Reservas anteriores a la columna: mejor mostrar de menos que una cifra falsa.
    render(
      <ClientBookingAmounts
        booking={{ total_price: 158, management_fee: 0, management_fee_source: 'unknown', status: 'confirmed' }}
      />,
    );
    expect(screen.getByText('Precio del servicio')).toBeTruthy();
    expect(screen.queryByText('Total de la reserva')).toBeNull();
    expect(document.body.textContent).not.toContain('gastos de gestión');
    // Y no se repite el mismo importe bajo dos etiquetas distintas.
    expect(screen.queryByText('Pendiente de pagar al profesional')).toBeNull();
    expect(screen.getAllByText('158,00 €')).toHaveLength(1);
  });

  it('refleja el cambio de precio sin recalcular la comisión', () => {
    // El jardinero sube el servicio a 250 y el cliente acepta: la comisión cobrada sigue
    // siendo la de 158 €, así que el total es 269,75 € y no 281,25 € (250 × 1,125).
    render(<ClientBookingAmounts booking={{ ...booking, total_price: 250 }} />);
    expect(screen.getByText('269,75 €')).toBeTruthy();
    expect(screen.getByText('250,00 €')).toBeTruthy();
  });
});

describe('GardenerBookingAmount', () => {
  it('muestra solo lo que el jardinero va a cobrar, íntegro', () => {
    render(<GardenerBookingAmount booking={booking} variant="hero" />);

    expect(screen.getByText('Cobrarás')).toBeTruthy();
    expect(screen.getByText('158,00 €')).toBeTruthy();
    expect(document.body.textContent).toContain('Íntegro para ti');

    // Nunca ve el total del cliente ni la comisión: sugeriría que se le descuenta algo.
    expect(screen.queryByText('177,75 €')).toBeNull();
    expect(screen.queryByText('19,75 €')).toBeNull();
  });

  it('etiqueta el importe también en la variante compacta', () => {
    render(<GardenerBookingAmount booking={booking} />);
    // Antes era un chip "€158" suelto, sin decir de qué era esa cifra.
    expect(screen.getByText('Cobrarás')).toBeTruthy();
    expect(screen.getByText(/158,00 €/)).toBeTruthy();
  });
});
