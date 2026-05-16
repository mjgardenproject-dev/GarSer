import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildAuthoritativeBookingQuote,
  type SerializableBookingData,
  type BookingQuoteResult,
} from '../../../src/shared/bookingQuoteCore.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PRICING_VERSION = 'booking_quote_v1';

type QuotePreview = BookingQuoteResult & {
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
  return data as AvailabilityRow[];
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
    pricingVersion: PRICING_VERSION,
    providerConfigVersion: params.providerConfigVersion,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = (await req.json()) as AuthorityPayload;
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      throw new Error('Faltan secretos de Supabase para booking-authority.');
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
    });

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

        const quote = await buildQuotePreview({
          bookingInput,
          providerId,
          providerConfig: priceRow.additional_config,
          globalMinPrice,
          providerConfigVersion,
        });
        quotes[providerId] = quote;

        const providerDates = availabilityIndex.get(providerId) || new Map<string, number[]>();
        earliestByProvider[providerId] = null;
        for (const [date, hours] of providerDates.entries()) {
          const validHours = getValidStartHours(hours, Math.max(1, Math.ceil(quote.estimatedHours)));
          if (validHours.length > 0) {
            earliestByProvider[providerId] = { date, startHour: validHours[0] };
            break;
          }
        }
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

      return new Response(JSON.stringify({ quote, validHours }), {
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
      const days: Array<{ date: string; day: number; disabled: boolean; count: number }> = [];
      const cursor = new Date(`${start}T12:00:00Z`);
      const endCursor = new Date(`${end}T12:00:00Z`);

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
        });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }

      return new Response(JSON.stringify({ quote, days }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'create_quote') {
      const providerId = String(payload.providerId || '').trim();
      if (!providerId) {
        return new Response(JSON.stringify({ error: 'Falta providerId.' }), {
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

      const ttlMinutes = Math.max(15, Math.min(24 * 60, Number(payload.ttlMinutes || 120)));
      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
      const signature = await sha256(JSON.stringify({
        client_id: user.id,
        provider_id: providerId,
        service_id: serviceId,
        pricing_version: PRICING_VERSION,
        provider_config_version: providerConfigVersion,
        booking_input: bookingInput,
        quote: {
          totalPrice: quote.totalPrice,
          estimatedHours: quote.estimatedHours,
          breakdown: quote.breakdown,
          warnings: quote.warnings,
        },
      }));

      const snapshot = {
        totalPrice: quote.totalPrice,
        estimatedHours: quote.estimatedHours,
        breakdown: quote.breakdown,
        warnings: quote.warnings,
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
          total_price: quote.totalPrice,
          estimated_hours: quote.estimatedHours,
          status: 'active',
          generated_at: new Date().toISOString(),
          expires_at: expiresAt,
        }, { onConflict: 'signature' })
        .select('id, expires_at')
        .single();

      if (error || !data) {
        throw error || new Error('No se pudo persistir el presupuesto.');
      }

      return new Response(JSON.stringify({
        ...quote,
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
    const message = error instanceof Error ? error.message : 'Error interno en booking-authority.';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
