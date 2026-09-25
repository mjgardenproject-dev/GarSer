import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));

import { buildMaintenanceCheckoutData } from './maintenancePlans';

describe('buildMaintenanceCheckoutData (GarSer Empresas F9)', () => {
  const checkout = {
    quoteId: 'q1', signature: 'maintenance:v1', expiresAt: '2026-10-01T10:00:00Z', providerId: 'p1', serviceIds: ['lawn'],
    inputPayload: { address: 'Marbella centro', addressCoordinates: { lat: 36.5, lng: -4.9 } },
    pricingSnapshot: { breakdown: [{ desc: 'Césped', price: 54 }], metadata: { pricingContext: { serviceType: 'lawn' } } as never },
    economicSnapshot: { managementFee: 6.75, payableNow: 6.75, serviceGrossTotal: 54 } as never,
    availability: { selectedSlot: { date: '2026-09-30', startHour: 9, startTime: '09:00:00', endTime: '11:00:00', durationHours: 2 } } as never,
    totalPrice: 54, estimatedHours: 2, pricingVersion: 'booking_quote_v1', providerConfigVersion: 'x',
  };

  it('abre el pago con el presupuesto del plan (no se rehace): precio, franja, profesional y visita', () => {
    const data = buildMaintenanceCheckoutData('v1', checkout);
    expect(data.quoteId).toBe('q1');
    expect(data.maintenanceVisitId).toBe('v1');
    expect(data.providerId).toBe('p1');
    expect(data.timeSlot).toBe('09:00 - 11:00');
    expect(data.authoritativeQuoteSnapshot?.totalPrice).toBe(54);
    expect(data.address).toBe('Marbella centro');
  });

  it('sin franja o sin contexto de precio no se puede pagar', () => {
    expect(() => buildMaintenanceCheckoutData('v1', { ...checkout, availability: {} as never })).toThrow();
  });
});
