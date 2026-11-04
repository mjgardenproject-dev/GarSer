/**
 * Pegamento del servidor con el motor de comisiones de SQL.
 *
 * Quien decide qué regla toca y cuántos céntimos se cobran es la base de datos
 * (`quote_commission_economics`, migraciones 20261102140000/150000). Este módulo solo:
 *   1. la llama con datos del servidor (cliente de la sesión verificada, profesional del
 *      presupuesto, origen declarado ya contrastado) y NUNCA con porcentajes o importes del navegador;
 *   2. comprueba que lo que vuelve tiene la forma de una economía con comisión;
 *   3. se niega a seguir si no hay una comisión válida: sin configuración no hay precio con
 *      comisión, solo un error recuperable, y jamás un 0 ni un valor por defecto.
 *
 * Lo cargan las edge functions de Deno (`booking-authority`, `booking-payment`) y las pruebas de
 * vitest con una `rpc` simulada, por eso recibe la llamada a la base de datos en vez de importarla.
 */

import type { BookingQuoteEconomicBreakdown } from './bookingQuoteCore.ts';
import {
  isCommissionRuleCode,
  type BookingQuoteCommission,
  type CommissionOrigin,
} from './commissionRules.ts';

export interface CommissionRpcResult {
  data: unknown;
  error: { message?: string; code?: string } | null;
}

/** `(nombre, argumentos) => rpc de Supabase`. Estructural, para no depender del cliente de Supabase. */
export type CommissionRpc = (fn: string, args: Record<string, unknown>) => PromiseLike<CommissionRpcResult>;

/** No hay una configuración de comisiones válida (o la base de datos no responde). Recuperable. */
export class CommissionUnavailableError extends Error {
  readonly code = 'commission_unavailable';
  readonly detail: string;
  constructor(detail = '') {
    super('No se pueden calcular los gastos de gestión ahora mismo. Inténtalo de nuevo en unos minutos.');
    this.name = 'CommissionUnavailableError';
    this.detail = detail;
  }
}

/** La reserva saldría sin pago y la web que llama no sabe confirmarla (una app instalada sin actualizar). */
export class ClientUpdateRequiredError extends Error {
  readonly code = 'client_update_required';
  constructor() {
    super('Actualiza la página para poder continuar con la reserva.');
    this.name = 'ClientUpdateRequiredError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const toCents = (value: unknown): number | null => (isFiniteNumber(value) ? Math.round(value * 100) : null);

/**
 * La comisión que lleva una economía firmada, o null si no la lleva (presupuesto anterior a las
 * comisiones configurables) o está mal formada.
 */
export function readCommissionFromEconomics(economics: unknown): BookingQuoteCommission | null {
  if (!isRecord(economics) || !isRecord(economics.commission)) return null;
  const c = economics.commission;
  if (!isCommissionRuleCode(c.rule)) return null;
  const origin = c.origin;
  if (origin !== 'garser' && origin !== 'provider_link') return null;
  const claimed = c.claimedOrigin ?? null;
  if (claimed !== null && claimed !== 'provider_link') return null;
  if (
    !Number.isInteger(c.rateBps) || (c.rateBps as number) < 0 || (c.rateBps as number) > 10000
    || !Number.isInteger(c.configVersion) || (c.configVersion as number) < 1
    || !isFiniteNumber(c.ratePercent) || !isFiniteNumber(c.baseAmount)
    || !isFiniteNumber(c.calculatedAmount) || !isFiniteNumber(c.amount)
    || typeof c.isFirstBooking !== 'boolean'
  ) {
    return null;
  }
  const adjustment = c.adjustment ?? null;
  if (adjustment !== null && adjustment !== 'minimum_charge') return null;
  // Las comisiones firmadas antes de la clave del enlace no traen este dato: valen como «sin declarar».
  const linkClaim = c.linkClaim ?? null;
  if (linkClaim !== null && linkClaim !== 'verified' && linkClaim !== 'rejected') return null;
  return {
    rule: c.rule,
    rateBps: c.rateBps as number,
    ratePercent: c.ratePercent,
    configVersion: c.configVersion as number,
    origin: origin as CommissionOrigin,
    claimedOrigin: claimed as 'provider_link' | null,
    linkClaim: linkClaim as 'verified' | 'rejected' | null,
    isFirstBooking: c.isFirstBooking,
    baseAmount: c.baseAmount,
    calculatedAmount: c.calculatedAmount,
    amount: c.amount,
    adjustment: adjustment as 'minimum_charge' | null,
  };
}

/** ¿Una economía con comisión es coherente consigo misma? (importes que se cobran = comisión). */
function economicsAreCoherent(economics: unknown, commission: BookingQuoteCommission): boolean {
  if (!isRecord(economics)) return false;
  const fee = toCents(economics.managementFee);
  const payable = toCents(economics.payableNow);
  const amount = toCents(commission.amount);
  if (fee === null || payable === null || amount === null) return false;
  if (fee !== amount || payable !== amount) return false;
  const waived = isRecord(economics.feeWaiver);
  // Sin cobro hay exención con motivo; con cobro, no la hay.
  return waived === (amount === 0);
}

export interface CommissionRequest {
  /** Economía del servicio tal y como la entrega el motor de precios (sin comisión). */
  economics: BookingQuoteEconomicBreakdown;
  /** Cliente de la sesión verificada; null si aún no hay sesión (solo vistas previas). */
  clientId: string | null;
  providerId: string;
  /** Origen declarado por la web, ya contrastado con el profesional del presupuesto. */
  claimedOrigin: 'provider_link' | null;
  /** La clave que traía el enlace declarado (SQL la contrasta con la del profesional). */
  linkCode?: string | null;
  /**
   * SOLO al revalidar un pago: el presupuesto firmado ya dejó anotado que la clave era la buena
   * (`linkClaim = 'verified'`), y no hace falta volver a tenerla.
   */
  claimVerified?: boolean;
  maintenanceVisit?: boolean;
  /** null/ausente = la configuración vigente; un número = esa versión (para revalidar un pago). */
  configVersion?: number | null;
  /** La web que llama sabe confirmar una reserva sin pago (`clientCapabilities.feeWaiver`). */
  clientCanConfirmWithoutPayment: boolean;
}

/**
 * La economía con la comisión que le toca a esta reserva, calculada por la base de datos.
 *
 * Lanza `CommissionUnavailableError` si no se puede obtener una comisión válida, y
 * `ClientUpdateRequiredError` si la reserva saldría sin pago y la web no sabe confirmarla. Nunca
 * devuelve una economía sin comisión.
 */
export async function applyCommission(
  rpc: CommissionRpc,
  request: CommissionRequest,
): Promise<BookingQuoteEconomicBreakdown> {
  let result: CommissionRpcResult;
  try {
    result = await rpc('quote_commission_economics', {
      p_economics: request.economics,
      p_client_id: request.clientId,
      p_provider_id: request.providerId,
      p_claimed_origin: request.claimedOrigin,
      p_maintenance_visit: Boolean(request.maintenanceVisit),
      p_config_version: request.configVersion ?? null,
      p_link_code: request.linkCode ?? null,
      p_claim_verified: Boolean(request.claimVerified),
    });
  } catch (error) {
    throw new CommissionUnavailableError(error instanceof Error ? error.message : String(error));
  }
  if (result.error) {
    throw new CommissionUnavailableError(result.error.message || result.error.code || 'rpc_error');
  }

  const economics = result.data;
  const commission = readCommissionFromEconomics(economics);
  if (!commission || !economicsAreCoherent(economics, commission)) {
    throw new CommissionUnavailableError('invalid_commission_payload');
  }

  const typed = economics as BookingQuoteEconomicBreakdown;
  if (commission.amount === 0 && !request.clientCanConfirmWithoutPayment) {
    throw new ClientUpdateRequiredError();
  }
  return typed;
}

/**
 * Compara la comisión de un presupuesto ya firmado con la que sale de volver a calcularla con
 * información verificada (y con la MISMA versión de la configuración). Devuelve por qué difieren,
 * o null si coinciden. Sirve para que el pago se niegue a cobrar un presupuesto cuya regla o importe
 * ya no son los suyos.
 */
export function commissionMismatch(signed: unknown, expected: unknown): string | null {
  const signedCommission = readCommissionFromEconomics(signed);
  const expectedCommission = readCommissionFromEconomics(expected);
  if (!signedCommission) return 'el presupuesto no lleva comisión configurable';
  if (!expectedCommission) return 'no se pudo recalcular la comisión';
  if (signedCommission.configVersion !== expectedCommission.configVersion) return 'la versión de la configuración no coincide';
  if (signedCommission.rule !== expectedCommission.rule) return 'la regla de comisión ha cambiado';
  if (signedCommission.linkClaim !== expectedCommission.linkClaim) return 'el resultado del enlace ha cambiado';
  if (signedCommission.rateBps !== expectedCommission.rateBps) return 'el porcentaje no coincide';
  const signedPayable = isRecord(signed) ? toCents(signed.payableNow) : null;
  const expectedPayable = isRecord(expected) ? toCents(expected.payableNow) : null;
  if (signedPayable === null || expectedPayable === null || signedPayable !== expectedPayable) {
    return 'el importe a pagar no coincide';
  }
  return null;
}
