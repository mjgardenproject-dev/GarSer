import { supabase } from '../lib/supabase';

/**
 * Nombres de usuario a partir de ids de auth.
 *
 * EL FALLO QUE RESUELVE: media docena de pantallas consultaban `profiles` por la columna `id`
 * pasándole el id del usuario de AUTH, que vive en `profiles.user_id`. Son columnas distintas,
 * así que la consulta devolvía cero filas y el nombre nunca se resolvía: el cliente no veía a su
 * jardinero en "Mis reservas", el jardinero no veía a su cliente, el chat mostraba genéricos y
 * "Mi Cuenta" cargaba vacía. Como todas caían a un texto por defecto, parecía que "no había
 * nombre" en vez de un error.
 *
 * POR QUÉ SE BUSCA POR LAS DOS COLUMNAS: el histórico de migraciones usó ambas como clave
 * contra `auth.uid()`, así que en producción pueden convivir filas de una y otra época. Buscar
 * solo por `user_id` arreglaría las nuevas y rompería las antiguas. Con las dos, ambas funcionan.
 *
 * Centralizado a propósito: la regla vivía repetida en seis sitios y se arregló mal en todos.
 */
export interface ProfileName {
  full_name: string | null;
  phone: string | null;
  /** Solo con fetchProviderNames: el proveedor es una empresa (su nombre es el comercial). */
  is_company?: boolean;
}

export async function fetchProfileNames(userIds: Array<string | null | undefined>): Promise<Record<string, ProfileName>> {
  const ids = Array.from(new Set(userIds.filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return {};

  const list = `(${ids.join(',')})`;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, user_id, full_name, phone')
    .or(`id.in.${list},user_id.in.${list}`);

  if (error) {
    console.warn('No se pudieron resolver los nombres de perfil:', error.message);
    return {};
  }

  const map: Record<string, ProfileName> = {};
  (data || []).forEach((row: { id?: string; user_id?: string; full_name?: string | null; phone?: string | null }) => {
    const entry: ProfileName = { full_name: row.full_name ?? null, phone: row.phone ?? null };
    // Se indexa por AMBAS claves: quien consulte con un id de auth o con el id de la fila
    // encuentra el nombre igual.
    if (row.user_id) map[row.user_id] = entry;
    if (row.id && !map[row.id]) map[row.id] = entry;
  });
  return map;
}

/** Nombre de un solo usuario, con texto de reserva si no se resuelve. */
export async function fetchProfileName(userId: string | null | undefined, fallback = 'Usuario'): Promise<string> {
  if (!userId) return fallback;
  const map = await fetchProfileNames([userId]);
  return map[userId]?.full_name?.trim() || fallback;
}

/**
 * GarSer Empresas (F5.4, H-31): nombres para mostrar de PROVEEDORES. El de su ficha de
 * profesional (`public_gardener_directory`, el mismo que ve el cliente en el listado al
 * reservar), y si no tiene ficha, el de su perfil. Para una empresa, la ficha es su nombre
 * comercial y el perfil es la persona del dueño: con `fetchProfileNames` el cliente habría visto
 * «con Marta» en vez de «con Jardines Demo Costa». Sirve también con ids que no son proveedores
 * (clientes): se quedan con el nombre de su perfil.
 */
export async function fetchProviderNames(userIds: Array<string | null | undefined>): Promise<Record<string, ProfileName>> {
  const ids = Array.from(new Set(userIds.filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return {};
  const [profiles, { data: providers }] = await Promise.all([
    fetchProfileNames(ids),
    supabase.from('public_gardener_directory').select('user_id, full_name, provider_kind').in('user_id', ids),
  ]);
  const map: Record<string, ProfileName> = { ...profiles };
  (providers || []).forEach((row: { user_id: string | null; full_name: string | null; provider_kind?: string | null }) => {
    const name = row.full_name?.trim();
    if (!row.user_id || !name) return;
    map[row.user_id] = { full_name: name, phone: map[row.user_id]?.phone ?? null, is_company: row.provider_kind === 'company' };
  });
  return map;
}
