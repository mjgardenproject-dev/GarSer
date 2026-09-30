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
import type { ManualAnswers, ManualServiceKey } from '../../../../shared/manualEntry/manualEntrySchema';
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
}

export interface ManualFieldPresentation {
  /** Cómo se lee lo que se escribe en un campo numérico (ver `readManualNumber`). */
  numberFormat?: ManualNumberFormat;
  /** Unidad que se muestra cuando depende de otras respuestas (fitosanitarios, F8). */
  unit?: (answers: ManualAnswers) => string | undefined;
}

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
    fields: { superficie_m2: { numberFormat: 'quantity' } },
  },
  hedge: {
    screens: onePerStep(['length', 'height', 'faces', 'state']),
    itemNounPlural: 'setos',
    fields: { longitud_m: { numberFormat: 'quantity' }, altura_m: { numberFormat: 'decimal' } },
  },
  tree: {
    screens: onePerStep(['size', 'pruning_type', 'access']),
    itemNounPlural: 'árboles',
    fields: {},
  },
  palm: {
    screens: onePerStep(['species', 'height', 'state', 'quantity', 'extras']),
    itemNounPlural: 'grupos de palmeras',
    fields: { quantity: { numberFormat: 'quantity' } },
  },
  shrub: {
    screens: onePerStep(['surface', 'size', 'state']),
    itemNounPlural: 'zonas de arbustos',
    fields: { superficie_m2: { numberFormat: 'quantity' } },
  },
  phytosanitary: {
    screens: onePerStep(['affected', 'area', 'size', 'intent', 'target', 'product', 'height', 'endotherapy'], {
      size: ['affectedType'],
      target: ['intent'],
      height: ['affectedType'],
      endotherapy: ['affectedType'],
    }),
    itemNounPlural: 'zonas de tratamiento',
    fields: { area: { numberFormat: 'quantity' } },
  },
  weeding: {
    screens: onePerStep(['area', 'state', 'herbicide']),
    itemNounPlural: 'parcelas',
    fields: { area: { numberFormat: 'quantity' } },
  },
};

export function getManualPresentation(serviceKey: ManualServiceKey): ManualServicePresentation {
  return MANUAL_ENTRY_PRESENTATION[serviceKey];
}
