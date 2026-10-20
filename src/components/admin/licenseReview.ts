// Cola de carnets del admin (2026-10-20): la fila de `admin_phyto_license_queue`, los motivos de
// rechazo rápidos y cómo se nombra a cada titular. Aparte del componente para poder probarlo.

export interface AdminLicenseRow {
  id: string;
  holder_id: string;
  created_at: string;
  license_number: string | null;
  document_url: string;
  document_hash: string | null;
  holder_name: string | null;
  email: string | null;
  phone: string | null;
  holder_kind: 'solo' | 'company_owner' | 'employee';
  company_name: string | null;
  submitted_by_company: boolean;
  current_expires_at: string | null;
  previous_rejections: number;
}

export const REJECTION_PRESETS = [
  'No se lee bien: haz la foto con más luz, sin reflejos y con el carnet entero.',
  'No es un carnet de aplicador de productos fitosanitarios.',
  'El carnet está caducado: sube el renovado.',
  'El nombre del carnet no coincide con el de la cuenta.',
  'Falta la otra cara del carnet.',
];

export function holderKindLabel(row: Pick<AdminLicenseRow, 'holder_kind' | 'company_name'>): string {
  if (row.holder_kind === 'employee') return row.company_name ? `Empleado de ${row.company_name}` : 'Empleado de una empresa';
  if (row.holder_kind === 'company_owner') return row.company_name ? `Titular de ${row.company_name}` : 'Titular de una empresa';
  return 'Autónomo';
}
