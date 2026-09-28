import { describe, it, expect } from 'vitest';
import { formatBookingDate, formatBookingWhen } from '../../supabase/functions/_shared/emailBrand.ts';

// H-44: los correos decían solo «a las 09:00»; el cliente no veía cuándo acaba.
describe('formatBookingDate / formatBookingWhen con hora de fin', () => {
  it('con duración: «de 09:00 a 13:00»', () => {
    expect(formatBookingDate('2026-10-05', '09:00:00', 4)).toBe('lunes, 5 de octubre de 2026, de 09:00 a 13:00');
  });

  it('sin duración, como siempre', () => {
    expect(formatBookingDate('2026-10-05', '09:00:00')).toBe('lunes, 5 de octubre de 2026 a las 09:00');
  });

  it('varios días: el rango de días y «desde las» (el fin de cada día no es uno solo)', () => {
    expect(formatBookingWhen('2026-10-05', '08:00:00', '2026-10-07', 8)).toBe('del lunes, 5 de octubre al miércoles, 7 de octubre de 2026, desde las 08:00');
  });

  it('un día con duración, a través de formatBookingWhen', () => {
    expect(formatBookingWhen('2026-10-05', '12:00:00', null, 1)).toBe('lunes, 5 de octubre de 2026, de 12:00 a 13:00');
  });
});
