import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateBookingStripeMetadataIntegrity } from '../../../src/shared/bookingPaymentCore.ts';

const jsonHeaders = { 'Content-Type': 'application/json' };

type StripeEventEnvelope = {
  id?: string;
  type?: string;
  data?: { object?: Record<string, unknown> };
};

type AttemptRow = {
  id: string;
  quote_id: string;
  quote_signature: string;
  client_id: string;
  gardener_id: string;
  service_id: string;
  payable_now_amount_cents: number;
  status: string;
  stripe_payment_intent_id?: string | null;
  gateway_response?: Record<string, unknown> | null;
};

type WebhookLedgerRow = {
  stripe_event_id: string;
  status: 'processing' | 'processed' | 'ignored' | 'failed';
  payment_attempt_id?: string | null;
};

class BookingPaymentWebhookHttpError extends Error {
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
    this.name = 'BookingPaymentWebhookHttpError';
    this.status = params.status;
    this.code = params.code;
    this.details = params.details;
  }
}

function resolveServiceRoleKey() {
  const modernSecretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (modernSecretKeys) {
    try {
      const parsed = JSON.parse(modernSecretKeys) as Record<string, string>;
      const preferred = parsed.default || Object.values(parsed)[0];
      if (preferred) return preferred;
    } catch {
      // Fallback to legacy secret below.
    }
  }

  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
}

function resolveWebhookSecrets() {
  const rawJson = Deno.env.get('STRIPE_WEBHOOK_SECRETS');
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed)) {
        return parsed.map((value) => String(value || '').trim()).filter(Boolean);
      }
      if (parsed && typeof parsed === 'object') {
        return Object.values(parsed).map((value) => String(value || '').trim()).filter(Boolean);
      }
    } catch {
      // Fallback to scalar envs below.
    }
  }

  return [
    Deno.env.get('STRIPE_WEBHOOK_SECRET'),
    Deno.env.get('STRIPE_CHECKOUT_WEBHOOK_SECRET'),
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'unknown');
}

function normalizeForMatch(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function toLoggableError(error: unknown) {
  if (error instanceof BookingPaymentWebhookHttpError) {
    return {
      name: error.name,
      code: error.code,
      status: error.status,
      message: error.message,
      details: error.details,
      stack: error.stack,
    };
  }

  if (error instanceof Error) {
    const candidate = error as Error & { code?: string; status?: number; details?: unknown };
    return {
      name: candidate.name,
      code: candidate.code,
      status: candidate.status,
      message: candidate.message,
      details: candidate.details,
      stack: candidate.stack,
    };
  }

  return { message: String(error || 'unknown') };
}

function logBookingPaymentWebhookError(stage: string, error: unknown, context: Record<string, unknown> = {}) {
  console.error('[booking-payment-webhook]', {
    stage,
    context,
    error: toLoggableError(error),
  });
}

async function persistServerTelemetry(
  admin: ReturnType<typeof createClient>,
  params: {
    level: 'info' | 'warn' | 'error';
    event: string;
    context?: Record<string, unknown>;
    userId?: string | null;
  },
) {
  const { error } = await admin.from('booking_funnel_events').insert({
    user_id: params.userId || null,
    level: params.level,
    event: params.event,
    source: 'edge-booking-payment-webhook',
    path: '/functions/v1/booking-payment-webhook',
    context: params.context || {},
    created_at: new Date().toISOString(),
  });

  if (error) {
    console.error('[booking-payment-webhook] telemetry persist failed', {
      event: params.event,
      message: error.message,
    });
  }
}

function classifyWebhookError(error: unknown, fallbackStatus = 500) {
  if (error instanceof BookingPaymentWebhookHttpError) {
    return error;
  }

  const candidate = error as Error & { code?: string; status?: number; details?: Record<string, unknown> };
  const message = getErrorMessage(error).trim() || 'Fallo interno procesando el webhook.';
  const normalized = normalizeForMatch(message);

  if (normalized.includes('metodo no soportado')) {
    return new BookingPaymentWebhookHttpError({ status: 405, code: 'method_not_allowed', message });
  }
  if (normalized.includes('faltan secretos de supabase')) {
    return new BookingPaymentWebhookHttpError({ status: 500, code: 'service_configuration_error', message });
  }
  if (normalized.includes('falta stripe_webhook_secret')) {
    return new BookingPaymentWebhookHttpError({ status: 500, code: 'webhook_secret_missing', message });
  }
  if (normalized.includes('falta la cabecera stripe-signature')) {
    return new BookingPaymentWebhookHttpError({ status: 400, code: 'missing_signature_header', message });
  }
  if (
    normalized.includes('firma del webhook de stripe no es valida') ||
    normalized.includes('stripe-signature no tiene un formato valido') ||
    normalized.includes('firma de stripe ha expirado')
  ) {
    return new BookingPaymentWebhookHttpError({ status: 400, code: 'invalid_signature', message });
  }
  if (normalized.includes('payload del webhook no es json valido')) {
    return new BookingPaymentWebhookHttpError({ status: 400, code: 'invalid_json', message });
  }
  if (normalized.includes('payload de stripe no incluye id o type')) {
    return new BookingPaymentWebhookHttpError({ status: 400, code: 'invalid_event_payload', message });
  }
  if (normalized.includes('no se pudo registrar el webhook')) {
    return new BookingPaymentWebhookHttpError({ status: 500, code: 'webhook_ledger_failed', message });
  }

  return new BookingPaymentWebhookHttpError({
    status: fallbackStatus,
    code: typeof candidate.code === 'string' && candidate.code.trim()
      ? 'database_error'
      : 'booking_payment_webhook_failed',
    message,
    details: typeof candidate.code === 'string' && candidate.code.trim()
      ? {
          upstreamCode: candidate.code,
          ...((candidate.details && typeof candidate.details === 'object') ? candidate.details : {}),
        }
      : undefined,
  });
}

function parseStripeSignatureHeader(header: string) {
  const parts = String(header || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  const timestampPart = parts.find((part) => part.startsWith('t='));
  const signatures = parts
    .filter((part) => part.startsWith('v1='))
    .map((part) => part.slice(3))
    .filter(Boolean);

  const timestamp = Number(timestampPart?.slice(2) || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || signatures.length === 0) {
    throw new Error('La cabecera Stripe-Signature no tiene un formato valido.');
  }

  return { timestamp, signatures };
}

function hexToBytes(hex: string) {
  const normalized = String(hex || '').trim().toLowerCase();
  if (!/^[a-f0-9]+$/i.test(normalized) || normalized.length % 2 !== 0) {
    return null;
  }

  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return bytes;
}

function timingSafeEqualHex(left: string, right: string) {
  const leftBytes = hexToBytes(left);
  const rightBytes = hexToBytes(right);
  if (!leftBytes || !rightBytes || leftBytes.length !== rightBytes.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    mismatch |= leftBytes[index] ^ rightBytes[index];
  }
  return mismatch === 0;
}

async function computeHmacSha256Hex(secret: string, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function verifyStripeSignature(params: {
  rawBody: string;
  signatureHeader: string;
  secrets: string[];
  toleranceSeconds: number;
}) {
  const { timestamp, signatures } = parseStripeSignatureHeader(params.signatureHeader);
  const currentTimestamp = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTimestamp - timestamp) > params.toleranceSeconds) {
    throw new Error('La firma de Stripe ha expirado o esta fuera de tolerancia.');
  }

  const signedPayload = `${timestamp}.${params.rawBody}`;
  for (const secret of params.secrets) {
    const expected = await computeHmacSha256Hex(secret, signedPayload);
    if (signatures.some((candidate) => timingSafeEqualHex(candidate, expected))) {
      return;
    }
  }

  throw new Error('La firma del webhook de Stripe no es valida.');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asInteger(value: unknown) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? Math.round(normalized) : 0;
}

function getObjectMetadata(object: Record<string, unknown>) {
  return asRecord(object.metadata);
}

function getPaymentIntentId(object: Record<string, unknown>) {
  const objectId = asString(object.id);
  if (asString(object.object) === 'payment_intent') return objectId;
  const paymentIntent = object.payment_intent;
  if (typeof paymentIntent === 'string') return paymentIntent.trim();
  return asString(asRecord(paymentIntent).id);
}

async function getAttemptSummary(admin: ReturnType<typeof createClient>, attemptId: string) {
  const { data, error } = await admin.rpc('get_booking_payment_attempt_summary', {
    p_attempt_id: attemptId,
  });
  if (error) throw error;
  return data;
}

async function getAttemptRowById(admin: ReturnType<typeof createClient>, attemptId: string) {
  const { data, error } = await admin
    .from('booking_payment_attempts')
    .select(`
      id,
      quote_id,
      quote_signature,
      client_id,
      gardener_id,
      service_id,
      payable_now_amount_cents,
      status,
      stripe_payment_intent_id,
      gateway_response
    `)
    .eq('id', attemptId)
    .maybeSingle();

  if (error) throw error;
  return (data as AttemptRow | null) || null;
}

async function findAttemptForEvent(
  admin: ReturnType<typeof createClient>,
  object: Record<string, unknown>,
) {
  const metadata = getObjectMetadata(object);
  const metadataAttemptId = asString(metadata.attempt_id);
  if (metadataAttemptId) {
    const attempt = await getAttemptRowById(admin, metadataAttemptId);
    if (attempt) return attempt;
  }

  const paymentIntentId = getPaymentIntentId(object);
  if (!paymentIntentId) return null;

  const { data, error } = await admin
    .from('booking_payment_attempts')
    .select(`
      id,
      quote_id,
      quote_signature,
      client_id,
      gardener_id,
      service_id,
      payable_now_amount_cents,
      status,
      stripe_payment_intent_id,
      gateway_response
    `)
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();

  if (error) throw error;
  return (data as AttemptRow | null) || null;
}

async function upsertWebhookLedgerRow(
  admin: ReturnType<typeof createClient>,
  params: {
    eventId: string;
    eventType: string;
    paymentAttemptId?: string | null;
    stripeObjectId?: string | null;
    payload: unknown;
  },
) {
  const { data, error } = await admin
    .from('stripe_webhook_events')
    .insert({
      stripe_event_id: params.eventId,
      event_type: params.eventType,
      payment_attempt_id: params.paymentAttemptId || null,
      stripe_object_id: params.stripeObjectId || null,
      status: 'processing',
      payload: params.payload,
    })
    .select('stripe_event_id, status, payment_attempt_id')
    .maybeSingle();

  if (!error) {
    return { row: data as WebhookLedgerRow, alreadyProcessed: false };
  }
  if (error.code !== '23505') throw error;

  const existing = await admin
    .from('stripe_webhook_events')
    .select('stripe_event_id, status, payment_attempt_id')
    .eq('stripe_event_id', params.eventId)
    .single();

  if (existing.error) throw existing.error;
  const existingRow = existing.data as WebhookLedgerRow;
  if (existingRow.status === 'failed') {
    const retryUpdate = await admin
      .from('stripe_webhook_events')
      .update({
        status: 'processing',
        payment_attempt_id: params.paymentAttemptId || existingRow.payment_attempt_id || null,
        payload: params.payload,
        failure_message: null,
        processed_at: null,
      })
      .eq('stripe_event_id', params.eventId)
      .select('stripe_event_id, status, payment_attempt_id')
      .single();

    if (retryUpdate.error) throw retryUpdate.error;
    return { row: retryUpdate.data as WebhookLedgerRow, alreadyProcessed: false };
  }

  return {
    row: existingRow,
    alreadyProcessed:
      existingRow.status === 'processed' ||
      existingRow.status === 'ignored' ||
      existingRow.status === 'processing',
  };
}

async function finalizeWebhookLedgerRow(
  admin: ReturnType<typeof createClient>,
  params: {
    eventId: string;
    status: 'processed' | 'ignored' | 'failed';
    paymentAttemptId?: string | null;
    failureMessage?: string | null;
  },
) {
  const { error } = await admin
    .from('stripe_webhook_events')
    .update({
      status: params.status,
      payment_attempt_id: params.paymentAttemptId || null,
      failure_message: params.failureMessage || null,
      processed_at: new Date().toISOString(),
    })
    .eq('stripe_event_id', params.eventId);

  if (error) throw error;
}

async function markAttemptForReconciliation(
  admin: ReturnType<typeof createClient>,
  params: {
    attemptId: string;
    reason: string;
    paymentIntentId?: string | null;
    gatewayPayload?: Record<string, unknown>;
  },
) {
  const { error } = await admin.rpc('release_booking_payment_attempt', {
    p_attempt_id: params.attemptId,
    p_next_status: 'reconciliation_required',
    p_reason: params.reason,
    p_stripe_payment_intent_id: params.paymentIntentId || null,
    p_gateway_payload: params.gatewayPayload || {},
  });

  if (error) throw error;
}

async function markAttemptProcessing(
  admin: ReturnType<typeof createClient>,
  attempt: AttemptRow,
  params: { paymentIntentId?: string | null; gatewayPayload?: Record<string, unknown> },
) {
  const { error } = await admin
    .from('booking_payment_attempts')
    .update({
      status: 'processing',
      stripe_payment_intent_id: params.paymentIntentId || attempt.stripe_payment_intent_id || null,
      gateway_response: {
        ...asRecord(attempt.gateway_response),
        ...(params.gatewayPayload || {}),
      },
    })
    .eq('id', attempt.id);

  if (error) throw error;
}

async function ensureStripeMetadataIntegrity(
  admin: ReturnType<typeof createClient>,
  params: {
    attempt: AttemptRow;
    metadata: Record<string, unknown>;
    paymentIntentId?: string | null;
    eventId: string;
  },
) {
  const integrity = validateBookingStripeMetadataIntegrity({
    expected: {
      attemptId: params.attempt.id,
      quoteId: params.attempt.quote_id,
      quoteSignature: params.attempt.quote_signature,
      clientId: params.attempt.client_id,
      gardenerId: params.attempt.gardener_id,
      serviceId: params.attempt.service_id,
      payableNowAmountCents: params.attempt.payable_now_amount_cents,
      paymentIntentId: params.attempt.stripe_payment_intent_id || params.paymentIntentId || null,
    },
    metadata: params.metadata,
    paymentIntentId: params.paymentIntentId,
  });

  if (integrity.ok) return true;

  await markAttemptForReconciliation(admin, {
    attemptId: params.attempt.id,
    reason: integrity.reason || 'stripe_metadata_mismatch',
    paymentIntentId: params.paymentIntentId,
    gatewayPayload: {
      webhookEventId: params.eventId,
      metadata: params.metadata,
      expected: integrity.expected,
      received: integrity.received,
    },
  });
  return false;
}

async function processStripeEvent(
  admin: ReturnType<typeof createClient>,
  params: {
    event: StripeEventEnvelope;
    attempt: AttemptRow | null;
  },
) {
  const eventType = asString(params.event.type);
  const object = asRecord(params.event.data?.object);
  const metadata = getObjectMetadata(object);
  const attemptId = params.attempt?.id || asString(metadata.attempt_id);
  const paymentIntentId = getPaymentIntentId(object);

  if (!params.attempt || !attemptId) {
    return {
      status: 'ignored' as const,
      attemptId: null,
      summary: null,
      message: 'Evento sin intento de pago asociado.',
    };
  }

  if (!(await ensureStripeMetadataIntegrity(admin, {
    attempt: params.attempt,
    metadata,
    paymentIntentId,
    eventId: asString(params.event.id),
  }))) {
    return {
      status: 'processed' as const,
      attemptId,
      summary: await getAttemptSummary(admin, attemptId),
      message: 'Intento enviado a conciliacion por metadata inconsistente.',
    };
  }

  if (eventType === 'payment_intent.succeeded') {
    const { data, error } = await admin.rpc('confirm_booking_payment_attempt', {
      p_attempt_id: attemptId,
      p_stripe_event_id: asString(params.event.id),
      p_stripe_payment_intent_id: paymentIntentId || null,
      p_amount_total_cents: asInteger(object.amount_received || object.amount),
      p_currency: asString(object.currency) || 'eur',
      p_gateway_payload: {
        webhookEventId: asString(params.event.id),
        webhookType: eventType,
        paymentIntentId,
        paymentStatus: asString(object.status),
      },
    });

    if (error) throw error;
    const summaryStatus = String(data?.status || '');

    // Emails transaccionales de confirmación (cliente + jardinero).
    // Estrictamente NO bloqueante: cualquier fallo se traga aquí y NUNCA
    // afecta al procesamiento del pago ni a la respuesta del webhook.
    if (summaryStatus === 'booking_created') {
      const confirmedBookingId = asString(asRecord(data).bookingId);
      if (confirmedBookingId) {
        try {
          await admin.functions.invoke('booking-confirmation-email', {
            body: { bookingId: confirmedBookingId },
          });
        } catch (emailError) {
          console.error('booking-confirmation-email dispatch fallido (no bloqueante):', emailError);
        }
      }
    }

    return {
      status: 'processed' as const,
      attemptId,
      summary: data,
      message: summaryStatus === 'booking_created'
        ? 'PaymentIntent conciliado correctamente.'
        : summaryStatus === 'reconciliation_required'
          ? 'PaymentIntent cobrado, pero el intento requiere conciliacion manual.'
          : 'PaymentIntent procesado sin cambios de booking.',
    };
  }

  if (eventType === 'payment_intent.processing') {
    await markAttemptProcessing(admin, params.attempt, {
      paymentIntentId: paymentIntentId || null,
      gatewayPayload: {
        webhookEventId: asString(params.event.id),
        webhookType: eventType,
        paymentIntentId,
      },
    });

    return {
      status: 'processed' as const,
      attemptId,
      summary: await getAttemptSummary(admin, attemptId),
      message: 'PaymentIntent en procesamiento.',
    };
  }

  if (eventType === 'payment_intent.payment_failed') {
    const { data, error } = await admin.rpc('release_booking_payment_attempt', {
      p_attempt_id: attemptId,
      p_next_status: 'failed',
      p_reason: 'stripe_payment_failed',
      p_stripe_payment_intent_id: paymentIntentId || null,
      p_gateway_payload: {
        webhookEventId: asString(params.event.id),
        webhookType: eventType,
        paymentIntentId,
        lastPaymentError: asRecord(object.last_payment_error),
      },
    });

    if (error) throw error;
    return {
      status: 'processed' as const,
      attemptId,
      summary: data,
      message: 'Intento marcado como fallido.',
    };
  }

  if (eventType === 'payment_intent.canceled') {
    const { data, error } = await admin.rpc('release_booking_payment_attempt', {
      p_attempt_id: attemptId,
      p_next_status: 'cancelled',
      p_reason: 'stripe_payment_intent_canceled',
      p_stripe_payment_intent_id: paymentIntentId || null,
      p_gateway_payload: {
        webhookEventId: asString(params.event.id),
        webhookType: eventType,
        cancellationReason: asString(object.cancellation_reason),
      },
    });

    if (error) throw error;
    return {
      status: 'processed' as const,
      attemptId,
      summary: data,
      message: 'Intento cancelado desde Stripe.',
    };
  }

  return {
    status: 'ignored' as const,
    attemptId,
    summary: null,
    message: `Evento ${eventType} ignorado por no afectar al lifecycle del intento.`,
  };
}

Deno.serve(async (req: Request) => {
  let admin: ReturnType<typeof createClient> | null = null;
  let attempt: AttemptRow | null = null;
  let event: StripeEventEnvelope | null = null;
  let eventId = '';
  let eventType = '';
  let stripeObjectId = '';
  let shouldFinalizeFailure = false;

  try {
    if (req.method !== 'POST') {
      throw new BookingPaymentWebhookHttpError({
        status: 405,
        code: 'method_not_allowed',
        message: 'Metodo no soportado.',
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = resolveServiceRoleKey();
    const webhookSecrets = resolveWebhookSecrets();

    if (!supabaseUrl || !serviceRoleKey) {
      throw new BookingPaymentWebhookHttpError({
        status: 500,
        code: 'service_configuration_error',
        message: 'Faltan secretos de Supabase para booking-payment-webhook.',
      });
    }
    if (webhookSecrets.length === 0) {
      throw new BookingPaymentWebhookHttpError({
        status: 500,
        code: 'webhook_secret_missing',
        message: 'Falta STRIPE_WEBHOOK_SECRET para validar el webhook.',
      });
    }

    admin = createClient(supabaseUrl, serviceRoleKey);
    const rawBody = await req.text();
    const signatureHeader = req.headers.get('Stripe-Signature') || '';
    if (!signatureHeader) {
      throw new BookingPaymentWebhookHttpError({
        status: 400,
        code: 'missing_signature_header',
        message: 'Falta la cabecera Stripe-Signature.',
      });
    }

    try {
      await verifyStripeSignature({
        rawBody,
        signatureHeader,
        secrets: webhookSecrets,
        toleranceSeconds: 300,
      });
    } catch (error) {
      throw classifyWebhookError(error, 400);
    }

    try {
      event = JSON.parse(rawBody) as StripeEventEnvelope;
    } catch {
      throw new BookingPaymentWebhookHttpError({
        status: 400,
        code: 'invalid_json',
        message: 'El payload del webhook no es JSON valido.',
      });
    }

    eventId = asString(event.id);
    eventType = asString(event.type);
    const object = asRecord(event.data?.object);
    stripeObjectId = asString(object.id);

    if (!eventId || !eventType) {
      throw new BookingPaymentWebhookHttpError({
        status: 400,
        code: 'invalid_event_payload',
        message: 'El payload de Stripe no incluye id o type.',
      });
    }

    attempt = await findAttemptForEvent(admin, object);

    let ledger: { row: WebhookLedgerRow; alreadyProcessed: boolean };
    try {
      ledger = await upsertWebhookLedgerRow(admin, {
        eventId,
        eventType,
        paymentAttemptId: attempt?.id || null,
        stripeObjectId,
        payload: event,
      });
    } catch (error) {
      throw new BookingPaymentWebhookHttpError({
        status: 500,
        code: 'webhook_ledger_failed',
        message: getErrorMessage(error).trim() || 'No se pudo registrar el webhook.',
      });
    }

    if (ledger.alreadyProcessed) {
      await persistServerTelemetry(admin, {
        level: 'info',
        event: 'booking.payment_webhook_processed',
        userId: attempt?.client_id || null,
        context: {
          eventId,
          eventType,
          attemptId: ledger.row.payment_attempt_id || attempt?.id || null,
          webhookStatus: ledger.row.status,
          duplicate: true,
          stripeObjectId: stripeObjectId || null,
        },
      });
      return jsonResponse({
        received: true,
        duplicate: true,
        eventId,
        paymentAttemptId: ledger.row.payment_attempt_id || attempt?.id || null,
      });
    }

    shouldFinalizeFailure = true;
    const result = await processStripeEvent(admin, { event, attempt });
    await persistServerTelemetry(admin, {
      level: 'info',
      event: 'booking.payment_webhook_processed',
      userId: attempt?.client_id || null,
      context: {
        eventId,
        eventType,
        attemptId: result.attemptId,
        bookingId: result.summary?.bookingId ?? null,
        paymentStatus: result.summary?.status ?? null,
        webhookStatus: result.status,
        duplicate: false,
        stripeObjectId: stripeObjectId || null,
      },
    });
    await finalizeWebhookLedgerRow(admin, {
      eventId,
      status: result.status,
      paymentAttemptId: result.attemptId,
      failureMessage: null,
    });
    shouldFinalizeFailure = false;

    return jsonResponse({
      received: true,
      eventId,
      status: result.status,
      paymentAttemptId: result.attemptId,
      attempt: result.summary,
      message: result.message,
    });
  } catch (error) {
    const httpError = classifyWebhookError(error);
    logBookingPaymentWebhookError('request_failed', error, {
      method: req.method,
      eventId: eventId || null,
      eventType: eventType || null,
      attemptId: attempt?.id || null,
      stripeObjectId: stripeObjectId || null,
      code: httpError.code,
      status: httpError.status,
    });

    if (admin) {
      await persistServerTelemetry(admin, {
        level: httpError.status >= 500 ? 'error' : 'warn',
        event: eventId && eventType ? 'booking.payment_webhook_failed' : 'booking.payment_webhook_rejected',
        userId: attempt?.client_id || null,
        context: {
          eventId: eventId || null,
          eventType: eventType || null,
          attemptId: attempt?.id || null,
          stripeObjectId: stripeObjectId || null,
          reason: httpError.code,
          errorCode: httpError.code,
          httpStatus: httpError.status,
          message: httpError.message,
        },
      });
    }

    if (admin && shouldFinalizeFailure && eventId) {
      try {
        await finalizeWebhookLedgerRow(admin, {
          eventId,
          status: 'failed',
          paymentAttemptId: attempt?.id || null,
          failureMessage: httpError.message,
        });
      } catch (ledgerError) {
        logBookingPaymentWebhookError('finalize_failed_ledger', ledgerError, {
          eventId,
          attemptId: attempt?.id || null,
        });
      }
    }

    return jsonResponse({
      error: httpError.message,
      code: httpError.code,
      eventId: eventId || null,
      paymentAttemptId: attempt?.id || null,
    }, httpError.status);
  }
});
