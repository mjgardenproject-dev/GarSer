import type {
  HedgePricingConfig,
  LawnPricingConfig,
  ShrubPricingConfig,
  WeedingPricingConfig,
} from '../types';
import { isHedgeConfigValid, isLawnConfigValid, isShrubConfigValid, isWeedingConfigValid } from '../utils/serviceValidation';
import { buildAuthoritativeBookingQuote, type SerializableBookingData } from '../shared/bookingQuoteCore';
import type { ActivationServiceName } from './serviceCatalog';
import { PERCENT_CHIPS, SUGGESTED } from './suggestedValues';

// Preguntas de tarifas del cuestionario «Activa tu cuenta», servicio a servicio (2026-11-11).
//
// Cada servicio dice: qué se pregunta (en lenguaje del oficio), cómo pasan las respuestas a SU
// configuración (el MISMO JSON que guarda el configurador de «Mi perfil → Servicios», en
// `gardener_service_prices.additional_config`), con qué validador se da por completa y qué ejemplos de
// presupuesto se calculan con el MOTOR REAL (bookingQuoteCore) para enseñárselos.
//
// Reglas del motor que se respetan (skill garser-pricing-rules): rendimientos siempre obligatorios; el % de
// estado/dificultad sube a la vez tiempo y precio; el mínimo va al total y debe ser > 0 para que el
// configurador lo dé por bueno.

export type Answer = number | string | boolean | null;
export type Answers = Record<string, Answer>;

export interface ChoiceOption {
  value: string;
  label: string;
  detail?: string;
}

interface BaseQuestion {
  id: string;
  title: string | ((answers: Answers) => string);
  /** Una línea debajo del título (ejemplo, aclaración). */
  help?: string | ((answers: Answers) => string);
  /** «Por qué te lo preguntamos», en las preguntas raras (rendimientos). */
  why?: string | ((answers: Answers) => string);
  when?: (answers: Answers) => boolean;
}

export interface ChoiceQuestion extends BaseQuestion {
  kind: 'choice';
  options: ChoiceOption[];
}

export interface NumberQuestion extends BaseQuestion {
  kind: 'number';
  unit: string;
  /** Botones con los valores habituales (D1): el profesional toca uno o escribe el suyo. */
  suggestions: readonly number[];
  /** El valor más bajo que se acepta (incluido). Por defecto, mayor que 0. */
  min?: number;
  max?: number;
  /** Admite decimales (precios por m² o por metro). */
  decimals?: boolean;
  /** 0 es una respuesta válida (recargos). */
  allowZero?: boolean;
}

/** Un número dentro de una pantalla con varios (p. ej. «hasta 2 m» y «de 2 a 4 m»). */
export interface NumberField {
  id: string;
  label: string;
  unit: string;
  suggestions: readonly number[];
  min?: number;
  max?: number;
  decimals?: boolean;
  allowZero?: boolean;
  when?: (answers: Answers) => boolean;
}

/** Varios números relacionados en UNA pantalla: menos pantallas, misma información. */
export interface MultiNumberQuestion extends BaseQuestion {
  kind: 'multi';
  fields: NumberField[];
}

export type Question = ChoiceQuestion | NumberQuestion | MultiNumberQuestion;

export interface QuoteExample {
  label: string;
  bookingData: SerializableBookingData;
}

export interface ServiceQuestionnaire {
  service: ActivationServiceName;
  questions: Question[];
  /** Respuestas que salen de una configuración ya guardada (para no volver a preguntar desde cero). */
  fromConfig: (config: unknown) => Answers;
  /** Configuración completa a guardar: la anterior + lo respondido. */
  toConfig: (answers: Answers, previous: unknown) => Record<string, unknown>;
  isValid: (config: Record<string, unknown>) => boolean;
  examples: QuoteExample[];
}

// ── Utilidades ─────────────────────────────────────────────────────────────────────────────────────

const num = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};
const positive = (value: unknown): number | null => {
  const n = num(value);
  return n !== null && n > 0 ? n : null;
};
const nonNegative = (value: unknown): number | null => {
  const n = num(value);
  return n !== null && n >= 0 ? n : null;
};
const obj = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});
const n0 = (value: Answer | undefined): number => (typeof value === 'number' ? value : 0);

export const isQuestionVisible = (question: Question, answers: Answers): boolean => (question.when ? question.when(answers) : true);

export const visibleQuestions = (questionnaire: ServiceQuestionnaire, answers: Answers): Question[] =>
  questionnaire.questions.filter((q) => isQuestionVisible(q, answers));

/**
 * Cuántas preguntas tendrá el servicio, como mucho: las elecciones aún sin contestar se cuentan con la opción
 * que más preguntas abre. Así «2 de 7» no pasa a «2 de 8» al elegir; como mucho baja.
 */
export function questionCountUpperBound(questionnaire: ServiceQuestionnaire, answers: Answers): number {
  const open = visibleQuestions(questionnaire, answers).find(
    (q): q is ChoiceQuestion => q.kind === 'choice' && !isQuestionAnswered(q, answers),
  );
  if (!open) return visibleQuestions(questionnaire, answers).length;
  return Math.max(...open.options.map((option) => questionCountUpperBound(questionnaire, { ...answers, [open.id]: option.value })));
}

/** ¿Vale este número para este campo? */
export function isNumberValid(field: Pick<NumberField, 'min' | 'max' | 'allowZero'>, value: Answer | undefined): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (field.allowZero) {
    if (value < (field.min ?? 0)) return false;
  } else if (value <= 0 || (field.min !== undefined && value < field.min)) {
    return false;
  }
  return field.max === undefined || value <= field.max;
}

/** ¿Está bien contestada esta pregunta de un solo valor (elegir o un número)? */
export function isAnswered(question: ChoiceQuestion | NumberQuestion, value: Answer | undefined): boolean {
  if (question.kind === 'choice') return question.options.some((o) => o.value === value);
  return isNumberValid(question, value);
}

export const visibleFields = (question: MultiNumberQuestion, answers: Answers): NumberField[] =>
  question.fields.filter((field) => (field.when ? field.when(answers) : true));

/** ¿Está bien contestada la pantalla entera (en una de varios números, todos los que se ven)? */
export function isQuestionAnswered(question: Question, answers: Answers): boolean {
  if (question.kind === 'multi') return visibleFields(question, answers).every((field) => isNumberValid(field, answers[field.id]));
  return isAnswered(question, answers[question.id]);
}

export const textOf = (text: string | ((answers: Answers) => string) | undefined, answers: Answers): string =>
  typeof text === 'function' ? text(answers) : text ?? '';

const methodQuestion = (perQuantityLabel: string, perQuantityDetail: string): ChoiceQuestion => ({
  id: 'method',
  kind: 'choice',
  title: '¿Cómo cobras este servicio?',
  options: [
    { value: 'per_hour', label: 'Por hora', detail: 'El precio sale de las horas que tardas.' },
    { value: 'per_quantity', label: perQuantityLabel, detail: perQuantityDetail },
  ],
});

const isPerHour = (a: Answers) => a.method === 'per_hour';
const isPerQuantity = (a: Answers) => a.method === 'per_quantity';

const hourlyQuestion = (suggestions: readonly number[]): NumberQuestion => ({
  id: 'hourly',
  kind: 'number',
  title: '¿Cuánto cobras la hora?',
  unit: '€/h',
  suggestions,
  max: 500,
  decimals: true,
  when: isPerHour,
});

const WHY_YIELD = (a: Answers) =>
  isPerHour(a)
    ? 'Lo usamos para calcular cuánto dura cada trabajo (y su precio, porque cobras por hora) y no llenarte la agenda de más.'
    : 'Lo usamos para calcular cuánto dura cada trabajo y reservarte ese tiempo en la agenda, ni más ni menos.';

const percentQuestion = (id: string, title: string, help: string | undefined, suggestions: readonly number[] = PERCENT_CHIPS): NumberQuestion => ({
  id,
  kind: 'number',
  title,
  help,
  unit: '%',
  suggestions,
  allowZero: true,
  max: 300,
});

const STATE_HELP = 'Ese % sube a la vez el tiempo que te reservamos y el precio. Ejemplo: con un 20 %, 1 h pasa a 1 h 12 min y 40 € a 48 €.';

const percentField = (id: string, label: string, suggestions: readonly number[] = PERCENT_CHIPS): NumberField => ({
  id, label, unit: '%', suggestions, allowZero: true, max: 300,
});

/** Los dos recargos de estado/dificultad en una sola pantalla. */
const statesQuestion = (title: string, low: NumberField, high: NumberField): MultiNumberQuestion => ({
  id: 'states', kind: 'multi', title, help: STATE_HELP, fields: [low, high],
});
const WASTE_HELP = 'Pon 0 % si te los llevas sin coste extra.';

const minimumQuestion = (suggestions: readonly number[]): NumberQuestion => ({
  id: 'minimum',
  kind: 'number',
  title: '¿Cuál es lo mínimo que cobras por un trabajo?',
  help: 'Si un trabajo sale por menos, se cobra este mínimo (cubre el desplazamiento).',
  unit: '€',
  suggestions,
  min: 1,
  max: 2000,
});

// ── Corte de césped ────────────────────────────────────────────────────────────────────────────────

const lawn: ServiceQuestionnaire = {
  service: 'Corte de césped',
  questions: [
    methodQuestion('Por m²', 'Un precio por cada metro cuadrado de césped.'),
    hourlyQuestion(SUGGESTED.lawn.hourly),
    {
      id: 'perM2', kind: 'number', title: '¿Cuánto cobras el m² de césped?', help: 'Por ejemplo, 0,18 € el m².',
      unit: '€/m²', suggestions: SUGGESTED.lawn.perM2, decimals: true, max: 20, when: isPerQuantity,
    },
    {
      id: 'yield', kind: 'number', title: '¿Cuántos m² cortas en una hora, más o menos?', why: WHY_YIELD,
      unit: 'm²/h', suggestions: SUGGESTED.lawn.yieldM2PerHour, max: 5000,
    },
    statesQuestion(
      'Si el césped está descuidado, ¿cuánto más supone?',
      percentField('descuidado', 'Descuidado (hierba alta, semanas sin cortar)', SUGGESTED.lawn.descuidado),
      percentField('muyDescuidado', 'Muy descuidado (muy alto, con matojos)', SUGGESTED.lawn.muyDescuidado),
    ),
    percentQuestion('waste', 'Si el cliente quiere que te lleves los restos, ¿cuánto más cobras?', WASTE_HELP, SUGGESTED.lawn.waste),
    minimumQuestion(SUGGESTED.lawn.minimum),
  ],
  fromConfig: (raw) => {
    const c = obj(raw);
    const method = c.pricing_method === 'per_hour' ? 'per_hour' : c.pricing_method === 'per_quantity' ? 'per_quantity' : null;
    return {
      method,
      hourly: positive(c.precioPorHora ?? c.hourly_rate),
      perM2: positive(c.price_per_m2),
      yield: positive(c.yield_m2_per_hour),
      descuidado: nonNegative(obj(c.condition_surcharges).descuidado),
      muyDescuidado: nonNegative(obj(c.condition_surcharges).muy_descuidado),
      waste: nonNegative(obj(c.waste_removal).percentage),
      minimum: positive(c.minimum_price),
    };
  },
  toConfig: (a, previous) => {
    const prev = obj(previous) as Partial<LawnPricingConfig>;
    const perHour = isPerHour(a);
    const config: LawnPricingConfig = {
      ...prev,
      pricing_method: perHour ? 'per_hour' : 'per_quantity',
      price_per_m2: perHour ? Number(prev.price_per_m2 ?? 0) : n0(a.perM2),
      precioPorHora: perHour ? n0(a.hourly) : prev.precioPorHora,
      yield_m2_per_hour: n0(a.yield),
      condition_surcharges: { descuidado: n0(a.descuidado), muy_descuidado: n0(a.muyDescuidado) },
      waste_removal: { percentage: n0(a.waste) },
      minimum_price: n0(a.minimum),
    };
    if (perHour && prev.hourly_rate !== undefined) config.hourly_rate = n0(a.hourly);
    return config as unknown as Record<string, unknown>;
  },
  isValid: (c) => isLawnConfigValid(c as unknown as LawnPricingConfig),
  examples: [
    { label: 'Césped de 400 m² en buen estado', bookingData: { lawnZones: [{ quantity: 400, state: 'normal' }], wasteRemoval: false } },
    { label: 'El mismo, descuidado', bookingData: { lawnZones: [{ quantity: 400, state: 'descuidado' }], wasteRemoval: false } },
    { label: 'En buen estado y llevándote los restos', bookingData: { lawnZones: [{ quantity: 400, state: 'normal' }], wasteRemoval: true } },
  ],
};

// ── Poda de setos ──────────────────────────────────────────────────────────────────────────────────

const wantsHigh = (a: Answers) => a.high === 'yes';

const hedge: ServiceQuestionnaire = {
  service: 'Poda de setos',
  questions: [
    methodQuestion('Por metro de seto', 'Un precio por cada metro de seto, según lo alto que sea.'),
    hourlyQuestion(SUGGESTED.hedge.hourly),
    {
      id: 'prices', kind: 'multi', title: '¿Cuánto cobras el metro de seto?', help: 'Por una cara. Si el cliente pide las dos, se cuenta el doble.',
      when: isPerQuantity,
      fields: [
        { id: 'priceLow', label: 'Hasta 2 m de alto', unit: '€/m', suggestions: SUGGESTED.hedge.perMeterLow, decimals: true, max: 200 },
        { id: 'priceMid', label: 'De 2 a 4 m de alto', unit: '€/m', suggestions: SUGGESTED.hedge.perMeterMid, decimals: true, max: 200 },
      ],
    },
    {
      id: 'yields', kind: 'multi', title: '¿Cuántos metros de seto cortas en una hora?', help: 'Por una cara.', why: WHY_YIELD,
      fields: [
        { id: 'yieldLow', label: 'Hasta 2 m de alto', unit: 'm/h', suggestions: SUGGESTED.hedge.yieldLow, max: 1000 },
        { id: 'yieldMid', label: 'De 2 a 4 m de alto', unit: 'm/h', suggestions: SUGGESTED.hedge.yieldMid, max: 1000 },
      ],
    },
    {
      id: 'high', kind: 'choice', title: '¿Cortas setos de más de 4 m de alto?',
      options: [
        { value: 'yes', label: 'Sí', detail: 'Te preguntamos su precio y cuánto tardas.' },
        { value: 'no', label: 'No', detail: 'No te llegarán esos trabajos; el resto, sí.' },
      ],
    },
    {
      id: 'highBand', kind: 'multi', title: 'Setos de más de 4 m de alto', help: 'Por una cara.', why: WHY_YIELD, when: wantsHigh,
      fields: [
        { id: 'priceHigh', label: 'Precio por metro', unit: '€/m', suggestions: SUGGESTED.hedge.perMeterHigh, decimals: true, max: 300, when: isPerQuantity },
        { id: 'yieldHigh', label: 'Metros que cortas en una hora', unit: 'm/h', suggestions: SUGGESTED.hedge.yieldHigh, max: 1000 },
      ],
    },
    statesQuestion(
      'Si el seto es difícil, ¿cuánto más supone?',
      percentField('media', 'Algo difícil (muy crecido, ramas gruesas)', SUGGESTED.hedge.media),
      percentField('alta', 'Muy difícil (abandonado, acceso complicado)', SUGGESTED.hedge.alta),
    ),
    percentQuestion('waste', 'Si el cliente quiere que te lleves los restos, ¿cuánto más cobras?', WASTE_HELP, SUGGESTED.hedge.waste),
    minimumQuestion(SUGGESTED.hedge.minimum),
  ],
  fromConfig: (raw) => {
    const c = obj(raw);
    const matrix = obj(c.pricing_matrix);
    const yields = obj(c.yield_ml_per_hour);
    const method = c.pricing_method === 'per_hour' ? 'per_hour' : c.pricing_method === 'per_quantity' ? 'per_quantity' : null;
    return {
      method,
      hourly: positive(c.precioPorHora ?? c.hourly_rate),
      priceLow: positive(matrix['0-2m']),
      priceMid: positive(matrix['2-4m']),
      priceHigh: positive(matrix['4-6m']),
      yieldLow: positive(yields['0-2m']),
      yieldMid: positive(yields['2-4m']),
      yieldHigh: positive(yields['4-6m']),
      high: c.specialist_enabled === true ? 'yes' : c.specialist_enabled === false ? 'no' : null,
      media: nonNegative(obj(c.condition_surcharges).media),
      alta: nonNegative(obj(c.condition_surcharges).alta),
      waste: nonNegative(obj(c.waste_removal).percentage),
      minimum: positive(c.minimum_price),
    };
  },
  toConfig: (a, previous) => {
    const prev = obj(previous) as Partial<HedgePricingConfig>;
    const perHour = isPerHour(a);
    const high = wantsHigh(a);
    const prevMatrix = (prev.pricing_matrix ?? {}) as Partial<Record<'0-2m' | '2-4m' | '4-6m', number>>;
    const prevYields = (prev.yield_ml_per_hour ?? {}) as Partial<Record<'0-2m' | '2-4m' | '4-6m', number>>;
    const config: HedgePricingConfig = {
      ...prev,
      pricing_method: perHour ? 'per_hour' : 'per_quantity',
      precioPorHora: perHour ? n0(a.hourly) : prev.precioPorHora,
      pricing_matrix: perHour
        ? { '0-2m': Number(prevMatrix['0-2m'] ?? 0), '2-4m': Number(prevMatrix['2-4m'] ?? 0), '4-6m': Number(prevMatrix['4-6m'] ?? 0) }
        : { '0-2m': n0(a.priceLow), '2-4m': n0(a.priceMid), '4-6m': high ? n0(a.priceHigh) : 0 },
      yield_ml_per_hour: {
        '0-2m': n0(a.yieldLow),
        '2-4m': n0(a.yieldMid),
        '4-6m': high ? n0(a.yieldHigh) : Number(prevYields['4-6m'] ?? 0),
      },
      specialist_enabled: high,
      condition_surcharges: { ...(prev.condition_surcharges ?? {}), media: n0(a.media), alta: n0(a.alta) },
      waste_removal: { percentage: n0(a.waste) },
      minimum_price: n0(a.minimum),
    };
    if (perHour && prev.hourly_rate !== undefined) config.hourly_rate = n0(a.hourly);
    return config as unknown as Record<string, unknown>;
  },
  isValid: (c) => isHedgeConfigValid(c as unknown as HedgePricingConfig),
  examples: [
    { label: '30 m de seto de hasta 2 m, una cara', bookingData: { hedgeZones: [{ type: 'seto', height: '0-2m', length: 30, state: 'normal', faces_to_trim: 1 }], wasteRemoval: false } },
    { label: '30 m de seto de 2 a 4 m, una cara', bookingData: { hedgeZones: [{ type: 'seto', height: '2-4m', length: 30, state: 'normal', faces_to_trim: 1 }], wasteRemoval: false } },
    { label: '30 m de hasta 2 m, algo difícil y con restos', bookingData: { hedgeZones: [{ type: 'seto', height: '0-2m', length: 30, state: 'media', faces_to_trim: 1 }], wasteRemoval: true } },
  ],
};

// ── Poda de plantas y arbustos ─────────────────────────────────────────────────────────────────────

const SIZE_HELP = {
  small: 'Pequeños (por debajo de la rodilla)',
  medium: 'Medianos (hasta el pecho)',
  large: 'Grandes (más altos que una persona)',
};

const shrub: ServiceQuestionnaire = {
  service: 'Poda de plantas y arbustos',
  questions: [
    methodQuestion('Por m²', 'Un precio por m² de arbustos, según su tamaño.'),
    hourlyQuestion(SUGGESTED.shrub.hourly),
    {
      id: 'prices', kind: 'multi', title: '¿Cuánto cobras el m² de arbustos?', help: 'Según su tamaño.', when: isPerQuantity,
      fields: [
        { id: 'priceSmall', label: SIZE_HELP.small, unit: '€/m²', suggestions: SUGGESTED.shrub.perM2Small, decimals: true, max: 200 },
        { id: 'priceMedium', label: SIZE_HELP.medium, unit: '€/m²', suggestions: SUGGESTED.shrub.perM2Medium, decimals: true, max: 200 },
        { id: 'priceLarge', label: SIZE_HELP.large, unit: '€/m²', suggestions: SUGGESTED.shrub.perM2Large, decimals: true, max: 200 },
      ],
    },
    {
      id: 'yields', kind: 'multi', title: '¿Cuántos m² de arbustos podas en una hora?', why: WHY_YIELD,
      fields: [
        { id: 'yieldSmall', label: SIZE_HELP.small, unit: 'm²/h', suggestions: SUGGESTED.shrub.yieldSmall, max: 500 },
        { id: 'yieldMedium', label: SIZE_HELP.medium, unit: 'm²/h', suggestions: SUGGESTED.shrub.yieldMedium, max: 500 },
        { id: 'yieldLarge', label: SIZE_HELP.large, unit: 'm²/h', suggestions: SUGGESTED.shrub.yieldLarge, max: 500 },
      ],
    },
    statesQuestion(
      'Si los arbustos están descuidados, ¿cuánto más supone?',
      percentField('descuidado', 'Descuidados', SUGGESTED.shrub.descuidado),
      percentField('muyDescuidado', 'Muy descuidados', SUGGESTED.shrub.muyDescuidado),
    ),
    percentQuestion('waste', 'Si el cliente quiere que te lleves los restos, ¿cuánto más cobras?', WASTE_HELP, SUGGESTED.shrub.waste),
    minimumQuestion(SUGGESTED.shrub.minimum),
  ],
  fromConfig: (raw) => {
    const c = obj(raw);
    const prices = obj(c.prices_per_m2);
    const yields = obj(c.yield_m2_per_hour);
    const surcharges = obj(c.condition_surcharges);
    const method = c.pricing_method === 'per_hour' ? 'per_hour' : c.pricing_method === 'per_quantity' ? 'per_quantity' : null;
    return {
      method,
      hourly: positive(c.precioPorHora ?? c.hourly_rate),
      priceSmall: positive(prices['pequeñas']),
      priceMedium: positive(prices['medianas']),
      priceLarge: positive(prices['grandes']),
      yieldSmall: positive(yields['pequeñas']),
      yieldMedium: positive(yields['medianas']),
      yieldLarge: positive(yields['grandes']),
      // OJO (skill §10.5): en arbustos `media` es «descuidado» y `alta` es «muy descuidado».
      descuidado: nonNegative(surcharges.media),
      muyDescuidado: nonNegative(surcharges.alta),
      waste: nonNegative(obj(c.waste_removal).percentage),
      minimum: positive(c.minimum_price),
    };
  },
  toConfig: (a, previous) => {
    const prev = obj(previous) as Partial<ShrubPricingConfig>;
    const perHour = isPerHour(a);
    const prevPrices = prev.prices_per_m2 ?? { pequeñas: 0, medianas: 0, grandes: 0 };
    const config: ShrubPricingConfig = {
      ...prev,
      pricing_method: perHour ? 'per_hour' : 'per_quantity',
      precioPorHora: perHour ? n0(a.hourly) : prev.precioPorHora,
      prices_per_m2: perHour ? prevPrices : { pequeñas: n0(a.priceSmall), medianas: n0(a.priceMedium), grandes: n0(a.priceLarge) },
      yield_m2_per_hour: { pequeñas: n0(a.yieldSmall), medianas: n0(a.yieldMedium), grandes: n0(a.yieldLarge) },
      condition_surcharges: { media: n0(a.descuidado), alta: n0(a.muyDescuidado) },
      waste_removal: { percentage: n0(a.waste) },
      minimum_price: n0(a.minimum),
    };
    if (perHour && prev.hourly_rate !== undefined) config.hourly_rate = n0(a.hourly);
    return config as unknown as Record<string, unknown>;
  },
  isValid: (c) => isShrubConfigValid(c as unknown as ShrubPricingConfig),
  examples: [
    { label: '25 m² de arbustos medianos', bookingData: { shrubGroups: [{ id: 'ej1', area: 25, size: 'medianas', state: 'normal' }], wasteRemoval: false } },
    { label: 'Los mismos, descuidados', bookingData: { shrubGroups: [{ id: 'ej2', area: 25, size: 'medianas', state: 'descuidado' }], wasteRemoval: false } },
    { label: '25 m² medianos, llevándote los restos', bookingData: { shrubGroups: [{ id: 'ej3', area: 25, size: 'medianas', state: 'normal' }], wasteRemoval: true } },
  ],
};

// ── Desbroce de malas hierbas ──────────────────────────────────────────────────────────────────────

const weeding: ServiceQuestionnaire = {
  service: 'Desbroce de malas hierbas',
  questions: [
    { id: 'perM2', kind: 'number', title: '¿Cuánto cobras el m² de desbroce?', help: 'Por ejemplo, 0,35 € el m².', unit: '€/m²', suggestions: SUGGESTED.weeding.perM2, decimals: true, max: 20 },
    {
      id: 'yield', kind: 'number', title: '¿Cuántos m² desbrozas en una hora, más o menos?',
      why: 'Lo usamos para calcular cuánto dura cada trabajo y reservarte ese tiempo en la agenda, ni más ni menos.',
      unit: 'm²/h', suggestions: SUGGESTED.weeding.yieldM2PerHour, max: 5000,
    },
    statesQuestion(
      'Si el terreno es difícil, ¿cuánto más supone?',
      percentField('media', 'Algo difícil (hierba alta, pendiente)', SUGGESTED.weeding.media),
      percentField('alta', 'Muy difícil (zarzas, mucha pendiente, piedras)', SUGGESTED.weeding.alta),
    ),
    percentQuestion('waste', 'Si el cliente quiere que te lleves los restos, ¿cuánto más cobras?', WASTE_HELP, SUGGESTED.weeding.waste),
    minimumQuestion(SUGGESTED.weeding.minimum),
  ],
  fromConfig: (raw) => {
    const c = obj(raw);
    const s = obj(c.suplementos);
    return {
      perM2: positive(c.precio_desbroce_m2),
      yield: positive(c.yield_m2_per_hour),
      media: nonNegative(s.dificultad_media),
      alta: nonNegative(s.dificultad_alta),
      waste: nonNegative(s.retirada_restos),
      minimum: positive(c.importe_minimo),
    };
  },
  toConfig: (a, previous) => {
    const prev = obj(previous) as Partial<WeedingPricingConfig>;
    const config: WeedingPricingConfig = {
      ...prev,
      version: 'weeding_v1',
      precio_desbroce_m2: n0(a.perM2),
      yield_m2_per_hour: n0(a.yield),
      suplementos: { dificultad_media: n0(a.media), dificultad_alta: n0(a.alta), retirada_restos: n0(a.waste) },
      importe_minimo: n0(a.minimum),
    };
    return config as unknown as Record<string, unknown>;
  },
  isValid: (c) => isWeedingConfigValid(c as unknown as WeedingPricingConfig),
  examples: [
    { label: '400 m² de terreno normal', bookingData: { weedingZones: [{ id: 'ej1', area: 400, state: 'normal' }], wasteRemoval: false } },
    { label: 'Los mismos, muy difíciles', bookingData: { weedingZones: [{ id: 'ej2', area: 400, state: 'dificultad_alta' }], wasteRemoval: false } },
    { label: '400 m² normales, llevándote los restos', bookingData: { weedingZones: [{ id: 'ej3', area: 400, state: 'normal' }], wasteRemoval: true } },
  ],
};

export const SERVICE_QUESTIONNAIRES: Partial<Record<ActivationServiceName, ServiceQuestionnaire>> = {
  'Corte de césped': lawn,
  'Poda de setos': hedge,
  'Poda de plantas y arbustos': shrub,
  'Desbroce de malas hierbas': weeding,
};

// ── Ejemplo de presupuesto con el motor real ───────────────────────────────────────────────────────

export interface QuotePreview {
  label: string;
  price: number;
  /** Horas que bloquea en la agenda (como la elegibilidad: mínimo 1, hacia arriba). */
  agendaHours: number;
  /** El precio es el mínimo por trabajo del profesional (el cálculo daba menos). */
  isMinimum: boolean;
}

const minimumOf = (config: Record<string, unknown>): number =>
  Number(config.minimum_price ?? config.minimumPrice ?? config.importe_minimo ?? config.minimum_fee ?? 0) || 0;

/** Presupuestos de ejemplo con la configuración que va saliendo. Los que el motor no puede calcular, fuera. */
export function previewQuotes(questionnaire: ServiceQuestionnaire, config: Record<string, unknown>): QuotePreview[] {
  return questionnaire.examples.flatMap((example) => {
    try {
      const quote = buildAuthoritativeBookingQuote({ bookingData: example.bookingData, providerConfig: config });
      if (!quote.eligibility.isEligible || !(quote.totalPrice > 0)) return [];
      const minimum = minimumOf(config);
      return [{
        label: example.label,
        price: quote.totalPrice,
        agendaHours: Math.max(1, Math.ceil(quote.estimatedHours)),
        isMinimum: minimum > 0 && quote.totalPrice <= Math.ceil(minimum),
      }];
    } catch {
      return [];
    }
  });
}
