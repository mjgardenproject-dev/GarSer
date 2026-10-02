/**
 * Presentación de los formularios manuales (solo cliente).
 * -------------------------------------------------------------
 * `manualEntrySchema.ts` es el contrato de datos: claves, valores, rangos y defaults, y lo
 * empaquetan dos Edge Functions (`booking-authority`, `booking-manual-declaration`). Todo lo que
 * es solo cómo se enseña —qué preguntas comparten pantalla, qué control lleva cada campo, en qué
 * formato se escriben los números, plurales— vive aquí, para poder rediseñar el asistente sin
 * tocar ese archivo ni redesplegar funciones (D-01 de la ronda 2026-09-30).
 *
 * Regla: nada de lo que se declare aquí puede cambiar QUÉ se envía. Una pantalla agrupa pasos
 * del schema, pero cada paso conserva su `stepId` para la telemetría, y los campos siguen
 * guardando la misma clave con el mismo valor.
 */
import {
  getFieldOptions,
  MANUAL_ENTRY_SURVEYS,
  MANUAL_RANGES,
  type ManualAnswers,
  type ManualFieldDef,
  type ManualServiceKey,
} from '../../../../shared/manualEntry/manualEntrySchema';
import { HEDGE_BAND_LABELS, mapHedgeHeightToBand } from '../../../../domain/hedgeBusinessRules';
import { isLowestRangeThresholdForSpecies } from '../../../../domain/speciesBusinessRules';
import { PALM_SPECIES_PHOTOS } from './palmSpeciesPhotos';
import type { ManualNumberFormat } from '../../../../utils/decimalText';

export interface ManualScreenPresentation {
  /** Identificador de la pantalla (el del primer paso cuando la pantalla es un solo paso). */
  id: string;
  /** Pasos del schema que se enseñan juntos, en el orden del schema. */
  stepIds: string[];
  /**
   * Respuestas de las que depende que la pantalla aparezca. Mientras alguna esté sin contestar,
   * la pantalla cuenta en «Pregunta X de Y» aunque todavía no se vea: así el total solo puede
   * bajar a medida que se responde, nunca crecer (SISTEMA-UX §6.9).
   */
  dependsOn?: string[];
  /**
   * Título y frase de apoyo de la pantalla. Hacen falta cuando la pantalla reúne varios pasos;
   * si no se dicen, son los del primer paso del schema.
   */
  title?: string;
  description?: string;
  /** Método de medida, en el desplegable «¿Cómo lo mido?» al final de la pantalla (sin comparaciones, D-03). */
  measureHelp?: string[];
}

/** Control con el que se contesta un campo (SISTEMA-UX §6.4-6.7). */
export type ManualFieldControl = 'number' | 'stepper' | 'options' | 'segmented' | 'toggle';

export interface ManualFieldPresentation {
  /**
   * Control del campo. Si no se dice, sale del `ui` del schema: `slider` → campo numérico
   * (F3: los deslizadores de 1–5000 m² no servían con el dedo), `stepper` → stepper,
   * `cards` → lista de opciones, `toggle` → fila sí/no.
   */
  control?: ManualFieldControl;
  /** Cómo se lee lo que se escribe en un campo numérico (ver `readManualNumber`). */
  numberFormat?: ManualNumberFormat;
  /** Nombre del dato con su artículo, para los mensajes de error («la superficie de césped»). */
  errorName?: string;
  /** No enseñar la ayuda del schema cuando repite la frase de apoyo de la pantalla (T-18). */
  hideHelp?: boolean;
  /** Cómo medir el dato, en un desplegable «¿Cómo lo mido?». Solo método: sin comparaciones (D-03). */
  measureHelp?: string;
  /** Unidad que se muestra cuando depende de otras respuestas (fitosanitarios, F8). */
  unit?: (answers: ManualAnswers) => string | undefined;
  /** Línea de contexto bajo el control, calculada de la respuesta (p. ej. el tramo de tarifa del seto). */
  feedback?: (answers: ManualAnswers) => string | null | undefined;
  /** Pictograma por valor de opción (nombre del registro de `ui/Pictogram.tsx`). */
  optionPictograms?: Record<string, ManualPictogramName>;
  /** Etiqueta que se enseña por valor de opción (el `value` enviado no cambia). */
  optionLabels?: Record<string, string>;
  /** Ayuda que se enseña por valor de opción; `null` la oculta (p. ej. ayudas comparativas, D-03). */
  optionHelp?: Record<string, string | null>;
  /** Ayuda propia del campo, en lugar de la del schema. */
  helpText?: string;
  /** Foto por valor de opción (ruta pública); `null` = hueco sin foto todavía (D-13). */
  optionImages?: Record<string, string | null>;
  /** Etiqueta corta junto al nombre de una fila sí/no («Recomendado»). */
  badge?: string;
  /**
   * Ocultar el campo cuando su respuesta no cuenta: SOLO si el constructor ya la descarta con esas
   * respuestas (P-04, REGLAS 3). No cambia lo que se envía de los campos visibles.
   */
  hiddenWhen?: (answers: ManualAnswers) => boolean;
  /**
   * Booleano elegido con dos opciones que la interfaz exige contestar (H-N-17). La validación
   * compartida no cambia (los booleanos siguen siendo opcionales para el servidor y el
   * constructor): solo no se avanza sin elegir, para que la revisión no enseñe «—».
   */
  requireChoice?: boolean;
}

/** Pictogramas propios (dibujos sencillos que dicen algo que un icono genérico no dice). */
export type ManualPictogramName = 'hedge-one-face' | 'hedge-two-faces';

export interface ManualServicePresentation {
  screens: ManualScreenPresentation[];
  /** Plural del sustantivo del elemento («árboles», no «árbols»). */
  itemNounPlural: string;
  /** Ofrecer «Duplicar» en la lista de elementos (árboles iguales, D-04). */
  allowDuplicate?: boolean;
  fields: Record<string, ManualFieldPresentation>;
}

/** Una pantalla por paso: la forma actual del asistente. */
const PALM_HEIGHT_FIELD = MANUAL_ENTRY_SURVEYS.palm.steps.find((step) => step.id === 'height')!.fields[0];

const onePerStep = (
  stepIds: string[],
  dependsOn: Record<string, string[]> = {},
): ManualScreenPresentation[] =>
  stepIds.map((id) => ({ id, stepIds: [id], ...(dependsOn[id] ? { dependsOn: dependsOn[id] } : {}) }));

export const MANUAL_ENTRY_PRESENTATION: Record<ManualServiceKey, ManualServicePresentation> = {
  lawn: {
    screens: onePerStep(['surface', 'state']),
    itemNounPlural: 'zonas de césped',
    fields: {
      superficie_m2: { numberFormat: 'quantity', errorName: 'la superficie de césped', hideHelp: true },
    },
  },
  // F5: longitud y altura son dos medidas del mismo seto, en una pantalla (D-05). Bajo la altura,
  // el tramo de tarifa en el que cae (las mismas bandas que usa el jardinero). Sin comparaciones:
  // «¿Cómo lo mido?» explica el método (D-03).
  hedge: {
    screens: [
      {
        id: 'measures',
        stepIds: ['length', 'height'],
        title: '¿Cuánto mide el seto?',
        description: 'Una medida aproximada vale: el profesional la comprueba al llegar.',
        measureHelp: [
          'Longitud: a lo largo del seto. Si hace esquinas o tiene varios tramos, súmalos.',
          'Altura: desde el suelo hasta lo más alto, incluidos los muros o estructuras sobre los que crece.',
        ],
      },
      ...onePerStep(['faces', 'state']),
    ],
    itemNounPlural: 'setos',
    fields: {
      longitud_m: { numberFormat: 'quantity', errorName: 'la longitud del seto', hideHelp: true },
      altura_m: {
        numberFormat: 'decimal',
        errorName: 'la altura del seto',
        // La ayuda del schema («la altura decide la tarifa…») la sustituye el tramo en vivo.
        hideHelp: true,
        feedback: (answers) => {
          const height = answers.altura_m;
          if (typeof height !== 'number' || !Number.isFinite(height)) return null;
          if (height < MANUAL_RANGES.hedge.altura_m.min || height > MANUAL_RANGES.hedge.altura_m.max) return null;
          return `Tramo de tarifa: ${HEDGE_BAND_LABELS[mapHedgeHeightToBand(height)]}`;
        },
      },
      caras: { optionPictograms: { '1': 'hedge-one-face', '2': 'hedge-two-faces' } },
    },
  },
  tree: {
    screens: [
      {
        id: 'size',
        stepIds: ['size'],
        measureHelp: [
          'Mide la altura total: desde el suelo hasta lo más alto de la copa.',
          'Si el árbol está entre dos tramos, elige el que más se aproxime. El profesional lo comprueba al llegar.',
        ],
      },
      { id: 'pruning_type', stepIds: ['pruning_type'] },
      { id: 'access', stepIds: ['access'] },
    ],
    itemNounPlural: 'árboles',
    // Cinco árboles iguales eran quince pantallas: «Duplicar» crea otro elemento idéntico (D-04).
    allowDuplicate: true,
    fields: {
      aiSizeBand: {
        // El tramo en metros es el único criterio (D-03): fuera «planta baja», «tejado»…, que
        // llevaban a tramos distintos según la casa de cada uno.
        optionLabels: { over_9: 'Muy grande (más de 9 m)' },
        optionHelp: { small: null, medium: null, large: null, over_9: null },
      },
      pruningType: {
        // Mismos nombres; la ayuda dice lo mismo que la definición del configurador del jardinero
        // (`TreePruningConfigurator`), que es con la que pone precio a cada tipo.
        optionHelp: {
          structural: 'Para árboles grandes, ramas pesadas o saneamiento profundo.',
          shaping: 'Para árboles jóvenes o mantenimiento ligero.',
        },
      },
      // Dos respuestas cortas: segmentado. Qué es «difícil» lo dice la frase de apoyo de la pantalla.
      // H-N-17: hay que elegir una de las dos (antes se podía saltar y contaba como normal).
      difficultyHigh: { control: 'segmented', requireChoice: true },
    },
  },
  palm: {
    screens: [
      { id: 'species', stepIds: ['species'] },
      { id: 'height', stepIds: ['height'] },
      { id: 'state', stepIds: ['state'], title: '¿En qué estado está la palmera?' },
      { id: 'quantity', stepIds: ['quantity'] },
      {
        id: 'extras',
        stepIds: ['extras'],
        // Qué extras hay depende de la especie (fitosanitario, pelado) y de la altura (acceso).
        dependsOn: ['species', 'height'],
        title: '¿Necesitas algo más?',
        description: 'Cada opción puede tener un coste adicional según el profesional.',
      },
    ],
    itemNounPlural: 'grupos de palmeras',
    fields: {
      species: {
        // Nombre común primero y latín debajo (D-10), con el rasgo para reconocerla. El `value`
        // sigue siendo el nombre latino. Foto por especie cuando el usuario la aporte (D-13).
        optionLabels: {
          'Phoenix canariensis': 'Palmera canaria',
          'Phoenix dactylifera': 'Palmera datilera',
          'Washingtonia robusta/filifera': 'Washingtonia o palmera de abanico',
          'Syagrus romanzoffiana': 'Pindó',
          'Trachycarpus fortunei': 'Palmera de molino',
          'Roystonea regia': 'Palmera real',
        },
        optionHelp: {
          'Phoenix canariensis': 'Phoenix canariensis · Copa muy densa y redondeada.',
          'Phoenix dactylifera': 'Phoenix dactylifera · Tronco esbelto y alto.',
          'Washingtonia robusta/filifera': 'Washingtonia robusta o filifera · Tronco muy alto y fino, copa pequeña.',
          'Syagrus romanzoffiana': 'Syagrus romanzoffiana · Hojas plumosas y arqueadas.',
          'Trachycarpus fortunei': 'Trachycarpus fortunei · Baja y resistente.',
          'Roystonea regia': 'Roystonea regia · Tronco liso y abultado.',
        },
        optionImages: PALM_SPECIES_PHOTOS,
      },
      height: {
        // Dos a cuatro tramos cortos: segmentado. El aviso del tramo más alto (ayuda de la opción
        // en el schema) pasa a la línea de debajo cuando se elige.
        control: 'segmented',
        feedback: (answers) => {
          const height = answers.height;
          if (typeof height !== 'string' || height === '') return null;
          const option = getFieldOptions(PALM_HEIGHT_FIELD, answers).find((o) => o.value === height);
          // Se volvió atrás y se cambió de especie: esa altura no existe en la nueva lista.
          if (!option) return 'Los tramos de altura cambian con la especie: vuelve a elegir la altura del tronco.';
          return option.help ?? null;
        },
      },
      quantity: {
        numberFormat: 'quantity',
        errorName: 'el número de palmeras',
        // Sin «ud»: la etiqueta ya dice «Número de palmeras».
        unit: () => '',
      },
      hasPhytosanitary: {
        badge: 'Recomendado',
        helpText: 'Protege los cortes de la poda frente a plagas como el picudo rojo.',
      },
      hasTrunkPeeling: { helpText: 'Acabado estético del tronco.' },
      hasAccessDifficulty: {
        helpText: 'Cerca de cables, en pendiente o con obstáculos importantes.',
        // En el tramo más bajo el constructor descarta el acceso difícil (`buildPalmGroups`, con
        // la misma regla de dominio): preguntarlo hacía creer que contaba (P-04).
        hiddenWhen: (answers) =>
          typeof answers.species === 'string' &&
          typeof answers.height === 'string' &&
          isLowestRangeThresholdForSpecies(answers.species, answers.height),
      },
    },
  },
  shrub: {
    screens: onePerStep(['surface', 'size', 'state']),
    itemNounPlural: 'zonas de arbustos',
    fields: {
      superficie_m2: { numberFormat: 'quantity', errorName: 'la superficie de plantas y arbustos' },
    },
  },
  phytosanitary: {
    screens: onePerStep(['affected', 'area', 'size', 'intent', 'target', 'product', 'height', 'endotherapy'], {
      size: ['affectedType'],
      target: ['intent'],
      height: ['affectedType'],
      endotherapy: ['affectedType'],
    }),
    itemNounPlural: 'zonas de tratamiento',
    // Un stepper para 1–5000 obligaba a cientos de toques (NN/g: los steppers no sirven para
    // ajustes grandes): campo numérico.
    fields: { area: { control: 'number', numberFormat: 'quantity', errorName: 'la cantidad a tratar' } },
  },
  weeding: {
    screens: onePerStep(['area', 'state', 'herbicide']),
    itemNounPlural: 'parcelas',
    fields: { area: { numberFormat: 'quantity', errorName: 'la superficie a desbrozar' } },
  },
};

export function getManualPresentation(serviceKey: ManualServiceKey): ManualServicePresentation {
  return MANUAL_ENTRY_PRESENTATION[serviceKey];
}

/** Etiqueta y ayuda con las que se enseña una opción, según la presentación del campo. */
export function presentOption(
  option: { value: string; label: string; help?: string },
  fieldPresentation?: ManualFieldPresentation,
): { label: string; help?: string } {
  const label = fieldPresentation?.optionLabels?.[option.value] ?? option.label;
  const helpOverride = fieldPresentation?.optionHelp?.[option.value];
  const help = helpOverride === null ? undefined : helpOverride ?? option.help;
  return { label, help };
}

/** Control efectivo de un campo: el de la presentación o, si no lo dice, el que sale del schema. */
export function resolveFieldControl(field: ManualFieldDef, fieldPresentation?: ManualFieldPresentation): ManualFieldControl {
  if (fieldPresentation?.control) return fieldPresentation.control;
  switch (field.ui) {
    case 'slider':
      return 'number';
    case 'stepper':
      return 'stepper';
    case 'toggle':
      return 'toggle';
    default:
      return 'options';
  }
}
