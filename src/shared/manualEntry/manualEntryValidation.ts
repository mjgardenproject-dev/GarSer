/**
 * Manual Entry Validation (isomorphic)
 * -------------------------------------------------------------
 * Authoritative range/enum/integer validation for manually-declared booking
 * variables. Used by:
 *   - the wizard (inline per-field UX via `validateManualField`)
 *   - the `booking-authority` edge function (server gate via
 *     `validateManualSerializableInput`) BEFORE the price is computed.
 *
 * Server rule (requisito E): out-of-range values are REJECTED with a clear,
 * coded message — never silently truncated. Inputs are sanitized (numbers
 * coerced, strings trimmed, enums checked against allow-lists).
 *
 * No React / DOM / Supabase imports (shared with Deno).
 */

import {
  MANUAL_RANGES,
  getFieldOptions,
  getPalmHeightRanges,
  resolveManualServiceKey,
  type ManualAnswers,
  type ManualFieldDef,
  type ManualServiceKey,
} from './manualEntrySchema.ts';
import { HEDGE_HEIGHT_BANDS } from '../../domain/hedgeBusinessRules.ts';

export interface ManualValidationError {
  field: string;
  code:
    | 'required'
    | 'out_of_range'
    | 'not_a_number'
    | 'not_integer'
    | 'invalid_option'
    | 'empty_collection'
    | 'unknown_service';
  message: string;
}

export interface ManualValidationResult {
  ok: boolean;
  errors: ManualValidationError[];
}

const ok = (): ManualValidationResult => ({ ok: true, errors: [] });
const fail = (errors: ManualValidationError[]): ManualValidationResult => ({ ok: errors.length === 0, errors });

/* -------------------------------------------------------------------------- */
/* Sanitizers                                                                  */
/* -------------------------------------------------------------------------- */

/** Coerce an arbitrary value to a finite number, or null if not numeric. */
export function sanitizeNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim().replace(',', '.');
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Coerce to a trimmed string (prevents injection of objects/arrays). */
export function sanitizeString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

export function sanitizeBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

/* -------------------------------------------------------------------------- */
/* Per-field validation (inline UX)                                            */
/* -------------------------------------------------------------------------- */

export function validateManualField(
  field: ManualFieldDef,
  value: unknown,
  answers: ManualAnswers,
): ManualValidationError | null {
  // Skipped (not visible) fields are never required.
  if (field.visibleWhen && !field.visibleWhen(answers)) return null;

  if (field.type === 'boolean') return null; // toggles always valid

  if (field.type === 'number' || field.type === 'integer') {
    const num = sanitizeNumber(value);
    if (num === null) {
      if (field.optional) return null;
      return { field: field.key, code: 'required', message: `Indica ${field.label.toLowerCase()}.` };
    }
    if (field.type === 'integer' && !Number.isInteger(num)) {
      return { field: field.key, code: 'not_integer', message: `${field.label} debe ser un número entero.` };
    }
    if (typeof field.min === 'number' && num < field.min) {
      return {
        field: field.key,
        code: 'out_of_range',
        message: `${field.label} debe ser al menos ${field.min}${field.unit ? ' ' + field.unit : ''}.`,
      };
    }
    if (typeof field.max === 'number' && num > field.max) {
      return {
        field: field.key,
        code: 'out_of_range',
        message: `${field.label} no puede superar ${field.max}${field.unit ? ' ' + field.unit : ''}.`,
      };
    }
    return null;
  }

  // enum
  const str = sanitizeString(value);
  if (!str) {
    if (field.optional) return null;
    return { field: field.key, code: 'required', message: `Selecciona ${field.label.toLowerCase()}.` };
  }
  const allowed = getFieldOptions(field, answers).map((option) => option.value);
  if (allowed.length > 0 && !allowed.includes(str)) {
    return { field: field.key, code: 'invalid_option', message: `Opción no válida para ${field.label.toLowerCase()}.` };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Collection-level validation (shared client + server authority)             */
/* -------------------------------------------------------------------------- */

const inRange = (value: number, range: { min: number; max: number }) => value >= range.min && value <= range.max;

const GARDEN_STATES = ['normal', 'descuidado', 'muy descuidado'];
const HEDGE_STATES = ['normal', 'media', 'alta'];
const WEEDING_STATES = ['normal', 'dificultad_media', 'dificultad_alta'];
const SHRUB_SIZES = ['pequeñas', 'medianas', 'grandes'];
const SHRUB_STATES = ['normal', 'descuidado', 'muy descuidado', 'muy_descuidado'];
const TREE_BANDS = ['small', 'medium', 'large', 'over_9'];
const TREE_PRUNING = ['structural', 'shaping', 'estructural', 'formacion'];
const PALM_STATES = ['normal', 'descuidado', 'muy descuidado', 'muy_descuidado'];
const PHYTO_AFFECTED = ['Césped', 'Plantas bajas', 'Setos', 'Árboles', 'Palmeras'];
const PHYTO_INTENT = ['preventive', 'curative', 'weed_control'];
const PHYTO_TARGET = ['insects', 'fungus', 'both'];
const PHYTO_PRODUCT = ['chemical', 'ecological'];

type SerializableLike = {
  lawnZones?: any[];
  hedgeZones?: any[];
  treeGroups?: any[];
  palmGroups?: any[];
  shrubGroups?: any[];
  phytosanitaryZones?: any[];
  weedingZones?: any[];
};

function pushRange(
  errors: ManualValidationError[],
  field: string,
  value: unknown,
  range: { min: number; max: number },
  label: string,
  integer = false,
) {
  const num = sanitizeNumber(value);
  if (num === null) {
    errors.push({ field, code: 'required', message: `Falta ${label}.` });
    return;
  }
  if (integer && !Number.isInteger(num)) {
    errors.push({ field, code: 'not_integer', message: `${label} debe ser un número entero.` });
    return;
  }
  if (!inRange(num, range)) {
    errors.push({
      field,
      code: 'out_of_range',
      message: `${label} debe estar entre ${range.min} y ${range.max}.`,
    });
  }
}

function pushEnum(
  errors: ManualValidationError[],
  field: string,
  value: unknown,
  allowed: string[],
  label: string,
  optional = false,
) {
  const str = sanitizeString(value);
  if (!str) {
    if (!optional) errors.push({ field, code: 'required', message: `Falta ${label}.` });
    return;
  }
  if (!allowed.includes(str)) {
    errors.push({ field, code: 'invalid_option', message: `${label} contiene un valor no permitido.` });
  }
}

/**
 * Validate the already-built collections of a SerializableBookingData for a
 * given service. This is the authoritative gate run on the server before
 * pricing. It only validates the manual-relevant fields; everything else is
 * already constrained by the pricing engine.
 */
export function validateManualBookingInput(
  serviceKey: ManualServiceKey,
  input: SerializableLike,
): ManualValidationResult {
  const errors: ManualValidationError[] = [];

  switch (serviceKey) {
    case 'lawn': {
      const zones = input.lawnZones || [];
      if (zones.length === 0) return fail([{ field: 'lawnZones', code: 'empty_collection', message: 'Falta la zona de césped.' }]);
      zones.forEach((zone, index) => {
        pushRange(errors, `lawnZones[${index}].quantity`, zone.quantity, MANUAL_RANGES.lawn.superficie_m2, 'la superficie de césped');
        pushEnum(errors, `lawnZones[${index}].state`, zone.state, GARDEN_STATES, 'el estado del césped');
      });
      break;
    }
    case 'hedge': {
      const zones = input.hedgeZones || [];
      if (zones.length === 0) return fail([{ field: 'hedgeZones', code: 'empty_collection', message: 'Falta el seto.' }]);
      zones.forEach((zone, index) => {
        pushRange(errors, `hedgeZones[${index}].length`, zone.length, MANUAL_RANGES.hedge.longitud_m, 'la longitud del seto');
        // La altura y su banda deciden la tarifa (pricing_matrix[height]); sin validarlas,
        // una banda inválida pasa el control y el motor devuelve missing_pricing_config
        // → el cliente ve cero jardineros sin saber por qué.
        pushRange(errors, `hedgeZones[${index}].height_pricing_m`, zone.height_pricing_m ?? zone.altura_m, MANUAL_RANGES.hedge.altura_m, 'la altura del seto');
        pushEnum(errors, `hedgeZones[${index}].height`, zone.height, HEDGE_HEIGHT_BANDS, 'la altura del seto');
        pushRange(errors, `hedgeZones[${index}].faces_to_trim`, zone.faces_to_trim ?? 1, MANUAL_RANGES.hedge.caras, 'las caras a recortar', true);
        pushEnum(errors, `hedgeZones[${index}].state`, zone.state, HEDGE_STATES, 'el estado del seto');
      });
      break;
    }
    case 'tree': {
      const groups = input.treeGroups || [];
      if (groups.length === 0) return fail([{ field: 'treeGroups', code: 'empty_collection', message: 'Falta al menos un árbol.' }]);
      groups.forEach((group, index) => {
        pushEnum(errors, `treeGroups[${index}].aiSizeBand`, group.aiSizeBand, TREE_BANDS, 'el tamaño del árbol');
        pushEnum(errors, `treeGroups[${index}].pruningType`, group.pruningType, TREE_PRUNING, 'el tipo de poda');
      });
      break;
    }
    case 'palm': {
      const groups = input.palmGroups || [];
      if (groups.length === 0) return fail([{ field: 'palmGroups', code: 'empty_collection', message: 'Falta al menos un grupo de palmeras.' }]);
      groups.forEach((group, index) => {
        const species = sanitizeString(group.species);
        const allowedHeights = getPalmHeightRanges(species);
        pushRange(errors, `palmGroups[${index}].quantity`, group.quantity, MANUAL_RANGES.palm.quantity, 'el número de palmeras', true);
        pushEnum(errors, `palmGroups[${index}].species`, group.species, Object.keys(speciesAllowList()), 'la especie de palmera');
        pushEnum(errors, `palmGroups[${index}].height`, group.height, allowedHeights, 'la altura de la palmera');
        pushEnum(errors, `palmGroups[${index}].state`, group.state ?? 'normal', PALM_STATES, 'el estado de la palmera', true);
      });
      break;
    }
    case 'shrub': {
      const groups = input.shrubGroups || [];
      if (groups.length === 0) return fail([{ field: 'shrubGroups', code: 'empty_collection', message: 'Falta la zona de arbustos.' }]);
      groups.forEach((group, index) => {
        pushRange(errors, `shrubGroups[${index}].area`, group.area, MANUAL_RANGES.shrub.superficie_m2, 'la superficie de arbustos');
        pushEnum(errors, `shrubGroups[${index}].size`, group.size, SHRUB_SIZES, 'el tamaño de los arbustos');
        pushEnum(errors, `shrubGroups[${index}].state`, group.state ?? 'normal', SHRUB_STATES, 'el estado de las plantas', true);
      });
      break;
    }
    case 'phytosanitary': {
      const zones = input.phytosanitaryZones || [];
      if (zones.length === 0) return fail([{ field: 'phytosanitaryZones', code: 'empty_collection', message: 'Falta al menos una zona a tratar.' }]);
      zones.forEach((zone, index) => {
        pushRange(errors, `phytosanitaryZones[${index}].area`, zone.area, MANUAL_RANGES.phytosanitary.area, 'la cantidad a tratar');
        pushEnum(errors, `phytosanitaryZones[${index}].affectedType`, zone.affectedType, PHYTO_AFFECTED, 'el tipo de vegetación');
        pushEnum(errors, `phytosanitaryZones[${index}].intent`, zone.intent ?? 'preventive', PHYTO_INTENT, 'la intención del tratamiento', true);
        pushEnum(errors, `phytosanitaryZones[${index}].curativeTarget`, zone.curativeTarget, PHYTO_TARGET, 'el objetivo del tratamiento', true);
        pushEnum(errors, `phytosanitaryZones[${index}].productPreference`, zone.productPreference, PHYTO_PRODUCT, 'el tipo de producto', true);
      });
      break;
    }
    case 'weeding': {
      const zones = input.weedingZones || [];
      if (zones.length === 0) return fail([{ field: 'weedingZones', code: 'empty_collection', message: 'Falta la parcela a desbrozar.' }]);
      zones.forEach((zone, index) => {
        pushRange(errors, `weedingZones[${index}].area`, zone.area, MANUAL_RANGES.weeding.area, 'la superficie a desbrozar');
        pushEnum(errors, `weedingZones[${index}].state`, zone.state, WEEDING_STATES, 'la dificultad del desbroce');
      });
      break;
    }
    default:
      return fail([{ field: 'service', code: 'unknown_service', message: 'Servicio no soportado para entrada manual.' }]);
  }

  return fail(errors);
}

function speciesAllowList(): Record<string, true> {
  return {
    'Phoenix canariensis': true,
    'Phoenix dactylifera': true,
    'Washingtonia robusta/filifera': true,
    'Syagrus romanzoffiana': true,
    'Trachycarpus fortunei': true,
    'Roystonea regia': true,
  };
}

/**
 * Server entry point: resolves the service from its name, then validates the
 * received SerializableBookingData. Returns `ok: true` for non-manual or
 * unrecognized services so it never blocks the existing photo flow.
 */
export function validateManualSerializableInput(params: {
  serviceName?: string | null;
  dataInputMode?: string | null;
  bookingInput: SerializableLike;
}): ManualValidationResult {
  if (params.dataInputMode !== 'manual') return ok();
  const serviceKey = resolveManualServiceKey(params.serviceName);
  if (!serviceKey) return ok();
  return validateManualBookingInput(serviceKey, params.bookingInput);
}
