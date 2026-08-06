/**
 * SSOT de los importes de una reserva, de cara a CLIENTE y a JARDINERO.
 *
 * Existe porque el mismo dinero se contaba de tres formas distintas segun la pantalla:
 * el checkout mostraba servicio + comision, el email y las tarjetas mostraban solo el
 * servicio, y ambos lo llamaban "Total". Un cliente que pagaba 19,75 € online y luego leia
 * "Total 158 €" no podia saber si al profesional le debia 158 o 138,25.
 *
 * Reglas del negocio que codifica este modulo:
 *   servicePrice   = bookings.total_price   → lo cobra el jardinero INTEGRO, en mano
 *   managementFee  = bookings.management_fee → lo cobra GarSer online (Stripe)
 *   clientTotal    = servicePrice + managementFee → desembolso total del cliente
 *
 * La comision NO es derivable de servicePrice: `respond_booking_price_change` puede mutar
 * `total_price` despues de que la comision ya se haya cobrado, y en ese caso no se recobra.
 * Por eso `management_fee` es una columna persistida y este modulo nunca aplica el 12,5%
 * sobre una reserva ya creada. Ver `getQuoteAmounts` para la fase pre-reserva.
 *
 * IMPORTANTE: este fichero NO debe importar nada. Lo consumen tanto React como las edge
 * functions de Deno (que lo cargan por ruta relativa); cualquier import arrastraria el
 * motor de precios entero (~60 KB) al bundle de las funciones de email.
 */

/** Comision de la plataforma. Unico lugar del repo donde vive la tasa. */
export const BOOKING_MANAGEMENT_FEE_RATE = 0.125;

/**
 * Estado del cargo de gastos de gestion. El cobro de Stripe es una autorizacion con captura
 * diferida (`capture_method: 'manual'`): se retiene al reservar y solo se captura cuando el
 * profesional acepta. Se deriva del estado de la reserva porque la captura ocurre en la misma
 * transicion que lo pone en `confirmed`.
 */
export type BookingFeeState = 'held' | 'charged' | 'void';

/** Procedencia del importe de comision, para poder degradar honestamente en filas antiguas. */
export type BookingFeeSource =
  | 'payment_attempt'
  | 'pricing_context_cents'
  | 'quote_snapshot_payable_now'
  | 'quote_snapshot_management_fee'
  | 'unknown';

export interface BookingAmounts {
  /** Precio del servicio. Lo cobra el jardinero integro. */
  servicePrice: number;
  /** Gastos de gestion cobrados por GarSer al cliente. */
  managementFee: number;
  /** Desembolso total del cliente: servicio + gastos de gestion. */
  clientTotal: number;
  /** Lo que el cliente todavia debe al profesional (siempre el precio del servicio). */
  pendingToGardener: number;
  /** Lo que el jardinero recibe. GarSer no le descuenta nada. */
  gardenerReceives: number;
  /**
   * `false` cuando no consta una comision fiable (reservas anteriores a la columna).
   * La UI debe ocultar el total del cliente y la linea de comision en ese caso, en vez de
   * inventar un importe que el cliente nunca pago.
   */
  feeIsKnown: boolean;
  feeState: BookingFeeState;
}

/** Fila de `bookings` tal y como la devuelve PostgREST (numeric puede llegar como string). */
export interface BookingAmountsRow {
  total_price?: number | string | null;
  management_fee?: number | string | null;
  management_fee_source?: string | null;
  status?: string | null;
}

const roundCurrency = (value: number): number =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

/** Parseo tolerante: PostgREST puede devolver `numeric` como number o como string. */
const toAmount = (value: unknown): number => {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return roundCurrency(parsed);
};

const resolveFeeState = (status?: string | null): BookingFeeState => {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'cancelled' || normalized === 'canceled' || normalized === 'rejected') {
    return 'void';
  }
  if (normalized === 'pending') return 'held';
  return 'charged';
};

/**
 * Importes de una RESERVA YA CREADA. La comision se lee de la columna, nunca se recalcula.
 */
export function getBookingAmounts(row: BookingAmountsRow | null | undefined): BookingAmounts {
  const servicePrice = toAmount(row?.total_price);
  const managementFee = toAmount(row?.management_fee);
  const sourceIsReliable = String(row?.management_fee_source || 'unknown') !== 'unknown';
  const feeIsKnown = sourceIsReliable && managementFee > 0;

  return {
    servicePrice,
    managementFee: feeIsKnown ? managementFee : 0,
    clientTotal: feeIsKnown ? roundCurrency(servicePrice + managementFee) : servicePrice,
    pendingToGardener: servicePrice,
    gardenerReceives: servicePrice,
    feeIsKnown,
    feeState: resolveFeeState(row?.status),
  };
}

/**
 * Importes de una COTIZACION todavia sin reserva (checkout). Misma forma de salida que
 * `getBookingAmounts` para que el checkout, la tarjeta y el email no puedan divergir.
 */
export function getQuoteAmounts(
  economics: { serviceGrossTotal: number; managementFee: number } | null | undefined,
): BookingAmounts | null {
  if (!economics) return null;
  const servicePrice = toAmount(economics.serviceGrossTotal);
  const managementFee = toAmount(economics.managementFee);

  return {
    servicePrice,
    managementFee,
    clientTotal: roundCurrency(servicePrice + managementFee),
    pendingToGardener: servicePrice,
    gardenerReceives: servicePrice,
    feeIsKnown: managementFee > 0,
    // Antes de reservar el cargo todavia no existe: se retendra al confirmar el pago.
    feeState: 'held',
  };
}

/**
 * Unico formateador de euros del proyecto: `1234,50 €`, `12.345,60 €`.
 *
 * Deliberadamente NO usa `Intl.NumberFormat`. El mismo importe se imprime en el navegador,
 * en las edge functions de Deno y en PL/pgSQL (mensajes de chat), y la salida de `Intl`
 * depende de la build de ICU del entorno: un runtime con small-icu cae a en-US y escribiria
 * `€1,234.50`. Aqui la salida es identica en los tres sitios, por construccion.
 *
 * Sigue la norma española: el separador de millares solo aparece a partir de cinco cifras
 * enteras (1234 va sin punto; 12.345 lo lleva). Usa espacio normal, no NBSP, para que el
 * importe sobreviva al text/plain de los emails y al copiar y pegar.
 */
export function formatEuro(value: number | string | null | undefined): string {
  const [integerPart, decimalPart] = toAmount(value).toFixed(2).split('.');
  const grouped =
    integerPart.length > 4
      ? integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
      : integerPart;
  return `${grouped},${decimalPart} €`;
}

/* ------------------------------------------------------------------------------------- *
 * Vocabulario canonico. Todas las superficies (web, emails, chat) usan estas etiquetas:
 * si una pantalla inventa un sinonimo, vuelve la ambiguedad que este modulo elimina.
 * ------------------------------------------------------------------------------------- */

export const BOOKING_AMOUNT_LABELS = {
  clientTotal: 'Total de la reserva',
  pendingToGardener: 'Pendiente de pagar al profesional',
  paidToGardener: 'Pagado al profesional',
  managementFee: 'Gastos de gestión',
  servicePrice: 'Precio del servicio',
  gardenerReceives: 'Cobrarás',
} as const;

/**
 * Nota que acompaña a las cifras del cliente. Explica donde fueron los gastos de gestion,
 * que es exactamente la duda que genera el desglose sin contexto.
 */
export function clientAmountsNote(amounts: BookingAmounts): string {
  if (!amounts.feeIsKnown) return '';
  const fee = formatEuro(amounts.managementFee);
  switch (amounts.feeState) {
    case 'held':
      return `Los ${fee} de gastos de gestión están retenidos y solo se cobran cuando el profesional acepte la reserva.`;
    case 'void':
      return `No se te ha cobrado nada: la retención de ${fee} de gastos de gestión queda liberada.`;
    default:
      return `Los ${fee} de gastos de gestión ya están pagados online. El resto se lo abonas directamente al profesional.`;
  }
}

/** Nota fija para el jardinero: su importe es integro. */
export const GARDENER_AMOUNT_NOTE =
  'Íntegro para ti. GarSer cobra sus gastos de gestión aparte, al cliente.';
