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
