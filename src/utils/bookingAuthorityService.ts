import type { BookingData } from '../contexts/BookingContext';
import type { BookingQuoteMetadata } from '../shared/bookingQuoteCore';
import { sanitizeBookingPayload } from './bookingResumeStorage';
import { supabase } from '../lib/supabase';

export interface QuoteSnapshot {
  totalPrice: number;
  estimatedHours: number;
  breakdown: Array<{ desc: string; price: number }>;
  warnings?: string[];
  metadata?: BookingQuoteMetadata;
}

export interface ProviderQuotePreview extends QuoteSnapshot {
  providerId: string;
  quoteId?: string;
  signature?: string;
  expiresAt?: string;
  pricingVersion?: string;
  providerConfigVersion?: string;
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

async function invokeAuthority<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('booking-authority', { body });
  if (error) throw error;
  return data as T;
}

export async function previewProviderQuotes(params: {
  bookingData: BookingData;
  serviceId: string;
  providerIds: string[];
  selectedDate: string;
  windowDays?: number;
  globalMinPrice?: number;
}): Promise<ProviderPreviewResponse> {
  return invokeAuthority<ProviderPreviewResponse>({
    action: 'preview_providers',
    serviceId: params.serviceId,
    providerIds: params.providerIds,
    selectedDate: params.selectedDate,
    windowDays: params.windowDays ?? 14,
    globalMinPrice: params.globalMinPrice ?? 0,
    bookingInput: pickSerializableBookingInput(params.bookingData),
  });
}

export async function fetchProviderValidHours(params: {
  bookingData: BookingData;
  serviceId: string;
  providerId: string;
  date: string;
  globalMinPrice?: number;
}): Promise<{ quote: ProviderQuotePreview; validHours: number[] }> {
  return invokeAuthority<{ quote: ProviderQuotePreview; validHours: number[] }>({
    action: 'valid_hours',
    serviceId: params.serviceId,
    providerId: params.providerId,
    date: params.date,
    globalMinPrice: params.globalMinPrice ?? 0,
    bookingInput: pickSerializableBookingInput(params.bookingData),
  });
}

export async function fetchProviderMonthDays(params: {
  bookingData: BookingData;
  serviceId: string;
  providerId: string;
  monthDate: string;
  globalMinPrice?: number;
}): Promise<{ quote: ProviderQuotePreview; days: ProviderMonthDay[] }> {
  return invokeAuthority<{ quote: ProviderQuotePreview; days: ProviderMonthDay[] }>({
    action: 'month_days',
    serviceId: params.serviceId,
    providerId: params.providerId,
    monthDate: params.monthDate,
    globalMinPrice: params.globalMinPrice ?? 0,
    bookingInput: pickSerializableBookingInput(params.bookingData),
  });
}

export async function createAuthoritativeQuote(params: {
  bookingData: BookingData;
  serviceId: string;
  providerId: string;
  globalMinPrice?: number;
  ttlMinutes?: number;
}): Promise<ProviderQuotePreview> {
  return invokeAuthority<ProviderQuotePreview>({
    action: 'create_quote',
    serviceId: params.serviceId,
    providerId: params.providerId,
    ttlMinutes: params.ttlMinutes ?? 120,
    globalMinPrice: params.globalMinPrice ?? 0,
    bookingInput: pickSerializableBookingInput(params.bookingData),
  });
}
