import { describe, expect, it } from 'vitest';

import {
  BOOKING_MANAGEMENT_FEE_RATE,
  clientAmountsNote,
  formatEuro,
  getBookingAmounts,
  getQuoteAmounts,
} from './bookingAmounts';

const euro = formatEuro;

describe('getBookingAmounts', () => {
  it('separa lo que paga el cliente de lo que cobra el jardinero', () => {
    expect(
      getBookingAmounts({
        total_price: 158,
        management_fee: 19.75,
        management_fee_source: 'payment_attempt',
        status: 'confirmed',
      }),
    ).toEqual({
      servicePrice: 158,
      managementFee: 19.75,
      clientTotal: 177.75,
      pendingToGardener: 158,
      gardenerReceives: 158,
      feeIsKnown: true,
      feeState: 'charged',
    });
  });

  it('NO recalcula la comisión tras un cambio de precio aceptado', () => {
    // El jardinero sube el servicio de 158 a 200 y el cliente acepta. La comisión cobrada
    // sigue siendo la de 158 (19,75 €): no se recobra. Derivarla del 12,5% daría 25 €,
    // un importe que el cliente nunca pagó. Este test ES la especificación de ese caso.
    const amounts = getBookingAmounts({
      total_price: 200,
      management_fee: 19.75,
      management_fee_source: 'payment_attempt',
      status: 'confirmed',
    });

    expect(amounts.clientTotal).toBe(219.75);
    expect(amounts.managementFee).toBe(19.75);
    expect(amounts.managementFee).not.toBe(200 * BOOKING_MANAGEMENT_FEE_RATE);
  });

  it('acepta numeric devuelto como string por PostgREST', () => {
    expect(
      getBookingAmounts({
        total_price: '158.00',
        management_fee: '19.75',
        management_fee_source: 'payment_attempt',
        status: 'confirmed',
      }),
    ).toEqual(
      getBookingAmounts({
        total_price: 158,
        management_fee: 19.75,
        management_fee_source: 'payment_attempt',
        status: 'confirmed',
      }),
    );
  });

  it('no arrastra errores de coma flotante', () => {
    const amounts = getBookingAmounts({
      total_price: 0.1,
      management_fee: 0.2,
      management_fee_source: 'payment_attempt',
    });
    expect(amounts.clientTotal).toBe(0.3);
  });

  it('oculta el desglose cuando la comisión no es fiable', () => {
    const legacy = getBookingAmounts({
      total_price: 158,
      management_fee: 0,
      management_fee_source: 'unknown',
      status: 'confirmed',
    });

    expect(legacy.feeIsKnown).toBe(false);
    expect(legacy.managementFee).toBe(0);
    // Sin comisión fiable el total del cliente colapsa al precio del servicio: no inventamos.
    expect(legacy.clientTotal).toBe(158);
    expect(clientAmountsNote(legacy)).toBe('');
  });

  it('la procedencia manda sobre el valor: source unknown invalida un importe presente', () => {
    const amounts = getBookingAmounts({
      total_price: 158,
      management_fee: 12,
      management_fee_source: 'unknown',
    });
    expect(amounts.feeIsKnown).toBe(false);
    expect(amounts.clientTotal).toBe(158);
  });

  it('no produce NaN con datos ausentes o corruptos', () => {
    for (const row of [
      {},
      { total_price: null, management_fee: null },
      { total_price: 'abc', management_fee: 'x' },
      { total_price: undefined },
    ]) {
      const amounts = getBookingAmounts(row);
      expect(Number.isFinite(amounts.servicePrice)).toBe(true);
      expect(Number.isFinite(amounts.clientTotal)).toBe(true);
      expect(amounts.servicePrice).toBe(0);
    }
    expect(getBookingAmounts(null).clientTotal).toBe(0);
  });

  it.each([
    ['pending', 'held'],
    ['confirmed', 'charged'],
    ['in_progress', 'charged'],
    ['completed', 'charged'],
    ['cancelled', 'void'],
    ['rejected', 'void'],
  ])('deriva el estado del cargo desde el estado de la reserva (%s)', (status, expected) => {
    expect(getBookingAmounts({ total_price: 158, management_fee: 19.75, management_fee_source: 'payment_attempt', status }).feeState).toBe(expected);
  });
});

describe('getQuoteAmounts', () => {
  it('produce las mismas cifras que una reserva ya creada', () => {
    // Garantiza que checkout, tarjeta de reserva y email dicen exactamente lo mismo.
    for (const servicePrice of [50, 158, 999.99, 1234.56]) {
      const managementFee = Math.round(servicePrice * BOOKING_MANAGEMENT_FEE_RATE * 100) / 100;
      const quote = getQuoteAmounts({ serviceGrossTotal: servicePrice, managementFee });
      const booking = getBookingAmounts({
        total_price: servicePrice,
        management_fee: managementFee,
        management_fee_source: 'payment_attempt',
        status: 'pending',
      });
      expect(quote).toEqual(booking);
    }
  });

  it('devuelve null si todavía no hay cotización', () => {
    expect(getQuoteAmounts(null)).toBeNull();
    expect(getQuoteAmounts(undefined)).toBeNull();
  });
});

describe('clientAmountsNote', () => {
  const base = { total_price: 158, management_fee: 19.75, management_fee_source: 'payment_attempt' };

  it('distingue la retención del cobro efectivo', () => {
    expect(clientAmountsNote(getBookingAmounts({ ...base, status: 'pending' }))).toContain('retenidos');
    expect(clientAmountsNote(getBookingAmounts({ ...base, status: 'confirmed' }))).toContain('pagados');
    expect(clientAmountsNote(getBookingAmounts({ ...base, status: 'cancelled' }))).toContain('No se te ha cobrado nada');
  });
});

describe('formatEuro', () => {
  it('formatea en es-ES con dos decimales', () => {
    expect(euro(120.5)).toBe('120,50 €');
    expect(euro(1234.5)).toBe('1234,50 €'); // norma española: sin punto a cuatro cifras
    expect(euro(12345.6)).toBe('12.345,60 €');
    expect(euro('158.00')).toBe('158,00 €');
  });

  it('degrada a 0,00 € en vez de NaN', () => {
    expect(euro(null)).toBe('0,00 €');
    expect(euro(undefined)).toBe('0,00 €');
    expect(euro('abc')).toBe('0,00 €');
  });
});
