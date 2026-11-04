import { describe, expect, it, vi } from 'vitest';

import type { BookingQuoteEconomicBreakdown } from './bookingQuoteCore';
import {
  applyCommission,
  ClientUpdateRequiredError,
  CommissionUnavailableError,
  commissionMismatch,
  readCommissionFromEconomics,
  type CommissionRpc,
} from './commissionEngine';

// Economía del motor de precios: solo servicio, sin comisión.
const serviceOnly = (gross = 158): BookingQuoteEconomicBreakdown => ({
  currency: 'EUR',
  taxRate: 0.21,
  serviceGrossTotal: gross,
  serviceNetSubtotal: 130.58,
  serviceTaxAmount: 27.42,
  managementFee: 0,
  payableNow: 0,
  payableLater: gross,
  lines: [{ code: 'service_line_1', label: 'Corte', amount: gross, kind: 'service' }],
  stripeLineItems: [],
});

// Lo que devolvería SQL (apply_commission_to_economics) para una decisión.
function signed(overrides: Record<string, unknown> = {}, fee = 19.75): Record<string, unknown> {
  const waived = fee === 0;
  return {
    ...serviceOnly(),
    managementFee: fee,
    payableNow: fee,
    lines: [{ code: 'service_line_1', label: 'Corte', amount: 158, kind: 'service' }],
    stripeLineItems: waived ? [] : [{ code: 'management_fee', label: 'Gastos de gestión', unitAmount: fee, quantity: 1 }],
    ...(waived ? { feeWaiver: { reason: 'provider_link', waivedFee: 0 } } : {}),
    commission: {
      rule: 'garser_first', rateBps: 1250, ratePercent: 12.5, configVersion: 3, origin: 'garser', claimedOrigin: null,
      linkClaim: null, isFirstBooking: true, baseAmount: 158, calculatedAmount: fee, amount: fee, adjustment: null,
      ...(overrides.commission as object | undefined),
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'commission')),
  };
}

const request = {
  economics: serviceOnly(),
  clientId: 'cliente-1',
  providerId: 'pro-1',
  claimedOrigin: null,
  clientCanConfirmWithoutPayment: true,
} as const;

const rpcReturning = (data: unknown, error: { message?: string; code?: string } | null = null): CommissionRpc & ReturnType<typeof vi.fn> =>
  vi.fn(async () => ({ data, error })) as never;

describe('applyCommission', () => {
  it('pide la comisión a SQL solo con datos del servidor y devuelve lo que SQL calcula', async () => {
    const rpc = rpcReturning(signed());
    const result = await applyCommission(rpc, { ...request, claimedOrigin: 'provider_link', configVersion: 7 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('quote_commission_economics', {
      p_economics: request.economics,
      p_client_id: 'cliente-1',
      p_provider_id: 'pro-1',
      p_claimed_origin: 'provider_link',
      p_maintenance_visit: false,
      p_config_version: 7,
      p_link_code: null,
      p_claim_verified: false,
    });
    expect(result.managementFee).toBe(19.75);
    expect(result.payableNow).toBe(19.75);
  });

  it('con un enlace declarado, la clave y el «ya verificado» viajan a SQL tal cual (SQL decide si valen)', async () => {
    const code = '0123456789abcdef0123456789abcdef';
    const rpc = rpcReturning(signed());
    await applyCommission(rpc, { ...request, claimedOrigin: 'provider_link', linkCode: code });
    expect(rpc).toHaveBeenLastCalledWith('quote_commission_economics', expect.objectContaining({
      p_claimed_origin: 'provider_link', p_link_code: code, p_claim_verified: false,
    }));
    await applyCommission(rpc, { ...request, claimedOrigin: 'provider_link', claimVerified: true });
    expect(rpc).toHaveBeenLastCalledWith('quote_commission_economics', expect.objectContaining({
      p_claimed_origin: 'provider_link', p_link_code: null, p_claim_verified: true,
    }));
  });

  it('el navegador no puede mandar porcentaje, importe, regla ni recurrencia: la petición no tiene esos campos', async () => {
    const rpc = rpcReturning(signed());
    await applyCommission(rpc, {
      ...request,
      // @ts-expect-error — no existe un campo de porcentaje que pueda llegar de fuera
      rate: 0,
      managementFee: 0,
      rule: 'link_first',
      isReturning: true,
    });
    const args = (rpc as unknown as { mock: { calls: Array<[string, Record<string, unknown>]> } }).mock.calls[0][1];
    expect(Object.keys(args).sort()).toEqual([
      'p_claim_verified', 'p_claimed_origin', 'p_client_id', 'p_config_version', 'p_economics', 'p_link_code',
      'p_maintenance_visit', 'p_provider_id',
    ]);
  });

  it('sin sesión (vista previa) pasa cliente nulo y la versión vigente', async () => {
    const rpc = rpcReturning(signed());
    await applyCommission(rpc, { ...request, clientId: null });
    expect(rpc).toHaveBeenCalledWith('quote_commission_economics', expect.objectContaining({ p_client_id: null, p_config_version: null }));
  });

  it('si la base de datos falla, bloquea con un error recuperable (nunca un 0 ni un valor por defecto)', async () => {
    await expect(applyCommission(rpcReturning(null, { message: 'commission_config_unavailable' }), request))
      .rejects.toBeInstanceOf(CommissionUnavailableError);
    await expect(applyCommission(rpcReturning(null, { code: '42501' }), request)).rejects.toBeInstanceOf(CommissionUnavailableError);
    await expect(applyCommission((async () => { throw new Error('timeout'); }) as CommissionRpc, request))
      .rejects.toBeInstanceOf(CommissionUnavailableError);
    const error = await applyCommission(rpcReturning(null, { message: 'commission_config_unavailable' }), request).catch((e) => e);
    expect(error.code).toBe('commission_unavailable');
    expect(error.message).toMatch(/Inténtalo de nuevo/);
    expect(error.detail).toBe('commission_config_unavailable');
  });

  it.each([
    ['sin datos', null],
    ['la economía sin comisión que le pasaron', serviceOnly()],
    ['una comisión mal formada', { ...serviceOnly(), commission: 'x' }],
    ['una regla inventada', signed({ commission: { rule: 'inventada' } })],
    ['un porcentaje no entero', signed({ commission: { rateBps: 12.5 } })],
    ['un porcentaje fuera de rango', signed({ commission: { rateBps: 10001 } })],
    ['una versión de configuración inválida', signed({ commission: { configVersion: 0 } })],
    ['un origen desconocido', signed({ commission: { origin: 'otro' } })],
    ['un resultado de enlace inventado', signed({ commission: { linkClaim: 'quizas' } })],
    ['un importe que no es el de la comisión', signed({ managementFee: 1 })],
    ['un «pagar ahora» que no es el de la comisión', signed({ payableNow: 1 })],
    ['0 € sin motivo de exención', signed({ managementFee: 0, payableNow: 0, commission: { amount: 0 } })],
    ['una exención con cobro', { ...(signed() as object), feeWaiver: { reason: 'provider_link', waivedFee: 0 } }],
  ])('rechaza %s', async (_label, data) => {
    await expect(applyCommission(rpcReturning(data), request)).rejects.toBeInstanceOf(CommissionUnavailableError);
  });

  it('una reserva sin pago solo se firma para una web que sabe confirmarla', async () => {
    const free = signed({ commission: { rule: 'link_first', rateBps: 0, ratePercent: 0, amount: 0, calculatedAmount: 0 } }, 0);
    await expect(applyCommission(rpcReturning(free), { ...request, clientCanConfirmWithoutPayment: false }))
      .rejects.toBeInstanceOf(ClientUpdateRequiredError);
    const result = await applyCommission(rpcReturning(free), request);
    expect(result.payableNow).toBe(0);
    expect(result.feeWaiver?.reason).toBe('provider_link');
  });

  it('acepta el suelo de 0,50 € como una comisión normal', async () => {
    const floor = signed({ commission: { rateBps: 300, ratePercent: 3, calculatedAmount: 0.3, amount: 0.5, adjustment: 'minimum_charge' } }, 0.5);
    const result = await applyCommission(rpcReturning(floor), request);
    expect(result.payableNow).toBe(0.5);
    expect(readCommissionFromEconomics(result)?.adjustment).toBe('minimum_charge');
  });
});

describe('readCommissionFromEconomics', () => {
  it('lee una comisión completa', () => {
    expect(readCommissionFromEconomics(signed())).toMatchObject({ rule: 'garser_first', rateBps: 1250, configVersion: 3, origin: 'garser', linkClaim: null });
  });

  it('lee el resultado del enlace, y una comisión firmada antes de que existiera vale como «sin declarar»', () => {
    expect(readCommissionFromEconomics(signed({ commission: { claimedOrigin: 'provider_link', linkClaim: 'verified' } }))?.linkClaim).toBe('verified');
    expect(readCommissionFromEconomics(signed({ commission: { claimedOrigin: 'provider_link', linkClaim: 'rejected' } }))?.linkClaim).toBe('rejected');
    const legacy = signed() as { commission: Record<string, unknown> };
    delete legacy.commission.linkClaim;
    expect(readCommissionFromEconomics(legacy)?.linkClaim).toBeNull();
  });

  it.each([null, undefined, 'x', 3, [], {}, { commission: null }, { commission: [] }, { commission: {} }])(
    'devuelve null con %j',
    (value) => expect(readCommissionFromEconomics(value)).toBeNull(),
  );
});

describe('commissionMismatch (el pago revalida lo firmado)', () => {
  it('coincide cuando la regla, el porcentaje, la versión y el importe son los mismos', () => {
    expect(commissionMismatch(signed(), signed())).toBeNull();
  });

  it.each([
    ['otra regla', signed({ commission: { rule: 'garser_repeat', rateBps: 1250 } }), 'regla'],
    ['otro porcentaje', signed({ commission: { rateBps: 300 } }), 'porcentaje'],
    ['otra versión', signed({ commission: { configVersion: 4 } }), 'versión'],
    ['otro resultado del enlace', signed({ commission: { claimedOrigin: 'provider_link', linkClaim: 'rejected' } }), 'enlace'],
    ['otro importe a pagar', signed({ payableNow: 5 }), 'importe'],
  ])('detecta %s', (_label, expected, word) => {
    expect(commissionMismatch(signed(), expected)).toContain(word);
  });

  it('un presupuesto sin comisión configurable, o un cálculo que falla, no se da por bueno', () => {
    expect(commissionMismatch(serviceOnly(), signed())).toMatch(/no lleva comisión/);
    expect(commissionMismatch(signed(), serviceOnly())).toMatch(/no se pudo recalcular/);
    expect(commissionMismatch(null, null)).not.toBeNull();
  });
});
