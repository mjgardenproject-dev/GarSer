import { supabase } from '../lib/supabase';
import { getCoordinatesFromAddress } from '../utils/geolocation';
import { getProviderCoordinates } from '../shared/bookingEligibilityCore';
import { notifySetupChanged } from '../utils/setupEvents';
import { sortActivationServices, toActivationServiceName, type ActivationServiceName } from './serviceCatalog';

// Lo que el cuestionario «Activa tu cuenta» lee al abrirse y lo que escribe en el paso de la zona
// (2026-11-11). Escribe en las MISMAS tablas y con las MISMAS reglas que «Mi perfil → Cobertura»
// (ProfileSettings.onSaveProfileInfo): así el configurador enseña lo mismo y no hay dos verdades.

export interface ActivationData {
  firstName: string;
  address: string;
  maxDistance: number;
  hasCoordinates: boolean;
  /** Servicios del alta + los que ya tiene configurados: salen marcados en el paso 2. */
  preselectedServices: ActivationServiceName[];
  /** Personas que dijo en el alta (1 = solo). Null en solicitudes anteriores. */
  estimatedTeamSize: number | null;
  /** id de cada servicio en la tabla `services`, por nombre. */
  serviceIds: Partial<Record<ActivationServiceName, string>>;
}

export const DEFAULT_MAX_DISTANCE = 25;
export const MIN_MAX_DISTANCE = 1;
export const MAX_MAX_DISTANCE = 100;

export function firstNameOf(fullName: string | null | undefined): string {
  return String(fullName || '').trim().split(/\s+/)[0] || '';
}

/** Radio válido (1-100 km, como «Cobertura»); si no lo es, el de por defecto. */
export function normalizeMaxDistance(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= MIN_MAX_DISTANCE && n <= MAX_MAX_DISTANCE ? n : DEFAULT_MAX_DISTANCE;
}

export async function loadActivationData(userId: string): Promise<ActivationData> {
  const [profileRes, gardenerRes, applicationRes, pricesRes, servicesRes] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('user_id', userId).maybeSingle(),
    (supabase.from('gardener_profiles') as any)
      .select('full_name, address, max_distance, operational_latitude, operational_longitude')
      .eq('user_id', userId)
      .maybeSingle(),
    (supabase.from('gardener_applications') as any)
      .select('services, estimated_team_size, city_zone')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase.from('gardener_service_prices').select('service_id').eq('gardener_id', userId),
    supabase.from('services').select('id, name'),
  ]);

  if (gardenerRes.error) throw gardenerRes.error;
  const gardener = (gardenerRes.data ?? null) as {
    full_name: string | null;
    address: string | null;
    max_distance: number | null;
    operational_latitude: number | null;
    operational_longitude: number | null;
  } | null;
  if (!gardener) throw new Error('not_a_provider');

  const application = (applicationRes.data ?? null) as { services?: string[] | null; estimated_team_size?: number | null; city_zone?: string | null } | null;
  const services = ((servicesRes.data ?? []) as Array<{ id: string; name: string }>);
  const serviceIds: Partial<Record<ActivationServiceName, string>> = {};
  for (const row of services) {
    const name = toActivationServiceName(row.name);
    if (name && !serviceIds[name]) serviceIds[name] = row.id;
  }
  const configuredNames = ((pricesRes.data ?? []) as Array<{ service_id: string }>)
    .map((row) => services.find((s) => s.id === row.service_id)?.name);

  const profileName = (profileRes.data as { full_name?: string | null } | null)?.full_name;
  return {
    firstName: firstNameOf(profileName || gardener.full_name),
    address: String(gardener.address || application?.city_zone || '').trim(),
    maxDistance: normalizeMaxDistance(gardener.max_distance),
    hasCoordinates: Boolean(getProviderCoordinates(gardener as never)),
    preselectedServices: sortActivationServices([...(application?.services ?? []), ...configuredNames]),
    estimatedTeamSize: typeof application?.estimated_team_size === 'number' ? application.estimated_team_size : null,
    serviceIds,
  };
}

export type SaveCoverageResult = { ok: true; hasCoordinates: true } | { ok: false; reason: 'address_not_found' | 'save_failed' };

/**
 * Paso 1: dirección y radio. Localiza la dirección en el mapa (si cambió o no tenía coordenadas) y guarda
 * dirección, radio y coordenadas en `gardener_profiles`, y la dirección en `profiles`, como «Cobertura».
 */
export async function saveCoverage(
  userId: string,
  previous: { address: string; hasCoordinates: boolean },
  next: { address: string; maxDistance: number },
): Promise<SaveCoverageResult> {
  const address = next.address.trim();
  if (!address) return { ok: false, reason: 'address_not_found' };

  let coordinates: { lat: number; lng: number } | null = null;
  if (address === previous.address.trim() && previous.hasCoordinates) {
    const { data } = await (supabase.from('gardener_profiles') as any)
      .select('operational_latitude, operational_longitude')
      .eq('user_id', userId)
      .maybeSingle();
    coordinates = getProviderCoordinates(data as never);
  }
  if (!coordinates) coordinates = await getCoordinatesFromAddress(address);
  if (!coordinates) return { ok: false, reason: 'address_not_found' };

  const { data: updated, error } = await (supabase.from('gardener_profiles') as any)
    .update({
      address,
      max_distance: normalizeMaxDistance(next.maxDistance),
      operational_latitude: coordinates.lat,
      operational_longitude: coordinates.lng,
    })
    .eq('user_id', userId)
    .select('user_id')
    .maybeSingle();
  if (error || !updated) return { ok: false, reason: 'save_failed' };

  await (supabase.from('profiles') as any).update({ address }).eq('user_id', userId);
  notifySetupChanged();
  return { ok: true, hasCoordinates: true };
}
