// Textos del aviso al administrador: algo espera su revisión (2026-11-04). Sin dependencias de Deno:
// lo usa send-email-notification y lo prueba vitest (src/shared/adminReviewEmailCopy.test.ts).
//
// Cada aviso dice QUÉ ha llegado, de quién, qué pasa si se deja, cuánto hay pendiente en total y lleva
// con un botón a la sección donde se resuelve.

export type AdminReviewKind = 'gardener_application' | 'company_application' | 'phyto_license' | 'incident';

export const ADMIN_REVIEW_KINDS: readonly AdminReviewKind[] = ['gardener_application', 'company_application', 'phyto_license', 'incident'];

export const isAdminReviewKind = (value: unknown): value is AdminReviewKind =>
  typeof value === 'string' && (ADMIN_REVIEW_KINDS as readonly string[]).includes(value);

/** Lo que se sabe de la novedad, ya leído de la base de datos (nunca de quien pide el correo). */
export type AdminReviewItem =
  | { kind: 'gardener_application'; name: string; zone: string; services: string[]; experience: string }
  | { kind: 'company_application'; companyName: string; contactName: string; zone: string; services: string[] }
  | { kind: 'phyto_license'; holderName: string; submittedByName: string; expiresLabel: string }
  | { kind: 'incident'; reporterRole: 'client' | 'gardener' | string; incidentKind: string; description: string };

export interface AdminPendingCounts {
  gardenerApplications: number;
  companyApplications: number;
  licenses: number;
  incidents: number;
}

export interface AdminReviewEmailCopy {
  subject: string;
  heading: string;
  intro: string;
  /** Filas etiqueta/valor: salen igual en HTML (detailRows) y en texto plano. */
  pairs: Array<[string, string]>;
  ctaLabel: string;
  /** Ruta dentro de garser.es. */
  ctaPath: string;
  footerNote: string;
}

const EXPERIENCE_LABEL: Record<string, string> = {
  '<1': 'Menos de 1 año',
  '1-3': 'De 1 a 3 años',
  '3-5': 'De 3 a 5 años',
  '>5': 'Más de 5 años',
};

const INCIDENT_KIND_LABEL: Record<string, string> = {
  gardener_no_show: 'El profesional no se presentó',
  service_not_done: 'El servicio no se hizo',
  service_incomplete: 'El servicio quedó incompleto',
  billing: 'Problema con el cobro',
  behaviour: 'Comportamiento',
  other: 'Otro motivo',
};

const clip = (text: string, max: number) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

const listOf = (items: string[], max = 5) => {
  const clean = items.map((i) => String(i || '').trim()).filter(Boolean);
  if (clean.length === 0) return '';
  return clean.length > max ? `${clean.slice(0, max).join(', ')} y ${clean.length - max} más` : clean.join(', ');
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** «2 solicitudes de jardinero · 1 carnet», solo lo que no es cero; '' si no hay nada. */
export function pendingSummary(counts: AdminPendingCounts): string {
  const parts: string[] = [];
  if (counts.gardenerApplications > 0) parts.push(plural(counts.gardenerApplications, 'solicitud de jardinero', 'solicitudes de jardinero'));
  if (counts.companyApplications > 0) parts.push(plural(counts.companyApplications, 'solicitud de empresa', 'solicitudes de empresa'));
  if (counts.licenses > 0) parts.push(plural(counts.licenses, 'carnet fitosanitario', 'carnets fitosanitarios'));
  if (counts.incidents > 0) parts.push(plural(counts.incidents, 'incidencia', 'incidencias'));
  return parts.join(' · ');
}

/** Dónde se resuelve cada tipo de novedad en el panel. */
export function adminReviewPathFor(kind: AdminReviewKind): string {
  switch (kind) {
    case 'gardener_application':
    case 'company_application':
      return '/admin/users';
    case 'phyto_license':
      return '/admin/phytosanitary';
    default:
      return '/admin/incidents';
  }
}

export function adminReviewEmailCopy(params: { item: AdminReviewItem; counts: AdminPendingCounts }): AdminReviewEmailCopy {
  const { item, counts } = params;
  const pairs: Array<[string, string]> = [];
  const add = (label: string, value: string) => {
    if (String(value || '').trim()) pairs.push([label, String(value).trim()]);
  };
  const heading = 'Tienes algo que revisar';
  const base = { heading, ctaPath: adminReviewPathFor(item.kind) };
  let copy: Omit<AdminReviewEmailCopy, 'pairs'>;

  switch (item.kind) {
    case 'gardener_application': {
      add('Nombre', item.name);
      add('Zona', item.zone);
      add('Servicios', listOf(item.services));
      add('Experiencia', EXPERIENCE_LABEL[item.experience] || item.experience);
      copy = {
        ...base,
        subject: 'Nueva solicitud de jardinero para revisar',
        intro: `${item.name || 'Una persona'} ha enviado su solicitud para trabajar como jardinero en GarSer.`,
        ctaLabel: 'Revisar la solicitud',
        footerNote: 'Quien solicita el alta lee en la web que se revisa en menos de 24 horas.',
      };
      break;
    }
    case 'company_application': {
      add('Empresa', item.companyName);
      add('Contacto', item.contactName);
      add('Zona', item.zone);
      add('Servicios', listOf(item.services));
      copy = {
        ...base,
        subject: 'Nueva solicitud de empresa para revisar',
        intro: `${item.companyName || 'Una empresa'} ha enviado su solicitud de alta en GarSer.`,
        ctaLabel: 'Revisar la solicitud',
        footerNote: 'Quien solicita el alta lee en la web que se revisa en menos de 24 horas.',
      };
      break;
    }
    case 'phyto_license': {
      add('Titular', item.holderName);
      if (item.submittedByName && item.submittedByName !== item.holderName) add('Enviado por', item.submittedByName);
      add('Caducidad indicada', item.expiresLabel);
      copy = {
        ...base,
        subject: 'Nuevo carnet fitosanitario para revisar',
        intro: `${item.holderName || 'Un profesional'} ha subido su carnet de aplicador de productos fitosanitarios.`,
        ctaLabel: 'Revisar el carnet',
        footerNote: 'Hasta que lo apruebes, no sale a los clientes en los tratamientos con producto químico.',
      };
      break;
    }
    default: {
      const who = item.reporterRole === 'gardener' ? 'Un profesional' : 'Un cliente';
      add('La abre', item.reporterRole === 'gardener' ? 'Profesional' : 'Cliente');
      add('Motivo', INCIDENT_KIND_LABEL[item.incidentKind] || item.incidentKind);
      add('Lo que cuenta', clip(item.description, 160));
      copy = {
        ...base,
        subject: 'Nueva incidencia para revisar',
        intro: `${who} ha abierto una incidencia sobre una reserva.`,
        ctaLabel: 'Revisar la incidencia',
        footerNote: 'Hasta que se resuelva, hay una persona esperando una respuesta (y puede haber dinero de por medio).',
      };
    }
  }

  const summary = pendingSummary(counts);
  if (summary) pairs.push(['Pendiente ahora', summary]);
  return { ...copy, pairs };
}
