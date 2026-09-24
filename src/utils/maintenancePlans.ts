// GarSer Empresas (F9, D17–D20): planes de mantenimiento del cliente. Cada visita se propone unos
// días antes y el cliente la confirma y paga con el pago de siempre; el precio es el del plan.

import { supabase } from '../lib/supabase';
import { buildAuthoritativeQuoteSnapshot } from '../shared/bookingAuthoritativeSnapshot';
import type { BookingData } from '../contexts/BookingContext';
import type { BookingQuoteAvailability, BookingQuoteEconomicBreakdown, BookingQuoteMetadata } from '../shared/bookingQuoteCore';

export type MaintenanceFrequency = 'weekly' | 'biweekly' | 'monthly';

export const FREQUENCY_LABEL: Record<MaintenanceFrequency, string> = {
  weekly: 'Cada semana',
  biweekly: 'Cada 2 semanas',
  monthly: 'Cada mes',
};

export interface MaintenancePlan {
  id: string;
  role: 'client' | 'provider';
  status: 'active' | 'cancelled';
  frequency: MaintenanceFrequency;
  start_hour: number;
  next_visit_date: string;
  total_price: number;
  estimated_hours: number;
  address: string | null;
  source_booking_id: string | null;
  services: string | null;
  provider_name: string | null;
  client_name: string | null;
  proposal: { visit_id: string; date: string; start_hour: number; expires_at: string; quote_id: string } | null;
  visits: Array<{ planned_date: string; date: string | null; status: string; booking_id: string | null }>;
}

export async function fetchMyMaintenancePlans(): Promise<MaintenancePlan[]> {
  const { data, error } = await supabase.rpc('my_maintenance_plans');
  if (error) throw new Error(error.message || 'No hemos podido cargar tus planes.');
  return (data || []) as unknown as MaintenancePlan[];
}

export async function createMaintenancePlan(bookingId: string, frequency: MaintenanceFrequency) {
  const { data, error } = await supabase.rpc('create_maintenance_plan', { p_booking_id: bookingId, p_frequency: frequency });
  if (error) throw new Error(error.message || 'No se ha podido crear el plan.');
  return data as { planId: string; nextVisitDate: string };
}

export async function cancelMaintenancePlan(planId: string) {
  const { error } = await supabase.rpc('cancel_maintenance_plan', { p_plan_id: planId });
  if (error) throw new Error(error.message || 'No se ha podido cancelar el plan.');
}

interface CheckoutPayload {
  quoteId: string;
  signature: string;
  expiresAt: string;
  providerId: string;
  serviceIds: string[];
  inputPayload: Record<string, unknown>;
  pricingSnapshot: { breakdown?: Array<{ desc: string; price: number }>; metadata?: BookingQuoteMetadata };
  economicSnapshot: BookingQuoteEconomicBreakdown;
  availability: BookingQuoteAvailability;
  totalPrice: number;
  estimatedHours: number;
  pricingVersion: string;
  providerConfigVersion: string;
}

/**
 * Lo que necesita la pantalla de confirmación para pagar la visita propuesta: el presupuesto ya
 * hecho por el plan (no se rehace, D19), su franja y los servicios.
 */
export function buildMaintenanceCheckoutData(visitId: string, checkout: CheckoutPayload): Partial<BookingData> {
  const snapshot = buildAuthoritativeQuoteSnapshot({
    totalPrice: Number(checkout.totalPrice),
    estimatedHours: Number(checkout.estimatedHours),
    breakdown: checkout.pricingSnapshot?.breakdown,
    warnings: [],
    metadata: checkout.pricingSnapshot?.metadata,
    economics: checkout.economicSnapshot,
    availability: checkout.availability,
    quoteId: checkout.quoteId,
    signature: checkout.signature,
    expiresAt: checkout.expiresAt,
    pricingVersion: checkout.pricingVersion,
    providerConfigVersion: checkout.providerConfigVersion,
  });
  if (!snapshot) throw new Error('No hemos podido preparar el pago de esta visita.');
  const slot = checkout.availability?.selectedSlot;
  const input = checkout.inputPayload || {};
  return {
    address: String(input.address || ''),
    addressCoordinates: input.addressCoordinates as BookingData['addressCoordinates'],
    serviceIds: checkout.serviceIds,
    providerId: checkout.providerId,
    quoteId: checkout.quoteId,
    authoritativeQuoteSnapshot: snapshot,
    preferredDate: slot?.date || '',
    timeSlot: slot ? `${slot.startTime.slice(0, 5)} - ${slot.endTime.slice(0, 5)}` : '',
    maintenanceVisitId: visitId,
  };
}

export async function fetchMaintenanceCheckout(visitId: string): Promise<Partial<BookingData>> {
  const { data, error } = await supabase.rpc('maintenance_visit_checkout', { p_visit_id: visitId });
  if (error) throw new Error(error.message || 'No hemos podido preparar esta visita.');
  return buildMaintenanceCheckoutData(visitId, data as unknown as CheckoutPayload);
}
