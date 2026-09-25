import type { BookingData } from '../contexts/BookingContext';
import type {
  BookingAuthoritativeQuoteSnapshot,
} from '../shared/bookingAuthoritativeSnapshot';
import type { BookingQuoteSlotSelection } from '../shared/bookingQuoteCore';
import { sanitizeBookingPayload } from './bookingResumeStorage';
import { supabase } from '../lib/supabase';
import { reportBookingEvent } from './bookingTelemetry';

export interface ProviderQuotePreview extends BookingAuthoritativeQuoteSnapshot {
  providerId: string;
  eligibility?: {
    isEligible: boolean;
    reason?: string;
  };
}

export interface ProviderPreviewResponse {
  quotes: Record<string, ProviderQuotePreview>;
  earliestByProvider: Record<string, { date: string; startHour: number } | null>;
  eligibleProviderIds?: string[];
  exclusions?: Record<string, { code: string; message: string }>;
}

export interface ProviderMonthDay {
  date: string;
  day: number;
  disabled: boolean;
  count: number;
}

export class BookingAuthorityError extends Error {
  readonly source = 'booking-authority';
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
    this.name = 'BookingAuthorityError';
    this.status = params.status;
    this.code = params.code;
    this.backendMessage = params.backendMessage;
    this.responseBody = params.responseBody;
  }
}

export function isBookingAuthorityError(error: unknown): error is BookingAuthorityError {
  return (
    error instanceof BookingAuthorityError ||
    (typeof error === 'object' &&
      error !== null &&
      'source' in error &&
      (error as { source?: string }).source === 'booking-authority')
  );
}

function pickSerializableBookingInput(bookingData: BookingData) {
  return sanitizeBookingPayload({
    serviceIds: bookingData.serviceIds,
    address: bookingData.address,
    addressCoordinates: bookingData.addressCoordinates,
    description: bookingData.description,
    dataInputMode: bookingData.dataInputMode,
    manualDeclarationId: bookingData.manualDeclarationId,
    manualConsent: bookingData.manualConsent,
    wasteRemoval: bookingData.wasteRemoval,
    aiQuantity: bookingData.aiQuantity,
    aiDifficulty: bookingData.aiDifficulty,
    aiUnit: bookingData.aiUnit,
    lawnSpecies: bookingData.lawnSpecies,
    palmSpecies: bookingData.palmSpecies,
    palmHeight: bookingData.palmHeight,
    palmState: bookingData.palmState,
    palmGroups: bookingData.palmGroups,
    lawnZones: bookingData.lawnZones,
    hedgeZones: bookingData.hedgeZones,
    treeGroups: bookingData.treeGroups,
    shrubGroups: bookingData.shrubGroups,
    phytosanitaryZones: bookingData.phytosanitaryZones,
    weedingZones: bookingData.weedingZones,
    servicesData: bookingData.servicesData,
  });
}

/**
 * GarSer Empresas (F8): los datos de UN servicio tal y como los usa el motor (los mismos campos
 * que el presupuesto de siempre, sin los datos guardados de los demás servicios).
 */
export function snapshotServiceInput(bookingData: BookingData, serviceId: string): Record<string, unknown> {
  const { servicesData: _omit, ...input } = pickSerializableBookingInput(bookingData) as Record<string, unknown>;
  void _omit;
  return { ...input, serviceIds: [serviceId] };
}

/**
 * GarSer Empresas (F8, D14): lo que se manda al servidor. Un servicio: lo de siempre. Varios: los
 * datos de cada uno (`items`, el primero el principal). El servicio que se esté rellenando en
 * ese momento, con lo que hay en pantalla si aún no se guardó.
 */
export function buildServicesPayload(bookingData: BookingData): { bookingInput: Record<string, unknown>; items?: Array<{ serviceId: string; bookingInput: Record<string, unknown> }> } {
  const ids = bookingData.serviceIds || [];
  if (ids.length <= 1) return { bookingInput: pickSerializableBookingInput(bookingData) as Record<string, unknown> };
  const activeId = ids[Math.min(bookingData.activeServiceIndex ?? ids.length - 1, ids.length - 1)];
  const inputs = ids.map((id) => bookingData.serviceInputs?.[id] || (id === activeId ? snapshotServiceInput(bookingData, id) : null));
  if (inputs.some((input) => !input)) {
    throw new Error('Faltan los datos de alguno de los servicios. Vuelve a rellenarlos.');
  }
  const items = ids.map((serviceId, index) => ({ serviceId, bookingInput: inputs[index] as Record<string, unknown> }));
  return { bookingInput: items[0].bookingInput, items };
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

function extractBackendMessage(payload: unknown) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload.trim();
  if (typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (typeof record.error === 'string') return record.error.trim();
    if (typeof record.message === 'string') return record.message.trim();
  }
  return '';
}

function extractAuthorityStatus(error: unknown): number | undefined {
  const candidate = error as { status?: number; context?: Response } | null;
  if (typeof candidate?.status === 'number') return candidate.status;
  if (typeof candidate?.context?.status === 'number') return candidate.context.status;
  return undefined;
}

function isTransientAuthorityError(error: unknown): boolean {
  const status = extractAuthorityStatus(error);
  // 5xx ⇒ the function did not process the request (boot failure / overload).
  if (status && status >= 500) return true;
  // No HTTP status ⇒ network/fetch failure before reaching the function.
  if (!status) {
    const name = String((error as { name?: string })?.name || '');
    const message = String((error as { message?: string })?.message || '').toLowerCase();
    return name.includes('FunctionsFetchError') || message.includes('fetch') || message.includes('network');
  }
  return false;
}

async function normalizeAuthorityError(error: unknown) {
  const candidate = error as {
    message?: string;
    name?: string;
    code?: string;
    status?: number;
    context?: Response;
  };
  const status = extractAuthorityStatus(error);
  const responseBody = await readFunctionErrorBody(candidate?.context);
  const backendMessage = extractBackendMessage(responseBody);

  // Never surface raw backend text for server-side failures (avoids leaking
  // stack traces / internals). Show a safe, actionable message instead.
  const isServerError = typeof status === 'number' && status >= 500;
  const isNetworkError = typeof status !== 'number';
  const safeMessage = isServerError || isNetworkError
    ? 'El servicio de presupuestos no está disponible ahora mismo. Espera unos segundos y vuelve a intentarlo.'
    : (backendMessage
        || (typeof candidate?.message === 'string' && candidate.message.trim()
          ? candidate.message.trim()
          : 'No se pudo revalidar el presupuesto con el backend.'));

  return new BookingAuthorityError({
    message: safeMessage,
    status,
    code: candidate?.code || candidate?.name,
    backendMessage: backendMessage || undefined,
    responseBody: responseBody || undefined,
  });
}

const AUTHORITY_MAX_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function invokeAuthority<T>(body: Record<string, unknown>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= AUTHORITY_MAX_ATTEMPTS; attempt += 1) {
    try {
      const { data, error } = await supabase.functions.invoke('booking-authority', { body });
      if (error) throw error;
      return data as T;
    } catch (error) {
      lastError = error;
      if (!isTransientAuthorityError(error) || attempt === AUTHORITY_MAX_ATTEMPTS) {
        break;
      }
      // Exponential backoff with jitter: ~300ms, ~700ms.
      const backoff = 300 * 2 ** (attempt - 1) + Math.floor(Math.random() * 150);
      await sleep(backoff);
    }
  }
  throw await normalizeAuthorityError(lastError);
}

export async function previewProviderQuotes(params: {
  bookingData: BookingData;
  serviceId: string;
  providerIds: string[];
  selectedDate: string;
  windowDays?: number;
}): Promise<ProviderPreviewResponse> {
  try {
    const response = await invokeAuthority<ProviderPreviewResponse>({
      action: 'preview_providers',
      serviceId: params.serviceId,
      providerIds: params.providerIds,
      selectedDate: params.selectedDate,
      windowDays: params.windowDays ?? 14,
      ...buildServicesPayload(params.bookingData),
    });
    reportBookingEvent('info', {
      event: 'booking.quote_preview_loaded',
      context: {
        serviceId: params.serviceId,
        selectedDate: params.selectedDate,
        providerCount: params.providerIds.length,
        quoteCount: Object.keys(response.quotes || {}).length,
      },
    });
    return response;
  } catch (error) {
    reportBookingEvent('error', {
      event: 'booking.quote_preview_failed',
      context: {
        serviceId: params.serviceId,
        selectedDate: params.selectedDate,
        providerCount: params.providerIds.length,
        message: error instanceof Error ? error.message : 'unknown',
      },
    });
    throw error;
  }
}

export async function fetchProviderValidHours(params: {
  bookingData: BookingData;
  serviceId: string;
  providerId: string;
  date: string;
}): Promise<{ quote: ProviderQuotePreview; validHours: number[]; slotPlans: Record<number, BookingQuoteSlotSelection> }> {
  try {
    // GarSer Empresas (F7): `slotPlans` trae, por hora, la forma del trabajo (personas, días,
    // fin). Una versión antigua del servidor no lo manda: se trata como vacío.
    const response = await invokeAuthority<{ quote: ProviderQuotePreview; validHours: number[]; slotPlans?: Record<number, BookingQuoteSlotSelection> }>({
      action: 'valid_hours',
      serviceId: params.serviceId,
      providerId: params.providerId,
      date: params.date,
      ...buildServicesPayload(params.bookingData),
    });
    reportBookingEvent('info', {
      event: 'booking.availability_hours_loaded',
      context: {
        providerId: params.providerId,
        serviceId: params.serviceId,
        selectedDate: params.date,
        validHourCount: response.validHours.length,
      },
    });
    return { ...response, slotPlans: response.slotPlans || {} };
  } catch (error) {
    reportBookingEvent('error', {
      event: 'booking.availability_hours_failed',
      context: {
        providerId: params.providerId,
        serviceId: params.serviceId,
        selectedDate: params.date,
        message: error instanceof Error ? error.message : 'unknown',
      },
    });
    throw error;
  }
}

export async function fetchProviderMonthDays(params: {
  bookingData: BookingData;
  serviceId: string;
  providerId: string;
  monthDate: string;
}): Promise<{ quote: ProviderQuotePreview; days: ProviderMonthDay[] }> {
  try {
    const response = await invokeAuthority<{ quote: ProviderQuotePreview; days: ProviderMonthDay[] }>({
      action: 'month_days',
      serviceId: params.serviceId,
      providerId: params.providerId,
      monthDate: params.monthDate,
      ...buildServicesPayload(params.bookingData),
    });
    reportBookingEvent('info', {
      event: 'booking.availability_calendar_loaded',
      context: {
        providerId: params.providerId,
        serviceId: params.serviceId,
        monthDate: params.monthDate,
        availableDayCount: (response.days || []).filter((day) => day.count > 0).length,
      },
    });
    return response;
  } catch (error) {
    reportBookingEvent('error', {
      event: 'booking.availability_calendar_failed',
      context: {
        providerId: params.providerId,
        serviceId: params.serviceId,
        monthDate: params.monthDate,
        message: error instanceof Error ? error.message : 'unknown',
      },
    });
    throw error;
  }
}

export interface RecalculatedCorrection {
  totalPrice: number;
  estimatedHours: number;
  breakdown: Array<{ desc: string; price: number }>;
  warnings: string[];
  eligibility: { isEligible: boolean; reason?: string };
}

/**
 * Re-quote a booking from gardener-corrected variables using the authoritative
 * engine on the server. Does not mutate the booking; the caller proposes the
 * returned total via `proposeBookingPriceChange` (explicit client acceptance).
 */
export async function recalculateBookingCorrection(params: {
  serviceId: string;
  providerId: string;
  correctedBookingInput: Record<string, unknown>;
}): Promise<RecalculatedCorrection> {
  return invokeAuthority<RecalculatedCorrection>({
    action: 'recalculate_correction',
    serviceId: params.serviceId,
    providerId: params.providerId,
    bookingInput: params.correctedBookingInput,
  });
}

export async function createAuthoritativeQuote(params: {
  bookingData: BookingData;
  serviceId: string;
  providerId: string;
  selectedDate: string;
  startTime: string;
  ttlMinutes?: number;
}): Promise<ProviderQuotePreview> {
  try {
    const quote = await invokeAuthority<ProviderQuotePreview>({
      action: 'create_quote',
      serviceId: params.serviceId,
      providerId: params.providerId,
      date: params.selectedDate,
      startTime: params.startTime,
      ttlMinutes: params.ttlMinutes ?? 120,
      ...buildServicesPayload(params.bookingData),
    });
    reportBookingEvent('info', {
      event: 'booking.quote_created',
      context: {
        quoteId: quote.quoteId,
        providerId: params.providerId,
        serviceId: params.serviceId,
        selectedDate: params.selectedDate,
        startTime: params.startTime,
      },
    });
    return quote;
  } catch (error) {
    reportBookingEvent('error', {
      event: 'booking.quote_create_failed',
      context: {
        providerId: params.providerId,
        serviceId: params.serviceId,
        selectedDate: params.selectedDate,
        startTime: params.startTime,
        message: error instanceof Error ? error.message : 'unknown',
      },
    });
    throw error;
  }
}
