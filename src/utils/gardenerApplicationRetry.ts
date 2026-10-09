import { supabase } from '../lib/supabase';

// Pendiente PH-02: un jardinero rechazado corrige su solicitud y la vuelve a enviar. Antes la web
// intentaba pasarla a borrador y borrarla desde el navegador; las reglas no lo dejan (respondía
// bien y no hacía nada) y el jardinero quedaba bloqueado para siempre. Ahora lo hace el servidor
// (`restart_gardener_application`): la misma solicitud vuelve a borrador con sus datos y el rechazo
// queda en un histórico que ven el admin y el propio jardinero.

export async function restartRejectedApplication(): Promise<void> {
  const { error } = await supabase.rpc('restart_gardener_application');
  if (error) throw new Error(error.message || 'No se ha podido reabrir tu solicitud.');
}

/**
 * PH-18: enviar el alta lo hace el servidor (`submit_gardener_application`), que comprueba que
 * está completa, como con las empresas. Antes era un UPDATE desde el navegador que dejaba enviar
 * una solicitud vacía.
 */
export async function submitGardenerApplication(): Promise<void> {
  const { error } = await supabase.rpc('submit_gardener_application');
  if (error) throw new Error(error.message || 'No se pudo enviar la solicitud.');
}

/** El último motivo de rechazo, para enseñarlo mientras corrige. */
export async function fetchLastRejection(userId: string): Promise<{ reason: string; reviewedAt: string | null } | null> {
  const { data, error } = await supabase
    .from('gardener_application_reviews')
    .select('review_comment, reviewed_at')
    .eq('user_id', userId)
    .order('reviewed_at', { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  return { reason: String(data[0].review_comment || '').trim(), reviewedAt: data[0].reviewed_at ?? null };
}

export type GardenerApplicationRow = {
  full_name?: string | null;
  phone?: string | null;
  city_zone?: string | null;
  professional_photo_url?: string | null;
  services?: string[] | null;
  other_services?: string | null;
  tools_available?: string[] | null;
  experience_years?: number | null;
  experience_description?: string | null;
  worked_for_companies?: boolean | null;
  can_prove?: boolean | null;
  proof_photos?: string[] | null;
  certification_text?: string | null;
  certification_photos?: string[] | null;
};

/** Los datos guardados de la solicitud, con la forma del formulario de alta. */
export function wizardStateFromApplication(row: GardenerApplicationRow) {
  const years = Number(row.experience_years ?? 0) || 0;
  return {
    fullName: row.full_name || '',
    phone: row.phone || '',
    cityZone: row.city_zone || '',
    photoUrl: row.professional_photo_url || '',
    services: row.services || [],
    otherServices: row.other_services || '',
    tools: row.tools_available || [],
    expYears: years,
    expYearsInput: String(years),
    experienceText: row.experience_description || '',
    workedForCompanies: Boolean(row.worked_for_companies),
    canProve: Boolean(row.can_prove),
    proofPhotos: row.proof_photos || [],
    educationText: row.certification_text || '',
    certPhotos: row.certification_photos || [],
  };
}

/** ¿Tiene la solicitud algún dato? (un borrador recién creado no tiene ninguno). */
export function applicationHasData(row: GardenerApplicationRow): boolean {
  return Boolean(row.full_name || row.phone || row.city_zone || row.professional_photo_url || (row.services || []).length);
}
