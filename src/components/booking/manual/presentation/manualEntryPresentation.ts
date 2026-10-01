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
  MANUAL_RANGES,
  type ManualAnswers,
  type ManualFieldDef,
  type ManualServiceKey,
} from '../../../../shared/manualEntry/manualEntrySchema';
import { HEDGE_BAND_LABELS, mapHedgeHeightToBand } from '../../../../domain/hedgeBusinessRules';
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
}

/** Pictogramas propios (dibujos sencillos que dicen algo que un icono genérico no dice). */
export type ManualPictogramName = 'hedge-one-face' | 'hedge-two-faces';

export interface ManualServicePresentation {
  screens: ManualScreenPresentation[];
  /** Plural del sustantivo del elemento («árboles», no «árbols»). */
  itemNounPlural: string;
  fields: Record<string, ManualFieldPresentation>;
}

/** Una pantalla por paso: la forma actual del asistente. */
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
    screens: onePerStep(['size', 'pruning_type', 'access']),
    itemNounPlural: 'árboles',
    fields: {},
  },
  palm: {
    screens: onePerStep(['species', 'height', 'state', 'quantity', 'extras']),
    itemNounPlural: 'grupos de palmeras',
    fields: { quantity: { numberFormat: 'quantity', errorName: 'el número de palmeras' } },
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
