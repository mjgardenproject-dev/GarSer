export const BOOKING_PAYMENT_HOLD_MINUTES = 30;

export type BookingPaymentAttemptStatus =
  | 'created'
  | 'payment_pending'
  | 'processing'
  | 'booking_created'
  | 'cancelled'
  | 'failed'
  | 'expired'
  | 'reconciliation_required';

export interface BookingPaymentAttemptSummary {
  attemptId: string;
  quoteId: string;
  status: BookingPaymentAttemptStatus;
  currency: string;
  payableNowAmountCents: number;
  payableNowAmount: number;
  serviceTotalAmountCents: number;
  serviceTotalAmount: number;
  paymentIntentId?: string;
  paymentExpiresAt?: string;
  holdExpiresAt?: string;
  bookingId?: string;
  retryable: boolean;
  terminal: boolean;
  lastErrorCode?: string;
  lastErrorMessage?: string;
}

export interface BookingPaymentPrepareResponse {
  attempt: BookingPaymentAttemptSummary;
  clientSecret?: string;
  publishableKey?: string;
}

export interface BookingPaymentStatusResponse {
  attempt: BookingPaymentAttemptSummary | null;
}

export interface BookingPaymentStatusCopy {
  title: string;
  detail: string;
}

export interface BookingStripeLineItemInput {
  code?: string | null;
  label?: string | null;
  unitAmount?: number | string | null;
  quantity?: number | string | null;
}

export interface BookingStripeLineItem {
  label: string;
  unitAmountCents: number;
  quantity: number;
}

const STRIPE_PRODUCT_CODE_PREFIX = 'bkln';
const STRIPE_PRODUCT_CODE_MAX_LENGTH = 12;

export interface BookingStripeMetadataExpectation {
  attemptId: string;
  quoteId: string;
  quoteSignature: string;
  clientId: string;
  gardenerId: string;
  serviceId: string;
  payableNowAmountCents: number;
  paymentIntentId?: string | null;
}

export interface BookingStripeMetadataIntegrityResult {
  ok: boolean;
  reason?: 'stripe_metadata_incomplete' | 'stripe_metadata_mismatch' | 'stripe_payment_intent_binding_mismatch';
  expected: Record<string, string>;
  received: Record<string, string>;
}

const ALLOWED_LOCAL_PREFIXES = ['http://localhost:', 'http://127.0.0.1:'];

export function toStripeAmountCents(amount: number): number {
  const normalized = Number(amount || 0);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error('El importe enviado a Stripe no es valido.');
  }
  return Math.round((normalized + Number.EPSILON) * 100);
}

function sanitizeStripeMetadataValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStripeLineItemQuantity(value: number | string | null | undefined): number {
  const normalized = Number(value ?? 1);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error('La cantidad de un line item de Stripe no es valida.');
  }
  return normalized;
}

export function buildAuthoritativeBookingStripeLineItems(params: {
  stripeLineItems?: BookingStripeLineItemInput[] | null;
  payableNowAmountCents: number;
  fallbackLabel?: string;
}): BookingStripeLineItem[] {
  const payableNowAmountCents = Number(params.payableNowAmountCents || 0);
  const fallbackLabel = String(params.fallbackLabel || 'Gastos de gestion').trim() || 'Gastos de gestion';

  if (!Number.isInteger(payableNowAmountCents) || payableNowAmountCents <= 0) {
    throw new Error('El intento de pago no tiene un importe autoritativo valido para Stripe.');
  }

  if (!Array.isArray(params.stripeLineItems) || params.stripeLineItems.length === 0) {
    return [{
      label: fallbackLabel,
      unitAmountCents: payableNowAmountCents,
      quantity: 1,
    }];
  }

  const normalized = params.stripeLineItems.map((item) => {
    const label = String(item?.label || '').trim() || fallbackLabel;
    const unitAmountCents = toStripeAmountCents(Number(item?.unitAmount || 0));
    const quantity = normalizeStripeLineItemQuantity(item?.quantity);

    if (unitAmountCents <= 0) {
      throw new Error('El snapshot economico contiene un line item de Stripe sin importe valido.');
    }

    return {
      label,
      unitAmountCents,
      quantity,
    };
  });

  const totalAmountCents = normalized.reduce((sum, item) => sum + (item.unitAmountCents * item.quantity), 0);
  if (totalAmountCents !== payableNowAmountCents) {
    throw new Error('El snapshot economico no cuadra con el importe autoritativo del intento de pago.');
  }

  return normalized;
}

export function buildBookingStripeLineItemProductCode(index: number): string {
  const normalizedIndex = Number.isFinite(index) ? Math.max(0, Math.trunc(index)) + 1 : 1;
  const candidate = `${STRIPE_PRODUCT_CODE_PREFIX}${normalizedIndex}`;
  return candidate.slice(0, STRIPE_PRODUCT_CODE_MAX_LENGTH);
}

export function fromStripeAmountCents(amountCents: number): number {
  const normalized = Number(amountCents || 0);
  if (!Number.isFinite(normalized) || normalized < 0) return 0;
  return Math.round(((normalized / 100) + Number.EPSILON) * 100) / 100;
}

export function isTerminalPaymentAttemptStatus(status: BookingPaymentAttemptStatus | string | null | undefined): boolean {
  return ['booking_created', 'cancelled', 'failed', 'expired', 'reconciliation_required'].includes(String(status || ''));
}

export function isRetryablePaymentAttemptStatus(status: BookingPaymentAttemptStatus | string | null | undefined): boolean {
  return ['cancelled', 'failed', 'expired'].includes(String(status || ''));
}

export function isInFlightPaymentAttemptStatus(status: BookingPaymentAttemptStatus | string | null | undefined): boolean {
  return ['created', 'payment_pending', 'processing'].includes(String(status || ''));
}

export function sanitizeBookingAppBaseUrl(value?: string | null): string | null {
  const candidate = String(value || '').trim();
  if (!candidate) return null;

  if (candidate.startsWith('https://')) {
    return candidate.replace(/\/+$/, '');
  }

  if (ALLOWED_LOCAL_PREFIXES.some((prefix) => candidate.startsWith(prefix))) {
    return candidate.replace(/\/+$/, '');
  }

  return null;
}

export function buildBookingPaymentReturnUrl(params: {
  appBaseUrl: string;
  attemptId: string;
}): string {
  const appBaseUrl = sanitizeBookingAppBaseUrl(params.appBaseUrl);
  const attemptId = String(params.attemptId || '').trim();

  if (!appBaseUrl) {
    throw new Error('La URL base de la aplicacion no es valida para el retorno del pago.');
  }
  if (!attemptId) {
    throw new Error('Falta el identificador del intento de pago para construir el retorno.');
  }

  return `${appBaseUrl}/reserva/confirmacion?attempt_id=${encodeURIComponent(attemptId)}&payment_return=1`;
}

export function buildBookingPaymentGatewaySyncEventId(params: {
  attemptId: string;
  paymentIntentId?: string | null;
}): string {
  const attemptId = sanitizeStripeMetadataValue(params.attemptId);
  const paymentIntentId = sanitizeStripeMetadataValue(params.paymentIntentId);

  if (!attemptId) {
    throw new Error('Falta el identificador del intento para construir el evento de sincronizacion.');
  }

  if (paymentIntentId) {
    return `client_sync:${attemptId}:payment_intent:${paymentIntentId}`;
  }

  return `client_sync:${attemptId}:attempt`;
}

export function validateBookingStripeMetadataIntegrity(params: {
  expected: BookingStripeMetadataExpectation;
  metadata?: Record<string, unknown> | null;
  paymentIntentId?: string | null;
}): BookingStripeMetadataIntegrityResult {
  const expected = {
    attempt_id: sanitizeStripeMetadataValue(params.expected.attemptId),
    quote_id: sanitizeStripeMetadataValue(params.expected.quoteId),
    quote_signature: sanitizeStripeMetadataValue(params.expected.quoteSignature),
    client_id: sanitizeStripeMetadataValue(params.expected.clientId),
    gardener_id: sanitizeStripeMetadataValue(params.expected.gardenerId),
    service_id: sanitizeStripeMetadataValue(params.expected.serviceId),
    payable_now_amount_cents: String(Number(params.expected.payableNowAmountCents || 0)),
  };
  const received = {
    attempt_id: sanitizeStripeMetadataValue(params.metadata?.attempt_id),
    quote_id: sanitizeStripeMetadataValue(params.metadata?.quote_id),
    quote_signature: sanitizeStripeMetadataValue(params.metadata?.quote_signature),
    client_id: sanitizeStripeMetadataValue(params.metadata?.client_id),
    gardener_id: sanitizeStripeMetadataValue(params.metadata?.gardener_id),
    service_id: sanitizeStripeMetadataValue(params.metadata?.service_id),
    payable_now_amount_cents: sanitizeStripeMetadataValue(params.metadata?.payable_now_amount_cents),
  };

  const hasMissingRequiredField = Object.entries(expected).some(([key, value]) => value !== '' && received[key as keyof typeof received] === '');
  if (hasMissingRequiredField) {
    return {
      ok: false,
      reason: 'stripe_metadata_incomplete',
      expected,
      received,
    };
  }

  const hasMismatch = Object.entries(expected).some(([key, value]) => value !== received[key as keyof typeof received]);
  if (hasMismatch) {
    return {
      ok: false,
      reason: 'stripe_metadata_mismatch',
      expected,
      received,
    };
  }

  const paymentIntentId = sanitizeStripeMetadataValue(params.paymentIntentId);
  const expectedPaymentIntentId = sanitizeStripeMetadataValue(params.expected.paymentIntentId);
  if (paymentIntentId && expectedPaymentIntentId && paymentIntentId !== expectedPaymentIntentId) {
    return {
      ok: false,
      reason: 'stripe_payment_intent_binding_mismatch',
      expected: {
        ...expected,
        payment_intent_id: expectedPaymentIntentId,
      },
      received: {
        ...received,
        payment_intent_id: paymentIntentId,
      },
    };
  }

  return {
    ok: true,
    expected: {
      ...expected,
      payment_intent_id: expectedPaymentIntentId,
    },
    received: {
      ...received,
      payment_intent_id: paymentIntentId,
    },
  };
}

export function getBookingPaymentStatusCopy(
  status: BookingPaymentAttemptStatus | string | null | undefined,
  lastErrorMessage?: string | null,
): BookingPaymentStatusCopy {
  switch (String(status || '')) {
    case 'created':
      return {
        title: 'Preparando pago',
        detail: 'Estamos preparando el pago seguro para reservar tu franja.',
      };
    case 'payment_pending':
      return {
        title: 'Pago pendiente',
        detail: `La franja queda retenida durante ${BOOKING_PAYMENT_HOLD_MINUTES} minutos mientras completas el pago.`,
      };
    case 'processing':
      return {
        title: 'Pago en proceso',
        detail: 'Stripe ha confirmado el pago y estamos consolidando la reserva.',
      };
    case 'booking_created':
      return {
        title: 'Reserva confirmada',
        detail: 'El pago se ha validado y la reserva ha quedado creada correctamente.',
      };
    case 'cancelled':
      return {
        title: 'Pago cancelado',
        detail: lastErrorMessage || 'Has cancelado el pago antes de completarlo. Puedes reintentar mientras el presupuesto siga vigente.',
      };
    case 'failed':
      return {
        title: 'Pago fallido',
        detail: lastErrorMessage || 'No se pudo completar el cobro de los gastos de gestión. Revisa el medio de pago y vuelve a intentarlo.',
      };
    case 'expired':
      return {
        title: 'Pago expirado',
        detail: lastErrorMessage || 'La retención de agenda ha caducado. Debes preparar un nuevo pago para volver a intentarlo.',
      };
    case 'reconciliation_required':
      return {
        title: 'Pago en revisión',
        detail: lastErrorMessage || 'El pago requiere revisión manual antes de confirmar la reserva.',
      };
    default:
      return {
        title: 'Pago pendiente',
        detail: 'Todavía no hay un estado de pago verificable para esta reserva.',
      };
  }
}

export function coercePaymentAttemptSummary(input: Record<string, unknown>): BookingPaymentAttemptSummary {
  const payableNowAmountCents = Number(input.payableNowAmountCents || 0);
  const serviceTotalAmountCents = Number(input.serviceTotalAmountCents || 0);
  const status = String(input.status || 'failed') as BookingPaymentAttemptStatus;

  return {
    attemptId: String(input.attemptId || ''),
    quoteId: String(input.quoteId || ''),
    status,
    currency: String(input.currency || 'eur'),
    payableNowAmountCents,
    payableNowAmount: fromStripeAmountCents(payableNowAmountCents),
    serviceTotalAmountCents,
    serviceTotalAmount: fromStripeAmountCents(serviceTotalAmountCents),
    paymentIntentId: typeof input.paymentIntentId === 'string' ? input.paymentIntentId : undefined,
    paymentExpiresAt: typeof input.paymentExpiresAt === 'string' ? input.paymentExpiresAt : undefined,
    holdExpiresAt: typeof input.holdExpiresAt === 'string' ? input.holdExpiresAt : undefined,
    bookingId: typeof input.bookingId === 'string' ? input.bookingId : undefined,
    retryable: Boolean(input.retryable ?? isRetryablePaymentAttemptStatus(status)),
    terminal: Boolean(input.terminal ?? isTerminalPaymentAttemptStatus(status)),
    lastErrorCode: typeof input.lastErrorCode === 'string' ? input.lastErrorCode : undefined,
    lastErrorMessage: typeof input.lastErrorMessage === 'string' ? input.lastErrorMessage : undefined,
  };
}
