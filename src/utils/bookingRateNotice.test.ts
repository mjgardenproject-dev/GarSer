import { describe, expect, it } from 'vitest';

import { describeBookingRateNotice } from './bookingRateNotice';

const base = { cameFromProviderLink: true, hadLinkCode: true, providerName: 'Antonio', managementFee: 22.5 };

describe('describeBookingRateNotice (QA-100 / QA-102)', () => {
  it('otra reserva en curso con tarifa de primera: lo dice, con el nombre y el importe', () => {
    const n = describeBookingRateNotice({ ...base, cameFromProviderLink: false, managementFee: 5.4,
      commission: { origin: 'garser', linkClaim: null, firstRateInUse: true } });
    expect(n?.kind).toBe('first_rate_in_use');
    expect(n?.text).toContain('Ya tienes otra reserva en curso con Antonio');
    expect(n?.text).toContain('una sola reserva a la vez');
    expect(n?.text).toContain('5,40');
  });

  it('otra en curso y la siguiente sale sin gastos: no menciona importe', () => {
    const n = describeBookingRateNotice({ ...base, managementFee: 0,
      commission: { origin: 'provider_link', linkClaim: 'verified', firstRateInUse: true } });
    expect(n?.kind).toBe('first_rate_in_use');
    expect(n?.text).not.toContain('€');
  });

  it('clave antigua: pide el enlace actualizado', () => {
    const n = describeBookingRateNotice({ ...base, commission: { origin: 'garser', linkClaim: 'rejected' } });
    expect(n?.kind).toBe('stale_link_code');
    expect(n?.text).toContain('ya no es el vigente de Antonio');
    expect(n?.text).toContain('22,50');
  });

  it('enlace sin clave: lo explica en vez de cambiar el precio en silencio', () => {
    const n = describeBookingRateNotice({ ...base, hadLinkCode: false, commission: { origin: 'garser', linkClaim: 'rejected' } });
    expect(n?.kind).toBe('missing_link_code');
    expect(n?.text).toContain('le falta su clave');
  });

  it('clave buena pero primera reserva por GarSer: explica que el origen ya está fijado', () => {
    const n = describeBookingRateNotice({ ...base, commission: { origin: 'garser', linkClaim: 'verified' } });
    expect(n?.kind).toBe('garser_client_already');
  });

  it('nada que explicar: cliente del enlace con su tarifa, marketplace normal, o sin gastos', () => {
    expect(describeBookingRateNotice({ ...base, commission: { origin: 'provider_link', linkClaim: 'verified' } })).toBeNull();
    expect(describeBookingRateNotice({ ...base, commission: { origin: 'provider_link', linkClaim: 'rejected' } })).toBeNull();
    expect(describeBookingRateNotice({ ...base, cameFromProviderLink: false, commission: { origin: 'garser', linkClaim: null } })).toBeNull();
    expect(describeBookingRateNotice({ ...base, managementFee: 0, commission: { origin: 'garser', linkClaim: 'rejected' } })).toBeNull();
    expect(describeBookingRateNotice({ ...base, commission: null })).toBeNull();
  });

  it('sin nombre habla de «este profesional»', () => {
    const n = describeBookingRateNotice({ ...base, providerName: '  ', commission: { origin: 'garser', linkClaim: 'rejected' } });
    expect(n?.text).toContain('este profesional');
  });
});
