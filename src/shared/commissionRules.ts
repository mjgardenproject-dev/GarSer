/**
 * Las cinco reglas de comisión de GarSer (qué cobra la plataforma en cada tipo de reserva) y su
 * validación. La CUENTA (qué regla toca, cuántos céntimos) no está aquí: vive en SQL
 * (`resolve_booking_commission` y `apply_commission_to_economics`, migración 20261102140000), que es
 * lo único que decide dinero. Este módulo solo describe las reglas para el panel de administración
 * y valida lo que se teclea, igual que lo valida la base de datos.
 *
 * Sin imports a propósito, como `bookingAmounts.ts`: lo cargan la web y las edge functions de Deno.
 */

export const COMMISSION_RULE_CODES = [
  'garser_first',
  'link_first',
  'garser_repeat',
  'maintenance_visit',
  'link_repeat',
] as const;

export type CommissionRuleCode = (typeof COMMISSION_RULE_CODES)[number];

export const isCommissionRuleCode = (value: unknown): value is CommissionRuleCode =>
  typeof value === 'string' && (COMMISSION_RULE_CODES as readonly string[]).includes(value);

/** Un porcentaje por regla, en tanto por ciento (12,5 = 12,5 %). */
export type CommissionRates = Record<CommissionRuleCode, number>;

export interface CommissionRuleInfo {
  code: CommissionRuleCode;
  /** Nombre de la regla, tal y como se muestra en el panel. */
  title: string;
  /** Nombre corto, para resúmenes y para el historial. */
  shortTitle: string;
  /** Qué reservas cubre. */
  description: string;
}

/** Orden en el que se muestran en el panel. */
export const COMMISSION_RULES: readonly CommissionRuleInfo[] = [
  {
    code: 'garser_first',
    title: 'Primera reserva de un cliente captado por GarSer',
    shortTitle: 'Primera reserva (captado por GarSer)',
    description:
      'Comisión aplicada cuando un cliente contrata por primera vez a un jardinero a través de GarSer y la oportunidad comercial ha sido generada por la plataforma.',
  },
  {
    code: 'link_first',
    title: 'Primera reserva de un cliente procedente del enlace personal del jardinero',
    shortTitle: 'Primera reserva (enlace del jardinero)',
    description:
      'Comisión aplicada a la primera reserva de un cliente que llega a GarSer a través del enlace personal de un jardinero.',
  },
  {
    code: 'garser_repeat',
    title: 'Reservas posteriores con el mismo jardinero',
    shortTitle: 'Reservas posteriores',
    description:
      'Comisión aplicada a las reservas posteriores de un cliente con un jardinero con el que ya ha contratado anteriormente.',
  },
  {
    code: 'maintenance_visit',
    title: 'Visitas de planes de mantenimiento',
    shortTitle: 'Visitas de planes de mantenimiento',
    description:
      'Comisión aplicada a cada visita correspondiente a un plan de mantenimiento de jardinería.',
  },
  {
    code: 'link_repeat',
    title: 'Reservas posteriores con un jardinero procedentes del enlace personal de este',
    shortTitle: 'Reservas posteriores (enlace del jardinero)',
    description:
      'Comisión aplicada a las reservas posteriores de un cliente con el mismo jardinero cuando la relación comercial se originó a través del enlace personal del profesional.',
  },
];

/** Máximo de decimales que admite un porcentaje (lo mismo que `numeric(5,2)` en la base de datos). */
export const COMMISSION_MAX_DECIMALS = 2;

export type CommissionPercentError =
  | 'required'
  | 'not_a_number'
  | 'negative'
  | 'above_100'
  | 'too_many_decimals';

export const COMMISSION_ERROR_MESSAGES: Record<CommissionPercentError, string> = {
  required: 'Indica un porcentaje.',
  not_a_number: 'Escribe solo el número, por ejemplo 12,5.',
  negative: 'No puede ser negativo.',
  above_100: 'No puede superar el 100 %.',
  too_many_decimals: 'Admite como mucho dos decimales.',
};

export type CommissionPercentReading =
  | { ok: true; value: number }
  | { ok: false; error: CommissionPercentError; message: string };

const invalid = (error: CommissionPercentError): CommissionPercentReading => ({
  ok: false,
  error,
  message: COMMISSION_ERROR_MESSAGES[error],
});

/**
 * Lee un porcentaje escrito a mano («12,5», «3», «0,25»). Un valor vacío o raro NUNCA se convierte
 * en 0: un 0 por error dejaría a GarSer sin cobrar. Acepta coma o punto decimal, sin signo, sin
 * separador de millares y sin notación científica.
 */
export function readCommissionPercent(text: string | null | undefined): CommissionPercentReading {
  const raw = String(text ?? '').trim();
  if (raw === '') return invalid('required');
  if (/^-/.test(raw)) {
    return /^-\d+([.,]\d+)?$/.test(raw) ? invalid('negative') : invalid('not_a_number');
  }
  if (!/^\d+([.,]\d+)?$/.test(raw)) return invalid('not_a_number');
  const [integerPart, decimalPart = ''] = raw.replace(',', '.').split('.');
  if (decimalPart.length > COMMISSION_MAX_DECIMALS && /[1-9]/.test(decimalPart.slice(COMMISSION_MAX_DECIMALS))) {
    return invalid('too_many_decimals');
  }
  const value = Number(`${integerPart}.${decimalPart.slice(0, COMMISSION_MAX_DECIMALS) || '0'}`);
  if (!Number.isFinite(value)) return invalid('not_a_number');
  if (value > 100) return invalid('above_100');
  return { ok: true, value };
}

/** Valida un número ya parseado (lo que llegaría a una RPC). */
export function validateCommissionPercent(value: unknown): CommissionPercentReading {
  if (value === null || value === undefined || value === '') return invalid('required');
  if (typeof value !== 'number' || !Number.isFinite(value)) return invalid('not_a_number');
  if (value < 0) return invalid('negative');
  if (value > 100) return invalid('above_100');
  if (Math.round(value * 100) / 100 !== value) return invalid('too_many_decimals');
  return { ok: true, value };
}

export type CommissionRatesValidation =
  | { ok: true; rates: CommissionRates }
  | { ok: false; errors: Partial<Record<CommissionRuleCode, string>> };

/** Valida las cinco reglas a la vez: o están todas bien, o se devuelven los errores de cada campo. */
export function validateCommissionRates(input: Partial<Record<CommissionRuleCode, unknown>>): CommissionRatesValidation {
  const errors: Partial<Record<CommissionRuleCode, string>> = {};
  const rates: Partial<CommissionRates> = {};
  for (const code of COMMISSION_RULE_CODES) {
    const reading = validateCommissionPercent(input[code]);
    if (reading.ok) rates[code] = reading.value;
    else errors[code] = reading.message;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, rates: rates as CommissionRates };
}

/** «12,5» / «3» / «0,25»: como se enseña un porcentaje en el panel (coma decimal, sin ceros sobrantes). */
export function formatCommissionPercent(value: number): string {
  const fixed = Number(value).toFixed(COMMISSION_MAX_DECIMALS).replace(/\.?0+$/, '');
  return (fixed === '' ? '0' : fixed).replace('.', ',');
}

export const commissionRatesEqual = (a: CommissionRates, b: CommissionRates): boolean =>
  COMMISSION_RULE_CODES.every((code) => Math.round(a[code] * 100) === Math.round(b[code] * 100));

/* ------------------------------------------------------------------------------------- *
 * Lo que viaja en la economía firmada de un presupuesto (la escribe SQL, no TypeScript).
 * ------------------------------------------------------------------------------------- */

/** De dónde vino el cliente con ese profesional. */
export type CommissionOrigin = 'garser' | 'provider_link';

/** Cómo quedó fijada la comisión de un presupuesto o de una reserva. */
export interface BookingQuoteCommission {
  rule: CommissionRuleCode;
  /** Porcentaje aplicado en puntos básicos (1250 = 12,5 %). */
  rateBps: number;
  ratePercent: number;
  /** Versión de la configuración (commission_settings_history) con la que se calculó. */
  configVersion: number;
  /** Origen del cliente con ese profesional, decidido por el servidor. */
  origin: CommissionOrigin;
  /** Lo que declaró la web (solo 'provider_link' o nada). Es una declaración, no una prueba. */
  claimedOrigin: 'provider_link' | null;
  isFirstBooking: boolean;
  /** Precio del servicio con IVA sobre el que se calculó. */
  baseAmount: number;
  /** Base × porcentaje, redondeado al céntimo. */
  calculatedAmount: number;
  /** Lo que se cobra: igual que el cálculo salvo el mínimo de 0,50 € de Stripe. */
  amount: number;
  adjustment: 'minimum_charge' | null;
}

/** Lo único que el navegador declara: que la reserva empezó en el enlace de ESTE profesional. */
export function claimedOriginFor(
  payload: { bookingOrigin?: unknown; originProviderId?: unknown },
  providerId: string,
): 'provider_link' | null {
  return payload.bookingOrigin === 'provider_link' && String(payload.originProviderId ?? '').trim() === providerId
    ? 'provider_link'
    : null;
}
