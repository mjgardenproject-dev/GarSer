import { describe, expect, it } from 'vitest';
import { bookingServiceLabel, isMultiServiceBooking } from './bookingServiceLabel';

describe('bookingServiceLabel (GarSer Empresas F8)', () => {
  it('varios servicios, en su orden', () => {
    const row = { services: { name: 'Corte de césped' }, booking_items: [
      { position: 2, services: { name: 'Poda de setos' } }, { position: 1, services: { name: 'Corte de césped' } },
    ] };
    expect(bookingServiceLabel(row)).toBe('Corte de césped + Poda de setos');
    expect(isMultiServiceBooking(row)).toBe(true);
  });
  it('uno, o reservas anteriores sin filas: el de siempre', () => {
    expect(bookingServiceLabel({ services: { name: 'Poda de setos' }, booking_items: [{ position: 1, services: { name: 'Poda de setos' } }] })).toBe('Poda de setos');
    expect(bookingServiceLabel({ services: { name: 'Poda de setos' } })).toBe('Poda de setos');
    expect(bookingServiceLabel({})).toBeNull();
    expect(isMultiServiceBooking({ services: { name: 'x' } })).toBe(false);
  });
});
