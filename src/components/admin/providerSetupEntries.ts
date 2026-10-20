import {
  buildProviderSetupSteps,
  type ProviderSetupStatus,
  type ProviderSetupSummary,
} from '../../shared/providerSetup';
import { MARKETING_MATERIALS } from '../../utils/marketing/materials';

// Admin · Profesionales: de la lista del servidor (admin_provider_setup_overview) a filas con sus
// pasos y su grupo. Aparte del componente para poder usarlo también en el dashboard del admin.

export interface AdminProviderRow {
  user_id: string;
  name: string | null;
  provider_kind: 'solo' | 'company';
  email: string | null;
  phone: string | null;
  approved_at: string;
  status: ProviderSetupStatus | null;
  /** Marketing: cuántas imágenes ha descargado o compartido, de qué materiales y cuándo la última. */
  marketing?: { downloads: number; last_at: string | null; materials: string[] | null } | null;
}

export type ProviderCategory = 'hidden' | 'pending' | 'complete';

export interface AdminProviderEntry extends AdminProviderRow {
  summary: ProviderSetupSummary | null;
  category: ProviderCategory;
}

const CATEGORY_ORDER: Record<ProviderCategory, number> = { hidden: 0, pending: 1, complete: 2 };

/** No sale a ningún cliente / sale pero le falta algo obligatorio / completo. */
export function categorize(summary: ProviderSetupSummary | null): ProviderCategory {
  if (!summary || summary.suspended || summary.visibleServices.length === 0) return 'hidden';
  return summary.allRequiredDone ? 'complete' : 'pending';
}

/** Primero los que no salen, luego los que tienen algo pendiente; dentro, los más recientes. */
export function buildAdminProviderEntries(rows: AdminProviderRow[]): AdminProviderEntry[] {
  return rows
    .map((row) => {
      const summary = row.status ? buildProviderSetupSteps(row.status) : null;
      return { ...row, summary, category: categorize(summary) };
    })
    .sort((a, b) =>
      CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]
      || new Date(b.approved_at).getTime() - new Date(a.approved_at).getTime());
}

const MATERIAL_TITLE = Object.fromEntries(MARKETING_MATERIALS.map((m) => [m.id, m.title])) as Record<string, string>;

function agoLabel(iso: string): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  if (days === 0) return 'hoy';
  return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

/** «Marketing: Flyer para redes y Vinilo para la furgoneta · hace 3 días» o «todavía nada». */
export function marketingLine(marketing: AdminProviderRow['marketing']): string {
  if (!marketing || !marketing.downloads || !marketing.last_at) return 'Marketing: todavía no ha descargado nada';
  const names = (marketing.materials ?? []).map((id) => MATERIAL_TITLE[id] ?? id);
  return `Marketing: ${names.join(', ')} · ${agoLabel(marketing.last_at)}`;
}
