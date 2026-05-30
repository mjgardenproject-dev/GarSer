import { supabase } from '../lib/supabase';
import type {
  BookingPaymentPrepareResponse,
  BookingPaymentStatusResponse,
  BookingPaymentAttemptSummary,
} from '../shared/bookingPaymentCore';
import { coercePaymentAttemptSummary } from '../shared/bookingPaymentCore';
import { reportBookingEvent } from './bookingTelemetry';

type PaymentInvokeBody = Record<string, unknown>;

export class BookingPaymentError extends Error {
  readonly source = 'booking-payment';
  readonly status?: number;
  readonly code?: string;
  readonly backendMessage?: string;
  readonly responseBody?: unknown;

  constructor(params: {
    message: string;
    status?: number;
    code?: string;
    backendMessage?: string;
    responseBody?: unknown;
  }) {
    super(params.message);
    this.name = 'BookingPaymentError';
    this.status = params.status;
    this.code = params.code;
    this.backendMessage = params.backendMessage;
    this.responseBody = params.responseBody;
  }
}

export function isBookingPaymentError(error: unknown): error is BookingPaymentError {
  return (
    error instanceof BookingPaymentError ||
    (typeof error === 'object' &&
      error !== null &&
      'source' in error &&
      (error as { source?: string }).source === 'booking-payment')
  );
}

async function readFunctionErrorBody(context?: Response) {
  if (!context) return null;

  try {
    const response = context.clone();
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();

    if (contentType.includes('application/json')) {
      return await response.json();
    }

    const text = await response.text();
    return text ? { error: text } : null;
  } catch {
    return null;
  }
}

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

function extractBackendMessage(payload: unknown) {
  const messages = collectErrorMessages(payload);
  return messages[0] || '';
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

async function normalizePaymentError(error: unknown) {
  const candidate = error as {
    message?: string;
    name?: string;
    code?: string;
    status?: number;
    context?: Response;
  };
  const status = typeof candidate?.status === 'number' ? candidate.status : candidate?.context?.status;
  const responseBody = await readFunctionErrorBody(candidate?.context);
  const backendMessage = extractBackendMessage(responseBody);
  const payloadSummary = summarizeErrorPayload(responseBody);
  const backendCode =
    responseBody && typeof responseBody === 'object' && typeof (responseBody as Record<string, unknown>).code === 'string'
      ? String((responseBody as Record<string, unknown>).code)
      : undefined;
  const rawCandidateMessage = normalizeErrorString(candidate?.message);
  const fallbackMessage = backendMessage
    ? backendMessage
    : rawCandidateMessage && !rawCandidateMessage.toLowerCase().includes('edge function returned a non-2xx status code')
      ? rawCandidateMessage
      : payloadSummary || 'No se pudo preparar el pago seguro.';

  return new BookingPaymentError({
    message: fallbackMessage,
    status,
    code: backendCode || candidate?.code || candidate?.name,
    backendMessage: backendMessage || undefined,
    responseBody: responseBody || undefined,
  });
}

async function invokePayment<T>(body: PaymentInvokeBody): Promise<T> {
  try {
    const { data, error } = await supabase.functions.invoke('booking-payment', { body });
    if (error) throw error;
    return data as T;
  } catch (error) {
    throw await normalizePaymentError(error);
  }
}

function normalizeStatusResponse(data: BookingPaymentStatusResponse): BookingPaymentStatusResponse {
  return {
    attempt: data?.attempt ? coercePaymentAttemptSummary(data.attempt as unknown as Record<string, unknown>) : null,
  };
}

function getTelemetryErrorContext(error: unknown) {
  if (isBookingPaymentError(error)) {
    return {
      message: error.message,
      errorCode: error.code,
      httpStatus: error.status,
      backendMessage: error.backendMessage,
    };
  }

  return {
    message: error instanceof Error ? error.message : 'unknown',
  };
}

export async function prepareBookingPayment(params: {
  quoteId?: string;
  attemptId?: string;
}): Promise<BookingPaymentPrepareResponse> {
  try {
    const data = await invokePayment<BookingPaymentPrepareResponse>({
      action: 'prepare_payment',
      quoteId: params.quoteId,
      attemptId: params.attemptId,
    });
    return {
      clientSecret: typeof data.clientSecret === 'string' ? data.clientSecret : undefined,
      publishableKey: typeof data.publishableKey === 'string' ? data.publishableKey : undefined,
      attempt: coercePaymentAttemptSummary(data.attempt as unknown as Record<string, unknown>),
    };
  } catch (error) {
    reportBookingEvent('error', {
      event: 'booking.payment_prepare_failed',
      context: {
        quoteId: params.quoteId,
        attemptId: params.attemptId,
        ...getTelemetryErrorContext(error),
      },
    });
    throw error;
  }
}

export async function getBookingPaymentAttemptStatus(params: {
  attemptId?: string;
  quoteId?: string;
}): Promise<BookingPaymentStatusResponse> {
  try {
    const data = await invokePayment<BookingPaymentStatusResponse>({
      action: 'get_attempt_status',
      attemptId: params.attemptId,
      quoteId: params.quoteId,
    });
    const normalized = normalizeStatusResponse(data);
    if (normalized.attempt) {
      reportBookingEvent('info', {
        event: 'booking.payment_status_loaded',
        context: {
          attemptId: normalized.attempt.attemptId,
          quoteId: normalized.attempt.quoteId,
          paymentStatus: normalized.attempt.status,
          retryable: normalized.attempt.retryable,
          terminal: normalized.attempt.terminal,
        },
      });
    }
    return normalized;
  } catch (error) {
    reportBookingEvent('error', {
      event: 'booking.payment_status_failed',
      context: {
        attemptId: params.attemptId,
        quoteId: params.quoteId,
        ...getTelemetryErrorContext(error),
      },
    });
    throw error;
  }
}

export async function syncBookingPaymentAttempt(params: {
  attemptId: string;
}): Promise<BookingPaymentAttemptSummary> {
  try {
    const data = await invokePayment<{ attempt: BookingPaymentAttemptSummary }>({
      action: 'sync_payment_state',
      attemptId: params.attemptId,
    });
    const attempt = coercePaymentAttemptSummary(data.attempt as unknown as Record<string, unknown>);
    reportBookingEvent('info', {
      event: 'booking.payment_state_synced',
      context: {
        attemptId: attempt.attemptId,
        quoteId: attempt.quoteId,
        paymentStatus: attempt.status,
        bookingId: attempt.bookingId,
      },
    });
    return attempt;
  } catch (error) {
    reportBookingEvent('error', {
      event: 'booking.payment_state_sync_failed',
      context: {
        attemptId: params.attemptId,
        ...getTelemetryErrorContext(error),
      },
    });
    throw error;
  }
}

export async function cancelBookingPaymentAttempt(params: {
  attemptId: string;
}): Promise<BookingPaymentAttemptSummary> {
  try {
    const data = await invokePayment<{ attempt: BookingPaymentAttemptSummary }>({
      action: 'cancel_attempt',
      attemptId: params.attemptId,
    });
    const attempt = coercePaymentAttemptSummary(data.attempt as unknown as Record<string, unknown>);
    reportBookingEvent('info', {
      event: 'booking.payment_attempt_cancelled',
      context: {
        attemptId: attempt.attemptId,
        quoteId: attempt.quoteId,
        paymentStatus: attempt.status,
      },
    });
    return attempt;
  } catch (error) {
    reportBookingEvent('error', {
      event: 'booking.payment_attempt_cancel_failed',
      context: {
        attemptId: params.attemptId,
        ...getTelemetryErrorContext(error),
      },
    });
    throw error;
  }
}
