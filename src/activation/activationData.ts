import { supabase } from '../lib/supabase';
import { getCoordinatesFromAddress } from '../utils/geolocation';
import { getProviderCoordinates } from '../shared/bookingEligibilityCore';
import { notifySetupChanged } from '../utils/setupEvents';
import { sortActivationServices, toActivationServiceName, type ActivationServiceName } from './serviceCatalog';
import type { ScheduleRule } from '../utils/recurringSchedulePersistence';

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
  /** id y unidad de cada servicio en la tabla `services`, por nombre. */
  serviceIds: Partial<Record<ActivationServiceName, string>>;
  serviceUnits: Partial<Record<ActivationServiceName, string>>;
  /** Lo que ya tiene guardado de cada servicio (configuración y si está activo). */
  savedServices: Partial<Record<ActivationServiceName, { config: unknown; active: boolean }>>;
  /** Su horario fijo y sus reglas de agenda, si ya los tiene. */
  schedule: { rules: ScheduleRule[]; weeksToMaintain: number | null; minNoticeHours: number | null };
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
  const [profileRes, gardenerRes, applicationRes, pricesRes, servicesRes, rulesRes, settingsRes] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('user_id', userId).maybeSingle(),
    (supabase.from('gardener_profiles') as any)
      .select('full_name, address, max_distance, operational_latitude, operational_longitude')
      .eq('user_id', userId)
      .maybeSingle(),
    (supabase.from('gardener_applications') as any)
      .select('services, estimated_team_size, city_zone')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase.from('gardener_service_prices').select('service_id, additional_config, active').eq('gardener_id', userId),
    supabase.from('services').select('id, name, measurement'),
    supabase.from('recurring_schedules').select('day_of_week, start_time, end_time').eq('gardener_id', userId),
    supabase.from('recurring_availability_settings').select('weeks_to_maintain, min_notice_hours').eq('gardener_id', userId).maybeSingle(),
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
  const services = ((servicesRes.data ?? []) as Array<{ id: string; name: string; measurement?: string | null }>);
  const serviceIds: Partial<Record<ActivationServiceName, string>> = {};
  const serviceUnits: Partial<Record<ActivationServiceName, string>> = {};
  for (const row of services) {
    const name = toActivationServiceName(row.name);
    if (name && !serviceIds[name]) {
      serviceIds[name] = row.id;
      serviceUnits[name] = row.measurement || 'area';
    }
  }
  const savedServices: ActivationData['savedServices'] = {};
  const priceRows = (pricesRes.data ?? []) as Array<{ service_id: string; additional_config: unknown; active: boolean | null }>;
  for (const row of priceRows) {
    const name = toActivationServiceName(services.find((s) => s.id === row.service_id)?.name);
    if (name) savedServices[name] = { config: row.additional_config, active: row.active === true };
  }
  const configuredNames = priceRows.map((row) => services.find((s) => s.id === row.service_id)?.name);

  const profileName = (profileRes.data as { full_name?: string | null } | null)?.full_name;
  return {
    firstName: firstNameOf(profileName || gardener.full_name),
    address: String(gardener.address || application?.city_zone || '').trim(),
    maxDistance: normalizeMaxDistance(gardener.max_distance),
    hasCoordinates: Boolean(getProviderCoordinates(gardener as never)),
    preselectedServices: sortActivationServices([...(application?.services ?? []), ...configuredNames]),
    estimatedTeamSize: typeof application?.estimated_team_size === 'number' ? application.estimated_team_size : null,
    serviceIds,
    serviceUnits,
    savedServices,
    schedule: {
      rules: ((rulesRes.data ?? []) as ScheduleRule[]),
      weeksToMaintain: (settingsRes.data as { weeks_to_maintain?: number | null } | null)?.weeks_to_maintain ?? null,
      minNoticeHours: (settingsRes.data as { min_notice_hours?: number | null } | null)?.min_notice_hours ?? null,
    },
  };
}

/**
 * Guarda la configuración de tarifas de un servicio, igual que «Mi perfil → Servicios»
 * (ProfileSettings.buildServicePricePayload). `active` va SIEMPRE explícito: la columna vale «sí» por
 * defecto y un servicio nuevo no debe ofrecerse hasta el gesto final «Activar mi cuenta».
 */
export async function saveServiceConfig(
  userId: string,
  serviceId: string,
  unitType: string,
  config: Record<string, unknown>,
  active: boolean,
): Promise<boolean> {
  const { error } = await (supabase.from('gardener_service_prices') as any).upsert(
    {
      gardener_id: userId,
      service_id: serviceId,
      unit_type: unitType || 'area',
      price_per_unit: 0,
      currency: 'EUR',
      active,
      additional_config: config,
    },
    { onConflict: 'gardener_id,service_id' },
  );
  if (error) return false;
  notifySetupChanged();
  return true;
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
