// Carnet fitosanitario (2026-10-20): el estado que calcula el servidor (`private.phyto_license_summary`,
// que llega por my_phyto_license, my_company_membership y company_team_overview) y lo que significa
// para cada pantalla. Puro: lo prueban los tests sin red.

export type PhytoLicenseStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface PhytoLicenseRenewal {
  status: 'pending' | 'rejected';
  submitted_at: string;
  rejection_reason: string | null;
  submitted_by_company: boolean;
}

export interface PhytoLicenseSummary {
  status: PhytoLicenseStatus | null;
  active: boolean;
  expires_at?: string | null;
  reviewed_at?: string | null;
  submitted_at?: string | null;
  license_number?: string | null;
  rejection_reason?: string | null;
  submitted_by_company?: boolean;
  renewal?: PhytoLicenseRenewal | null;
}

export const EMPTY_LICENSE: PhytoLicenseSummary = { status: null, active: false, renewal: null };

/** Con menos de estos días para caducar, se pide el renovado. */
export const RENEW_SOON_DAYS = 60;

/** Límites que también comprueba el servidor (y el almacén). */
export const LICENSE_MAX_BYTES = 10 * 1024 * 1024;
export const LICENSE_NUMBER_MAX = 40;

/** «Motivo: …» siempre con un solo punto final, lo escriba como lo escriba el admin. */
export function reasonSentence(reason: string | null | undefined): string {
  const text = String(reason || '').trim().replace(/[.\s]+$/, '');
  return `Motivo: ${text || 'sin indicar'}.`;
}

export function daysUntil(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.ceil((ms - now.getTime()) / 86_400_000);
}

export function formatLicenseDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' });
}

/**
 * Qué situación es, en una palabra:
 * - none: nunca ha enviado ninguno;
 * - pending: enviado y en revisión (sin uno vigente);
 * - approved: vigente y sin nada pendiente;
 * - expiring: vigente, pero caduca pronto y no ha enviado el renovado;
 * - renewal_pending: vigente, con el renovado en revisión;
 * - renewal_rejected: vigente, pero el renovado se rechazó;
 * - rejected / expired: sin carnet vigente.
 */
export type LicenseView =
  | 'none'
  | 'pending'
  | 'approved'
  | 'expiring'
  | 'renewal_pending'
  | 'renewal_rejected'
  | 'rejected'
  | 'expired';

export function licenseView(summary: PhytoLicenseSummary | null | undefined, now: Date = new Date()): LicenseView {
  const s = summary ?? EMPTY_LICENSE;
  if (s.active) {
    if (s.renewal?.status === 'pending') return 'renewal_pending';
    if (s.renewal?.status === 'rejected') return 'renewal_rejected';
    const days = daysUntil(s.expires_at, now);
    return days !== null && days <= RENEW_SOON_DAYS ? 'expiring' : 'approved';
  }
  if (s.status === 'pending') return 'pending';
  if (s.status === 'rejected') return 'rejected';
  if (s.status === 'expired' || s.status === 'approved') return 'expired';
  return 'none';
}

/** ¿Se enseña el formulario de subida directamente (sin tener que pulsar «renovar»)? */
export function needsUpload(view: LicenseView): boolean {
  return view === 'none' || view === 'rejected' || view === 'expired' || view === 'renewal_rejected';
}

/** ¿Puede enviar uno nuevo? Todo menos mientras hay uno en revisión. */
export function canUpload(view: LicenseView): boolean {
  return view !== 'pending' && view !== 'renewal_pending';
}

export type LicenseTone = 'ok' | 'info' | 'warn' | 'bad' | 'none';

export interface LicenseStatusCopy {
  tone: LicenseTone;
  title: string;
  detail: string;
}

/** El recuadro de estado, para el titular («tu carnet») o para la empresa («su carnet»). */
export function licenseStatusCopy(
  summary: PhytoLicenseSummary | null | undefined,
  audience: 'self' | 'company' = 'self',
  now: Date = new Date(),
): LicenseStatusCopy {
  const s = summary ?? EMPTY_LICENSE;
  const view = licenseView(s, now);
  const until = formatLicenseDate(s.expires_at);
  const days = daysUntil(s.expires_at, now);
  const self = audience === 'self';
  switch (view) {
    case 'approved':
      return { tone: 'ok', title: 'Carnet aprobado', detail: `Válido hasta el ${until}.` };
    case 'expiring':
      return {
        tone: 'warn',
        title: days !== null && days <= 0 ? 'Caduca hoy' : `Caduca en ${days} ${days === 1 ? 'día' : 'días'}`,
        detail: self
          ? `Válido hasta el ${until}. Sube el renovado para no quedarte sin tratamientos.`
          : `Válido hasta el ${until}. Pídele el renovado o súbelo tú.`,
      };
    case 'renewal_pending':
      return {
        tone: 'ok',
        title: 'Carnet aprobado · renovado en revisión',
        detail: `El actual vale hasta el ${until}. ${self ? 'Te avisaremos' : 'Os avisaremos'} cuando revisemos el renovado.`,
      };
    case 'renewal_rejected':
      return {
        tone: 'warn',
        title: 'No pudimos aprobar el renovado',
        detail: `${reasonSentence(s.renewal?.rejection_reason)} El actual vale hasta el ${until}.`,
      };
    case 'pending': {
      const sent = formatLicenseDate(s.submitted_at);
      const when = sent ? ` el ${sent}` : '';
      return {
        tone: 'info',
        title: 'En revisión',
        detail: s.submitted_by_company && self
          ? `Tu empresa lo envió${when}. Te avisaremos cuando esté revisado.`
          : `Enviado${when}. ${self ? 'Te avisaremos' : 'Os avisaremos'} cuando esté revisado.`,
      };
    }
    case 'rejected':
      return {
        tone: 'bad',
        title: 'No lo hemos podido aprobar',
        detail: `${reasonSentence(s.rejection_reason)} ${self ? 'Súbelo de nuevo corrigiéndolo.' : 'Puede subirlo de nuevo, o súbelo tú.'}`,
      };
    case 'expired':
      return {
        tone: 'bad',
        title: 'Carnet caducado',
        detail: `${until ? `Caducó el ${until}. ` : ''}${self ? 'Sube el renovado para volver a hacer tratamientos.' : 'No puede hacer tratamientos hasta que se apruebe el renovado.'}`,
      };
    case 'none':
    default:
      return {
        tone: 'none',
        title: self ? 'Aún no has subido tu carnet' : 'Sin carnet',
        detail: self ? 'Súbelo para poder hacer tratamientos fitosanitarios.' : 'No puede hacer tratamientos fitosanitarios.',
      };
  }
}

/**
 * El aviso de «Hoy» del empleado: solo si tiene que hacer algo. La empresa hace tratamientos (o se
 * lo ha pedido) y no tiene carnet, se lo rechazaron, caducó o caduca en 30 días.
 */
export function employeeLicensePrompt(params: {
  summary: PhytoLicenseSummary | null | undefined;
  needed: boolean;
  requestedAt?: string | null;
  companyName: string;
  now?: Date;
}): { tone: 'warn' | 'bad'; title: string; detail: string } | null {
  const now = params.now ?? new Date();
  const s = params.summary ?? EMPTY_LICENSE;
  const view = licenseView(s, now);
  const company = params.companyName || 'Tu empresa';
  switch (view) {
    case 'none':
      if (!params.needed) return null;
      return {
        tone: 'warn',
        title: 'Sube tu carnet fitosanitario',
        detail: params.requestedAt
          ? `${company} te lo ha pedido para poder asignarte tratamientos. Es una foto o un PDF.`
          : `Lo necesitas para que ${company} pueda asignarte tratamientos fitosanitarios.`,
      };
    case 'rejected':
      return { tone: 'bad', title: 'Tu carnet no se ha aprobado', detail: `${reasonSentence(s.rejection_reason)} Súbelo de nuevo.` };
    case 'expired':
      return { tone: 'bad', title: 'Tu carnet ha caducado', detail: 'Sube el renovado para volver a hacer tratamientos fitosanitarios.' };
    case 'renewal_rejected':
      return { tone: 'warn', title: 'No pudimos aprobar tu carnet renovado', detail: reasonSentence(s.renewal?.rejection_reason) };
    case 'expiring': {
      const days = daysUntil(s.expires_at, now) ?? 0;
      if (days > 30 && !requestIsCurrent(s, params.requestedAt)) return null;
      return { tone: 'warn', title: `Tu carnet caduca el ${formatLicenseDate(s.expires_at)}`, detail: 'Sube el renovado antes: mientras lo revisamos, el actual sigue valiendo.' };
    }
    default:
      return null;
  }
}

/** El carnet de alguien del equipo, tal como llega en company_team_overview. */
export function summaryFromTeamMember(member: {
  license_status: PhytoLicenseStatus | null;
  has_valid_phyto_license: boolean;
  license_expires_at?: string | null;
  license_rejection_reason?: string | null;
  license_renewal?: PhytoLicenseRenewal | null;
  license_submitted_at?: string | null;
}): PhytoLicenseSummary {
  return {
    status: member.license_status,
    active: member.has_valid_phyto_license,
    expires_at: member.license_expires_at ?? null,
    rejection_reason: member.license_rejection_reason ?? null,
    renewal: member.license_renewal ?? null,
    submitted_at: member.license_submitted_at ?? null,
  };
}

/**
 * ¿Se le puede pedir el carnet (o el renovado)? Lo mismo que comprueba el servidor: sin nada en
 * revisión, sin un carnet que valga más de 60 días y sin habérselo pedido en las últimas 24 horas.
 */
export function canRequestLicense(summary: PhytoLicenseSummary, requestedAt: string | null | undefined, now: Date = new Date()): boolean {
  const view = licenseView(summary, now);
  if (view === 'pending' || view === 'renewal_pending' || view === 'approved') return false;
  if (!requestedAt) return true;
  return now.getTime() - new Date(requestedAt).getTime() >= 86_400_000;
}

/** Una petición de la empresa cuenta si es posterior al último carnet que envió. */
export function requestIsCurrent(summary: PhytoLicenseSummary | null | undefined, requestedAt: string | null | undefined): boolean {
  if (!requestedAt) return false;
  const sentAt = summary?.submitted_at ? new Date(summary.submitted_at).getTime() : 0;
  return new Date(requestedAt).getTime() > sentAt;
}

/** «hoy», «ayer», «hace 3 días». */
export function agoLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  return `hace ${days} días`;
}
