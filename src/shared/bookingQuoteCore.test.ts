import { describe, expect, it } from 'vitest';

import { getBookingCustomerPaymentSummary } from './bookingQuoteCore';

describe('getBookingCustomerPaymentSummary', () => {
  it('deriva el resumen de pago visible al cliente sin alterar el contrato económico', () => {
    expect(
      getBookingCustomerPaymentSummary({
        currency: 'EUR',
        taxRate: 0.21,
        serviceGrossTotal: 158,
        serviceNetSubtotal: 130.58,
        serviceTaxAmount: 27.42,
        managementFee: 19.75,
        payableNow: 19.75,
        payableLater: 158,
        lines: [],
        stripeLineItems: [],
      })
    ).toEqual({
      reservationTotal: 177.75,
      serviceSubtotal: 158,
      reservationFee: 19.75,
      confirmationDeposit: 19.75,
      pendingToProfessional: 158,
    });
  });

  it('devuelve null si todavía no hay datos económicos disponibles', () => {
    expect(getBookingCustomerPaymentSummary(null)).toBeNull();
  });
});
