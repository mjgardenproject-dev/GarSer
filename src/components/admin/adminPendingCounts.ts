/**
 * Lo que espera la revisión del administrador, para los contadores rojos del menú del panel.
 *
 * Sale de `admin_pending_review_counts()` (solo administradores). Si la función no existe todavía
 * (la web se despliega antes que la migración) o falla, el menú sigue funcionando: se pide solo el
 * contador de incidencias como antes y el resto no muestra número.
 */

export type AdminPendingCounts = {
  gardenerApplications: number;
  companyApplications: number;
  licenses: number;
  incidents: number;
};

const asCount = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** El resultado de la función de base de datos, o null si no tiene la forma esperada. */
export function parseAdminPendingCounts(raw: unknown): AdminPendingCounts | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  return {
    gardenerApplications: asCount(r.gardenerApplications),
    companyApplications: asCount(r.companyApplications),
    licenses: asCount(r.licenses),
    incidents: asCount(r.incidents),
  };
}

/** «Usuarios» agrupa las solicitudes de alta de jardinero y de empresa. */
export const pendingApplications = (counts: AdminPendingCounts): number =>
  counts.gardenerApplications + counts.companyApplications;
