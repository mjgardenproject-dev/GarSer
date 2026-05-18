import { supabase } from '../lib/supabase';

type BookingTelemetryLevel = 'info' | 'warn' | 'error';
type TelemetryConsolePhase = 'event' | 'sink-retry' | 'sink-failed';

interface BookingTelemetryPayload {
  event: string;
  context?: Record<string, unknown>;
}

const MAX_SANITIZE_DEPTH = 4;
const MAX_ARRAY_ITEMS = 10;
const REDACTED_VALUE = '[redacted]';
const SENSITIVE_KEY_PATTERN = /(address|auth|authorization|cookie|description|email|name|note|password|phone|prompt|raw|response|session|token)/i;
const TELEMETRY_SINK_MAX_ATTEMPTS = 3;
const TELEMETRY_SINK_RETRY_DELAYS_MS = [250, 750];
const TELEMETRY_SINK_COOLDOWN_MS = 60_000;

let telemetrySinkDisabledUntil = 0;

function isTelemetryDebugEnabled() {
  const envDebugEnabled = import.meta.env.VITE_BOOKING_TELEMETRY_DEBUG === 'true';
  if (typeof window === 'undefined') return envDebugEnabled;

  const runtimeFlag = (window as typeof window & {
    __GARSER_BOOKING_TELEMETRY_DEBUG__?: boolean;
  }).__GARSER_BOOKING_TELEMETRY_DEBUG__;

  if (typeof runtimeFlag === 'boolean') return runtimeFlag;

  try {
    return window.localStorage.getItem('garser:booking-telemetry-debug') === 'true' || envDebugEnabled;
  } catch {
    return envDebugEnabled;
  }
}

function emitTelemetryToConsole(
  phase: TelemetryConsolePhase,
  payload: Record<string, unknown> | ReturnType<typeof buildTelemetryEntry>,
) {
  if (!isTelemetryDebugEnabled()) return;

  if (phase === 'event') {
    const entry = payload as ReturnType<typeof buildTelemetryEntry>;
    if (entry.level === 'info') console.info('[booking-event]', entry);
    else console.warn('[booking-event]', entry);
    return;
  }

  if (phase === 'sink-retry') {
    console.warn('[booking-event:sink-retry]', payload);
    return;
  }

  console.warn('[booking-event:sink-failed]', payload);
}

function trimString(value: string, maxLength = 500) {
  const normalized = value.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function inferPhase(event: string) {
  if (event.includes('details_analysis')) return 'analysis';
  if (event.includes('photo_analysis_source')) return 'analysis_source';
  if (event.includes('photo_selection')) return 'selection';
  if (event.includes('photo_removed')) return 'invalidation';
  if (event.includes('photo_upload')) return 'upload';
  if (event.includes('photo_compression')) return 'compression';
  if (event.includes('photo_signed_url')) return 'signed_url';
  if (event.includes('media_prepare')) return 'media_prepare';
  if (event.includes('media_persist')) return 'media_persist';
  if (event.includes('confirmation')) return 'confirmation';
  return 'booking';
}

function inferStatus(level: BookingTelemetryLevel, event: string) {
  if (event.endsWith('_started')) return 'started';
  if (event.endsWith('_succeeded')) return 'succeeded';
  if (event.endsWith('_failed')) return 'failed';
  if (event.endsWith('_retry')) return 'retry';
  if (event.endsWith('_rejected')) return 'rejected';
  if (event.endsWith('_skipped')) return 'skipped';
  if (event.includes('_using_')) return 'fallback';
  return level === 'info' ? 'info' : 'warning';
}

function inferErrorType(level: BookingTelemetryLevel, event: string, context?: Record<string, unknown>) {
  if (typeof context?.errorType === 'string' && context.errorType.trim()) {
    return context.errorType.trim();
  }

  if (level === 'info' && !event.endsWith('_failed') && !event.endsWith('_rejected')) {
    return undefined;
  }

  if (event.includes('analysis_source')) return 'analysis_source_error';
  if (event.includes('details_analysis')) return 'analysis_error';
  if (event.includes('photo_upload')) return 'photo_upload_error';
  if (event.includes('photo_selection')) return 'photo_selection_error';
  if (event.includes('photo_compression')) return 'photo_compression_error';
  if (event.includes('photo_signed_url')) return 'signed_url_error';
  if (event.includes('media_prepare')) return 'media_prepare_error';
  if (event.includes('media_persist')) return 'media_persist_error';
  if (event.includes('confirmation')) return 'confirmation_error';
  return 'booking_error';
}

function normalizeIdentifier(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function buildCorrelationId(rawValue: unknown) {
  const existing = normalizeIdentifier(rawValue);
  if (existing) return existing;

  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `booking-event-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function sanitizeContextValue(value: unknown, keyPath = '', depth = 0): unknown {
  if (value == null) return value;
  if (depth >= MAX_SANITIZE_DEPTH) return '[truncated]';

  if (typeof File !== 'undefined' && value instanceof File) {
    return {
      kind: 'file',
      name: trimString(value.name, 120),
      type: trimString(value.type || 'application/octet-stream', 120),
      size: value.size,
    };
  }

  if (value instanceof Error) {
    return {
      name: trimString(value.name || 'Error', 120),
      message: trimString(value.message || 'unknown_error'),
    };
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item, index) => sanitizeContextValue(item, `${keyPath}[${index}]`, depth + 1));
  }

  if (typeof value === 'string') {
    return SENSITIVE_KEY_PATTERN.test(keyPath) ? REDACTED_VALUE : trimString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, nested]) => {
          const nextPath = keyPath ? `${keyPath}.${key}` : key;
          return [key, sanitizeContextValue(nested, nextPath, depth + 1)];
        })
        .filter(([, nested]) => nested !== undefined)
    );
  }

  return String(value);
}

function buildTelemetryEntry(level: BookingTelemetryLevel, payload: BookingTelemetryPayload) {
  const safeContext = (sanitizeContextValue(payload.context || {}, 'context') || {}) as Record<string, unknown>;
  const correlationId = buildCorrelationId(
    safeContext.correlationId ?? safeContext.correlation_id ?? safeContext.operationId ?? safeContext.operation_id,
  );
  const bookingId = normalizeIdentifier(safeContext.bookingId ?? safeContext.booking_id);
  const operationId = normalizeIdentifier(safeContext.operationId ?? safeContext.operation_id);
  const userId = normalizeIdentifier(safeContext.userId ?? safeContext.user_id);
  const serviceId = normalizeIdentifier(safeContext.serviceId ?? safeContext.service_id);
  const enrichedContext: Record<string, unknown> = {
    ...safeContext,
    correlationId,
    ...(bookingId ? { bookingId } : {}),
    ...(operationId ? { operationId } : {}),
    ...(userId ? { userId } : {}),
    ...(serviceId ? { serviceId } : {}),
  };

  return {
    event: payload.event,
    context: enrichedContext,
    phase: typeof enrichedContext.phase === 'string' ? enrichedContext.phase : inferPhase(payload.event),
    status: typeof enrichedContext.status === 'string' ? enrichedContext.status : inferStatus(level, payload.event),
    service: typeof enrichedContext.service === 'string' ? enrichedContext.service : undefined,
    scope: typeof enrichedContext.scope === 'string' ? enrichedContext.scope : undefined,
    errorType: inferErrorType(level, payload.event, enrichedContext),
    correlationId,
    bookingId,
    operationId,
    userId,
    serviceId,
    level,
    timestamp: new Date().toISOString(),
    path: typeof window !== 'undefined' ? window.location.pathname : undefined,
    source: 'web-client',
  };
}

function getSinkRetryDelay(attempt: number) {
  return TELEMETRY_SINK_RETRY_DELAYS_MS[Math.max(0, attempt - 1)] || TELEMETRY_SINK_RETRY_DELAYS_MS[TELEMETRY_SINK_RETRY_DELAYS_MS.length - 1];
}

function waitForRetry(ms: number) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

async function sendTelemetryToSink(entry: ReturnType<typeof buildTelemetryEntry>, attempt = 1): Promise<void> {
  if (Date.now() < telemetrySinkDisabledUntil) {
    return;
  }

  try {
    const { error } = await supabase.functions.invoke('booking-telemetry', { body: entry });
    if (error) throw error;
  } catch (error) {
    if (attempt >= TELEMETRY_SINK_MAX_ATTEMPTS) {
      telemetrySinkDisabledUntil = Date.now() + TELEMETRY_SINK_COOLDOWN_MS;
      emitTelemetryToConsole('sink-failed', {
        attempt,
        event: entry.event,
        correlationId: entry.correlationId,
        disabledUntil: new Date(telemetrySinkDisabledUntil).toISOString(),
        error,
      });
      return;
    }

    emitTelemetryToConsole('sink-retry', {
      attempt,
      event: entry.event,
      correlationId: entry.correlationId,
      error,
    });
    await waitForRetry(getSinkRetryDelay(attempt));
    await sendTelemetryToSink(entry, attempt + 1);
  }
}

export function reportBookingEvent(level: BookingTelemetryLevel, payload: BookingTelemetryPayload) {
  const entry = buildTelemetryEntry(level, payload);

  emitTelemetryToConsole('event', entry);

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('garser:booking-event', { detail: entry }));
  }

  void sendTelemetryToSink(entry);
}
