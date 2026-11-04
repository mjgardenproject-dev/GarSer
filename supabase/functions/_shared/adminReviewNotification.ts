// Lectura de la novedad y de los destinatarios del aviso al administrador (2026-11-04).
//
// Todo sale de la base de datos con la clave de servicio: quién es administrador, qué es la novedad y
// si TODAVÍA espera revisión (una solicitud ya aprobada, un carnet ya resuelto o una incidencia ya
// cerrada no se avisan: el estado se comprueba otra vez al enviar). Sin dependencias de Deno: lo usa
// send-email-notification y lo prueba vitest con un cliente falso.

import type { AdminPendingCounts, AdminReviewItem, AdminReviewKind } from './adminReviewEmailCopy.ts';

// deno-lint-ignore no-explicit-any
type AdminClient = any;

const text = (value: unknown) => String(value ?? '').trim();
const textList = (value: unknown): string[] => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);

async function profileName(admin: AdminClient, userId: string): Promise<string> {
  if (!userId) return '';
  const { data: profile } = await admin.from('profiles').select('full_name').eq('user_id', userId).maybeSingle();
  if (text(profile?.full_name)) return text(profile.full_name);
  const { data: gardener } = await admin.from('gardener_profiles').select('full_name').eq('user_id', userId).maybeSingle();
  return text(gardener?.full_name);
}

/**
 * La novedad, o null si ya no existe o ya no espera revisión (entonces no se manda nada).
 * Lanza si la base de datos falla: el aviso se reintenta.
 */
export async function loadAdminReviewItem(admin: AdminClient, kind: AdminReviewKind, itemId: string): Promise<AdminReviewItem | null> {
  if (!itemId) return null;

  if (kind === 'gardener_application') {
    const { data, error } = await admin
      .from('gardener_applications')
      .select('id, status, full_name, city_zone, services, experience_range')
      .eq('id', itemId)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.status !== 'submitted') return null;
    return {
      kind,
      name: text(data.full_name),
      zone: text(data.city_zone),
      services: textList(data.services),
      experience: text(data.experience_range),
    };
  }

  if (kind === 'company_application') {
    const { data, error } = await admin
      .from('company_applications')
      .select('id, status, commercial_name, contact_name, city_zone, services')
      .eq('id', itemId)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.status !== 'submitted') return null;
    return {
      kind,
      companyName: text(data.commercial_name),
      contactName: text(data.contact_name),
      zone: text(data.city_zone),
      services: textList(data.services),
    };
  }

  if (kind === 'phyto_license') {
    const { data, error } = await admin
      .from('gardener_licenses')
      .select('id, status, gardener_id, submitted_by, expires_at')
      .eq('id', itemId)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.status !== 'pending') return null;
    const holderId = text(data.gardener_id);
    const submitterId = text(data.submitted_by);
    const expires = data.expires_at ? new Date(String(data.expires_at)) : null;
    return {
      kind,
      holderName: (await profileName(admin, holderId)) || 'Un profesional',
      submittedByName: submitterId && submitterId !== holderId ? await profileName(admin, submitterId) : '',
      expiresLabel: expires && !Number.isNaN(expires.getTime())
        ? expires.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' })
        : '',
    };
  }

  const { data, error } = await admin
    .from('booking_incidents')
    .select('id, status, reporter_role, kind, description')
    .eq('id', itemId)
    .maybeSingle();
  if (error) throw error;
  if (!data || !['open', 'in_review'].includes(String(data.status))) return null;
  return { kind: 'incident', reporterRole: text(data.reporter_role), incidentKind: text(data.kind), description: text(data.description) };
}

/** Cuánto espera ahora mismo la revisión del administrador. */
export async function loadPendingCounts(admin: AdminClient): Promise<AdminPendingCounts> {
  const count = async (table: string, column: string, values: string[]) => {
    const { count: n, error } = await admin.from(table).select('id', { count: 'exact', head: true }).in(column, values);
    if (error) throw error;
    return Number(n || 0);
  };
  const [gardenerApplications, companyApplications, licenses, incidents] = await Promise.all([
    count('gardener_applications', 'status', ['submitted']),
    count('company_applications', 'status', ['submitted']),
    count('gardener_licenses', 'status', ['pending']),
    count('booking_incidents', 'status', ['open', 'in_review']),
  ]);
  return { gardenerApplications, companyApplications, licenses, incidents };
}

/** Los administradores con correo (sin repetidos). Sin ninguno, no hay a quién avisar. */
export async function loadAdminRecipients(admin: AdminClient): Promise<Array<{ userId: string; email: string }>> {
  const { data, error } = await admin.from('profiles').select('user_id').eq('role', 'admin');
  if (error) throw error;
  const seen = new Set<string>();
  const out: Array<{ userId: string; email: string }> = [];
  for (const row of (data || []) as Array<{ user_id: string }>) {
    const { data: user } = await admin.auth.admin.getUserById(row.user_id);
    const email = text(user?.user?.email).toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({ userId: row.user_id, email });
  }
  return out;
}
