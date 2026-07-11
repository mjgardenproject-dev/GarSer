import { supabase } from '../lib/supabase';
import { BufferService } from './bufferService';
import { addDays, format } from 'date-fns';
import type { BookingData } from '../contexts/BookingContext';
import { previewProviderQuotes } from './bookingAuthorityService';
import { WORK_DAY_START_HOUR, WORK_DAY_END_HOUR } from './availabilityWindow';

// Bypass temporal de filtros para diagnóstico: ignora servicio, distancia y disponibilidad
const TEMP_DISABLE_FILTERS = false;

interface GardenerProfile {
  user_id: string;
  full_name?: string;
  address?: string;
  work_radius?: number;
  max_distance?: number;
  rating?: number;
  total_reviews?: number;
  is_available?: boolean;
}

export interface MergedSlot {
  startHour: number;
  endHour: number; // exclusive
  gardenerIds: string[];
}

function buildLegacyAuthorityInput(serviceIds: string[], clientAddress: string): BookingData {
  return {
    address: clientAddress,
    serviceIds,
    photos: [],
    description: '',
    preferredDate: '',
    timeSlot: '',
    providerId: '',
    estimatedHours: 0,
    totalPrice: 0,
  };
}

async function fetchAuthorityEligibleGardeners(serviceIds: string[], clientAddress: string): Promise<GardenerProfile[]> {
  if (!clientAddress) {
    console.warn('[eligibility] Flujo legacy sin dirección de cliente: se fuerza fallo cerrado.');
    return [];
  }

  if (serviceIds.length !== 1) {
    console.warn('[eligibility] Flujo legacy multi-servicio aislado: booking-authority solo admite un servicio autoritativo.', {
      serviceIds,
    });
    return [];
  }

  const { data, error } = await supabase
    .from('gardener_profiles')
    .select('user_id, full_name, address, max_distance, work_radius, rating, total_reviews, is_available')
    .eq('is_available', true);

  if (error) {
    console.warn('[eligibility] Error cargando perfiles legacy para revalidar con backend', { error });
    return [];
  }

  const profiles = (data as GardenerProfile[]) || [];
  if (profiles.length === 0) {
    return [];
  }

  try {
    const response = await previewProviderQuotes({
      bookingData: buildLegacyAuthorityInput(serviceIds, clientAddress),
      serviceId: serviceIds[0],
      providerIds: profiles.map((profile) => profile.user_id),
      selectedDate: format(new Date(), 'yyyy-MM-dd'),
      windowDays: 14,
    });

    const eligibleIds = new Set(
      (response.eligibleProviderIds || Object.keys(response.quotes || {})).filter(
        (providerId) => response.quotes?.[providerId]?.eligibility?.isEligible !== false,
      ),
    );

    return profiles
      .filter((profile) => eligibleIds.has(profile.user_id))
      .sort((a, b) => {
        const ratingDiff = Number(b.rating || 0) - Number(a.rating || 0);
        if (ratingDiff !== 0) return ratingDiff;
        return Number(b.total_reviews || 0) - Number(a.total_reviews || 0);
      });
  } catch (error) {
    console.warn('[eligibility] booking-authority rechazó el flujo legacy; se devuelve vacío para evitar doble fuente de verdad.', {
      error,
      serviceIds,
    });
    return [];
  }
}

// Legacy compatibility only: la elegibilidad real debe venir de booking-authority.
export async function findEligibleGardeners(serviceId: string, clientAddress: string): Promise<GardenerProfile[]> {
  if (TEMP_DISABLE_FILTERS) {
    const { data, error } = await supabase
      .from('gardener_profiles')
      .select('user_id, full_name, address, max_distance, work_radius, rating, total_reviews, is_available');
    if (error) {
      console.warn('[eligibility] Error obteniendo todos los jardineros (bypass)', { error });
      return [];
    }
    const list = (data as GardenerProfile[]) || [];
    console.log('[eligibility] BYPASS activo: retornando todos los jardineros', { count: list.length });
    return list;
  }

  return fetchAuthorityEligibleGardeners([serviceId], clientAddress);
}

// Legacy compatibility only: los flujos multi-servicio no deben apoyarse en gardener_profiles.services.
export async function findEligibleGardenersForServices(serviceIds: string[], clientAddress: string): Promise<GardenerProfile[]> {
  if (TEMP_DISABLE_FILTERS) {
    const { data, error } = await supabase
      .from('gardener_profiles')
      .select('user_id, full_name, address, max_distance, work_radius, rating, total_reviews, is_available');
    if (error) {
      console.warn('[eligibility] Error obteniendo todos los jardineros (bypass, multi)', { error });
      return [];
    }
    const list = (data as GardenerProfile[]) || [];
    console.log('[eligibility] BYPASS activo (multi): retornando todos los jardineros', { count: list.length });
    return list;
  }

  return fetchAuthorityEligibleGardeners(serviceIds, clientAddress);
}

// Calcula todas las secuencias continuas de duración solicitada por jardinero y fusiona
export async function computeMergedSlots(
  gardenerIds: string[],
  date: string,
  clientId: string,
  durationHours: number
): Promise<MergedSlot[]> {
  const byStart = new Map<number, string[]>();

  for (const gardenerId of gardenerIds) {
    const blocksMap = await BufferService.getAvailableBlocksWithBuffer([gardenerId], date, clientId);
    const blocks = blocksMap.get(gardenerId) || [];

    for (let start = WORK_DAY_START_HOUR; start + durationHours <= WORK_DAY_END_HOUR; start++) {
      const sequence = [];
      let ok = true;
      for (let i = 0; i < durationHours; i++) {
        const hour = start + i;
        const block = blocks.find(b => b.hour === hour);
        if (!block || !block.available) { ok = false; break; }
        sequence.push(block);
      }

      if (!ok) continue;

      const canBook = await BufferService.canBookSequence(
        gardenerId,
        date,
        start,
        durationHours,
        clientId
      );

      if (canBook.canBook) {
        const existing = byStart.get(start) || [];
        existing.push(gardenerId);
        byStart.set(start, existing);
      }
    }
  }

  const result: MergedSlot[] = Array.from(byStart.entries())
    .map(([startHour, gardenerIdsForStart]) => ({
      startHour,
      endHour: startHour + durationHours,
      gardenerIds: gardenerIdsForStart
    }))
    .sort((a, b) => a.startHour - b.startHour);

  return result;
}

// Busca próximos días con disponibilidad fusionada evitando que el cliente pruebe manualmente
export async function computeNextAvailableDays(
  gardenerIds: string[],
  startDate: string,
  clientId: string,
  durationHours: number,
  maxDaysToSearch: number = 14,
  maxResults: number = 7
): Promise<{ date: string; slots: MergedSlot[] }[]> {
  const suggestions: { date: string; slots: MergedSlot[] }[] = [];

  try {
    const baseDate = new Date(startDate);
    for (let i = 0; i < maxDaysToSearch; i++) {
      const d = addDays(baseDate, i);
      const dateStr = format(d, 'yyyy-MM-dd');
      const slots = await computeMergedSlots(gardenerIds, dateStr, clientId, durationHours);
      if (slots.length > 0) {
        suggestions.push({ date: dateStr, slots });
        if (suggestions.length >= maxResults) break;
      }
    }
  } catch (e) {
    console.error('Error buscando próximos días con disponibilidad:', e);
  }

  return suggestions;
}

export async function computeEarliestSlotForGardener(
  gardenerId: string,
  durationHours: number,
  startDate: string,
  clientId: string,
  filter: 'morning' | 'afternoon' | 'all' = 'all'
): Promise<{ date: string; startHour: number; timestamp: number } | null> {
  const baseDate = new Date(startDate);
  for (let i = 0; i < 14; i++) {
    const d = addDays(baseDate, i);
    const dateStr = format(d, 'yyyy-MM-dd');
    const slots = await computeMergedSlots([gardenerId], dateStr, clientId, durationHours);
    
    const filtered = slots.filter(s => {
      if (filter === 'morning') return s.startHour < 14;
      if (filter === 'afternoon') return s.startHour >= 14;
      return true;
    });

    if (filtered.length > 0) {
      const first = filtered[0];
      // Create timestamp for sorting
      const ts = new Date(`${dateStr}T${first.startHour.toString().padStart(2, '0')}:00:00`).getTime();
      return { date: dateStr, startHour: first.startHour, timestamp: ts };
    }
  }
  return null;
}

export async function getWeekBlocksForGardener(
  gardenerId: string,
  weekStartDate: string,
  clientId: string
): Promise<Map<string, { hour: number; available: boolean }[]>> {
  const result = new Map<string, { hour: number; available: boolean }[]>();
  const base = new Date(weekStartDate);
  
  // Fetch 7 days in parallel
  const promises = Array.from({ length: 7 }, async (_, i) => {
    const d = addDays(base, i);
    const dateStr = format(d, 'yyyy-MM-dd');
    const blocksMap = await BufferService.getAvailableBlocksWithBuffer([gardenerId], dateStr, clientId);
    const blocks = blocksMap.get(gardenerId) || [];
    return { date: dateStr, blocks };
  });

  const days = await Promise.all(promises);
  days.forEach(d => result.set(d.date, d.blocks));
  
  return result;
}
