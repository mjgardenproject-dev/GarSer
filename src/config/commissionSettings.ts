import { supabase } from '../lib/supabase';
import {
  COMMISSION_RULE_CODES,
  commissionRatesEqual,
  isCommissionRuleCode,
  validateCommissionPercent,
  validateCommissionRates,
  type CommissionRates,
  type CommissionRuleCode,
} from '../shared/commissionRules';

/**
 * Configuración de comisiones de GarSer (qué porcentaje pagan los clientes en cada tipo de reserva).
 *
 * Vive en `commission_settings`, que el navegador NO lee ni escribe directamente: todo pasa por RPC
 * que comprueban en SQL que quien llama es administrador (`is_admin()`). Esta capa solo traduce.
 *
 * Regla de oro: un fallo de lectura NUNCA se convierte en una configuración «por defecto» (un 0 %
 * por error dejaría a GarSer sin cobrar). Lo que no se pueda leer o no sea válido, lanza.
 */

export interface CommissionSettings {
  /** Sube con cada cambio de porcentajes; se manda al guardar para detectar ediciones cruzadas. */
  version: number;
  rates: CommissionRates;
  updatedAt: string | null;
  updatedBy: string | null;
  /**
   * ¿El último presupuesto firmado desde que existe esta configuración la usa?
   * false = el servidor sigue con el sistema anterior (faltan por desplegar sus funciones);
   * null = todavía no se ha firmado ninguno.
   */
  lastQuoteUsesCommissions: boolean | null;
}

export type CommissionSettingsErrorCode = 'forbidden' | 'unavailable' | 'invalid' | 'stale' | 'unexpected';

export class CommissionSettingsError extends Error {
  readonly code: CommissionSettingsErrorCode;
  readonly fieldErrors: Partial<Record<CommissionRuleCode, string>>;
  /** Con `stale`: lo que hay ahora en el servidor. */
  readonly current: CommissionSettings | null;

  constructor(
    code: CommissionSettingsErrorCode,
    message: string,
    extra: { fieldErrors?: Partial<Record<CommissionRuleCode, string>>; current?: CommissionSettings | null } = {},
  ) {
    super(message);
    this.name = 'CommissionSettingsError';
    this.code = code;
    this.fieldErrors = extra.fieldErrors ?? {};
    this.current = extra.current ?? null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Lee la respuesta del servidor con rigor: versión entera y las cinco reglas con porcentajes válidos.
 * Cualquier cosa rara lanza; no se rellena nada con valores por defecto.
 */
export function parseCommissionSettings(raw: unknown): CommissionSettings {
  if (!isRecord(raw) || !isRecord(raw.rates)) {
    throw new CommissionSettingsError('unexpected', 'La respuesta del servidor no tiene el formato esperado.');
  }
  const version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new CommissionSettingsError('unexpected', 'La respuesta del servidor no trae una versión válida.');
  }
  const input: Partial<Record<CommissionRuleCode, unknown>> = {};
  for (const code of COMMISSION_RULE_CODES) input[code] = raw.rates[code];
  const validated = validateCommissionRates(input);
  if (!validated.ok) {
    throw new CommissionSettingsError('unexpected', 'El servidor devolvió porcentajes que no son válidos.', {
      fieldErrors: validated.errors,
    });
  }
  const engine = isRecord(raw.engine) ? raw.engine : {};
  return {
    version,
    rates: validated.rates,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : null,
    lastQuoteUsesCommissions: typeof engine.lastQuoteUsesCommissions === 'boolean' ? engine.lastQuoteUsesCommissions : null,
  };
}

const FORBIDDEN_MESSAGE = 'No tienes permisos de administrador para ver o cambiar las comisiones.';
const UNAVAILABLE_MESSAGE = 'No se ha podido contactar con el servidor. Inténtalo de nuevo en unos minutos.';

function translateRpcError(error: { code?: string; message?: string }): CommissionSettingsError {
  if (error.code === '42501' || /Acceso denegado/i.test(error.message || '')) {
    return new CommissionSettingsError('forbidden', FORBIDDEN_MESSAGE);
  }
  return new CommissionSettingsError('unavailable', UNAVAILABLE_MESSAGE);
}

export async function fetchCommissionSettings(): Promise<CommissionSettings> {
  const { data, error } = await supabase.rpc('get_commission_settings');
  if (error) throw translateRpcError(error);
  return parseCommissionSettings(data);
}

export interface SaveCommissionResult {
  settings: CommissionSettings;
  /** false = los valores ya eran los guardados (nada que escribir). */
  changed: boolean;
}

/**
 * Guarda las cinco reglas a la vez (una sola escritura atómica en el servidor). Devuelve lo que
 * REALMENTE quedó guardado, leído de la base de datos. Cualquier otro resultado lanza
 * `CommissionSettingsError`: nunca se da por guardado algo que el servidor no confirmó.
 */
export async function saveCommissionSettings(
  expectedVersion: number,
  rates: CommissionRates,
): Promise<SaveCommissionResult> {
  // La web valida para ayudar al usuario; la base de datos vuelve a validar y es la que manda.
  const validated = validateCommissionRates(rates);
  if (!validated.ok) {
    throw new CommissionSettingsError('invalid', 'Revisa los porcentajes marcados.', { fieldErrors: validated.errors });
  }

  const { data, error } = await supabase.rpc('save_commission_settings', {
    p_expected_version: expectedVersion,
    p_rates: validated.rates,
  });
  if (error) throw translateRpcError(error);
  if (!isRecord(data)) {
    throw new CommissionSettingsError('unexpected', 'El servidor no confirmó el guardado.');
  }

  if (data.ok !== true) {
    if (data.code === 'stale_version') {
      let current: CommissionSettings | null = null;
      try {
        current = parseCommissionSettings(data.settings);
      } catch {
        current = null;
      }
      throw new CommissionSettingsError(
        'stale',
        typeof data.message === 'string' && data.message
          ? data.message
          : 'La configuración ha cambiado mientras la editabas. Revisa los valores actuales.',
        { current },
      );
    }
    if (data.code === 'invalid_rates') {
      const fieldErrors: Partial<Record<CommissionRuleCode, string>> = {};
      if (Array.isArray(data.errors)) {
        for (const item of data.errors) {
          if (isRecord(item) && isCommissionRuleCode(item.field) && typeof item.message === 'string') {
            fieldErrors[item.field] = item.message;
          }
        }
      }
      throw new CommissionSettingsError('invalid', 'El servidor ha rechazado algún porcentaje.', { fieldErrors });
    }
    throw new CommissionSettingsError('unexpected', 'El servidor no confirmó el guardado.');
  }

  const settings = parseCommissionSettings(data.settings);
  // Lo que queda guardado tiene que ser lo que se pidió. Si no, no se anuncia un éxito.
  if (!commissionRatesEqual(settings.rates, rates)) {
    throw new CommissionSettingsError(
      'unexpected',
      'El servidor guardó valores distintos a los enviados. Recarga la página y revisa la configuración.',
      { current: settings },
    );
  }
  return { settings, changed: data.changed === true };
}

/* ------------------------------------------------------------------------------------- *
 * Historial de cambios
 * ------------------------------------------------------------------------------------- */

export type CommissionAuditOutcome = 'saved' | 'no_change' | 'rejected' | 'stale';

export interface CommissionAuditEntry {
  id: number;
  occurredAt: string;
  actorId: string | null;
  actorName: string | null;
  source: 'admin_rpc' | 'direct_sql' | 'migration';
  outcome: CommissionAuditOutcome;
  previousVersion: number | null;
  newVersion: number | null;
  previousRates: Partial<Record<CommissionRuleCode, number>> | null;
  savedRates: Partial<Record<CommissionRuleCode, number>> | null;
}

const OUTCOMES: readonly string[] = ['saved', 'no_change', 'rejected', 'stale'];
const SOURCES: readonly string[] = ['admin_rpc', 'direct_sql', 'migration'];

function readRatesSubset(value: unknown): Partial<Record<CommissionRuleCode, number>> | null {
  if (!isRecord(value)) return null;
  const rates: Partial<Record<CommissionRuleCode, number>> = {};
  for (const code of COMMISSION_RULE_CODES) {
    const reading = validateCommissionPercent(value[code]);
    if (reading.ok) rates[code] = reading.value;
  }
  return rates;
}

export async function fetchCommissionAudit(limit = 10): Promise<CommissionAuditEntry[]> {
  const { data, error } = await supabase.rpc('list_commission_audit', { p_limit: limit });
  if (error) throw translateRpcError(error);
  if (!Array.isArray(data)) return [];
  const entries: CommissionAuditEntry[] = [];
  for (const item of data) {
    if (!isRecord(item) || typeof item.id !== 'number' || typeof item.occurredAt !== 'string') continue;
    if (!OUTCOMES.includes(String(item.outcome)) || !SOURCES.includes(String(item.source))) continue;
    entries.push({
      id: item.id,
      occurredAt: item.occurredAt,
      actorId: typeof item.actorId === 'string' ? item.actorId : null,
      actorName: typeof item.actorName === 'string' ? item.actorName : null,
      source: item.source as CommissionAuditEntry['source'],
      outcome: item.outcome as CommissionAuditOutcome,
      previousVersion: typeof item.previousVersion === 'number' ? item.previousVersion : null,
      newVersion: typeof item.newVersion === 'number' ? item.newVersion : null,
      previousRates: readRatesSubset(item.previousRates),
      savedRates: readRatesSubset(item.savedRates),
    });
  }
  return entries;
}
