import { supabase } from '../lib/supabase';
import { ensurePhytosanitaryPersistedConfig, normalizePhytosanitaryPricingConfig } from './phytosanitaryConfig';
import {
  isHedgeConfigValid,
  isLawnConfigValid,
  isPalmConfigValid,
  isPhytosanitaryConfigValid,
  isShrubConfigValid,
  isTreePruningConfigValid,
  isWeedingConfigValid,
} from './serviceValidation';

// Activar servicios (2026-11-05). Un servicio solo se ofrece a los clientes si está ACTIVO, y activar
// no es automático al poner los precios. Esto reúne en un sitio lo que hacen «Mi perfil → Servicios» y
// el apartado «Completa tu cuenta»: saber si un servicio YA se puede activar (su configuración
// guardada es válida) y activarlo/desactivarlo SIN tocar su configuración.

/** ¿Es válida la configuración guardada de este servicio? Los mismos validadores del configurador. */
export function isSavedServiceConfigValid(serviceName: string, rawConfig: unknown): boolean {
  if (!rawConfig || typeof rawConfig !== 'object') return false;
  const config = rawConfig as never;
  switch (serviceName) {
    case 'Poda de palmeras': return isPalmConfigValid(config);
    case 'Corte de césped': return isLawnConfigValid(config);
    case 'Poda de setos': return isHedgeConfigValid(config);
    case 'Poda de árboles': return isTreePruningConfigValid(config);
    case 'Poda de plantas y arbustos': return isShrubConfigValid(config);
    case 'Desbroce de malas hierbas': return isWeedingConfigValid(config);
    case 'Servicios fitosanitarios':
      // Misma normalización con la que ProfileSettings carga este servicio.
      return isPhytosanitaryConfigValid(ensurePhytosanitaryPersistedConfig(normalizePhytosanitaryPricingConfig(config)));
    default: return false;
  }
}

/** Estado de un servicio del profesional: el botón «Activar» tiene tres. */
export type ServiceActivationState = 'locked' | 'ready' | 'active';

export const serviceActivationState = (active: boolean, canActivate: boolean): ServiceActivationState =>
  active ? 'active' : canActivate ? 'ready' : 'locked';

export interface ServiceActivationInfo {
  id: string;
  name: string;
  active: boolean;
  /** Su configuración guardada es válida: se puede activar. */
  canActivate: boolean;
}

/** Los servicios que el profesional ya ha empezado a configurar (tienen fila de precios) y su estado. */
export async function loadServiceActivation(providerId: string): Promise<ServiceActivationInfo[]> {
  const [{ data: rows, error: rowsError }, { data: services, error: servicesError }] = await Promise.all([
    supabase.from('gardener_service_prices').select('service_id, active, additional_config').eq('gardener_id', providerId),
    supabase.from('services').select('id, name'),
  ]);
  if (rowsError) throw rowsError;
  if (servicesError) throw servicesError;
  const names = new Map(((services ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]));
  return ((rows ?? []) as Array<{ service_id: string; active: boolean | null; additional_config: unknown }>)
    .filter((row) => names.has(row.service_id))
    .map((row) => {
      const name = names.get(row.service_id) as string;
      return {
        id: row.service_id,
        name,
        active: row.active === true,
        canActivate: isSavedServiceConfigValid(name, row.additional_config),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/**
 * Activa o desactiva un servicio SIN tocar su configuración (solo la columna `active`) y deja al día
 * la lista de servicios activos de la ficha (`gardener_profiles.services`), como hace «Mi perfil».
 * Lanza si el servicio no tiene precios guardados.
 */
export async function setServiceActive(providerId: string, serviceId: string, active: boolean): Promise<void> {
  const { data: updated, error } = await supabase
    .from('gardener_service_prices')
    .update({ active })
    .eq('gardener_id', providerId)
    .eq('service_id', serviceId)
    .select('service_id');
  if (error) throw error;
  if (!updated || updated.length === 0) throw new Error('Este servicio todavía no tiene precios guardados.');

  const { data: activeRows, error: listError } = await supabase
    .from('gardener_service_prices')
    .select('service_id')
    .eq('gardener_id', providerId)
    .eq('active', true);
  if (listError) throw listError;
  const { error: profileError } = await supabase
    .from('gardener_profiles')
    .update({ services: (activeRows ?? []).map((row: { service_id: string }) => row.service_id) })
    .eq('user_id', providerId);
  if (profileError) throw profileError;
}
