import { supabase } from '../lib/supabase';
import { BufferService } from './bufferService';
import { getCoordinatesFromAddress, calculateDistance } from './geolocation';
import { addDays, format } from 'date-fns';

// Bypass temporal de filtros para diagnóstico: ignora servicio, distancia y disponibilidad
const TEMP_DISABLE_FILTERS = false;

interface GardenerProfile {
  user_id: string;
  address?: string;
  work_radius?: number;
  services: string[];
  is_available?: boolean;
}

export interface MergedSlot {
  startHour: number;
  endHour: number; // exclusive
  gardenerIds: string[];
}

// Encuentra jardineros elegibles por servicio y cobertura
export async function findEligibleGardeners(serviceId: string, clientAddress: string): Promise<GardenerProfile[]> {
  if (TEMP_DISABLE_FILTERS) {
    const { data, error } = await supabase
      .from('gardener_profiles')
      .select('*');
    if (error) {
      console.warn('[eligibility] Error obteniendo todos los jardineros (bypass)', { error });
      return [];
    }
    const list = (data as GardenerProfile[]) || [];
    console.log('[eligibility] BYPASS activo: retornando todos los jardineros', { count: list.length });
    return list;
  }

  const clientCoords = await getCoordinatesFromAddress(clientAddress);
  if (!clientCoords) {
    console.warn('[eligibility] Geocoding de cliente falló o no disponible', { clientAddress });
    return [];
  }

  const { data: gardeners, error } = await supabase
    .from('gardener_profiles')
    .select('*')
    .contains('services', [serviceId])
    .eq('is_available', true);

  let list: GardenerProfile[] = (gardeners as GardenerProfile[]) || [];
  if (error) {
    console.warn('[eligibility] Error en consulta de jardineros por servicio', { error });
  }

  // Fallback: si la consulta por contains no da resultados, traer disponibles y filtrar en cliente
  if (!list || list.length === 0) {
    const { data: allAvailable, error: fallbackError } = await supabase
      .from('gardener_profiles')
      .select('*')
      .eq('is_available', true);
    if (fallbackError) {
      console.warn('[eligibility] Fallback consulta is_available falló', { fallbackError });
      return [];
    }
    list = (allAvailable as GardenerProfile[]).filter(g => Array.isArray((g as any).services) && (g as any).services.includes(serviceId));
    console.debug('[eligibility] Fallback aplicando filtro de servicio en cliente', { count: list.length });
  }

  const eligible: GardenerProfile[] = [];
  for (const g of list as GardenerProfile[]) {
    if (!g.address) {
      console.debug('[eligibility] Jardinero sin dirección, descartado', { user_id: g.user_id });
      continue;
    }
    const coords = await getCoordinatesFromAddress(g.address);
    if (!coords) {
      console.debug('[eligibility] Geocoding de jardinero falló, descartado', { user_id: g.user_id, address: g.address });
      continue;
    }
    const distance = calculateDistance(clientCoords.lat, clientCoords.lng, coords.lat, coords.lng);
    const radius = (g as any).max_distance ?? g.work_radius ?? 20;
    const within = distance <= radius;
    console.debug('[eligibility] Distancia vs radio', { user_id: g.user_id, distanceKm: Math.round(distance * 10) / 10, radiusKm: radius, within });
    if (within) eligible.push(g);
  }
  return eligible;
}

// Encuentra jardineros elegibles que soporten TODOS los servicios seleccionados
export async function findEligibleGardenersForServices(serviceIds: string[], clientAddress: string): Promise<GardenerProfile[]> {
  if (TEMP_DISABLE_FILTERS) {
    const { data, error } = await supabase
      .from('gardener_profiles')
      .select('*');
    if (error) {
      console.warn('[eligibility] Error obteniendo todos los jardineros (bypass, multi)', { error });
      return [];
    }
    const list = (data as GardenerProfile[]) || [];
    console.log('[eligibility] BYPASS activo (multi): retornando todos los jardineros', { count: list.length });
    return list;
  }

  const clientCoords = await getCoordinatesFromAddress(clientAddress);
  if (!clientCoords) {
    console.warn('[eligibility] Geocoding de cliente falló o no disponible', { clientAddress });
    return [];
  }

  let list: GardenerProfile[] = [];
  try {
    const { data, error } = await supabase
      .from('gardener_profiles')
      .select('*')
      .contains('services', serviceIds)
      .eq('is_available', true);
    if (error) throw error;
    list = (data as GardenerProfile[]) || [];
    console.log('[eligibility] Consulta por servicios múltiples', { requested: serviceIds, count: list.length });
  } catch (e) {
    console.warn('[eligibility] Error consultando jardineros por servicios múltiples, intento fallback:', e);
    const { data: allAvailable, error: fallbackError } = await supabase
      .from('gardener_profiles')
      .select('*')
      .eq('is_available', true);
    if (fallbackError) {
      console.warn('[eligibility] Fallback consulta is_available falló', { fallbackError });
      return [];
    }
    list = ((allAvailable as GardenerProfile[]) || []).filter(g => {
      const svcs = (g as any).services as string[];
      return Array.isArray(svcs) && serviceIds.every(id => svcs.includes(id));
    });
    console.log('[eligibility] Fallback filtrado en cliente por servicios', { requested: serviceIds, count: list.length });
  }

  const eligible: GardenerProfile[] = [];
  for (const g of list) {
    const radiusKm = (g as any).max_distance ?? g.work_radius ?? 20;
    if (!g.address) {
      console.log('[eligibility] Jardinero sin dirección, asumiendo elegible (multi)', { user_id: g.user_id, radiusKm });
      eligible.push(g);
      continue;
    }
    const gardenerCoords = await getCoordinatesFromAddress(g.address);
    if (!gardenerCoords) {
      console.log('[eligibility] Geocoding de jardinero falló, asumiendo elegible (multi)', { user_id: g.user_id, address: g.address, radiusKm });
      eligible.push(g);
      continue;
    }
    const distKm = calculateDistance(clientCoords.lat, clientCoords.lng, gardenerCoords.lat, gardenerCoords.lng);
    const within = distKm <= radiusKm;
    console.log('[eligibility] Distancia vs radio (multi)', { user_id: g.user_id, distanceKm: Math.round(distKm * 10) / 10, radiusKm, within });
    if (within) eligible.push(g);
  }

  return eligible;
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

    for (let start = 8; start + durationHours <= 20; start++) {
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