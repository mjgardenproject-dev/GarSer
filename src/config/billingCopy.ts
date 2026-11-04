import type { BillingLevel, PublicBillingTerms } from '../shared/billingTerms';

/**
 * Los textos de la web que dependen de los ajustes de comisiones.
 *
 * Regla de oro: la web nunca afirma nada sobre qué clientes pagan gastos de gestión que no sea cierto
 * ahora mismo. Por eso:
 *   · Todo texto que dependa de quién paga sale de AQUÍ, a partir de los niveles que devuelve la base
 *     de datos (`get_public_billing_terms`), y se recalcula cuando cambian los ajustes.
 *   · Si los niveles no están (todavía cargando, error de red, sin configuración), se usan textos
 *     NEUTROS que son ciertos con cualquier configuración. Jamás una promesa «por defecto».
 *   · No se citan porcentajes: se dice «sin gastos de gestión», «gastos reducidos» o «gastos de gestión».
 *   · Lo que no puede cambiar nunca (el profesional no paga nada y cobra el 100 % de su precio, porque
 *     los gastos de gestión los paga el cliente, aparte) sí es fijo y vive en `publicSiteContent.ts`.
 *   · Nada de esto se imprime ni se descarga (flyers, tarjetas, QR, mensajes para copiar): un papel no
 *     se puede corregir cuando cambian los ajustes.
 *
 * `null` = «no sabemos» y devuelve siempre el texto neutro.
 */

export type BillingTermsInput = PublicBillingTerms | null | undefined;

const PLAN_NOTE = 'Las visitas de un plan de mantenimiento sí llevan gastos de gestión.';

/** «no pagan gastos de gestión», «pagan unos gastos de gestión reducidos», «pagan gastos de gestión». */
const clientsPay = (level: BillingLevel): string => {
  if (level === 'none') return 'no pagan gastos de gestión';
  if (level === 'reduced') return 'pagan unos gastos de gestión reducidos';
  return 'pagan gastos de gestión';
};

/** Los clientes del enlace del profesional (primera reserva y siguientes) no pagan nada. */
export const ownClientsPayNothing = (terms: BillingTermsInput): boolean =>
  Boolean(terms) && terms!.linkFirst === 'none' && terms!.linkRepeat === 'none';

/** Hay algún caso de los clientes del enlace sin gastos, pero las visitas de plan sí llevan. */
const planWarning = (terms: BillingTermsInput): boolean =>
  Boolean(terms) && (terms!.linkFirst === 'none' || terms!.linkRepeat === 'none') && terms!.maintenanceVisit !== 'none';

/**
 * Una frase corta sobre los clientes del propio profesional, para el panel (asistente de alta y
 * «Marketing»). Neutra si no se sabe o si no hay nada que prometer.
 */
export function ownClientsLine(terms: BillingTermsInput): string {
  if (!terms) return 'Tus clientes reservan directamente contigo.';
  const { linkFirst: first, linkRepeat: repeat } = terms;
  if (first === 'none' && repeat === 'none') {
    return `Tus clientes reservan contigo sin gastos de gestión${planWarning(terms) ? ' (salvo en las visitas de un plan de mantenimiento)' : ''}.`;
  }
  if (first === 'none') return 'Tus clientes reservan contigo sin gastos de gestión la primera vez.';
  return 'Tus clientes reservan directamente contigo.';
}

/** La frase breve de los puntos destacados del encabezado de /para-jardineros. */
export function ownClientsHighlight(terms: BillingTermsInput): string {
  if (ownClientsPayNothing(terms) && !planWarning(terms)) return 'Tus clientes reservan sin gastos de gestión';
  if (ownClientsPayNothing(terms)) return 'Tus clientes reservan sin gastos de gestión (salvo en planes de mantenimiento)';
  return 'Tus clientes reservan directamente contigo';
}

export interface FeeSplitRow {
  id: 'own' | 'garser';
  label: string;
  who: string;
  /** Etiqueta corta; null cuando no se sabe (no se enseña). */
  badge: string | null;
  result: string;
}

export interface FeeSplitCopy {
  title: string;
  intro: string;
  rows: FeeSplitRow[];
  /** Qué pasa cuando un cliente que trajo GarSer vuelve a reservar con el profesional; null si no hay nada que decir. */
  loyaltyNote: string | null;
}

const NEUTRAL_RESULT = 'Los gastos de gestión, si los hay, los paga el cliente, aparte. Tú cobras tu precio entero.';

function ownRow(terms: BillingTermsInput): FeeSplitRow {
  const base = { id: 'own' as const, label: 'Tus clientes', who: 'Reservan con tu enlace.' };
  if (!terms) {
    return { ...base, badge: null, result: 'Ven tu precio antes de reservar. Tú cobras tu precio entero.' };
  }
  const { linkFirst: first, linkRepeat: repeat } = terms;
  if (first === 'none' && repeat === 'none') {
    return {
      ...base,
      badge: 'Sin gastos de gestión',
      result: `Pagan tu precio y nada más.${planWarning(terms) ? ` ${PLAN_NOTE}` : ''}`,
    };
  }
  if (first === repeat) {
    return {
      ...base,
      badge: first === 'reduced' ? 'Gastos reducidos' : 'Gastos de gestión',
      result: `${first === 'reduced' ? 'Pagan unos gastos de gestión reducidos' : 'Pagan gastos de gestión'}, aparte de tu precio. Tú cobras tu precio entero.`,
    };
  }
  const second = repeat === 'none' ? 'después ya no pagan gastos de gestión' : `después ${clientsPay(repeat)}`;
  return {
    ...base,
    badge: 'Según la reserva',
    result: `En su primera reserva ${clientsPay(first)}; ${second}. Tú cobras tu precio entero.${planWarning(terms) ? ` ${PLAN_NOTE}` : ''}`,
  };
}

function garserRow(terms: BillingTermsInput): FeeSplitRow {
  const base = { id: 'garser' as const, label: 'Clientes nuevos de GarSer', who: 'Te encuentran buscando jardinero en garser.es.' };
  if (!terms) return { ...base, badge: null, result: NEUTRAL_RESULT };
  if (terms.garserFirst === 'none') {
    return { ...base, badge: 'Sin gastos de gestión', result: 'Reservan sin gastos de gestión. Tú cobras tu precio entero.' };
  }
  return {
    ...base,
    badge: 'Gastos de gestión',
    result: 'Esos gastos los paga el cliente, aparte. Tú cobras tu precio entero.',
  };
}

function loyaltyNote(terms: BillingTermsInput): string | null {
  if (!terms || terms.garserFirst === 'none') return null;
  if (terms.garserRepeat === 'none') {
    return 'Y si un cliente que te trajo GarSer vuelve a reservar contigo, deja de pagar gastos de gestión.';
  }
  if (terms.garserRepeat === 'reduced') {
    return 'Y si un cliente que te trajo GarSer vuelve a reservar contigo, paga menos gastos de gestión.';
  }
  return null;
}

/** La sección «quién paga qué» de /para-jardineros. */
export function feeSplitCopy(terms: BillingTermsInput): FeeSplitCopy {
  const ownFree = ownClientsPayNothing(terms);
  const differs = Boolean(terms) && terms!.linkFirst !== terms!.garserFirst;
  return {
    title: ownFree && !planWarning(terms)
      ? 'Para ti es gratis. Para tus clientes, sin gastos de gestión.'
      : 'Para ti es gratis. Los gastos de gestión, los paga el cliente.',
    intro: differs
      ? 'Nunca pagas nada a GarSer. Lo único que cambia es quién trae al cliente:'
      : 'Nunca pagas nada a GarSer. Los gastos de gestión, si los hay, los paga siempre el cliente, aparte de tu precio:',
    rows: [ownRow(terms), garserRow(terms)],
    loyaltyNote: loyaltyNote(terms),
  };
}

export interface BillingFaqItem {
  question: string;
  answer: string;
}

function ownClientsAnswer(terms: BillingTermsInput): string {
  if (!terms) {
    return 'Lo que pagan a GarSer, si algo, se lo mostramos antes de que reserven y va aparte de tu precio: a ti no se te descuenta nada.';
  }
  const { linkFirst: first, linkRepeat: repeat } = terms;
  if (first === 'none' && repeat === 'none') {
    return [
      'Si reservan desde tu enlace, pagan tu precio y nada más.',
      ...(planWarning(terms) ? [PLAN_NOTE] : []),
      'A ti no se te descuenta nada.',
    ].join(' ');
  }
  if (first === repeat) {
    return `${first === 'reduced' ? 'Pagan unos gastos de gestión reducidos' : 'Sí, pagan unos gastos de gestión'}, aparte de tu precio. A ti no se te descuenta nada.`;
  }
  return `Depende de la reserva: en su primera reserva ${clientsPay(first)}; después ${clientsPay(repeat)}. Va aparte de tu precio: a ti no se te descuenta nada.`;
}

function newClientsAnswer(terms: BillingTermsInput): string {
  if (!terms) {
    return 'Los gastos de gestión, si los hay, los paga el cliente, aparte, y se los mostramos antes de que reserve: a ti no se te descuenta nada.';
  }
  if (terms.garserFirst === 'none') {
    return 'Tampoco pagan gastos de gestión. Y a ti no se te descuenta nada.';
  }
  return 'Esos pagan unos gastos de gestión a GarSer al reservar. Los paga el cliente, aparte: a ti no se te descuenta nada.';
}

/** Las preguntas frecuentes de /para-jardineros (las que dependen de los ajustes se recalculan). */
export function gardenersFaqs(terms: BillingTermsInput): BillingFaqItem[] {
  return [
    {
      question: '¿Cuánto me cuesta?',
      answer: 'Nada. No hay cuota ni comisión para ti: cobras el 100 % de tu precio.',
    },
    {
      question: '¿Mis clientes pagan algo por reservar conmigo?',
      answer: ownClientsAnswer(terms),
    },
    {
      question: '¿Y los clientes nuevos que me mande GarSer?',
      answer: newClientsAnswer(terms),
    },
    {
      question: '¿Cómo me pagan mis clientes?',
      answer: 'Directamente a ti al terminar el trabajo, de la manera que acordéis. GarSer no toca tu dinero.',
    },
    {
      question: '¿Mis clientes tienen que registrarse?',
      answer: 'Solo para confirmar. Ven tu precio y tus huecos sin cuenta, y en el último paso crean una con su correo. Así siguen la reserva y hablan contigo por el chat.',
    },
    {
      question: '¿Sirve para empresas con empleados?',
      answer: 'Sí. Das de alta tu empresa, añades a tu equipo y cada empleado ve sus trabajos en su app. GarSer reparte los trabajos o eliges tú quién va.',
    },
    {
      question: '¿Necesito instalar algo?',
      answer: 'No. Funciona en el navegador del móvil o del ordenador. Si quieres, la añades a tu pantalla de inicio desde Safari o Chrome y activas los avisos en el móvil.',
    },
  ];
}

/** Los puntos destacados del encabezado de /para-jardineros: dos fijos y uno que depende de los ajustes. */
export function gardenersHighlights(terms: BillingTermsInput): string[] {
  return [
    'Gratis para ti: sin cuota ni comisión',
    ownClientsHighlight(terms),
    'Cobras el 100 % de tu precio',
  ];
}
