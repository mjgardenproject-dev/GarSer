import { supabase } from '../lib/supabase';

/**
 * Nombres de los servicios del catálogo, compartidos entre pantallas de la reserva.
 *
 * «Detalles» decide qué formulario pintar (césped, setos, fitosanitarios…) a partir del NOMBRE
 * del servicio, y lo pedía a la base de datos al montarse. Mientras llegaba la respuesta pintaba
 * la pantalla genérica («Fotos de tu jardín») y después la del servicio: un parpadeo de una
 * pantalla que no era la suya. «Servicios» ya ha cargado esos nombres, así que los deja aquí y
 * «Detalles» los lee al instante; solo si no están (p. ej. al recargar en «Detalles») se piden,
 * y mientras tanto la página enseña un estado de carga, nunca otra pantalla.
 */

const names = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();

/** Nombre con el que la reserva trata el servicio (la base de datos aún dice «fumigación»). */
export function normalizeServiceDisplayName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('fumigación') || lower.includes('fumigacion') || lower.includes('tratamientos fitosanitarios')) {
    return 'Servicios fitosanitarios';
  }
  return name;
}

/** Guarda los nombres ya normalizados que una pantalla ha cargado del catálogo. */
export function rememberServiceNames(services: ReadonlyArray<{ id?: unknown; name?: unknown }>): void {
  services.forEach(({ id, name }) => {
    if (typeof id === 'string' && id && typeof name === 'string' && name) {
      names.set(id, normalizeServiceDisplayName(name));
    }
  });
}

export function getKnownServiceName(serviceId: string): string | undefined {
  return names.get(serviceId);
}

/** Pide un nombre que no esté guardado. Las peticiones simultáneas del mismo id se comparten. */
export function loadServiceName(serviceId: string): Promise<string> {
  const known = names.get(serviceId);
  if (known) return Promise.resolve(known);
  const pending = inFlight.get(serviceId);
  if (pending) return pending;

  const request = (async () => {
    const { data, error } = await supabase.from('services').select('name').eq('id', serviceId).single();
    if (error) throw error;
    const name = (data as { name?: unknown } | null)?.name;
    if (typeof name !== 'string' || !name) throw new Error(`El servicio ${serviceId} no tiene nombre`);
    const displayName = normalizeServiceDisplayName(name);
    names.set(serviceId, displayName);
    return displayName;
  })().finally(() => {
    inFlight.delete(serviceId);
  });
  inFlight.set(serviceId, request);
  return request;
}

/** Solo para pruebas. */
export function resetServiceNameCatalog(): void {
  names.clear();
  inFlight.clear();
}
