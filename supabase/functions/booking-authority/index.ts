import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildAuthoritativeBookingQuote,
  type BookingAvailabilityCalendarDay,
  type BookingQuoteAvailability,
  type BookingQuoteResult,
  type SerializableBookingData,
  type BookingQuoteSlotSelection,
  type BookingQuoteServiceItem,
} from '../../../src/shared/bookingQuoteCore.ts';
import {
  bookingRequiresPhytosanitaryLicense,
  buildProviderWorkerIndex,
  buildPlannedSlot,
  evaluateOperationalEligibility,
  getClientCoordinates,
  getProviderCoordinates,
  getValidStartHoursForPlan,
  MAX_JOB_DAYS,
  mergeWorkerDates,
  planBookingShape,
  providerConfigVersionPayload,
  type ProviderExclusionCode,
  type ProviderFreeHourRow,
} from '../../../src/shared/bookingEligibilityCore.ts';
import { geocodeAddressWithGoogleApi } from '../../../src/shared/providerOperationalGeocoding.ts';
import { validateManualSerializableInput } from '../../../src/shared/manualEntry/manualEntryValidation.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PRICING_VERSION = 'booking_quote_v1';

type QuotePreview = Omit<BookingQuoteResult, 'warnings'> & {
  warnings: string[];
  /** F8: el detalle de cada servicio cuando el presupuesto es de varios. */
  items?: BookingQuoteServiceItem[];
  providerId: string;
  quoteId?: string;
  signature?: string;
  expiresAt?: string;
  pricingVersion?: string;
  providerConfigVersion?: string;
};

type PriceRow = {
  gardener_id: string;
  additional_config: Record<string, unknown> | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type ProviderProfileRow = {
  user_id: string;
  address?: string | null;
  max_distance: number | null;
  operational_latitude: number | null;
  operational_longitude: number | null;
  // T1 (transversal, 2026-09-13): ver bookingEligibilityCore.ts — puerta de licencia
  // fitosanitaria para preview_providers/valid_hours/create_quote.
  license_verification_status: string | null;
  license_expires_at: string | null;
  // GarSer Empresas (F4): en una empresa el carnet se comprueba por persona.
  provider_kind?: string | null;
};

type WorkerDates = Map<string, Map<string, number[]>>;

type ProviderExclusion = {
  code: ProviderExclusionCode;
  message: string;
};

interface AuthorityPayload {
  action?: 'preview_providers' | 'valid_hours' | 'month_days' | 'create_quote' | 'recalculate_correction';
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
  /**
   * GarSer Empresas (F8, D14): varios servicios en la misma visita, cada uno con sus datos. El
   * primero tiene que ser `serviceId` / `bookingInput`. Sin esto (o con uno), lo de siempre.
   */
  items?: Array<{ serviceId?: string; bookingInput?: SerializableBookingData }>;
}

// F8: un servicio más de la visita, con la tarifa de un profesional para él.
type ExtraService = { serviceId: string; serviceName?: string; bookingInput: SerializableBookingData; priceRow?: PriceRow };

// F8: la «versión de la configuración» del profesional. Con un servicio, la de siempre; con
// varios, la de todos en orden. booking-payment la calcula igual para revalidar.
async function providerConfigVersionFor(main?: PriceRow, extras: Array<PriceRow | undefined> = []) {
  return await sha256(providerConfigVersionPayload([main, ...extras]));
}

// F8: los datos de todos los servicios en uno (lo que se guarda como datos del presupuesto y ve
// el profesional). Cada servicio aporta sus campos; un campo vacío no pisa uno con datos.
const isEmptyValue = (value: unknown) => value == null
  || (Array.isArray(value) && value.length === 0)
  || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0);
function mergeServiceInputs(main: SerializableBookingData, extras: SerializableBookingData[]): SerializableBookingData {
  const merged: Record<string, unknown> = { ...(main as Record<string, unknown>) };
  extras.forEach((extra) => {
    Object.entries(extra as Record<string, unknown>).forEach(([key, value]) => {
      if (isEmptyValue(merged[key]) && !isEmptyValue(value)) merged[key] = value;
    });
  });
  return merged as SerializableBookingData;
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

const normalizeProviderIds = (providerIds?: string[]) =>
  Array.from(new Set((providerIds || []).map((id) => String(id || '').trim()).filter(Boolean)));

const buildErrorResponse = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

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

async function fetchProviderProfiles(
  admin: ReturnType<typeof createClient>,
  providerIds: string[],
): Promise<Record<string, ProviderProfileRow>> {
  if (providerIds.length === 0) return {};
  const { data, error } = await admin
    .from('gardener_profiles')
    .select('user_id, address, max_distance, operational_latitude, operational_longitude, license_verification_status, license_expires_at, provider_kind')
    .in('user_id', providerIds);

  if (error || !data) return {};
  return Object.fromEntries(
    (data as ProviderProfileRow[]).map((row) => [String(row.user_id), row]),
  );
}

async function ensureProviderOperationalCoordinates(
  admin: ReturnType<typeof createClient>,
  providerId: string,
  profile?: ProviderProfileRow,
): Promise<ProviderProfileRow | undefined> {
  if (!profile) return profile;
  if (getProviderCoordinates(profile)) return profile;

  const address = String(profile.address || '').trim();
  // Geocoding usa su PROPIO secret de Google Maps (Geocoding API), separado del
  // GOOGLE_API_KEY de Gemini que usa ai-pricing-estimator. Compartir el mismo nombre hacía
  // que el geocoding recibiera la key de Gemini (sin Geocoding API) y fallara en silencio,
  // dejando a los jardineros con coordenadas nulas e invisibles en ProvidersPage.
  const googleApiKey = String(Deno.env.get('GOOGLE_MAPS_API_KEY') || '').trim();
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

  const nextProfile: ProviderProfileRow = {
    ...profile,
    operational_latitude: resolvedCoordinates.lat,
    operational_longitude: resolvedCoordinates.lng,
  };

  try {
    const { error } = await admin
      .from('gardener_profiles')
      .update({
        operational_latitude: resolvedCoordinates.lat,
        operational_longitude: resolvedCoordinates.lng,
      })
      .eq('user_id', providerId);
    if (error) {
      return profile;
    }
  } catch {
    return profile;
  }

  return nextProfile;
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

// GarSer Empresas (F4): las horas libres salen de UNA función SQL, `provider_free_hours`, que
// también usa el pago: por cada proveedor, las de cada persona que puede hacer el trabajo
// (autónomo: él mismo; empresa: su equipo con ese servicio y, si hace falta, con carnet), sin
// las horas que alguien está pagando ni las que ya tiene en su agenda.
// GarSer Empresas: cómo vende cada empresa. F6 (D10): si acepta trabajos partidos (por
// turnos). F7 (D11): cuántas personas pueden ir a la vez. Un autónomo no sale aquí: 1 persona.
type ProviderPlanning = { split: Set<string>; maxCrew: Map<string, number> };

async function fetchProviderPlanning(admin: ReturnType<typeof createClient>, providerIds: string[]): Promise<ProviderPlanning> {
  const planning: ProviderPlanning = { split: new Set(), maxCrew: new Map() };
  if (providerIds.length === 0) return planning;
  const { data } = await admin
    .from('companies')
    .select('provider_user_id, allow_split_jobs, max_crew')
    .in('provider_user_id', providerIds)
    .eq('status', 'active');
  ((data || []) as { provider_user_id: string; allow_split_jobs: boolean; max_crew: number | null }[]).forEach((row) => {
    const id = String(row.provider_user_id);
    if (row.allow_split_jobs) planning.split.add(id);
    planning.maxCrew.set(id, Math.max(1, Number(row.max_crew || 1)));
  });
  return planning;
}

// F7: un trabajo de varios días necesita las horas libres de los días siguientes a cada fecha.
const extendForMultiDay = (endDate: string) => addDays(endDate, MAX_JOB_DAYS - 1);

// H-32: PostgREST corta cualquier respuesta en 1000 filas (también las de una función), sin
// avisar. Con varios proveedores o muchos días, `provider_free_hours` las pasa de largo: se pide
// por páginas (la función devuelve las filas ordenadas, así que las páginas no se solapan).
const FREE_HOURS_PAGE = 1000;

async function fetchProviderWorkerHours(
  admin: ReturnType<typeof createClient>,
  params: {
    providerIds: string[];
    serviceId: string;
    startDate: string;
    endDate: string;
    requiresLicense: boolean;
    /** F8 (D16): los demás servicios de la visita: solo personas que los hagan todos. */
    extraServiceIds?: string[];
  },
) {
  if (params.providerIds.length === 0) return buildProviderWorkerIndex([]);
  try {
    await admin.rpc('cleanup_expired_booking_payment_state', {
      p_gardener_ids: params.providerIds,
      p_start_date: params.startDate,
      p_end_date: params.endDate,
    });
  } catch {
    // No bloqueamos el funnel si falla la limpieza oportunista.
  }
  const rows: ProviderFreeHourRow[] = [];
  for (let from = 0; ; from += FREE_HOURS_PAGE) {
    const { data, error } = await admin.rpc('provider_free_hours', {
      p_provider_ids: params.providerIds,
      p_service_id: params.serviceId,
      p_start: params.startDate,
      p_end: params.endDate,
      p_requires_license: params.requiresLicense,
      p_extra_service_ids: params.extraServiceIds || [],
    }).range(from, from + FREE_HOURS_PAGE - 1);
    if (error || !data) return buildProviderWorkerIndex([]);
    rows.push(...(data as ProviderFreeHourRow[]));
    if ((data as unknown[]).length < FREE_HOURS_PAGE) break;
  }
  return buildProviderWorkerIndex(rows);
}

function applyMinNoticeToWorkers(workerDates: WorkerDates, minNoticeHours: number, nowMs: number): WorkerDates {
  const filtered: WorkerDates = new Map();
  workerDates.forEach((dates, workerId) => {
    filtered.set(workerId, applyMinNoticeFilter(dates, minNoticeHours, nowMs));
  });
  return filtered;
}

// Fetches min_notice_hours per provider from recurring_availability_settings.
// Returns 0 for providers without a setting (no restriction).
async function fetchMinNoticeSettings(
  admin: ReturnType<typeof createClient>,
  providerIds: string[],
): Promise<Record<string, number>> {
  if (providerIds.length === 0) return {};
  const { data } = await admin
    .from('recurring_availability_settings')
    .select('gardener_id, min_notice_hours')
    .in('gardener_id', providerIds);
  if (!data) return {};
  return Object.fromEntries(
    (data as { gardener_id: string; min_notice_hours: number | null }[]).map((row) => [
      String(row.gardener_id),
      Math.max(0, Number(row.min_notice_hours ?? 0)),
    ]),
  );
}

// Availability slots are stored in the gardener's local wall-clock time
// (Europe/Madrid). Converting them to epoch requires the zone's UTC offset at
// that date, which varies with DST (+01:00 winter, +02:00 summer).
const AVAILABILITY_TIME_ZONE = 'Europe/Madrid';

function getTimeZoneOffsetMinutes(timeZone: string, at: Date): number {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value || 'GMT+00:00';
  const match = formatted.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] || 0));
}

function localSlotEpochMs(date: string, hour: number): number {
  const utcGuess = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00Z`).getTime();
  const offsetMinutes = getTimeZoneOffsetMinutes(AVAILABILITY_TIME_ZONE, new Date(utcGuess));
  return utcGuess - offsetMinutes * 60_000;
}

// Removes from a provider's date map any hour whose slot datetime is within
// minNoticeHours of nowMs (server UTC milliseconds).
function applyMinNoticeFilter(
  providerDates: Map<string, number[]>,
  minNoticeHours: number,
  nowMs: number,
): Map<string, number[]> {
  if (minNoticeHours <= 0) return providerDates;
  const cutoffMs = nowMs + minNoticeHours * 3_600_000;
  const filtered = new Map<string, number[]>();
  providerDates.forEach((hours, date) => {
    const validHours = hours.filter((hour) => localSlotEpochMs(date, hour) >= cutoffMs);
    if (validHours.length > 0) filtered.set(date, validHours);
  });
  return filtered;
}

async function buildQuotePreview(params: {
  quote: BookingQuoteResult & { items?: BookingQuoteServiceItem[] };
  providerId: string;
  providerConfigVersion: string;
  availability?: BookingQuoteAvailability;
}): Promise<QuotePreview> {
  // El presupuesto ya calculado al evaluar (F8: puede ser de varios servicios): no se recalcula.
  const quote = params.quote;
  return {
    providerId: params.providerId,
    totalPrice: quote.totalPrice,
    estimatedHours: quote.estimatedHours,
    breakdown: quote.breakdown,
    warnings: quote.warnings.map((item) => item.message),
    metadata: quote.metadata,
    economics: quote.economics,
    eligibility: quote.eligibility,
    ...(quote.items ? { items: quote.items } : {}),
    availability: params.availability,
    pricingVersion: PRICING_VERSION,
    providerConfigVersion: params.providerConfigVersion,
  };
}

async function evaluateProviderEligibility(params: {
  admin: ReturnType<typeof createClient>;
  bookingInput: SerializableBookingData;
  providerId: string;
  priceRow?: PriceRow;
  profile?: ProviderProfileRow;
  workerDates: WorkerDates;
  allowSplit?: boolean;
  maxCrew?: number;
  mainServiceId?: string;
  mainServiceName?: string;
  extras?: ExtraService[];
  requestedDate: string;
  windowEndDate: string;
  restrictToRequestedDate?: boolean;
}): Promise<
  | {
      eligible: true;
      quote: QuotePreview;
      providerConfigVersion: string;
      validHoursForRequestedDate: number[];
      earliestSlot: BookingQuoteSlotSelection;
    }
  | {
      eligible: false;
      exclusion: ProviderExclusion;
    }
> {
  const extras = params.extras || [];
  const providerConfigVersion = await providerConfigVersionFor(params.priceRow, extras.map((extra) => extra.priceRow));
  const resolvedProfile = await ensureProviderOperationalCoordinates(
    params.admin,
    params.providerId,
    params.profile,
  );
  const evaluation = evaluateOperationalEligibility({
    bookingInput: params.bookingInput,
    providerConfig: params.priceRow?.additional_config || null,
    providerConfigVersion,
    profile: resolvedProfile,
    providerDates: mergeWorkerDates(params.workerDates),
    workerDates: params.workerDates,
    licenseCheckedPerWorker: resolvedProfile?.provider_kind === 'company',
    allowSplitAcrossWorkers: Boolean(params.allowSplit),
    maxCrew: params.maxCrew,
    ...(extras.length > 0 ? {
      mainService: { serviceId: params.mainServiceId || '', serviceName: params.mainServiceName },
      extraServices: extras.map((extra) => ({
        serviceId: extra.serviceId,
        serviceName: extra.serviceName,
        bookingInput: extra.bookingInput,
        providerConfig: extra.priceRow?.additional_config || null,
      })),
    } : {}),
    requestedDate: params.requestedDate,
    windowEndDate: params.windowEndDate,
    restrictToRequestedDate: params.restrictToRequestedDate,
  });

  if (!evaluation.eligible) {
    return {
      eligible: false,
      exclusion: evaluation.exclusion,
    };
  }

  const quote = await buildQuotePreview({
    quote: evaluation.quote,
    providerId: params.providerId,
    providerConfigVersion,
  });

  return {
    eligible: true,
    quote: {
      ...quote,
      availability: buildAvailabilityContract({
        requestedDate: params.requestedDate,
        windowEndDate: params.windowEndDate,
        validStartHours: evaluation.validHoursForRequestedDate,
        earliestSlot: evaluation.earliestSlot,
      }),
    },
    providerConfigVersion,
    validHoursForRequestedDate: evaluation.validHoursForRequestedDate,
    earliestSlot: evaluation.earliestSlot,
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

    if (!action || !serviceId) {
      return buildErrorResponse(400, 'missing_action_or_service', 'Faltan action o serviceId.');
    }

    // F8 (D14): los demás servicios de la visita. El primero de `items` es el principal.
    const requestedItems = Array.isArray(payload.items) ? payload.items : [];
    const extraItems: Array<{ serviceId: string; bookingInput: SerializableBookingData }> = requestedItems.length > 1
      ? requestedItems.slice(1).map((item) => ({ serviceId: String(item?.serviceId || '').trim(), bookingInput: (item?.bookingInput || {}) as SerializableBookingData }))
      : [];
    if (requestedItems.length > 1) {
      const ids = [serviceId, ...extraItems.map((item) => item.serviceId)];
      if (String(requestedItems[0]?.serviceId || '').trim() !== serviceId || ids.some((id) => !id) || new Set(ids).size !== ids.length || ids.length > 7) {
        return buildErrorResponse(400, 'invalid_service_items', 'La lista de servicios no es válida.');
      }
    }
    const extraServiceIds = extraItems.map((item) => item.serviceId);
    const requiresLicense = [bookingInput, ...extraItems.map((item) => item.bookingInput)].some(bookingRequiresPhytosanitaryLicense);
    const serviceNames: Record<string, string> = {};
    {
      const { data: serviceRows } = await admin.from('services').select('id, name').in('id', [serviceId, ...extraServiceIds]);
      ((serviceRows || []) as { id: string; name: string }[]).forEach((row) => { serviceNames[String(row.id)] = String(row.name || ''); });
    }
    // F8: las tarifas de cada profesional para los demás servicios (alineadas con extraItems).
    const extrasFor = (providerId: string, extraPriceRows: Array<Record<string, PriceRow>>): ExtraService[] =>
      extraItems.map((item, index) => ({ ...item, serviceName: serviceNames[item.serviceId], priceRow: extraPriceRows[index]?.[providerId] }));
    const fetchExtraPriceRows = (providerIds: string[]) => Promise.all(extraServiceIds.map((id) => fetchPriceRows(admin, id, providerIds)));

    // Authoritative server-side validation of manually-declared variables.
    // Runs before any pricing so out-of-range values are rejected (never truncated).
    // Inert for the photo flow (dataInputMode !== 'manual'). F8: la de cada servicio.
    for (const item of [{ serviceId, bookingInput }, ...extraItems]) {
      if ((item.bookingInput as { dataInputMode?: string }).dataInputMode !== 'manual') continue;
      const serviceName = serviceNames[item.serviceId] || '';
      const manualValidation = validateManualSerializableInput({
        serviceName,
        dataInputMode: 'manual',
        bookingInput: item.bookingInput as Record<string, unknown>,
      });
      if (!manualValidation.ok) {
        return new Response(
          JSON.stringify({
            error: 'Algunos datos introducidos están fuera de los valores permitidos.',
            code: 'manual_input_invalid',
            validationErrors: manualValidation.errors,
          }),
          { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    // Re-quote a booking from gardener-corrected variables using the SAME engine.
    // Returns the recomputed total; the gardener then proposes it via the existing
    // price-change RPC (explicit client acceptance), keeping the engine the only
    // source of price truth and the acceptance flow intact.
    if (action === 'recalculate_correction') {
      const providerId = String(payload.providerId || '').trim();
      if (!providerId) {
        return buildErrorResponse(400, 'missing_provider', 'Falta el identificador del profesional.');
      }
      const priceRows = await fetchPriceRows(admin, serviceId, [providerId]);
      const providerConfig = priceRows[providerId]?.additional_config || null;
      if (!providerConfig) {
        return buildErrorResponse(409, 'missing_provider_config', 'El profesional no tiene una configuración de precios activa para este servicio.');
      }
      const quote = buildAuthoritativeBookingQuote({ bookingData: bookingInput, providerConfig });
      if (!quote.eligibility.isEligible || !(quote.totalPrice > 0)) {
        return new Response(
          JSON.stringify({
            error: 'No se ha podido recalcular un precio válido con las variables corregidas.',
            code: 'recalculation_ineligible',
            eligibility: quote.eligibility,
          }),
          { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          totalPrice: quote.totalPrice,
          estimatedHours: quote.estimatedHours,
          breakdown: quote.breakdown,
          economics: quote.economics,
          warnings: quote.warnings.map((item) => item.message),
          eligibility: quote.eligibility,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (action === 'preview_providers') {
      const providerIds = normalizeProviderIds(payload.providerIds);
      const selectedDate = toIsoDate(payload.selectedDate) || new Date().toISOString().slice(0, 10);
      const windowDays = Math.max(1, Math.min(31, Number(payload.windowDays || 14)));
      const endDate = addDays(selectedDate, windowDays - 1);
      const priceRows = await fetchPriceRows(admin, serviceId, providerIds);
      const extraPriceRows = await fetchExtraPriceRows(providerIds);
      const providerProfiles = await fetchProviderProfiles(admin, providerIds);
      const workerIndex = await fetchProviderWorkerHours(admin, {
        providerIds, serviceId, startDate: selectedDate, endDate: extendForMultiDay(endDate), requiresLicense, extraServiceIds,
      });
      const planning = await fetchProviderPlanning(admin, providerIds);
      const noticeSettings = await fetchMinNoticeSettings(admin, providerIds);
      const nowMs = Date.now();

      const quotes: Record<string, QuotePreview> = {};
      const earliestByProvider: Record<string, { date: string; startHour: number } | null> = {};
      const exclusions: Record<string, ProviderExclusion> = {};
      const eligibleProviderIds: string[] = [];

      for (const providerId of providerIds) {
        const workerDates = applyMinNoticeToWorkers(
          workerIndex.get(providerId) || new Map(), noticeSettings[providerId] ?? 0, nowMs,
        );
        const evaluation = await evaluateProviderEligibility({
          admin,
          bookingInput,
          providerId,
          priceRow: priceRows[providerId],
          profile: providerProfiles[providerId],
          workerDates,
          allowSplit: planning.split.has(providerId),
          maxCrew: planning.maxCrew.get(providerId),
          mainServiceId: serviceId,
          mainServiceName: serviceNames[serviceId],
          extras: extrasFor(providerId, extraPriceRows),
          requestedDate: selectedDate,
          windowEndDate: endDate,
        });

        if (!evaluation.eligible) {
          exclusions[providerId] = evaluation.exclusion;
          earliestByProvider[providerId] = null;
          continue;
        }

        quotes[providerId] = evaluation.quote;
        eligibleProviderIds.push(providerId);
        earliestByProvider[providerId] = {
          date: evaluation.earliestSlot.date,
          startHour: evaluation.earliestSlot.startHour,
        };
      }

      return new Response(JSON.stringify({ quotes, earliestByProvider, eligibleProviderIds, exclusions }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'valid_hours') {
      const providerId = String(payload.providerId || '').trim();
      const date = toIsoDate(payload.date);
      if (!providerId || !date) {
        return buildErrorResponse(400, 'missing_provider_or_date', 'Faltan providerId o date.');
      }

      const priceRows = await fetchPriceRows(admin, serviceId, [providerId]);
      const extraPriceRows = await fetchExtraPriceRows([providerId]);
      const providerProfiles = await fetchProviderProfiles(admin, [providerId]);
      const workerIndex = await fetchProviderWorkerHours(admin, {
        providerIds: [providerId], serviceId, startDate: date, endDate: extendForMultiDay(date), requiresLicense, extraServiceIds,
      });
      const planning = await fetchProviderPlanning(admin, [providerId]);
      const allowSplit = planning.split.has(providerId);
      const maxCrew = planning.maxCrew.get(providerId);
      const noticeSettings = await fetchMinNoticeSettings(admin, [providerId]);
      const workerDates = applyMinNoticeToWorkers(
        workerIndex.get(providerId) || new Map(), noticeSettings[providerId] ?? 0, Date.now(),
      );
      const evaluation = await evaluateProviderEligibility({
        admin,
        bookingInput,
        providerId,
        priceRow: priceRows[providerId],
        profile: providerProfiles[providerId],
        workerDates,
        allowSplit,
        maxCrew,
        mainServiceId: serviceId,
        mainServiceName: serviceNames[serviceId],
        extras: extrasFor(providerId, extraPriceRows),
        requestedDate: date,
        windowEndDate: date,
        restrictToRequestedDate: true,
      });

      if (!evaluation.eligible) {
        return new Response(JSON.stringify({ quote: null, validHours: [], exclusion: evaluation.exclusion }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // F7: para cada hora, la forma del trabajo (cuántas personas, cuántos días, hasta cuándo),
      // para que la pantalla no la tenga que adivinar con «inicio + horas».
      const labourHours = Math.max(1, Math.ceil(evaluation.quote.estimatedHours));
      const slotPlans: Record<number, ReturnType<typeof buildPlannedSlot>> = {};
      evaluation.validHoursForRequestedDate.forEach((hour) => {
        const plan = planBookingShape({ workerDates, date, startHour: hour, labourHours, maxCrew, allowSplit });
        if (plan) slotPlans[hour] = buildPlannedSlot(date, hour, plan);
      });

      return new Response(JSON.stringify({
        quote: evaluation.quote,
        validHours: evaluation.validHoursForRequestedDate,
        slotPlans,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'month_days') {
      const providerId = String(payload.providerId || '').trim();
      const monthDate = toIsoDate(payload.monthDate) || toIsoDate(payload.selectedDate);
      if (!providerId || !monthDate) {
        return buildErrorResponse(400, 'missing_provider_or_month', 'Faltan providerId o monthDate.');
      }

      const { start, end } = getMonthBounds(monthDate);
      const priceRows = await fetchPriceRows(admin, serviceId, [providerId]);
      const extraPriceRows = await fetchExtraPriceRows([providerId]);
      const providerProfiles = await fetchProviderProfiles(admin, [providerId]);
      const workerIndex = await fetchProviderWorkerHours(admin, {
        providerIds: [providerId], serviceId, startDate: start, endDate: extendForMultiDay(end), requiresLicense, extraServiceIds,
      });
      const planning = await fetchProviderPlanning(admin, [providerId]);
      const allowSplit = planning.split.has(providerId);
      const maxCrew = planning.maxCrew.get(providerId);
      const noticeSettings = await fetchMinNoticeSettings(admin, [providerId]);
      const nowMs = Date.now();
      const minNotice = noticeSettings[providerId] ?? 0;
      const workerDates = applyMinNoticeToWorkers(workerIndex.get(providerId) || new Map(), minNotice, nowMs);
      const evaluation = await evaluateProviderEligibility({
        admin,
        bookingInput,
        providerId,
        priceRow: priceRows[providerId],
        profile: providerProfiles[providerId],
        workerDates,
        allowSplit,
        maxCrew,
        mainServiceId: serviceId,
        mainServiceName: serviceNames[serviceId],
        extras: extrasFor(providerId, extraPriceRows),
        requestedDate: start,
        windowEndDate: end,
      });

      if (!evaluation.eligible) {
        return new Response(JSON.stringify({ quote: null, days: [], exclusion: evaluation.exclusion }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const today = new Date().toISOString().slice(0, 10);
      const days: BookingAvailabilityCalendarDay[] = [];
      const cursor = new Date(`${start}T12:00:00Z`);
      const endCursor = new Date(`${end}T12:00:00Z`);
      let earliestSlot: BookingQuoteSlotSelection | null = null;

      const labourHours = Math.max(1, Math.ceil(evaluation.quote.estimatedHours));
      while (cursor <= endCursor) {
        const date = cursor.toISOString().slice(0, 10);
        // F7: la misma regla que el pago (planificador): una persona, equipo, turnos o días.
        const validHours = date < today
          ? []
          : getValidStartHoursForPlan({ workerDates, date, labourHours, maxCrew, allowSplit });
        days.push({
          date,
          day: cursor.getUTCDate(),
          disabled: date < today || validHours.length === 0,
          count: validHours.length,
          availableStartHours: validHours,
        });
        if (!earliestSlot && validHours.length > 0) {
          const plan = planBookingShape({ workerDates, date, startHour: validHours[0], labourHours, maxCrew, allowSplit });
          earliestSlot = plan ? buildPlannedSlot(date, validHours[0], plan) : null;
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }

      return new Response(JSON.stringify({
        quote: {
          ...evaluation.quote,
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
        return buildErrorResponse(400, 'missing_quote_slot', 'Faltan providerId, date o startTime.');
      }

      const user = await resolveUser(admin, req);
      if (!user) {
        return buildErrorResponse(401, 'auth_required', 'Debes iniciar sesión para generar un presupuesto confirmado.');
      }

      const priceRows = await fetchPriceRows(admin, serviceId, [providerId]);
      const extraPriceRows = await fetchExtraPriceRows([providerId]);
      const providerProfiles = await fetchProviderProfiles(admin, [providerId]);
      const workerIndex = await fetchProviderWorkerHours(admin, {
        providerIds: [providerId], serviceId, startDate: date, endDate: extendForMultiDay(date), requiresLicense, extraServiceIds,
      });
      const planning = await fetchProviderPlanning(admin, [providerId]);
      const allowSplit = planning.split.has(providerId);
      const maxCrew = planning.maxCrew.get(providerId);
      const noticeSettings = await fetchMinNoticeSettings(admin, [providerId]);
      const workerDatesForQuote = applyMinNoticeToWorkers(
        workerIndex.get(providerId) || new Map(), noticeSettings[providerId] ?? 0, Date.now(),
      );
      const evaluation = await evaluateProviderEligibility({
        admin,
        bookingInput,
        providerId,
        priceRow: priceRows[providerId],
        profile: providerProfiles[providerId],
        workerDates: workerDatesForQuote,
        allowSplit,
        maxCrew,
        mainServiceId: serviceId,
        mainServiceName: serviceNames[serviceId],
        extras: extrasFor(providerId, extraPriceRows),
        requestedDate: date,
        windowEndDate: date,
        restrictToRequestedDate: true,
      });

      if (!evaluation.eligible) {
        const status = evaluation.exclusion.code === 'outside_coverage' ? 403 : 422;
        return buildErrorResponse(status, evaluation.exclusion.code, evaluation.exclusion.message);
      }

      const validHours = evaluation.validHoursForRequestedDate;
      const selectedHour = extractHour(startTime);
      if (!validHours.includes(selectedHour)) {
        return buildErrorResponse(
          409,
          'no_reservable_availability',
          'La franja seleccionada ya no está disponible para este presupuesto.',
        );
      }

      // F7: la franja lleva la forma del trabajo (personas, días, fin) para enseñarla al cliente.
      const labourHours = Math.max(1, Math.ceil(evaluation.quote.estimatedHours));
      const plannedSlot = (hour: number) => {
        const plan = planBookingShape({ workerDates: workerDatesForQuote, date, startHour: hour, labourHours, maxCrew, allowSplit });
        return plan ? buildPlannedSlot(date, hour, plan) : null;
      };
      const availability = buildAvailabilityContract({
        requestedDate: date,
        validStartHours: validHours,
        selectedSlot: plannedSlot(selectedHour),
        earliestSlot: validHours.length > 0 ? plannedSlot(validHours[0]) : null,
      });

      const ttlMinutes = Math.max(15, Math.min(24 * 60, Number(payload.ttlMinutes || 120)));
      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
      const signature = await sha256(JSON.stringify({
        client_id: user.id,
        provider_id: providerId,
        service_id: serviceId,
        pricing_version: PRICING_VERSION,
        provider_config_version: evaluation.providerConfigVersion,
        date,
        start_time: startTime,
        booking_input: bookingInput,
        items: extraItems.length > 0 ? extraItems : undefined,
        quote: {
          totalPrice: evaluation.quote.totalPrice,
          estimatedHours: evaluation.quote.estimatedHours,
          breakdown: evaluation.quote.breakdown,
          warnings: evaluation.quote.warnings,
          economics: evaluation.quote.economics,
        },
      }));

      // F8: los servicios del presupuesto (null = uno, lo de siempre). El primero es serviceId.
      const quoteItems = extraItems.length > 0
        ? (evaluation.quote.items || []).map((item, index) => ({
          serviceId: item.serviceId,
          serviceName: serviceNames[item.serviceId] || null,
          inputPayload: index === 0 ? bookingInput : extraItems[index - 1].bookingInput,
          totalPrice: item.totalPrice,
          estimatedHours: item.estimatedHours,
          breakdown: item.breakdown,
          requiresLicense: item.requiresLicense,
        }))
        : null;
      if (extraItems.length > 0 && quoteItems?.length !== extraItems.length + 1) {
        return buildErrorResponse(422, 'invalid_service_items', 'No se ha podido presupuestar cada servicio por separado.');
      }
      const storedInput = extraItems.length > 0 ? mergeServiceInputs(bookingInput, extraItems.map((item) => item.bookingInput)) : bookingInput;

      const snapshot = {
        totalPrice: evaluation.quote.totalPrice,
        estimatedHours: evaluation.quote.estimatedHours,
        breakdown: evaluation.quote.breakdown,
        warnings: evaluation.quote.warnings,
        metadata: evaluation.quote.metadata,
        economics: evaluation.quote.economics,
        eligibility: evaluation.quote.eligibility,
        availability,
        providerId,
        serviceId,
        // GarSer Empresas (F4): el pago aparta a una persona CON carnet si el trabajo lo exige.
        requiresPhytosanitaryLicense: requiresLicense,
        ...(quoteItems ? { items: quoteItems } : {}),
      };

      const clientCoordinates = getClientCoordinates(bookingInput);
      const providerCoordinates = getProviderCoordinates(providerProfiles[providerId]);

      const { data, error } = await admin
        .from('booking_quotes')
        .upsert({
          client_id: user.id,
          gardener_id: providerId,
          service_id: serviceId,
          signature,
          pricing_version: PRICING_VERSION,
          provider_config_version: evaluation.providerConfigVersion,
          input_payload: storedInput,
          pricing_snapshot: snapshot,
          items: quoteItems,
          availability_snapshot: availability,
          economic_snapshot: evaluation.quote.economics,
          total_price: evaluation.quote.totalPrice,
          estimated_hours: evaluation.quote.estimatedHours,
          status: 'active',
          generated_at: new Date().toISOString(),
          expires_at: expiresAt,
          selected_date: date,
          selected_start_time: startTime,
          client_latitude: clientCoordinates?.lat ?? null,
          client_longitude: clientCoordinates?.lng ?? null,
          provider_latitude: providerCoordinates?.lat ?? null,
          provider_longitude: providerCoordinates?.lng ?? null,
        }, { onConflict: 'signature' })
        .select('id, expires_at')
        .single();

      if (error || !data) {
        throw error || new Error('No se pudo persistir el presupuesto.');
      }

      return new Response(JSON.stringify({
        ...evaluation.quote,
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
    // Log the real cause server-side (Supabase function logs); never echo raw
    // error text to the client to avoid leaking internals.
    console.error('booking-authority fatal error', error);
    return new Response(
      JSON.stringify({ error: 'Error interno del servicio de presupuestos.', code: 'internal' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});
