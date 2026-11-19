import type { ActivationServiceName } from './serviceCatalog';

// Recorrido del cuestionario «Activa tu cuenta» (2026-11-11) y dónde se quedó cada profesional.
//
// Lo que responde se guarda en sus tablas de siempre al pulsar «Siguiente». Aquí solo se recuerda EN QUÉ
// PASO va (este navegador) y qué servicios marcó, para retomarlo donde lo dejó. «Seguir luego» lo pausa en
// esta sesión del navegador: el panel deja de abrirlo solo hasta la próxima vez que entre (decisión D2).

export type ActivationStepId =
  | 'welcome'
  | 'zone'
  | 'services'
  | `service:${ActivationServiceName}`
  | 'schedule'
  | 'team'
  | 'finish';

export interface ActivationProgress {
  step: ActivationStepId;
  /** Servicios marcados en «¿Qué servicios hace tu empresa?», en el orden de la pantalla. */
  selectedServices: ActivationServiceName[];
  /** Respuestas de tarifas a medio contestar, por servicio (lo guardado va a su tabla al terminarlo). */
  serviceAnswers?: Partial<Record<ActivationServiceName, Record<string, number | string | boolean | null>>>;
  /** Pregunta en la que va dentro del servicio actual. */
  questionIndex?: number;
}

/** Los 4 bloques que se cuentan en «Paso X de 4». */
export const ACTIVATION_BLOCKS = [
  { id: 'zone', label: 'Tu zona' },
  { id: 'services', label: 'Servicios y tarifas' },
  { id: 'schedule', label: 'Horario' },
  { id: 'team', label: 'Equipo' },
] as const;

export function stepSequence(selected: readonly ActivationServiceName[]): ActivationStepId[] {
  return [
    'welcome',
    'zone',
    'services',
    ...selected.map((name) => `service:${name}` as ActivationStepId),
    'schedule',
    'team',
    'finish',
  ];
}

/** 1-4 según el bloque; null en la bienvenida y en el final. */
export function blockNumber(step: ActivationStepId): number | null {
  if (step === 'zone') return 1;
  if (step === 'services' || step.startsWith('service:')) return 2;
  if (step === 'schedule') return 3;
  if (step === 'team') return 4;
  return null;
}

/** Avance 0-100 según la posición en el recorrido completo (los servicios elegidos cuentan). */
export function progressPercent(step: ActivationStepId, selected: readonly ActivationServiceName[]): number {
  const seq = stepSequence(selected);
  const index = seq.indexOf(step);
  if (index < 0) return 0;
  return Math.round((index / (seq.length - 1)) * 100);
}

export function nextStep(step: ActivationStepId, selected: readonly ActivationServiceName[]): ActivationStepId {
  const seq = stepSequence(selected);
  const index = seq.indexOf(step);
  return index < 0 ? 'welcome' : seq[Math.min(index + 1, seq.length - 1)];
}

export function previousStep(step: ActivationStepId, selected: readonly ActivationServiceName[]): ActivationStepId {
  const seq = stepSequence(selected);
  const index = seq.indexOf(step);
  return index <= 0 ? 'welcome' : seq[index - 1];
}

/** «Unos N minutos»: 4 de zona, horario y equipo + 2 por servicio (mínimo 6). */
export function estimatedMinutes(serviceCount: number): number {
  return Math.max(6, 4 + 2 * Math.max(0, serviceCount));
}

// ── Guardar dónde se quedó ─────────────────────────────────────────────────────────────────────────

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const progressKey = (userId: string) => `garser:activation:${userId}`;
export const ACTIVATION_PAUSE_KEY = 'garser:activation:paused';

const isStep = (value: unknown, selected: readonly ActivationServiceName[]): value is ActivationStepId =>
  typeof value === 'string' && stepSequence(selected).includes(value as ActivationStepId);

export function readActivationProgress(
  userId: string,
  isKnownService: (name: string) => name is ActivationServiceName,
  storage: KV | null = safeLocalStorage(),
): ActivationProgress | null {
  if (!storage) return null;
  try {
    const raw = JSON.parse(storage.getItem(progressKey(userId)) || 'null') as Partial<ActivationProgress> | null;
    if (!raw || typeof raw !== 'object') return null;
    const selected = Array.isArray(raw.selectedServices) ? raw.selectedServices.filter(isKnownService) : [];
    if (!isStep(raw.step, selected)) return null;
    const progress: ActivationProgress = { step: raw.step, selectedServices: selected };
    if (raw.serviceAnswers && typeof raw.serviceAnswers === 'object') {
      const answers: NonNullable<ActivationProgress['serviceAnswers']> = {};
      for (const [name, value] of Object.entries(raw.serviceAnswers)) {
        if (isKnownService(name) && value && typeof value === 'object') answers[name] = value as Record<string, number | string | boolean | null>;
      }
      progress.serviceAnswers = answers;
    }
    if (typeof raw.questionIndex === 'number' && Number.isInteger(raw.questionIndex) && raw.questionIndex >= 0) {
      progress.questionIndex = raw.questionIndex;
    }
    return progress;
  } catch {
    return null;
  }
}

export function writeActivationProgress(userId: string, progress: ActivationProgress, storage: KV | null = safeLocalStorage()): void {
  try {
    storage?.setItem(progressKey(userId), JSON.stringify(progress));
  } catch {
    // Sin almacenamiento (navegación privada): se retoma desde el principio, con lo ya guardado contestado.
  }
}

export function clearActivationProgress(userId: string, storage: KV | null = safeLocalStorage()): void {
  try {
    storage?.removeItem(progressKey(userId));
  } catch {
    /* nada que borrar */
  }
}

// ── Terminado ───────────────────────────────────────────────────────────────────────────────────
//
// QA-196 / QA-108: un profesional que activó su cuenta pero tiene un paso obligatorio pendiente que NO
// depende del cuestionario (el carnet, que lo aprueba GarSer) volvía a la Bienvenida en cada inicio de
// sesión, y «Ir a mi panel» le devolvía al cuestionario. Terminarlo se recuerda aquí (este navegador, al
// instante) y en el servidor (`activation_step = 'done'`, para otros dispositivos).

const doneKey = (userId: string) => `garser:activation:done:${userId}`;

export function markActivationDone(userId: string, storage: KV | null = safeLocalStorage()): void {
  try {
    storage?.setItem(doneKey(userId), '1');
  } catch {
    /* sin almacenamiento: queda lo que anota el servidor */
  }
}

export function isActivationDoneLocally(userId: string, storage: KV | null = safeLocalStorage()): boolean {
  try {
    return storage?.getItem(doneKey(userId)) === '1';
  } catch {
    return false;
  }
}

// ── Borrador de las invitaciones (paso «Equipo») ────────────────────────────────────────────────────
//
// QA-026: recargar la página (cambio de app, tirar para recargar) vaciaba los correos, nombres, servicios y
// horarios ya escritos. Se guarda en este navegador hasta terminar el cuestionario.

export interface TeamDraft {
  /** Cuándo se guardó (ms). Pasados 14 días se olvida: son correos de otras personas. */
  at?: number;
  team: {
    answer: 'no' | 'yes' | null;
    emails: string[];
    presets: Array<unknown | null>;
    declared: boolean;
  };
  sent: Array<{ invitationId: string; email: string; url: string; emailed: boolean }>;
}

const teamDraftKey = (userId: string) => `garser:activation:team:${userId}`;
const TEAM_DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export function readTeamDraft(userId: string, storage: KV | null = safeLocalStorage(), now: number = Date.now()): TeamDraft | null {
  if (!storage) return null;
  try {
    const raw = JSON.parse(storage.getItem(teamDraftKey(userId)) || 'null') as Partial<TeamDraft> | null;
    const team = raw?.team;
    if (!team || typeof team !== 'object') return null;
    if (typeof raw?.at === 'number' && now - raw.at > TEAM_DRAFT_MAX_AGE_MS) return null;
    if (!Array.isArray(team.emails) || !team.emails.every((e) => typeof e === 'string')) return null;
    if (!Array.isArray(team.presets) || team.presets.length !== team.emails.length) return null;
    const answer = team.answer === 'yes' || team.answer === 'no' ? team.answer : null;
    const sent = Array.isArray(raw?.sent)
      ? raw!.sent.filter(
          (s): s is TeamDraft['sent'][number] =>
            Boolean(s) && typeof s.invitationId === 'string' && typeof s.email === 'string' && typeof s.url === 'string',
        ).map((s) => ({ ...s, emailed: Boolean(s.emailed) }))
      : [];
    return { team: { answer, emails: team.emails, presets: team.presets, declared: team.declared === true }, sent };
  } catch {
    return null;
  }
}

export function writeTeamDraft(userId: string, draft: TeamDraft, storage: KV | null = safeLocalStorage()): void {
  try {
    storage?.setItem(teamDraftKey(userId), JSON.stringify({ ...draft, at: Date.now() }));
  } catch {
    /* sin almacenamiento: se rellena otra vez, como antes */
  }
}

export function clearTeamDraft(userId: string, storage: KV | null = safeLocalStorage()): void {
  try {
    storage?.removeItem(teamDraftKey(userId));
  } catch {
    /* nada que borrar */
  }
}

/** «Seguir luego»: el panel no lo vuelve a abrir solo en esta sesión del navegador. */
export function pauseActivation(storage: KV | null = safeSessionStorage()): void {
  try {
    storage?.setItem(ACTIVATION_PAUSE_KEY, '1');
  } catch {
    /* sin almacenamiento: volverá a abrirse, que es lo seguro */
  }
}

export function isActivationPaused(storage: KV | null = safeSessionStorage()): boolean {
  try {
    return storage?.getItem(ACTIVATION_PAUSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function resumeActivation(storage: KV | null = safeSessionStorage()): void {
  try {
    storage?.removeItem(ACTIVATION_PAUSE_KEY);
  } catch {
    /* nada */
  }
}

function safeLocalStorage(): KV | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function safeSessionStorage(): KV | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/** El paso que se anota en el servidor para «Admin → Profesionales» (los servicios cuentan como uno). */
export type RecordedActivationStep = 'welcome' | 'zone' | 'services' | 'service' | 'schedule' | 'team' | 'finish' | 'done';
export const recordedStep = (step: ActivationStepId): RecordedActivationStep =>
  step.startsWith('service:') ? 'service' : (step as RecordedActivationStep);

/** Cómo lo lee el administrador. */
export const ACTIVATION_STEP_LABEL: Record<RecordedActivationStep, string> = {
  welcome: 'lo ha abierto',
  zone: 'en su zona',
  services: 'eligiendo servicios',
  service: 'poniendo sus tarifas',
  schedule: 'en el horario',
  team: 'en el equipo',
  finish: 'en el último paso',
  done: 'terminado',
};
