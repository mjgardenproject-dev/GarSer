// Encuesta de alta de empresas (GarSer Empresas, D2 + D7).
//
// Este fichero es el ÚNICO sitio donde se deciden las preguntas: la pantalla y el panel de
// admin se generan a partir de aquí. Los datos que necesita la aprobación van en columnas de
// `company_applications`; el resto de respuestas en `answers` (jsonb), así que cambiar,
// añadir o quitar preguntas de ese bloque no exige tocar la base de datos.
//
// D7 está en BORRADOR (docs/garser-empresas/01-PLAN-Y-PROGRESO.md, «D7 — Borrador»): el
// usuario puede ajustarlo aquí.

export const COMPANY_SERVICE_OPTIONS = [
  'Corte de césped',
  'Poda de setos',
  'Poda de árboles',
  'Poda de palmeras',
  'Poda de plantas y arbustos',
  'Desbroce de malas hierbas',
  'Servicios fitosanitarios',
] as const;

export const TEAM_SIZE_OPTIONS = [
  { value: '1', label: '1 persona' },
  { value: '2-5', label: '2 a 5' },
  { value: '6-10', label: '6 a 10' },
  { value: '11-20', label: '11 a 20' },
  { value: '20+', label: 'Más de 20' },
] as const;

export interface CompanyApplicationAnswers {
  founded_year?: string;
  website?: string;
  team_size?: string;
  vehicles?: string;
  has_phyto_workers?: 'si' | 'no';
  has_liability_insurance?: boolean;
  insurer?: string;
  own_machinery?: string;
  description?: string;
  /** Si ya se contestó «¿el titular trabaja?»: la columna owner_works no distingue «no» de «sin contestar». */
  owner_works_answered?: boolean;
}

export interface CompanyApplicationDraft {
  commercial_name: string;
  legal_name: string;
  tax_id: string;
  contact_name: string;
  phone: string;
  address: string;
  city_zone: string;
  services: string[];
  owner_works: boolean | null;
  accept_terms: boolean;
  declaration_truth: boolean;
  answers: CompanyApplicationAnswers;
}

export const EMPTY_COMPANY_APPLICATION: CompanyApplicationDraft = {
  commercial_name: '',
  legal_name: '',
  tax_id: '',
  contact_name: '',
  phone: '',
  address: '',
  city_zone: '',
  services: [],
  owner_works: null,
  accept_terms: false,
  declaration_truth: false,
  answers: {},
};

export const COMPANY_APPLICATION_STEPS = [
  { id: 'empresa', title: 'Tu empresa' },
  { id: 'contacto', title: 'Contacto y zona' },
  { id: 'equipo', title: 'Tu equipo' },
  { id: 'servicios', title: 'Servicios' },
  { id: 'garantias', title: 'Garantías y compromisos' },
] as const;

export type CompanyApplicationStepId = (typeof COMPANY_APPLICATION_STEPS)[number]['id'];

// Mismo criterio que el alta de jardinero (GardenerApplicationWizard): 9 dígitos que empiezan
// por 6, 7, 8 o 9, con +34 opcional.
export const isValidSpanishPhone = (value: string) => /^(\+34)?[6789]\d{8}$/.test(value.replace(/[\s-]/g, ''));

// CIF de sociedad, o NIF/NIE si la «empresa» es un autónomo con trabajadores. Solo el formato:
// la comprobación real la hace el admin al revisar.
export const isValidSpanishTaxId = (value: string) => {
  const v = value.replace(/[\s-]/g, '').toUpperCase();
  return /^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(v) || /^\d{8}[A-Z]$/.test(v) || /^[XYZ]\d{7}[A-Z]$/.test(v);
};

const blank = (value: string | undefined | null) => !value || value.trim().length === 0;

/**
 * Qué falta en un paso, en palabras para el usuario. Vacío = el paso está completo.
 * Los obligatorios de columnas coinciden con los que exige `submit_company_application` en el
 * servidor; los de `answers` (equipo, seguro) solo los exige la pantalla.
 */
export function missingInStep(step: CompanyApplicationStepId, draft: CompanyApplicationDraft): string[] {
  const missing: string[] = [];
  if (step === 'empresa') {
    if (blank(draft.commercial_name)) missing.push('el nombre comercial');
    if (blank(draft.legal_name)) missing.push('la razón social');
    if (blank(draft.tax_id)) missing.push('el CIF');
    else if (!isValidSpanishTaxId(draft.tax_id)) missing.push('un CIF, NIF o NIE con formato válido');
  }
  if (step === 'contacto') {
    if (blank(draft.contact_name)) missing.push('la persona de contacto');
    if (blank(draft.phone)) missing.push('el teléfono');
    else if (!isValidSpanishPhone(draft.phone)) missing.push('un teléfono válido (9 dígitos, +34 opcional)');
    if (blank(draft.address)) missing.push('la dirección');
    if (blank(draft.city_zone)) missing.push('la zona donde trabajáis');
  }
  if (step === 'equipo') {
    if (blank(draft.answers.team_size)) missing.push('cuántas personas sois');
    if (draft.owner_works === null) missing.push('si el titular trabaja en los servicios');
  }
  if (step === 'servicios') {
    if (draft.services.length === 0) missing.push('al menos un servicio');
  }
  if (step === 'garantias') {
    if (draft.answers.has_liability_insurance === undefined) missing.push('si tenéis seguro de responsabilidad civil');
    if (!draft.accept_terms) missing.push('aceptar las condiciones');
    if (!draft.declaration_truth) missing.push('declarar que los datos son ciertos');
  }
  return missing;
}

export const missingInApplication = (draft: CompanyApplicationDraft) =>
  COMPANY_APPLICATION_STEPS.flatMap((s) => missingInStep(s.id, draft));

/** Fila para `company_applications`: solo las columnas que la empresa tiene permiso a escribir. */
export function toApplicationRow(draft: CompanyApplicationDraft) {
  const trim = (s: string) => s.trim();
  return {
    commercial_name: trim(draft.commercial_name),
    legal_name: trim(draft.legal_name),
    tax_id: draft.tax_id.replace(/[\s-]/g, '').toUpperCase(),
    contact_name: trim(draft.contact_name),
    phone: trim(draft.phone),
    address: trim(draft.address),
    city_zone: trim(draft.city_zone),
    services: draft.services,
    owner_works: draft.owner_works === true,
    accept_terms: draft.accept_terms,
    declaration_truth: draft.declaration_truth,
    answers: { ...draft.answers, owner_works_answered: draft.owner_works !== null },
  };
}

/** Lo contrario: de la fila guardada al borrador de la pantalla (para retomar o corregir). */
export function fromApplicationRow(row: Partial<Record<string, unknown>> | null | undefined): CompanyApplicationDraft {
  if (!row) return { ...EMPTY_COMPANY_APPLICATION, answers: {} };
  const s = (k: string) => (typeof row[k] === 'string' ? (row[k] as string) : '');
  return {
    commercial_name: s('commercial_name'),
    legal_name: s('legal_name'),
    tax_id: s('tax_id'),
    contact_name: s('contact_name'),
    phone: s('phone'),
    address: s('address'),
    city_zone: s('city_zone'),
    services: Array.isArray(row.services) ? (row.services as string[]) : [],
    owner_works: (row.answers as CompanyApplicationAnswers | undefined)?.owner_works_answered ? Boolean(row.owner_works) : null,
    accept_terms: Boolean(row.accept_terms),
    declaration_truth: Boolean(row.declaration_truth),
    answers: (row.answers && typeof row.answers === 'object' ? row.answers : {}) as CompanyApplicationAnswers,
  };
}

/** Respuestas de `answers` en lenguaje humano, para el panel de revisión del admin. */
export function describeAnswers(answers: CompanyApplicationAnswers): Array<{ label: string; value: string }> {
  const yesNo = (v: boolean | undefined) => (v === undefined ? '—' : v ? 'Sí' : 'No');
  const teamLabel = TEAM_SIZE_OPTIONS.find((o) => o.value === answers.team_size)?.label ?? '—';
  return [
    { label: 'Año de inicio', value: answers.founded_year || '—' },
    { label: 'Web o redes', value: answers.website || '—' },
    { label: 'Personas en el equipo', value: teamLabel },
    { label: 'Vehículos', value: answers.vehicles || '—' },
    { label: 'Trabajadores con carnet fitosanitario', value: answers.has_phyto_workers === 'si' ? 'Sí' : answers.has_phyto_workers === 'no' ? 'No' : '—' },
    { label: 'Seguro de responsabilidad civil', value: yesNo(answers.has_liability_insurance) },
    { label: 'Aseguradora', value: answers.insurer || '—' },
    { label: 'Maquinaria propia', value: answers.own_machinery || '—' },
    { label: 'Sobre la empresa', value: answers.description || '—' },
  ];
}
