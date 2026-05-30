import type { BookingData } from '../contexts/BookingContext';
import type {
  BookingAuthoritativeQuoteSnapshot,
} from '../shared/bookingAuthoritativeSnapshot';
import { sanitizeBookingPayload } from './bookingResumeStorage';
import { supabase } from '../lib/supabase';
import { reportBookingEvent } from './bookingTelemetry';

export interface ProviderQuotePreview extends BookingAuthoritativeQuoteSnapshot {
  providerId: string;
}

export interface ProviderPreviewResponse {
  quotes: Record<string, ProviderQuotePreview>;
  earliestByProvider: Record<string, { date: string; startHour: number } | null>;
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
    description: bookingData.description,
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

async function normalizeAuthorityError(error: unknown) {
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
  const fallbackMessage =
    typeof candidate?.message === 'string' && candidate.message.trim()
      ? candidate.message.trim()
      : 'No se pudo revalidar el presupuesto con el backend.';

  return new BookingAuthorityError({
    message: backendMessage || fallbackMessage,
    status,
    code: candidate?.code || candidate?.name,
    backendMessage: backendMessage || undefined,
    responseBody: responseBody || undefined,
  });
}

async function invokeAuthority<T>(body: Record<string, unknown>): Promise<T> {
  try {
    const { data, error } = await supabase.functions.invoke('booking-authority', { body });
    if (error) throw error;
    return data as T;
  } catch (error) {
    throw await normalizeAuthorityError(error);
  }
}

export async function previewProviderQuotes(params: {
  bookingData: BookingData;
  serviceId: string;
  providerIds: string[];
  selectedDate: string;
  windowDays?: number;
  globalMinPrice?: number;
}): Promise<ProviderPreviewResponse> {
  try {
    const response = await invokeAuthority<ProviderPreviewResponse>({
      action: 'preview_providers',
      serviceId: params.serviceId,
      providerIds: params.providerIds,
      selectedDate: params.selectedDate,
      windowDays: params.windowDays ?? 14,
      globalMinPrice: params.globalMinPrice ?? 0,
      bookingInput: pickSerializableBookingInput(params.bookingData),
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
  globalMinPrice?: number;
}): Promise<{ quote: ProviderQuotePreview; validHours: number[] }> {
  try {
    const response = await invokeAuthority<{ quote: ProviderQuotePreview; validHours: number[] }>({
      action: 'valid_hours',
      serviceId: params.serviceId,
      providerId: params.providerId,
      date: params.date,
      globalMinPrice: params.globalMinPrice ?? 0,
      bookingInput: pickSerializableBookingInput(params.bookingData),
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
    return response;
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
  globalMinPrice?: number;
}): Promise<{ quote: ProviderQuotePreview; days: ProviderMonthDay[] }> {
  try {
    const response = await invokeAuthority<{ quote: ProviderQuotePreview; days: ProviderMonthDay[] }>({
      action: 'month_days',
      serviceId: params.serviceId,
      providerId: params.providerId,
      monthDate: params.monthDate,
      globalMinPrice: params.globalMinPrice ?? 0,
      bookingInput: pickSerializableBookingInput(params.bookingData),
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

export async function createAuthoritativeQuote(params: {
  bookingData: BookingData;
  serviceId: string;
  providerId: string;
  selectedDate: string;
  startTime: string;
  globalMinPrice?: number;
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
      globalMinPrice: params.globalMinPrice ?? 0,
      bookingInput: pickSerializableBookingInput(params.bookingData),
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
