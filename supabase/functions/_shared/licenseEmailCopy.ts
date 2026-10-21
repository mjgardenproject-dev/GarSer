// Textos de los avisos del carnet fitosanitario (2026-10-20). Sin dependencias de Deno: lo usa
// send-email-notification y lo prueba vitest (src/shared/licenseEmailCopy.test.ts).
//
// Tres destinatarios: el titular del carnet (autónomo, dueño de empresa o empleado), el dueño de la
// empresa cuando es de alguien de su equipo, y el empleado al que su empresa le pide el carnet.
// Cada aviso dice qué ha pasado, qué consecuencia tiene y qué hacer, con un botón que lleva allí.

export type LicenseEvent = 'approved' | 'rejected' | 'expiring' | 'expired' | 'submitted_for_you';
export type LicenseHolderKind = 'solo' | 'company_owner' | 'employee';

export interface LicenseEmailCopy {
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

const firstNameOf = (name?: string | null) => String(name || '').trim().split(/\s+/)[0] || '';
const greeting = (name?: string | null) => (firstNameOf(name) ? `Hola ${firstNameOf(name)}` : 'Hola');

/** Dónde sube o ve su carnet cada uno. */
export function licensePathFor(kind: LicenseHolderKind): string {
  if (kind === 'employee') return '/mi-trabajo?tab=profile';
  if (kind === 'company_owner') return '/empresa?tab=company';
  return '/dashboard';
}

/** Al titular del carnet. */
export function holderLicenseEmailCopy(params: {
  event: LicenseEvent;
  kind: LicenseHolderKind;
  name?: string | null;
  companyName?: string | null;
  /** Caducidad del carnet del aviso (aprobado, a punto de caducar o caducado). */
  expiresLabel?: string | null;
  reason?: string | null;
  /** Rechazo de una renovación: hasta cuándo vale el carnet que ya tenía. */
  stillValidLabel?: string | null;
}): LicenseEmailCopy {
  const company = String(params.companyName || '').trim() || 'Tu empresa';
  const path = licensePathFor(params.kind);
  const heading = greeting(params.name);
  const expires = String(params.expiresLabel || '').trim();
  const whatItAllows = params.kind === 'employee'
    ? `${company} ya puede asignarte tratamientos fitosanitarios.`
    : params.kind === 'company_owner'
      ? 'Ya puedes hacer tú los tratamientos con producto químico de tu empresa.'
      : 'Ya sales a los clientes en los tratamientos con producto químico.';

  switch (params.event) {
    case 'approved':
      return {
        subject: 'Tu carnet fitosanitario está aprobado',
        heading,
        intro: `Hemos revisado tu carnet fitosanitario y está aprobado. ${whatItAllows}`,
        pairs: expires ? [['Válido hasta', expires]] : [],
        ctaLabel: 'Ver mi carnet',
        ctaPath: path,
        footerNote: 'Te avisaremos 30 días antes de que caduque para que lo renueves a tiempo.',
      };
    case 'rejected': {
      const still = String(params.stillValidLabel || '').trim();
      return {
        subject: 'No hemos podido aprobar tu carnet fitosanitario',
        heading,
        intro: still
          ? `Hemos revisado el carnet renovado que enviaste y no podemos aprobarlo. Tu carnet actual sigue valiendo hasta el ${still}.`
          : 'Hemos revisado el carnet que enviaste y no podemos aprobarlo todavía. Súbelo de nuevo corrigiendo lo que te indicamos.',
        pairs: [['Motivo', String(params.reason || '').trim() || 'Sin indicar']],
        ctaLabel: 'Subir el carnet de nuevo',
        ctaPath: path,
        footerNote: params.kind === 'employee'
          ? `Puedes subirlo tú desde tu móvil, o ${company} puede enviarlo por ti.`
          : 'Asegúrate de que se lea entero, por las dos caras si las tiene, y de que esté en vigor.',
      };
    }
    case 'expiring':
      return {
        subject: expires ? `Tu carnet fitosanitario caduca el ${expires}` : 'Tu carnet fitosanitario caduca pronto',
        heading,
        intro: 'Para seguir haciendo tratamientos fitosanitarios, sube tu carnet renovado antes de que caduque. Mientras lo revisamos, el actual sigue valiendo.',
        pairs: expires ? [['Caduca el', expires]] : [],
        ctaLabel: 'Subir el carnet renovado',
        ctaPath: path,
        footerNote: params.kind === 'employee' ? `${company} también puede enviarlo por ti.` : 'Es una foto o un PDF: tardas un minuto.',
      };
    case 'expired':
      return {
        subject: 'Tu carnet fitosanitario ha caducado',
        heading,
        intro: params.kind === 'employee'
          ? `Desde hoy ${company} no puede asignarte tratamientos fitosanitarios. Sube tu carnet renovado para volver a hacerlos.`
          : params.kind === 'company_owner'
            ? 'Desde hoy no puedes hacer tú los tratamientos con producto químico. Sube tu carnet renovado para volver a hacerlos.'
            : 'Desde hoy no sales a los clientes en los tratamientos con producto químico. Sube tu carnet renovado para volver a salir.',
        pairs: expires ? [['Caducó el', expires]] : [],
        ctaLabel: 'Subir el carnet renovado',
        ctaPath: path,
        footerNote: 'En cuanto lo aprobemos, vuelve todo como estaba.',
      };
    case 'submitted_for_you':
    default:
      return {
        subject: `${company} ha enviado tu carnet fitosanitario a GarSer`,
        heading,
        intro: `${company} ha enviado tu carnet fitosanitario para que lo revisemos. Te avisaremos en cuanto esté revisado.`,
        pairs: [],
        ctaLabel: 'Ver mi carnet',
        ctaPath: path,
        footerNote: `Si no le diste permiso a ${company} para enviarlo, díselo o escríbenos desde garser.es.`,
      };
  }
}

/** Al dueño de la empresa, sobre el carnet de alguien de su equipo. */
export function companyLicenseEmailCopy(params: {
  event: Exclude<LicenseEvent, 'submitted_for_you'>;
  personName?: string | null;
  expiresLabel?: string | null;
  reason?: string | null;
}): LicenseEmailCopy {
  const person = String(params.personName || '').trim() || 'Una persona de tu equipo';
  const expires = String(params.expiresLabel || '').trim();
  const base = { heading: 'Carnets de tu equipo', ctaPath: '/empresa?tab=team' };
  switch (params.event) {
    case 'approved':
      return {
        ...base,
        subject: `El carnet fitosanitario de ${person} está aprobado`,
        intro: `Hemos aprobado el carnet fitosanitario de ${person}. Ya puedes asignarle «Servicios fitosanitarios» en tu equipo.`,
        pairs: expires ? [['Válido hasta', expires]] : [],
        ctaLabel: 'Asignar servicios',
        footerNote: 'Te avisaremos 30 días antes de que caduque.',
      };
    case 'rejected':
      return {
        ...base,
        subject: `No hemos podido aprobar el carnet de ${person}`,
        intro: `Hemos revisado el carnet fitosanitario de ${person} y no podemos aprobarlo todavía.`,
        pairs: [['Motivo', String(params.reason || '').trim() || 'Sin indicar']],
        ctaLabel: 'Ver mi equipo',
        footerNote: 'Puede subirlo de nuevo desde su móvil, o puedes enviarlo tú desde su ficha del equipo.',
      };
    case 'expiring':
      return {
        ...base,
        subject: expires ? `El carnet de ${person} caduca el ${expires}` : `El carnet de ${person} caduca pronto`,
        intro: `Pídele que suba el carnet renovado, o súbelo tú desde su ficha. Cuando caduque, no podrás asignarle tratamientos fitosanitarios.`,
        pairs: expires ? [['Caduca el', expires]] : [],
        ctaLabel: 'Ver mi equipo',
        footerNote: 'Mientras revisamos el renovado, el actual sigue valiendo.',
      };
    case 'expired':
    default:
      return {
        ...base,
        subject: `El carnet de ${person} ha caducado`,
        intro: `${person} ya no puede hacer tratamientos fitosanitarios: le hemos quitado ese servicio en tu equipo. Cuando suba el carnet renovado y lo aprobemos, podrás volver a asignárselo.`,
        pairs: expires ? [['Caducó el', expires]] : [],
        ctaLabel: 'Ver mi equipo',
        footerNote: 'Los trabajos que ya tenía asignados no cambian: revísalos por si alguno es un tratamiento.',
      };
  }
}

/** Al empleado, cuando su empresa le pide el carnet (o el renovado, si el suyo caduca pronto). */
export function licenseRequestEmailCopy(params: {
  name?: string | null;
  companyName?: string | null;
  /** Caducidad del carnet que tiene, si se le pide el renovado. */
  renewalOf?: string | null;
}): LicenseEmailCopy {
  const company = String(params.companyName || '').trim() || 'Tu empresa';
  const renewalOf = String(params.renewalOf || '').trim();
  return {
    subject: renewalOf ? `${company} te pide tu carnet fitosanitario renovado` : `${company} te pide tu carnet fitosanitario`,
    heading: greeting(params.name),
    intro: renewalOf
      ? `Tu carnet fitosanitario caduca el ${renewalOf}. ${company} te pide el renovado para seguir asignándote tratamientos. Súbelo desde tu móvil: es una foto o un PDF.`
      : `${company} necesita tu carnet fitosanitario para poder asignarte tratamientos. Súbelo desde tu móvil: es una foto o un PDF y tardas un minuto.`,
    pairs: [
      ['1', 'Entra en «Mi trabajo» → «Perfil».'],
      ['2', 'Pulsa «Hacer foto» o elige el archivo.'],
      ['3', 'Lo revisamos y te avisamos.'],
    ],
    ctaLabel: 'Subir mi carnet',
    ctaPath: licensePathFor('employee'),
    footerNote: `Si no vas a hacer tratamientos fitosanitarios, no hace falta: díselo a ${company}.`,
  };
}
