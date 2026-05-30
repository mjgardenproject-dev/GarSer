import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildAuthoritativeBookingQuote,
  type BookingAvailabilityCalendarDay,
  type BookingQuoteAvailability,
  type SerializableBookingData,
  type BookingQuoteResult,
  type BookingQuoteSlotSelection,
} from '../../../src/shared/bookingQuoteCore.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PRICING_VERSION = 'booking_quote_v1';

type QuotePreview = Omit<BookingQuoteResult, 'warnings'> & {
  warnings: string[];
  providerId: string;
  quoteId?: string;
  signature?: string;
  expiresAt?: string;
  pricingVersion?: string;
  providerConfigVersion?: string;
};

type AvailabilityRow = {
  gardener_id: string;
  date: string;
  start_time: string;
  is_available: boolean;
};

type HoldBlockRow = {
  gardener_id: string;
  date: string;
  hour_block: number;
};

type PriceRow = {
  gardener_id: string;
  additional_config: Record<string, unknown> | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type ServiceRow = {
  id: string;
  base_price: number | null;
};

interface AuthorityPayload {
  action?: 'preview_providers' | 'valid_hours' | 'month_days' | 'create_quote';
  serviceId?: string;
  providerIds?: string[];
  providerId?: string;
  selectedDate?: string;
  date?: string;
  monthDate?: string;
  monthStart?: string;
  monthEnd?: string;
  windowDays?: number;
  ttlMinutes?: number;
  startTime?: string;
  bookingInput?: SerializableBookingData;
  globalMinPrice?: number;
}

const toIsoDate = (value?: string | null) => {
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
};

const addDays = (date: string, days: number) => {
  const base = new Date(`${date}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
};

const getMonthBounds = (monthDate: string) => {
  const parsed = new Date(`${monthDate}T12:00:00Z`);
  const start = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1));
  const end = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
};

const extractHour = (value: string) => Number.parseInt(String(value || '0').slice(0, 2), 10);
const toIsoTime = (value?: string | null) => {
  const text = String(value || '').trim();
  if (/^\d{2}:\d{2}$/.test(text)) return `${text}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(text)) return text;
  return '';
};

const buildSlotSelection = (
  date: string,
  startHour: number,
  durationHours: number
): BookingQuoteSlotSelection | null => {
  if (!date || !Number.isFinite(startHour) || startHour < 0) return null;
  const safeDuration = Math.max(1, Math.ceil(durationHours));
  const startTime = `${String(startHour).padStart(2, '0')}:00:00`;
  const endHour = startHour + safeDuration;
  return {
    date,
    startHour,
    startTime,
    endTime: `${String(endHour).padStart(2, '0')}:00:00`,
    durationHours: safeDuration,
  };
};

const buildAvailabilityContract = (params: {
  requestedDate?: string;
  windowEndDate?: string;
  validStartHours?: number[];
  calendarDays?: BookingAvailabilityCalendarDay[];
  earliestSlot?: BookingQuoteSlotSelection | null;
  selectedSlot?: BookingQuoteSlotSelection | null;
}): BookingQuoteAvailability => ({
  requestedDate: params.requestedDate,
  windowEndDate: params.windowEndDate,
  validStartHours: params.validStartHours || [],
  calendarDays: params.calendarDays,
  earliestSlot: params.earliestSlot ?? null,
  selectedSlot: params.selectedSlot ?? null,
});

const getValidStartHours = (hours: number[], duration: number) => {
  const sorted = Array.from(new Set(hours.filter((hour) => Number.isFinite(hour)))).sort((a, b) => a - b);
  const set = new Set(sorted);
  const valid: number[] = [];
  for (const hour of sorted) {
    let fits = true;
    for (let step = 0; step < duration; step += 1) {
      if (!set.has(hour + step)) {
        fits = false;
        break;
      }
    }
    if (fits) valid.push(hour);
  }
  return valid;
};

const normalizeProviderIds = (providerIds?: string[]) =>
  Array.from(new Set((providerIds || []).map((id) => String(id || '').trim()).filter(Boolean)));

async function sha256(text: string) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, '0')).join('');
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
      // Fall back to legacy anon key below.
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

async function resolveUser(admin: ReturnType<typeof createClient>, req: Request) {
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

async function fetchServiceRow(
  admin: ReturnType<typeof createClient>,
  serviceId: string
): Promise<ServiceRow | null> {
  const { data, error } = await admin
    .from('services')
    .select('id, base_price')
    .eq('id', serviceId)
    .single();

  if (error || !data) return null;
  return data as ServiceRow;
}

async function fetchPriceRows(
  admin: ReturnType<typeof createClient>,
  serviceId: string,
  providerIds: string[]
): Promise<Record<string, PriceRow>> {
  if (providerIds.length === 0) return {};
  const { data, error } = await admin
    .from('gardener_service_prices')
    .select('gardener_id, additional_config, updated_at, created_at')
    .eq('service_id', serviceId)
    .eq('active', true)
    .in('gardener_id', providerIds);

  if (error || !data) return {};
  return Object.fromEntries(
    (data as PriceRow[]).map((row) => [String(row.gardener_id), row])
  );
}

async function fetchAvailabilityRows(
  admin: ReturnType<typeof createClient>,
  providerIds: string[],
  startDate: string,
  endDate: string
): Promise<AvailabilityRow[]> {
  if (providerIds.length === 0) return [];
  try {
    await admin.rpc('cleanup_expired_booking_payment_state', {
      p_gardener_ids: providerIds,
      p_start_date: startDate,
      p_end_date: endDate,
    });
  } catch {
    // No bloqueamos el funnel si falla la limpieza oportunista.
  }
  const { data, error } = await admin
    .from('availability')
    .select('gardener_id, date, start_time, is_available')
    .in('gardener_id', providerIds)
    .gte('date', startDate)
    .lte('date', endDate)
    .eq('is_available', true)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true });

  if (error || !data) return [];

  const { data: holdData } = await admin
    .from('booking_schedule_hold_blocks')
    .select('gardener_id, date, hour_block')
    .in('gardener_id', providerIds)
    .gte('date', startDate)
    .lte('date', endDate);

  const heldSlots = new Set(
    ((holdData || []) as HoldBlockRow[]).map((row) =>
      `${row.gardener_id}|${toIsoDate(row.date)}|${Number(row.hour_block)}`
    )
  );

  return (data as AvailabilityRow[]).filter((row) => {
    const key = `${row.gardener_id}|${toIsoDate(row.date)}|${extractHour(row.start_time)}`;
    return !heldSlots.has(key);
  });
}

function buildAvailabilityIndex(rows: AvailabilityRow[]) {
  const byProvider = new Map<string, Map<string, number[]>>();
  rows.forEach((row) => {
    const providerId = String(row.gardener_id);
    const date = toIsoDate(row.date);
    if (!providerId || !date || !row.is_available) return;
    const providerMap = byProvider.get(providerId) || new Map<string, number[]>();
    const hours = providerMap.get(date) || [];
    hours.push(extractHour(row.start_time));
    providerMap.set(date, hours);
    byProvider.set(providerId, providerMap);
  });
  return byProvider;
}

async function buildQuotePreview(params: {
  bookingInput: SerializableBookingData;
  providerId: string;
  providerConfig: Record<string, unknown> | null;
  globalMinPrice: number;
  providerConfigVersion: string;
  availability?: BookingQuoteAvailability;
}): Promise<QuotePreview> {
  const quote = buildAuthoritativeBookingQuote({
    bookingData: params.bookingInput,
    providerConfig: params.providerConfig,
    globalMinPrice: params.globalMinPrice,
  });
  return {
    providerId: params.providerId,
    totalPrice: quote.totalPrice,
    estimatedHours: quote.estimatedHours,
    breakdown: quote.breakdown,
    warnings: quote.warnings.map((item) => item.message),
    metadata: quote.metadata,
    economics: quote.economics,
    availability: params.availability,
    pricingVersion: PRICING_VERSION,
    providerConfigVersion: params.providerConfigVersion,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = (await req.json()) as AuthorityPayload;
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const allowedApiKeys = resolveAllowedClientApiKeys();

    if (!supabaseUrl || !serviceRoleKey || allowedApiKeys.length === 0) {
      throw new Error('Faltan secretos de Supabase para booking-authority.');
    }

    if (!hasAllowedClientApiKey(req, allowedApiKeys)) {
      return new Response(JSON.stringify({ error: 'apikey no autorizada.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const action = payload.action;
    const serviceId = String(payload.serviceId || '').trim();
    const bookingInput = (payload.bookingInput || {}) as SerializableBookingData;
    const fallbackMinPrice = Math.max(0, Number(payload.globalMinPrice || 0));

    if (!action || !serviceId) {
      return new Response(JSON.stringify({ error: 'Faltan action o serviceId.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const service = await fetchServiceRow(admin, serviceId);
    const globalMinPrice = Math.max(fallbackMinPrice, Number(service?.base_price || 0));

    if (action === 'preview_providers') {
      const providerIds = normalizeProviderIds(payload.providerIds);
      const selectedDate = toIsoDate(payload.selectedDate) || new Date().toISOString().slice(0, 10);
      const windowDays = Math.max(1, Math.min(31, Number(payload.windowDays || 14)));
      const endDate = addDays(selectedDate, windowDays - 1);
      const priceRows = await fetchPriceRows(admin, serviceId, providerIds);
      const availabilityRows = await fetchAvailabilityRows(admin, providerIds, selectedDate, endDate);
      const availabilityIndex = buildAvailabilityIndex(availabilityRows);

      const quotes: Record<string, QuotePreview> = {};
      const earliestByProvider: Record<string, { date: string; startHour: number } | null> = {};

      for (const providerId of providerIds) {
        const priceRow = priceRows[providerId];
        if (!priceRow?.additional_config) {
          earliestByProvider[providerId] = null;
          continue;
        }

        const providerConfigVersion = await sha256(JSON.stringify({
          updated_at: priceRow.updated_at || priceRow.created_at || '',
          config: priceRow.additional_config,
        }));

        const providerDates = availabilityIndex.get(providerId) || new Map<string, number[]>();
        const selectedDateHours = providerDates.get(selectedDate) || [];
        const selectedDateValidHours = getValidStartHours(selectedDateHours, 1);
        let earliestSlot: BookingQuoteSlotSelection | null = null;

        const quote = await buildQuotePreview({
          bookingInput,
          providerId,
          providerConfig: priceRow.additional_config,
          globalMinPrice,
          providerConfigVersion,
          availability: buildAvailabilityContract({
            requestedDate: selectedDate,
            windowEndDate: endDate,
            validStartHours: selectedDateValidHours,
          }),
        });
        earliestByProvider[providerId] = null;
        for (const [date, hours] of providerDates.entries()) {
          const validHours = getValidStartHours(hours, Math.max(1, Math.ceil(quote.estimatedHours)));
          if (validHours.length > 0) {
            earliestSlot = buildSlotSelection(date, validHours[0], quote.estimatedHours);
            earliestByProvider[providerId] = earliestSlot
              ? { date: earliestSlot.date, startHour: earliestSlot.startHour }
              : null;
            break;
          }
        }

        quotes[providerId] = {
          ...quote,
          availability: buildAvailabilityContract({
            requestedDate: selectedDate,
            windowEndDate: endDate,
            validStartHours: getValidStartHours(
              selectedDateHours,
              Math.max(1, Math.ceil(quote.estimatedHours))
            ),
            earliestSlot,
          }),
        };
      }

      return new Response(JSON.stringify({ quotes, earliestByProvider }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'valid_hours') {
      const providerId = String(payload.providerId || '').trim();
      const date = toIsoDate(payload.date);
      if (!providerId || !date) {
        return new Response(JSON.stringify({ error: 'Faltan providerId o date.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const priceRows = await fetchPriceRows(admin, serviceId, [providerId]);
      const priceRow = priceRows[providerId];
      if (!priceRow?.additional_config) {
        return new Response(JSON.stringify({ quote: null, validHours: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const providerConfigVersion = await sha256(JSON.stringify({
        updated_at: priceRow.updated_at || priceRow.created_at || '',
        config: priceRow.additional_config,
      }));

      const quote = await buildQuotePreview({
        bookingInput,
        providerId,
        providerConfig: priceRow.additional_config,
        globalMinPrice,
        providerConfigVersion,
      });

      const availabilityRows = await fetchAvailabilityRows(admin, [providerId], date, date);
      const validHours = getValidStartHours(
        availabilityRows.map((row) => extractHour(row.start_time)),
        Math.max(1, Math.ceil(quote.estimatedHours))
      );

      return new Response(JSON.stringify({
        quote: {
          ...quote,
          availability: buildAvailabilityContract({
            requestedDate: date,
            validStartHours: validHours,
            earliestSlot: validHours.length > 0
              ? buildSlotSelection(date, validHours[0], quote.estimatedHours)
              : null,
          }),
        },
        validHours,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'month_days') {
      const providerId = String(payload.providerId || '').trim();
      const monthDate = toIsoDate(payload.monthDate) || toIsoDate(payload.selectedDate);
      if (!providerId || !monthDate) {
        return new Response(JSON.stringify({ error: 'Faltan providerId o monthDate.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { start, end } = getMonthBounds(monthDate);
      const priceRows = await fetchPriceRows(admin, serviceId, [providerId]);
      const priceRow = priceRows[providerId];
      if (!priceRow?.additional_config) {
        return new Response(JSON.stringify({ quote: null, days: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const providerConfigVersion = await sha256(JSON.stringify({
        updated_at: priceRow.updated_at || priceRow.created_at || '',
        config: priceRow.additional_config,
      }));

      const quote = await buildQuotePreview({
        bookingInput,
        providerId,
        providerConfig: priceRow.additional_config,
        globalMinPrice,
        providerConfigVersion,
      });

      const availabilityRows = await fetchAvailabilityRows(admin, [providerId], start, end);
      const availabilityIndex = buildAvailabilityIndex(availabilityRows).get(providerId) || new Map<string, number[]>();
      const today = new Date().toISOString().slice(0, 10);
      const days: BookingAvailabilityCalendarDay[] = [];
      const cursor = new Date(`${start}T12:00:00Z`);
      const endCursor = new Date(`${end}T12:00:00Z`);
      let earliestSlot: BookingQuoteSlotSelection | null = null;

      while (cursor <= endCursor) {
        const date = cursor.toISOString().slice(0, 10);
        const hours = availabilityIndex.get(date) || [];
        const validHours = date < today
          ? []
          : getValidStartHours(hours, Math.max(1, Math.ceil(quote.estimatedHours)));
        days.push({
          date,
          day: cursor.getUTCDate(),
          disabled: date < today || validHours.length === 0,
          count: validHours.length,
          availableStartHours: validHours,
        });
        if (!earliestSlot && validHours.length > 0) {
          earliestSlot = buildSlotSelection(date, validHours[0], quote.estimatedHours);
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }

      return new Response(JSON.stringify({
        quote: {
          ...quote,
          availability: buildAvailabilityContract({
            requestedDate: monthDate,
            windowEndDate: end,
            calendarDays: days,
            earliestSlot,
          }),
        },
        days,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'create_quote') {
      const providerId = String(payload.providerId || '').trim();
      const date = toIsoDate(payload.date);
      const startTime = toIsoTime(payload.startTime);
      if (!providerId || !date || !startTime) {
        return new Response(JSON.stringify({ error: 'Faltan providerId, date o startTime.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const user = await resolveUser(admin, req);
      if (!user) {
        return new Response(JSON.stringify({ error: 'Debes iniciar sesión para generar un presupuesto confirmado.' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const priceRows = await fetchPriceRows(admin, serviceId, [providerId]);
      const priceRow = priceRows[providerId];
      if (!priceRow?.additional_config) {
        return new Response(JSON.stringify({ error: 'No existe configuración activa para este profesional.' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const providerConfigVersion = await sha256(JSON.stringify({
        updated_at: priceRow.updated_at || priceRow.created_at || '',
        config: priceRow.additional_config,
      }));

      const quote = await buildQuotePreview({
        bookingInput,
        providerId,
        providerConfig: priceRow.additional_config,
        globalMinPrice,
        providerConfigVersion,
      });

      if (quote.totalPrice <= 0) {
        return new Response(JSON.stringify({ error: 'No se pudo generar un presupuesto válido para este profesional.' }), {
          status: 422,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const availabilityRows = await fetchAvailabilityRows(admin, [providerId], date, date);
      const validHours = getValidStartHours(
        availabilityRows.map((row) => extractHour(row.start_time)),
        Math.max(1, Math.ceil(quote.estimatedHours))
      );
      const selectedHour = extractHour(startTime);
      if (!validHours.includes(selectedHour)) {
        return new Response(JSON.stringify({ error: 'La franja seleccionada ya no está disponible para este presupuesto.' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const availability = buildAvailabilityContract({
        requestedDate: date,
        validStartHours: validHours,
        selectedSlot: buildSlotSelection(date, selectedHour, quote.estimatedHours),
        earliestSlot: validHours.length > 0
          ? buildSlotSelection(date, validHours[0], quote.estimatedHours)
          : null,
      });

      const ttlMinutes = Math.max(15, Math.min(24 * 60, Number(payload.ttlMinutes || 120)));
      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
      const signature = await sha256(JSON.stringify({
        client_id: user.id,
        provider_id: providerId,
        service_id: serviceId,
        pricing_version: PRICING_VERSION,
        provider_config_version: providerConfigVersion,
        date,
        start_time: startTime,
        booking_input: bookingInput,
        quote: {
          totalPrice: quote.totalPrice,
          estimatedHours: quote.estimatedHours,
          breakdown: quote.breakdown,
          warnings: quote.warnings,
          economics: quote.economics,
        },
      }));

      const snapshot = {
        totalPrice: quote.totalPrice,
        estimatedHours: quote.estimatedHours,
        breakdown: quote.breakdown,
        warnings: quote.warnings,
        metadata: quote.metadata,
        economics: quote.economics,
        availability,
        providerId,
        serviceId,
      };

      const { data, error } = await admin
        .from('booking_quotes')
        .upsert({
          client_id: user.id,
          gardener_id: providerId,
          service_id: serviceId,
          signature,
          pricing_version: PRICING_VERSION,
          provider_config_version: providerConfigVersion,
          input_payload: bookingInput,
          pricing_snapshot: snapshot,
          availability_snapshot: availability,
          economic_snapshot: quote.economics,
          total_price: quote.totalPrice,
          estimated_hours: quote.estimatedHours,
          status: 'active',
          generated_at: new Date().toISOString(),
          expires_at: expiresAt,
          selected_date: date,
          selected_start_time: startTime,
        }, { onConflict: 'signature' })
        .select('id, expires_at')
        .single();

      if (error || !data) {
        throw error || new Error('No se pudo persistir el presupuesto.');
      }

      return new Response(JSON.stringify({
        ...quote,
        availability,
        quoteId: data.id,
        signature,
        expiresAt: data.expires_at,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Acción no soportada.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('booking-authority fatal error', error);
    const message = error instanceof Error ? error.message : 'Error interno en booking-authority.';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
