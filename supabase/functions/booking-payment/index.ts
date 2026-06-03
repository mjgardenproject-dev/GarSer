import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  evaluateOperationalEligibility,
  type ProviderProfileLike,
} from '../../../src/shared/bookingEligibilityCore.ts';
import {
  BOOKING_PAYMENT_HOLD_MINUTES,
  buildAuthoritativeBookingStripeLineItems,
  buildBookingPaymentGatewaySyncEventId,
  buildBookingStripeLineItemProductCode,
  isInFlightPaymentAttemptStatus,
  validateBookingStripeMetadataIntegrity,
} from '../../../src/shared/bookingPaymentCore.ts';
import type { SerializableBookingData } from '../../../src/shared/bookingQuoteCore.ts';
import { geocodeAddressWithGoogleApi } from '../../../src/shared/providerOperationalGeocoding.ts';
import {
  BookingPaymentHttpError,
  classifyBookingPaymentError,
  extractBookingPaymentErrorDiagnostics,
} from './error-classification.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type PaymentAction =
  | 'prepare_payment'
  | 'get_attempt_status'
  | 'cancel_attempt'
  | 'sync_payment_state';

type PaymentPayload = {
  action?: PaymentAction;
  quoteId?: string;
  attemptId?: string;
};

type AttemptSummary = {
  attemptId: string;
  quoteId: string;
  status: string;
  currency: string;
  payableNowAmountCents: number;
  serviceTotalAmountCents: number;
  paymentIntentId?: string;
  paymentExpiresAt?: string;
  holdExpiresAt?: string;
  bookingId?: string;
  retryable: boolean;
  terminal: boolean;
  lastErrorCode?: string;
  lastErrorMessage?: string;
};

type AttemptRow = {
  id: string;
  client_id: string;
  gardener_id: string;
  service_id: string;
  quote_id: string;
  quote_signature: string;
  currency: string;
  status: string;
  stripe_idempotency_key: string;
  stripe_payment_intent_id?: string | null;
  payment_expires_at?: string | null;
  service_total_amount_cents: number;
  payable_now_amount_cents: number;
  economic_snapshot: {
    stripeLineItems?: Array<{
      code: string;
      label: string;
      unitAmount: number;
      quantity: number;
    }>;
  } | null;
  gateway_response?: Record<string, unknown> | null;
  last_error_code?: string | null;
  last_error_message?: string | null;
};

type QuoteRow = {
  id: string;
  client_id: string;
  gardener_id: string;
  service_id: string;
  signature: string;
  status: string;
  expires_at?: string | null;
  selected_date?: string | null;
  selected_start_time?: string | null;
  total_price: number;
  estimated_hours: number;
  provider_config_version?: string | null;
  input_payload: SerializableBookingData | null;
  pricing_snapshot?: Record<string, unknown> | null;
  economic_snapshot?: Record<string, unknown> | null;
};

type ActivePriceRow = {
  gardener_id: string;
  additional_config: Record<string, unknown> | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type AvailabilityRow = {
  gardener_id: string;
  date: string;
  start_time: string;
  is_available: boolean;
};

type HoldBlockRow = {
  hold_id: string;
  gardener_id: string;
  date: string;
  hour_block: number;
};

type ActiveHoldRow = {
  id: string;
};

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

function resolveStripeSecret() {
  return Deno.env.get('STRIPE_SECRET_KEY');
}

function resolveStripePublishableKey() {
  return String(Deno.env.get('STRIPE_PUBLISHABLE_KEY') || '').trim() || null;
}

function resolveAllowedClientApiKeys() {
  const keys = new Set<string>();
  const modernPublishableKeys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');

  if (modernPublishableKeys) {
    try {
      const parsed = JSON.parse(modernPublishableKeys) as Record<string, string>;
      Object.values(parsed)
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .forEach((value) => keys.add(value));
    } catch {
      // Fallback to legacy anon key below.
    }
  }

  const legacyAnonKey = String(Deno.env.get('SUPABASE_ANON_KEY') || '').trim();
  if (legacyAnonKey) {
    keys.add(legacyAnonKey);
  }

  return Array.from(keys);
}

function hasAllowedClientApiKey(req: Request, allowedApiKeys: string[]) {
  const apiKey = String(req.headers.get('apikey') || '').trim();
  return apiKey !== '' && allowedApiKeys.includes(apiKey);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
    source: 'edge-booking-payment',
    path: '/functions/v1/booking-payment',
    context: params.context || {},
    created_at: new Date().toISOString(),
  });

  if (error) {
    console.error('[booking-payment] telemetry persist failed', {
      event: params.event,
      message: error.message,
    });
  }
}

function toLoggableError(error: unknown) {
  if (error instanceof BookingPaymentHttpError) {
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

function logBookingPaymentError(action: string, error: unknown, context: Record<string, unknown> = {}) {
  console.error('[booking-payment]', {
    action,
    context,
    error: toLoggableError(error),
  });
}

function resolveBookingPaymentFailureEvent(action?: PaymentAction, hasOperationContext = false) {
  if (!hasOperationContext) {
    return 'booking.payment_request_rejected';
  }

  switch (action) {
    case 'prepare_payment':
      return 'booking.payment_prepare_failed';
    case 'get_attempt_status':
      return 'booking.payment_status_failed';
    case 'cancel_attempt':
      return 'booking.payment_attempt_cancel_failed';
    case 'sync_payment_state':
      return 'booking.payment_state_sync_failed';
    default:
      return 'booking.payment_request_rejected';
  }
}

async function resolveUser(admin: ReturnType<typeof createClient>, req: Request) {
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

async function parsePayload(req: Request): Promise<PaymentPayload> {
  try {
    return (await req.json()) as PaymentPayload;
  } catch {
    throw new BookingPaymentHttpError({
      status: 400,
      code: 'invalid_json',
      message: 'El body JSON de booking-payment no es valido.',
    });
  }
}

async function getAttemptSummary(
  admin: ReturnType<typeof createClient>,
  attemptId: string,
): Promise<AttemptSummary> {
  const { data, error } = await admin.rpc('get_booking_payment_attempt_summary', {
    p_attempt_id: attemptId,
  });

  if (error || !data) {
    throw error || new Error('No se pudo recuperar el resumen del intento de pago.');
  }

  return data as AttemptSummary;
}

async function getAttemptRow(
  admin: ReturnType<typeof createClient>,
  attemptId: string,
): Promise<AttemptRow | null> {
  const { data, error } = await admin
    .from('booking_payment_attempts')
    .select(`
      id,
      client_id,
      gardener_id,
      service_id,
      quote_id,
      quote_signature,
      currency,
      status,
      stripe_idempotency_key,
      stripe_payment_intent_id,
      payment_expires_at,
      service_total_amount_cents,
      payable_now_amount_cents,
      economic_snapshot,
      gateway_response,
      last_error_code,
      last_error_message
    `)
    .eq('id', attemptId)
    .maybeSingle();

  if (error) throw error;
  return (data as AttemptRow | null) || null;
}

async function getQuoteRow(
  admin: ReturnType<typeof createClient>,
  quoteId: string,
): Promise<QuoteRow | null> {
  const { data, error } = await admin
    .from('booking_quotes')
    .select(`
      id,
      client_id,
      gardener_id,
      service_id,
      signature,
      status,
      expires_at,
      selected_date,
      selected_start_time,
      total_price,
      estimated_hours,
      provider_config_version,
      input_payload,
      pricing_snapshot,
      economic_snapshot
    `)
    .eq('id', quoteId)
    .maybeSingle();

  if (error) throw error;
  return (data as QuoteRow | null) || null;
}

async function getActivePriceRow(
  admin: ReturnType<typeof createClient>,
  gardenerId: string,
  serviceId: string,
): Promise<ActivePriceRow | null> {
  const { data, error } = await admin
    .from('gardener_service_prices')
    .select('gardener_id, additional_config, updated_at, created_at')
    .eq('gardener_id', gardenerId)
    .eq('service_id', serviceId)
    .eq('active', true)
    .maybeSingle();

  if (error) throw error;
  return (data as ActivePriceRow | null) || null;
}

async function getProviderProfile(
  admin: ReturnType<typeof createClient>,
  gardenerId: string,
): Promise<(ProviderProfileLike & { address?: string | null }) | null> {
  const { data, error } = await admin
    .from('gardener_profiles')
    .select('address, max_distance, operational_latitude, operational_longitude')
    .eq('user_id', gardenerId)
    .maybeSingle();

  if (error) throw error;
  return (data as (ProviderProfileLike & { address?: string | null }) | null) || null;
}

async function ensureProviderOperationalCoordinates(
  admin: ReturnType<typeof createClient>,
  gardenerId: string,
  profile?: (ProviderProfileLike & { address?: string | null }) | null,
): Promise<(ProviderProfileLike & { address?: string | null }) | null> {
  if (!profile) return null;
  if (Number.isFinite(Number(profile.operational_latitude)) && Number.isFinite(Number(profile.operational_longitude))) {
    return profile;
  }

  const address = String(profile.address || '').trim();
  const googleApiKey = String(Deno.env.get('GOOGLE_API_KEY') || '').trim();
  if (!address || !googleApiKey) {
    return profile;
  }

  const resolvedCoordinates = await geocodeAddressWithGoogleApi({
    address,
    apiKey: googleApiKey,
  });

  if (!resolvedCoordinates) {
    return profile;
  }

  try {
    const { error } = await admin
      .from('gardener_profiles')
      .update({
        operational_latitude: resolvedCoordinates.lat,
        operational_longitude: resolvedCoordinates.lng,
      })
      .eq('user_id', gardenerId);

    if (error) {
      return profile;
    }
  } catch {
    return profile;
  }

  return {
    ...profile,
    operational_latitude: resolvedCoordinates.lat,
    operational_longitude: resolvedCoordinates.lng,
  };
}

const toIsoDate = (value?: string | null) => {
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
};

const extractHour = (value?: string | null) => Number.parseInt(String(value || '0').slice(0, 2), 10);

async function sha256(text: string) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('');
}

function buildAvailabilityIndex(rows: AvailabilityRow[]) {
  const providerDates = new Map<string, number[]>();
  rows.forEach((row) => {
    const date = toIsoDate(row.date);
    if (!date || !row.is_available) return;
    const hours = providerDates.get(date) || [];
    hours.push(extractHour(row.start_time));
    providerDates.set(date, hours);
  });
  return providerDates;
}

async function fetchAvailabilityRowsForQuote(
  admin: ReturnType<typeof createClient>,
  params: {
    gardenerId: string;
    date: string;
    excludeHoldIds?: string[];
  },
): Promise<AvailabilityRow[]> {
  try {
    await admin.rpc('cleanup_expired_booking_payment_state', {
      p_gardener_ids: [params.gardenerId],
      p_start_date: params.date,
      p_end_date: params.date,
    });
  } catch {
    // No bloqueamos el pago por fallos de limpieza oportunista.
  }

  const { data, error } = await admin
    .from('availability')
    .select('gardener_id, date, start_time, is_available')
    .eq('gardener_id', params.gardenerId)
    .eq('date', params.date)
    .eq('is_available', true)
    .order('start_time', { ascending: true });

  if (error || !data) return [];

  const { data: holdData } = await admin
    .from('booking_schedule_hold_blocks')
    .select('hold_id, gardener_id, date, hour_block')
    .eq('gardener_id', params.gardenerId)
    .eq('date', params.date);

  const excludedHoldIds = new Set((params.excludeHoldIds || []).map((value) => String(value || '').trim()).filter(Boolean));
  const heldSlots = new Set(
    ((holdData || []) as HoldBlockRow[])
      .filter((row) => !excludedHoldIds.has(String(row.hold_id)))
      .map((row) => `${row.gardener_id}|${toIsoDate(row.date)}|${Number(row.hour_block)}`),
  );

  return (data as AvailabilityRow[]).filter((row) => {
    const key = `${row.gardener_id}|${toIsoDate(row.date)}|${extractHour(row.start_time)}`;
    return !heldSlots.has(key);
  });
}

async function getActiveHoldIdsForQuote(
  admin: ReturnType<typeof createClient>,
  quoteId: string,
): Promise<string[]> {
  const { data, error } = await admin
    .from('booking_schedule_holds')
    .select('id')
    .eq('quote_id', quoteId)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString());

  if (error || !data) return [];
  return (data as ActiveHoldRow[]).map((row) => row.id);
}

function assertQuoteEconomicsStillMatch(params: {
  quote: QuoteRow;
  totalPrice: number;
  estimatedHours: number;
  payableNow: number;
}) {
  const persistedPayableNow = Number(asRecord(params.quote.economic_snapshot).payableNow || 0);
  const persistedTotalPrice = Number(params.quote.total_price || 0);
  const persistedEstimatedHours = Number(params.quote.estimated_hours || 0);

  if (
    Math.round(persistedTotalPrice) !== Math.round(params.totalPrice)
    || Math.round(persistedEstimatedHours * 100) !== Math.round(params.estimatedHours * 100)
    || Math.round(persistedPayableNow * 100) !== Math.round(params.payableNow * 100)
  ) {
    throw new BookingPaymentHttpError({
      status: 422,
      code: 'invalid_quote_state',
      message: 'El presupuesto ya no coincide con la configuración operativa actual. Debes regenerar el presupuesto antes de pagar.',
    });
  }
}

async function revalidateQuoteBeforePayment(
  admin: ReturnType<typeof createClient>,
  params: {
    quoteId: string;
    userId: string;
  },
) {
  const quote = await getQuoteRow(admin, params.quoteId);
  if (!quote) {
    throw new BookingPaymentHttpError({
      status: 404,
      code: 'not_found',
      message: 'El presupuesto seleccionado ya no esta disponible.',
    });
  }

  if (quote.client_id !== params.userId) {
    throw new BookingPaymentHttpError({
      status: 403,
      code: 'quote_forbidden',
      message: 'El presupuesto no pertenece a la sesion autenticada.',
    });
  }

  const selectedDate = toIsoDate(quote.selected_date);
  if (!selectedDate || !asString(quote.selected_start_time)) {
    throw new BookingPaymentHttpError({
      status: 422,
      code: 'invalid_quote_state',
      message: 'Debes regenerar el presupuesto antes de iniciar el checkout.',
    });
  }

  const [priceRow, profile, excludedHoldIds] = await Promise.all([
    getActivePriceRow(admin, quote.gardener_id, quote.service_id),
    getProviderProfile(admin, quote.gardener_id),
    getActiveHoldIdsForQuote(admin, quote.id),
  ]);

  const providerConfigVersion = await sha256(JSON.stringify({
    updated_at: priceRow?.updated_at || priceRow?.created_at || '',
    config: priceRow?.additional_config || null,
  }));

  const availabilityRows = await fetchAvailabilityRowsForQuote(admin, {
    gardenerId: quote.gardener_id,
    date: selectedDate,
    excludeHoldIds: excludedHoldIds,
  });
  const resolvedProfile = await ensureProviderOperationalCoordinates(admin, quote.gardener_id, profile);

  const evaluation = evaluateOperationalEligibility({
    bookingInput: (quote.input_payload || {}) as SerializableBookingData,
    providerConfig: priceRow?.additional_config || null,
    providerConfigVersion,
    profile: resolvedProfile,
    providerDates: buildAvailabilityIndex(availabilityRows),
    requestedDate: selectedDate,
    windowEndDate: selectedDate,
    restrictToRequestedDate: true,
  });

  if (!evaluation.eligible) {
    const status = evaluation.exclusion.code === 'no_reservable_availability' ? 409 : 422;
    const code = evaluation.exclusion.code === 'no_reservable_availability'
      ? 'slot_unavailable'
      : 'invalid_quote_state';
    const message = evaluation.exclusion.code === 'no_reservable_availability'
      ? 'La franja seleccionada ya no esta disponible para iniciar el pago.'
      : `El presupuesto ya no es elegible (${evaluation.exclusion.code}). Debes regenerar el presupuesto antes de pagar.`;
    throw new BookingPaymentHttpError({ status, code, message });
  }

  const selectedHour = extractHour(quote.selected_start_time);
  if (!evaluation.validHoursForRequestedDate.includes(selectedHour)) {
    throw new BookingPaymentHttpError({
      status: 409,
      code: 'slot_unavailable',
      message: 'La franja seleccionada ya no esta disponible para iniciar el pago.',
    });
  }

  if (asString(quote.provider_config_version) !== evaluation.providerConfigVersion) {
    throw new BookingPaymentHttpError({
      status: 422,
      code: 'invalid_quote_state',
      message: 'La configuración del profesional ha cambiado. Debes regenerar el presupuesto antes de pagar.',
    });
  }

  assertQuoteEconomicsStillMatch({
    quote,
    totalPrice: evaluation.quote.totalPrice,
    estimatedHours: evaluation.quote.estimatedHours,
    payableNow: Number(evaluation.quote.economics.payableNow || 0),
  });

  return {
    quote,
    evaluation,
  };
}

async function getOwnedAttemptRow(
  admin: ReturnType<typeof createClient>,
  params: { userId: string; attemptId?: string; quoteId?: string },
): Promise<AttemptRow | null> {
  let query = admin
    .from('booking_payment_attempts')
    .select(`
      id,
      client_id,
      gardener_id,
      service_id,
      quote_id,
      quote_signature,
      currency,
      status,
      stripe_idempotency_key,
      stripe_payment_intent_id,
      payment_expires_at,
      service_total_amount_cents,
      payable_now_amount_cents,
      economic_snapshot,
      gateway_response,
      last_error_code,
      last_error_message
    `)
    .eq('client_id', params.userId);

  if (params.attemptId) {
    const { data, error } = await query.eq('id', params.attemptId).maybeSingle();
    if (error) throw error;
    return (data as AttemptRow | null) || null;
  }

  if (!params.quoteId) return null;

  const { data, error } = await query
    .eq('quote_id', params.quoteId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as AttemptRow | null) || null;
}

async function stripePost(params: {
  path: string;
  body: URLSearchParams;
  stripeSecret: string;
  idempotencyKey?: string;
}) {
  const response = await fetch(`https://api.stripe.com${params.path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.stripeSecret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(params.idempotencyKey ? { 'Idempotency-Key': params.idempotencyKey } : {}),
    },
    body: params.body.toString(),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new BookingPaymentHttpError({
      status: 502,
      code: 'stripe_request_failed',
      message: payload?.error?.message || 'Stripe devolvio un error al procesar el pago.',
      details: {
        stripeType: typeof payload?.error?.type === 'string' ? payload.error.type : undefined,
        stripeCode: typeof payload?.error?.code === 'string' ? payload.error.code : undefined,
      },
    });
  }

  return payload as Record<string, unknown>;
}

async function stripeGet(params: { path: string; stripeSecret: string }) {
  const response = await fetch(`https://api.stripe.com${params.path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${params.stripeSecret}` },
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new BookingPaymentHttpError({
      status: 502,
      code: 'stripe_request_failed',
      message: payload?.error?.message || 'Stripe devolvio un error al consultar el pago.',
      details: {
        stripeType: typeof payload?.error?.type === 'string' ? payload.error.type : undefined,
        stripeCode: typeof payload?.error?.code === 'string' ? payload.error.code : undefined,
      },
    });
  }

  return payload as Record<string, unknown>;
}

function asRecord(value: unknown) {
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

function appendMetadata(body: URLSearchParams, prefix: string, metadata: Record<string, string>) {
  Object.entries(metadata).forEach(([key, value]) => {
    body.append(`${prefix}[${key}]`, value);
  });
}

function getLineItems(attempt: AttemptRow) {
  return buildAuthoritativeBookingStripeLineItems({
    stripeLineItems: Array.isArray(attempt.economic_snapshot?.stripeLineItems)
      ? attempt.economic_snapshot?.stripeLineItems || []
      : [],
    payableNowAmountCents: Number(attempt.payable_now_amount_cents || 0),
    fallbackLabel: 'Gastos de gestion',
  });
}

function buildAttemptMetadata(attempt: AttemptRow) {
  return {
    attempt_id: attempt.id,
    quote_id: attempt.quote_id,
    quote_signature: attempt.quote_signature,
    client_id: attempt.client_id,
    gardener_id: attempt.gardener_id,
    service_id: attempt.service_id,
    payable_now_amount_cents: String(attempt.payable_now_amount_cents),
  };
}

function mergeGatewayResponse(existing: AttemptRow['gateway_response'], payload: Record<string, unknown>) {
  return {
    ...asRecord(existing),
    ...payload,
  };
}

function resolveAttemptExpiryIso(attempt: AttemptRow) {
  return attempt.payment_expires_at || new Date(Date.now() + (BOOKING_PAYMENT_HOLD_MINUTES * 60_000)).toISOString();
}

function isExpired(value?: string | null) {
  const normalized = asString(value);
  if (!normalized) return false;
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

async function markAttemptPending(
  admin: ReturnType<typeof createClient>,
  attempt: AttemptRow,
  params: {
    paymentIntentId: string;
    paymentExpiresAt?: string | null;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
    gatewayPayload?: Record<string, unknown>;
  },
) {
  const { error } = await admin
    .from('booking_payment_attempts')
    .update({
      status: 'payment_pending',
      stripe_payment_intent_id: params.paymentIntentId,
      payment_expires_at: params.paymentExpiresAt || resolveAttemptExpiryIso(attempt),
      last_error_code: params.lastErrorCode || null,
      last_error_message: params.lastErrorMessage || null,
      gateway_response: mergeGatewayResponse(attempt.gateway_response, params.gatewayPayload || {}),
    })
    .eq('id', attempt.id);

  if (error) throw classifyBookingPaymentError(error);
}

async function markAttemptProcessing(
  admin: ReturnType<typeof createClient>,
  attempt: AttemptRow,
  params: {
    paymentIntentId?: string | null;
    gatewayPayload?: Record<string, unknown>;
  },
) {
  const { error } = await admin
    .from('booking_payment_attempts')
    .update({
      status: 'processing',
      stripe_payment_intent_id: params.paymentIntentId || attempt.stripe_payment_intent_id || null,
      gateway_response: mergeGatewayResponse(attempt.gateway_response, params.gatewayPayload || {}),
    })
    .eq('id', attempt.id);

  if (error) throw classifyBookingPaymentError(error);
}

async function releaseAttempt(
  admin: ReturnType<typeof createClient>,
  params: {
    attemptId: string;
    nextStatus: 'cancelled' | 'failed' | 'expired' | 'reconciliation_required';
    reason: string;
    paymentIntentId?: string | null;
    gatewayPayload?: Record<string, unknown>;
  },
) {
  const { data, error } = await admin.rpc('release_booking_payment_attempt', {
    p_attempt_id: params.attemptId,
    p_next_status: params.nextStatus,
    p_reason: params.reason,
    p_stripe_payment_intent_id: params.paymentIntentId || null,
    p_gateway_payload: params.gatewayPayload || {},
  });

  if (error) throw error;
  return data as AttemptSummary;
}

async function syncAttemptWithStripePaymentIntent(
  admin: ReturnType<typeof createClient>,
  attempt: AttemptRow,
  stripeSecret: string,
  source: string,
  stripePublishableKey?: string | null,
): Promise<{ attempt: AttemptSummary; clientSecret?: string; publishableKey?: string }> {
  const paymentIntentId = asString(attempt.stripe_payment_intent_id);
  if (!paymentIntentId) {
    return {
      attempt: await getAttemptSummary(admin, attempt.id),
      publishableKey: stripePublishableKey || undefined,
    };
  }

  const paymentIntent = await stripeGet({
    path: `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`,
    stripeSecret,
  });
  const metadata = asRecord(paymentIntent.metadata);
  const resolvedPaymentIntentId = asString(paymentIntent.id) || paymentIntentId;
  const integrity = validateBookingStripeMetadataIntegrity({
    expected: {
      attemptId: attempt.id,
      quoteId: attempt.quote_id,
      quoteSignature: attempt.quote_signature,
      clientId: attempt.client_id,
      gardenerId: attempt.gardener_id,
      serviceId: attempt.service_id,
      payableNowAmountCents: attempt.payable_now_amount_cents,
      paymentIntentId: resolvedPaymentIntentId,
    },
    metadata,
    paymentIntentId: resolvedPaymentIntentId,
  });

  if (!integrity.ok) {
    return {
      attempt: await releaseAttempt(admin, {
        attemptId: attempt.id,
        nextStatus: 'reconciliation_required',
        reason: integrity.reason || 'stripe_metadata_mismatch',
        paymentIntentId: resolvedPaymentIntentId,
        gatewayPayload: {
          syncedFrom: source,
          metadata,
          expected: integrity.expected,
          received: integrity.received,
        },
      }),
      publishableKey: stripePublishableKey || undefined,
    };
  }

  const paymentIntentStatus = asString(paymentIntent.status);
  const clientSecret = asString(paymentIntent.client_secret) || undefined;
  const lastPaymentError = asRecord(paymentIntent.last_payment_error);
  const lastPaymentErrorCode = asString(lastPaymentError.code) || asString(lastPaymentError.decline_code) || null;
  const lastPaymentErrorMessage = asString(lastPaymentError.message) || null;

  if (paymentIntentStatus === 'succeeded') {
    const { data, error } = await admin.rpc('confirm_booking_payment_attempt', {
      p_attempt_id: attempt.id,
      p_stripe_event_id: buildBookingPaymentGatewaySyncEventId({
        attemptId: attempt.id,
        paymentIntentId: resolvedPaymentIntentId,
      }),
      p_stripe_payment_intent_id: resolvedPaymentIntentId,
      p_amount_total_cents: asInteger(paymentIntent.amount_received || paymentIntent.amount),
      p_currency: asString(paymentIntent.currency) || attempt.currency || 'eur',
      p_gateway_payload: {
        syncedFrom: source,
        paymentIntentId: resolvedPaymentIntentId,
        paymentIntentStatus,
      },
    });

    if (error) throw error;
    return {
      attempt: data as AttemptSummary,
      publishableKey: stripePublishableKey || undefined,
    };
  }

  if (paymentIntentStatus === 'processing') {
    if (attempt.status !== 'processing') {
      await markAttemptProcessing(admin, attempt, {
        paymentIntentId: resolvedPaymentIntentId,
        gatewayPayload: {
          syncedFrom: source,
          paymentIntentId: resolvedPaymentIntentId,
          paymentIntentStatus,
        },
      });
    }
    return {
      attempt: await getAttemptSummary(admin, attempt.id),
      publishableKey: stripePublishableKey || undefined,
    };
  }

  if (paymentIntentStatus === 'canceled') {
    return {
      attempt: await releaseAttempt(admin, {
        attemptId: attempt.id,
        nextStatus: 'cancelled',
        reason: asString(paymentIntent.cancellation_reason) || 'stripe_payment_intent_canceled',
        paymentIntentId: resolvedPaymentIntentId,
        gatewayPayload: {
          syncedFrom: source,
          paymentIntentId: resolvedPaymentIntentId,
          paymentIntentStatus,
        },
      }),
      publishableKey: stripePublishableKey || undefined,
    };
  }

  await markAttemptPending(admin, attempt, {
    paymentIntentId: resolvedPaymentIntentId,
    paymentExpiresAt: resolveAttemptExpiryIso(attempt),
    lastErrorCode: lastPaymentErrorCode,
    lastErrorMessage: lastPaymentErrorMessage,
    gatewayPayload: {
      syncedFrom: source,
      paymentIntentId: resolvedPaymentIntentId,
      paymentIntentStatus,
      lastPaymentError: Object.keys(lastPaymentError).length > 0 ? lastPaymentError : undefined,
    },
  });

  return {
    attempt: await getAttemptSummary(admin, attempt.id),
    clientSecret,
    publishableKey: stripePublishableKey || undefined,
  };
}

async function createPaymentIntentForAttempt(
  admin: ReturnType<typeof createClient>,
  attempt: AttemptRow,
  stripeSecret: string,
  userEmail?: string | null,
  stripePublishableKey?: string | null,
) {
  const body = new URLSearchParams();
  body.append('amount', String(attempt.payable_now_amount_cents));
  body.append('currency', attempt.currency || 'eur');
  body.append('description', 'Gastos de gestion de reserva GarSer');
  body.append('automatic_payment_methods[enabled]', 'true');

  const receiptEmail = asString(userEmail);
  if (receiptEmail) {
    body.append('receipt_email', receiptEmail);
  }

  appendMetadata(body, 'metadata', buildAttemptMetadata(attempt));
  getLineItems(attempt).forEach((item, index) => {
    body.append(`amount_details[line_items][${index}][product_code]`, buildBookingStripeLineItemProductCode(index));
    body.append(`amount_details[line_items][${index}][unit_cost]`, String(item.unitAmountCents));
    body.append(`amount_details[line_items][${index}][quantity]`, String(item.quantity));
    body.append(`amount_details[line_items][${index}][product_name]`, item.label);
  });

  const paymentIntent = await stripePost({
    path: '/v1/payment_intents',
    body,
    stripeSecret,
    idempotencyKey: attempt.stripe_idempotency_key,
  });

  const paymentIntentId = asString(paymentIntent.id);
  const clientSecret = asString(paymentIntent.client_secret);
  if (!paymentIntentId || !clientSecret) {
    throw new BookingPaymentHttpError({
      status: 502,
      code: 'stripe_payment_intent_invalid',
      message: 'Stripe no devolvio un PaymentIntent valido para el intento de pago.',
    });
  }

  await markAttemptPending(admin, attempt, {
    paymentIntentId,
    paymentExpiresAt: resolveAttemptExpiryIso(attempt),
    gatewayPayload: {
      paymentIntentPreparedAt: new Date().toISOString(),
      stripePaymentIntentId: paymentIntentId,
    },
  });

  return {
    attempt: await getAttemptSummary(admin, attempt.id),
    clientSecret,
    publishableKey: stripePublishableKey || undefined,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let payload: PaymentPayload | null = null;
  let dbAdmin: ReturnType<typeof createClient> | null = null;
  let userId: string | null = null;
  let contextQuoteId = '';
  let contextAttemptId = '';
  let contextProviderId = '';
  let contextServiceId = '';

  try {
    payload = await parsePayload(req);
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = resolveServiceRoleKey();
    const stripeSecret = resolveStripeSecret();
    const allowedApiKeys = resolveAllowedClientApiKeys();

    if (!supabaseUrl || !serviceRoleKey || allowedApiKeys.length === 0) {
      throw new Error('Faltan secretos de Supabase para booking-payment.');
    }

    const authAdmin = createClient(supabaseUrl, serviceRoleKey);
    dbAdmin = createClient(supabaseUrl, serviceRoleKey);

    if (!hasAllowedClientApiKey(req, allowedApiKeys)) {
      throw new BookingPaymentHttpError({
        status: 401,
        code: 'client_api_key_invalid',
        message: 'apikey no autorizada.',
      });
    }

    const user = await resolveUser(authAdmin, req);
    if (!user) {
      throw new BookingPaymentHttpError({
        status: 401,
        code: 'auth_required',
        message: 'Debes iniciar sesion.',
      });
    }
    userId = user.id;

    if (payload.action === 'get_attempt_status') {
      contextAttemptId = asString(payload.attemptId);
      contextQuoteId = asString(payload.quoteId);
      const attempt = await getOwnedAttemptRow(dbAdmin, {
        userId: user.id,
        attemptId: contextAttemptId || undefined,
        quoteId: contextQuoteId || undefined,
      });

      if (!attempt) {
        return jsonResponse({ attempt: null });
      }

      contextAttemptId = attempt.id;
      contextQuoteId = attempt.quote_id;
      contextProviderId = attempt.gardener_id;
      contextServiceId = attempt.service_id;

      if (isExpired(attempt.payment_expires_at) && isInFlightPaymentAttemptStatus(attempt.status)) {
        await releaseAttempt(dbAdmin, {
          attemptId: attempt.id,
          nextStatus: 'expired',
          reason: 'payment_expired_client_poll',
          paymentIntentId: attempt.stripe_payment_intent_id || null,
          gatewayPayload: { expiredFrom: 'booking-payment:get_attempt_status' },
        });
      }

      const summary = await getAttemptSummary(dbAdmin, attempt.id);
      await persistServerTelemetry(dbAdmin, {
        level: 'info',
        event: 'booking.payment_status_loaded',
        userId,
        context: {
          action: payload.action,
          attemptId: summary.attemptId,
          quoteId: summary.quoteId,
          paymentStatus: summary.status,
          retryable: summary.retryable,
          terminal: summary.terminal,
        },
      });
      return jsonResponse({ attempt: summary });
    }

    if (payload.action === 'cancel_attempt') {
      if (!stripeSecret) {
        throw new Error('Falta STRIPE_SECRET_KEY para cancelar el pago.');
      }

      const attemptId = asString(payload.attemptId);
      if (!attemptId) {
        throw new BookingPaymentHttpError({
          status: 400,
          code: 'missing_attempt_id',
          message: 'Falta attemptId.',
        });
      }

      const attempt = await getOwnedAttemptRow(dbAdmin, { userId: user.id, attemptId });
      if (!attempt) {
        throw new BookingPaymentHttpError({
          status: 404,
          code: 'attempt_not_found',
          message: 'Intento de pago no encontrado.',
        });
      }

      contextAttemptId = attempt.id;
      contextQuoteId = attempt.quote_id;
      contextProviderId = attempt.gardener_id;
      contextServiceId = attempt.service_id;

      if (attempt.stripe_payment_intent_id && isInFlightPaymentAttemptStatus(attempt.status)) {
        try {
          await stripePost({
            path: `/v1/payment_intents/${encodeURIComponent(attempt.stripe_payment_intent_id)}/cancel`,
            body: new URLSearchParams(),
            stripeSecret,
          });
        } catch {
          // Si Stripe ya lo ha cancelado o finalizado, seguimos con la liberacion local.
        }
      }

      const summary = await releaseAttempt(dbAdmin, {
        attemptId: attempt.id,
        nextStatus: 'cancelled',
        reason: 'cancelled_by_client',
        paymentIntentId: attempt.stripe_payment_intent_id || null,
        gatewayPayload: { cancelledFrom: 'booking-payment:cancel_attempt' },
      });
      await persistServerTelemetry(dbAdmin, {
        level: 'info',
        event: 'booking.payment_attempt_cancelled',
        userId,
        context: {
          action: payload.action,
          attemptId: summary.attemptId,
          quoteId: summary.quoteId,
          paymentStatus: summary.status,
        },
      });
      return jsonResponse({ attempt: summary });
    }

    const stripePublishableKey = resolveStripePublishableKey();

    if (payload.action === 'sync_payment_state') {
      if (!stripeSecret) {
        throw new Error('Falta STRIPE_SECRET_KEY para sincronizar el pago.');
      }

      const attemptId = asString(payload.attemptId);
      if (!attemptId) {
        throw new BookingPaymentHttpError({
          status: 400,
          code: 'missing_attempt_id',
          message: 'Falta attemptId.',
        });
      }

      const attempt = await getOwnedAttemptRow(dbAdmin, { userId: user.id, attemptId });
      if (!attempt) {
        throw new BookingPaymentHttpError({
          status: 404,
          code: 'attempt_not_found',
          message: 'Intento de pago no encontrado.',
        });
      }

      contextAttemptId = attempt.id;
      contextQuoteId = attempt.quote_id;
      contextProviderId = attempt.gardener_id;
      contextServiceId = attempt.service_id;

      if (!isInFlightPaymentAttemptStatus(attempt.status)) {
        return jsonResponse({ attempt: await getAttemptSummary(dbAdmin, attempt.id) });
      }

      const result = await syncAttemptWithStripePaymentIntent(
        dbAdmin,
        attempt,
        stripeSecret,
        'booking-payment:sync_payment_state',
        stripePublishableKey,
      );
      await persistServerTelemetry(dbAdmin, {
        level: 'info',
        event: 'booking.payment_state_synced',
        userId,
        context: {
          action: payload.action,
          attemptId: result.attempt.attemptId,
          quoteId: result.attempt.quoteId,
          paymentStatus: result.attempt.status,
          bookingId: result.attempt.bookingId ?? null,
        },
      });
      return jsonResponse({ attempt: result.attempt });
    }

    if (payload.action !== 'prepare_payment') {
      throw new BookingPaymentHttpError({
        status: 400,
        code: 'unsupported_action',
        message: 'Accion no soportada.',
      });
    }

    if (!stripeSecret) {
      throw new Error('Falta STRIPE_SECRET_KEY para preparar el pago.');
    }

    const requestedAttemptId = asString(payload.attemptId);
    const quoteId = asString(payload.quoteId);
    let attempt: AttemptRow | null = null;
    let revalidatedQuoteId = quoteId;

    if (requestedAttemptId) {
      attempt = await getOwnedAttemptRow(dbAdmin, { userId: user.id, attemptId: requestedAttemptId });
      if (!attempt) {
        throw new BookingPaymentHttpError({
          status: 404,
          code: 'attempt_not_found',
          message: 'Intento de pago no encontrado.',
        });
      }
      revalidatedQuoteId = attempt.quote_id;
    } else {
      if (!quoteId) {
        throw new BookingPaymentHttpError({
          status: 400,
          code: 'missing_quote_id',
          message: 'Falta quoteId.',
        });
      }
      contextQuoteId = quoteId;

      await revalidateQuoteBeforePayment(dbAdmin, {
        quoteId,
        userId: user.id,
      });

      const prepareResult = await dbAdmin.rpc('prepare_booking_payment_attempt_for_client', {
        p_quote_id: quoteId,
        p_client_id: user.id,
        p_hold_ttl_minutes: BOOKING_PAYMENT_HOLD_MINUTES,
      });

      if (prepareResult.error || !prepareResult.data?.attemptId) {
        throw classifyBookingPaymentError(
          prepareResult.error || new Error('No se pudo preparar el intento de pago.'),
          422,
        );
      }

      attempt = await getAttemptRow(dbAdmin, String(prepareResult.data.attemptId));
      if (!attempt) {
        throw new BookingPaymentHttpError({
          status: 404,
          code: 'attempt_not_found',
          message: 'No se pudo recuperar el intento de pago preparado.',
        });
      }
    }

    contextAttemptId = attempt.id;
    contextQuoteId = attempt.quote_id;
    contextProviderId = attempt.gardener_id;
    contextServiceId = attempt.service_id;

    try {
      await revalidateQuoteBeforePayment(dbAdmin, {
        quoteId: revalidatedQuoteId || attempt.quote_id,
        userId: user.id,
      });
    } catch (error) {
      const classified = classifyBookingPaymentError(error, 422);
      if (isInFlightPaymentAttemptStatus(attempt.status)) {
        await releaseAttempt(dbAdmin, {
          attemptId: attempt.id,
          nextStatus: 'reconciliation_required',
          reason: classified.code,
          paymentIntentId: attempt.stripe_payment_intent_id || null,
          gatewayPayload: {
            revalidatedFrom: 'booking-payment:prepare_payment',
            revalidationCode: classified.code,
            revalidationMessage: classified.message,
          },
        });
      }
      throw classified;
    }

    if (isExpired(attempt.payment_expires_at) && isInFlightPaymentAttemptStatus(attempt.status)) {
      const summary = await releaseAttempt(dbAdmin, {
        attemptId: attempt.id,
        nextStatus: 'expired',
        reason: 'payment_expired_before_prepare',
        paymentIntentId: attempt.stripe_payment_intent_id || null,
        gatewayPayload: { expiredFrom: 'booking-payment:prepare_payment' },
      });
      return jsonResponse({ attempt: summary });
    }

    if (attempt.status === 'booking_created' || attempt.status === 'reconciliation_required') {
      return jsonResponse({ attempt: await getAttemptSummary(dbAdmin, attempt.id) });
    }

    const result = attempt.stripe_payment_intent_id
      ? await syncAttemptWithStripePaymentIntent(
          dbAdmin,
          attempt,
          stripeSecret,
          'booking-payment:prepare_payment',
          stripePublishableKey,
        )
      : await createPaymentIntentForAttempt(dbAdmin, attempt, stripeSecret, user.email, stripePublishableKey);

    await persistServerTelemetry(dbAdmin, {
      level: 'info',
      event: 'booking.payment_prepared',
      userId,
      context: {
        action: payload.action,
        attemptId: result.attempt.attemptId,
        quoteId: result.attempt.quoteId,
        providerId: attempt.gardener_id,
        serviceId: attempt.service_id,
        paymentStatus: result.attempt.status,
        paymentIntentId: result.attempt.paymentIntentId || null,
      },
    });

    return jsonResponse({
      attempt: result.attempt,
      clientSecret: result.clientSecret,
      publishableKey: result.publishableKey,
    });
  } catch (error) {
    const httpError = classifyBookingPaymentError(error);
    const errorDiagnostics = extractBookingPaymentErrorDiagnostics(error);
    const telemetryEvent = resolveBookingPaymentFailureEvent(
      payload?.action,
      Boolean(contextQuoteId || contextAttemptId),
    );
    if (dbAdmin) {
      await persistServerTelemetry(dbAdmin, {
        level: httpError.status >= 500 ? 'error' : 'warn',
        event: telemetryEvent,
        userId,
        context: {
          action: payload?.action || 'unknown',
          attemptId: contextAttemptId || asString(payload?.attemptId) || null,
          quoteId: contextQuoteId || asString(payload?.quoteId) || null,
          providerId: contextProviderId || null,
          serviceId: contextServiceId || null,
          reason: httpError.code,
          errorCode: httpError.code,
          httpStatus: httpError.status,
          message: httpError.message,
          upstreamCode: errorDiagnostics.upstreamCode || null,
          upstreamStatus: errorDiagnostics.upstreamStatus || null,
          upstreamMessage: errorDiagnostics.upstreamMessage || null,
          upstreamDetails: errorDiagnostics.upstreamDetailsSummary || null,
          upstreamHint: errorDiagnostics.upstreamHint || null,
        },
      });
    }
    logBookingPaymentError('request_failed', error, {
      method: req.method,
      action: payload?.action || 'unknown',
      attemptId: contextAttemptId || asString(payload?.attemptId) || null,
      quoteId: contextQuoteId || asString(payload?.quoteId) || null,
      code: httpError.code,
      status: httpError.status,
    });
    return jsonResponse({ error: httpError.message, code: httpError.code }, httpError.status);
  }
});
