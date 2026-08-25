import { supabase } from '../lib/supabase';

/**
 * Repetir un servicio ya contratado.
 *
 * Recupera las CARACTERÍSTICAS de una reserva anterior (dirección, servicio, zonas, medidas,
 * estados) para precargar una reserva nueva y editable. **No arrastra ningún importe**: el
 * precio lo calcula en vivo la pantalla de jardineros contra la configuración vigente de cada
 * profesional, que puede haber cambiado desde entonces.
 */

/** Claves de foto que NO se restauran. */
const PHOTO_KEYS = new Set([
  'photoUrl', 'photoUrls', 'uploadedPhotoUrls', 'photos', 'photoContract',
  'analyzedIndices', 'selectedIndices', 'imageIndex', 'photoCount', 'totalPhotoCount',
]);

/**
 * Quita las referencias a fotos de todo el payload.
 *
 * Son inservibles por dos motivos independientes: las URLs firmadas caducan en una hora, y las
 * fotos de una reserva **se borran de Storage al completarla**. Restaurarlas dejaría imágenes
 * rotas por toda la pantalla. Los RESULTADOS del análisis (especie, altura, superficie, estado)
 * sí se conservan, que es lo que describe el trabajo y lo que permite continuar sin re-analizar.
 */
function stripPhotoReferences(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPhotoReferences);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      if (PHOTO_KEYS.has(key)) return;
      out[key] = stripPhotoReferences(item);
    });
    return out;
  }
  return value;
}

export interface RebookResult {
  payload: Record<string, unknown>;
  /** true si la reserva no tenía presupuesto asociado y solo se recuperó lo básico. */
  partial: boolean;
}

export async function fetchRebookPayload(bookingId: string): Promise<RebookResult> {
  const { data, error } = await supabase.rpc('get_rebook_payload', { p_booking_id: bookingId });
  if (error) {
    throw new Error(error.message || 'No se pudieron recuperar los datos de la reserva.');
  }

  const result = (data || {}) as { payload?: Record<string, unknown>; partial?: boolean };
  const cleaned = stripPhotoReferences(result.payload || {}) as Record<string, unknown>;

  return {
    // Se CONSERVA el modo de entrada original. Forzar 'manual' parecía razonable -no hay fotos
    // que analizar- pero hace que el asistente arranque vacío y vuelva a preguntarlo todo,
    // perdiendo justo lo que se acaba de recuperar. En el modo de fichas los datos se ven
    // rellenos y editables, que es el objetivo: facilitarle el proceso al cliente.
    payload: { ...cleaned, isRebooking: true },
    partial: Boolean(result.partial),
  };
}

export { stripPhotoReferences };

const BREAKDOWN_SECTIONS = [
  'lawnZones', 'hedgeZones', 'treeGroups', 'shrubGroups', 'palmGroups',
  'phytosanitaryZones', 'weedingZones',
] as const;

/**
 * ¿Hay algo que resumir?
 *
 * Las reservas antiguas o creadas por otra vía no tienen presupuesto asociado, y de ellas solo
 * se recupera la dirección y el servicio. Enseñar entonces una tarjeta de resumen vacía y pedir
 * que se confirmen unas condiciones que no aparecen por ningún lado es peor que no enseñarla:
 * en ese caso el cliente pasa directo a rellenar los datos.
 */
export function hasRebookBreakdown(payload: Record<string, unknown>): boolean {
  return BREAKDOWN_SECTIONS.some((section) => {
    const value = payload[section];
    return Array.isArray(value) && value.length > 0;
  });
}
