export class BookingPaymentHttpError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(params: {
    status: number;
    message: string;
    code: string;
    details?: Record<string, unknown>;
  }) {
    super(params.message);
    this.name = 'BookingPaymentHttpError';
    this.status = params.status;
    this.code = params.code;
    this.details = params.details;
  }
}

type ErrorLike = Error & {
  code?: string;
  status?: number;
  details?: unknown;
  hint?: unknown;
};

function normalizeErrorString(value: unknown) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (!normalized) return '';
  if (normalized === '[object Object]') return '';
  if (normalized.toLowerCase() === 'object object') return '';
  return normalized;
}

function collectErrorMessages(payload: unknown, seen = new WeakSet<object>()): string[] {
  const direct = normalizeErrorString(payload);
  if (direct) return [direct];

  if (!payload || typeof payload !== 'object') return [];
  if (seen.has(payload as object)) return [];
  seen.add(payload as object);

  if (Array.isArray(payload)) {
    return payload.flatMap((item) => collectErrorMessages(item, seen));
  }

  const record = payload as Record<string, unknown>;
  const prioritizedKeys = ['error', 'message', 'detail', 'details', 'hint', 'reason'];
  const messages = prioritizedKeys.flatMap((key) => collectErrorMessages(record[key], seen));

  if (messages.length > 0) {
    return Array.from(new Set(messages));
  }

  return Object.values(record).flatMap((value) => collectErrorMessages(value, seen));
}

function summarizeErrorPayload(payload: unknown) {
  const messages = collectErrorMessages(payload);
  if (messages.length > 0) {
    return messages.join(' | ');
  }

  if (!payload || typeof payload !== 'object') return '';

  try {
    return JSON.stringify(payload);
  } catch {
    return '';
  }
}

function normalizeForMatch(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export function extractBookingPaymentErrorDiagnostics(error: unknown) {
  const candidate = error as ErrorLike;
  const upstreamMessage = normalizeErrorString(candidate?.message);
  const upstreamDetailsSummary = summarizeErrorPayload(candidate?.details);
  const upstreamHint = summarizeErrorPayload(candidate?.hint);
  const collectedMessages = collectErrorMessages([
    candidate?.details,
    candidate?.hint,
    upstreamMessage,
  ]);
  const message = collectedMessages[0] || upstreamMessage || 'Error interno al preparar el pago.';
  const normalizedText = normalizeForMatch(
    [upstreamMessage, upstreamDetailsSummary, upstreamHint, message].filter(Boolean).join(' | '),
  );

  return {
    message,
    normalizedText,
    upstreamCode: normalizeErrorString(candidate?.code) || undefined,
    upstreamStatus: typeof candidate?.status === 'number' ? candidate.status : undefined,
    upstreamMessage: upstreamMessage || undefined,
    upstreamDetailsSummary: upstreamDetailsSummary || undefined,
    upstreamHint: upstreamHint || undefined,
  };
}

export function classifyBookingPaymentError(error: unknown, fallbackStatus = 500) {
  if (error instanceof BookingPaymentHttpError) {
    return error;
  }

  const diagnostics = extractBookingPaymentErrorDiagnostics(error);
  const {
    message,
    normalizedText,
    upstreamCode,
    upstreamStatus,
    upstreamMessage,
    upstreamDetailsSummary,
    upstreamHint,
  } = diagnostics;

  const upstreamDetails = {
    upstreamCode,
    upstreamStatus,
    upstreamMessage,
    upstreamDetails: upstreamDetailsSummary,
    upstreamHint,
  };

  if (normalizedText.includes('apikey no autorizada')) {
    return new BookingPaymentHttpError({ status: 401, code: 'client_api_key_invalid', message, details: upstreamDetails });
  }
  if (normalizedText.includes('debes iniciar sesion')) {
    return new BookingPaymentHttpError({ status: 401, code: 'auth_required', message, details: upstreamDetails });
  }
  if (normalizedText.includes('no pertenece a la sesion autenticada')) {
    return new BookingPaymentHttpError({ status: 403, code: 'quote_forbidden', message, details: upstreamDetails });
  }
  if (normalizedText.includes('no encontrado')) {
    return new BookingPaymentHttpError({ status: 404, code: 'not_found', message, details: upstreamDetails });
  }
  if (normalizedText.includes('falta quoteid')) {
    return new BookingPaymentHttpError({ status: 400, code: 'missing_quote_id', message, details: upstreamDetails });
  }
  if (normalizedText.includes('falta attemptid')) {
    return new BookingPaymentHttpError({ status: 400, code: 'missing_attempt_id', message, details: upstreamDetails });
  }
  if (normalizedText.includes('accion no soportada')) {
    return new BookingPaymentHttpError({ status: 400, code: 'unsupported_action', message, details: upstreamDetails });
  }
  if (normalizedText.includes('falta stripe_secret_key')) {
    return new BookingPaymentHttpError({ status: 500, code: 'stripe_configuration_error', message, details: upstreamDetails });
  }
  if (normalizedText.includes('faltan secretos de supabase')) {
    return new BookingPaymentHttpError({ status: 500, code: 'service_configuration_error', message, details: upstreamDetails });
  }
  if (normalizedText.includes('payment intent') && normalizedText.includes('no coincide')) {
    return new BookingPaymentHttpError({
      status: 409,
      code: 'stripe_payment_intent_binding_mismatch',
      message,
      details: upstreamDetails,
    });
  }
  if (normalizedText.includes('metadata') && normalizedText.includes('stripe')) {
    return new BookingPaymentHttpError({ status: 409, code: 'stripe_metadata_mismatch', message, details: upstreamDetails });
  }
  if (normalizedText.includes('estado invalido del intento')) {
    return new BookingPaymentHttpError({ status: 409, code: 'invalid_attempt_state', message, details: upstreamDetails });
  }
  if (normalizedText.includes('ha expirado') && normalizedText.includes('presupuesto')) {
    return new BookingPaymentHttpError({ status: 409, code: 'quote_expired', message, details: upstreamDetails });
  }
  if (
    normalizedText.includes('ya no esta disponible') ||
    normalizedText.includes('temporalmente bloqueada') ||
    normalizedText.includes('fuera del horario permitido')
  ) {
    return new BookingPaymentHttpError({ status: 409, code: 'slot_unavailable', message, details: upstreamDetails });
  }
  if (
    normalizedText.includes('presupuesto') ||
    normalizedText.includes('importe pendiente valido') ||
    normalizedText.includes('regenerar el presupuesto')
  ) {
    return new BookingPaymentHttpError({ status: 422, code: 'invalid_quote_state', message, details: upstreamDetails });
  }
  if (upstreamCode === 'P0001') {
    return new BookingPaymentHttpError({
      status: fallbackStatus,
      code: 'business_rule_violation',
      message,
      details: upstreamDetails,
    });
  }

  return new BookingPaymentHttpError({
    status: fallbackStatus,
    code: upstreamCode ? 'database_error' : 'booking_payment_failed',
    message,
    details: upstreamCode ? upstreamDetails : undefined,
  });
}
