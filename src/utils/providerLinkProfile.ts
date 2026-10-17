import { supabase } from '../lib/supabase';

/**
 * Lo que la reserva necesita saber del profesional del enlace (garser.es/reservar/<id>): su
 * nombre, para decírselo al cliente, y los servicios que ofrece, para enseñarle solo esos.
 *
 * Varias pantallas de la reserva lo usan (la entrada, «Dirección», «Servicios», «Profesionales»):
 * se pide una vez y se comparte, como serviceNameCatalog. El perfil público ya lo ha cargado
 * cuando el cliente pulsa «Reservar con este profesional», así que lo deja aquí y la reserva
 * arranca sin volver a pedirlo.
 */

export interface ProviderLinkProfile {
  userId: string;
  fullName: string;
  /** Servicios activos y configurados (gardener_profiles.services, proyección de sus tarifas). */
  serviceIds: string[];
  maxDistanceKm: number | null;
}

const profiles = new Map<string, ProviderLinkProfile | null>();
const inFlight = new Map<string, Promise<ProviderLinkProfile | null>>();

type DirectoryRow = {
  user_id?: unknown;
  full_name?: unknown;
  services?: unknown;
  max_distance?: unknown;
};

export function toProviderLinkProfile(row: DirectoryRow): ProviderLinkProfile | null {
  if (typeof row.user_id !== 'string' || !row.user_id) return null;
  return {
    userId: row.user_id,
    fullName: typeof row.full_name === 'string' ? row.full_name.trim() : '',
    serviceIds: Array.isArray(row.services) ? row.services.filter((id): id is string => typeof id === 'string') : [],
    maxDistanceKm: Number.isFinite(Number(row.max_distance)) && row.max_distance != null ? Number(row.max_distance) : null,
  };
}

/** Guarda el perfil que ya ha cargado otra pantalla (el perfil público). */
export function rememberProviderLinkProfile(row: DirectoryRow): void {
  const profile = toProviderLinkProfile(row);
  if (profile) profiles.set(profile.userId, profile);
}

export function getKnownProviderLinkProfile(gardenerId: string): ProviderLinkProfile | null | undefined {
  return profiles.get(gardenerId);
}

/** null: no existe (o ya no sale en el directorio). Las peticiones simultáneas se comparten. */
export function loadProviderLinkProfile(gardenerId: string): Promise<ProviderLinkProfile | null> {
  if (profiles.has(gardenerId)) return Promise.resolve(profiles.get(gardenerId) ?? null);
  const pending = inFlight.get(gardenerId);
  if (pending) return pending;

  const request = (async () => {
    const { data, error } = await supabase
      .from('public_gardener_directory')
      .select('user_id, full_name, services, max_distance')
      .eq('user_id', gardenerId)
      .maybeSingle();
    if (error) throw error;
    const profile = data ? toProviderLinkProfile(data as DirectoryRow) : null;
    profiles.set(gardenerId, profile);
    return profile;
  })().finally(() => {
    inFlight.delete(gardenerId);
  });
  inFlight.set(gardenerId, request);
  return request;
}

/** Solo para los tests. */
export function resetProviderLinkProfiles(): void {
  profiles.clear();
  inFlight.clear();
}
