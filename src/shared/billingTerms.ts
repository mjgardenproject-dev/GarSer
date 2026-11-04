/**
 * Lo que la web puede afirmar sobre los gastos de gestión, en NIVELES y no en porcentajes.
 *
 * La web pública (landing de jardineros, FAQ, avisos del panel) no cita ningún porcentaje: dice si
 * un tipo de cliente paga gastos de gestión, paga menos o no paga. Eso lo decide la configuración de
 * comisiones; este módulo solo traduce esa configuración a un nivel y comprueba lo que llega de la
 * base de datos. Los textos salen de `config/billingCopy.ts` a partir de estos niveles, así que
 * cuando cambian los ajustes cambia lo que dice la web, sin tocar código.
 *
 * Los niveles son relativos a la primera reserva de un cliente captado por GarSer (la «línea base»):
 *   none      0 %: no se cobra nada en ese caso
 *   reduced   más de 0 % pero menos que la línea base
 *   standard  igual que la línea base
 *   higher    más que la línea base
 *
 * Debe coincidir con `public.commission_term_level` (migración 20261104140000); lo comprueba una
 * prueba que ejecuta el SQL real con una rejilla de porcentajes.
 *
 * Sin imports de la web, como `commissionRules.ts`: lo pueden cargar la web y las pruebas.
 */

import type { CommissionRates } from './commissionRules.ts';

export const BILLING_LEVELS = ['none', 'reduced', 'standard', 'higher'] as const;
export type BillingLevel = (typeof BILLING_LEVELS)[number];

export const isBillingLevel = (value: unknown): value is BillingLevel =>
  typeof value === 'string' && (BILLING_LEVELS as readonly string[]).includes(value);

export interface PublicBillingTerms {
  /** Versión de la configuración de la que salen (solo para diagnóstico). */
  version: number;
  /** Primera reserva de un cliente captado por GarSer. */
  garserFirst: BillingLevel;
  /** Primera reserva de un cliente que llega por el enlace del profesional. */
  linkFirst: BillingLevel;
  /** Reservas posteriores de un cliente captado por GarSer con el mismo profesional. */
  garserRepeat: BillingLevel;
  /** Reservas posteriores de un cliente del enlace del profesional. */
  linkRepeat: BillingLevel;
  /** Visitas de un plan de mantenimiento (mandan sobre «reservas posteriores»). */
  maintenanceVisit: BillingLevel;
}

export function termLevel(rate: number, baseline: number): BillingLevel {
  if (rate === 0) return 'none';
  if (rate < baseline) return 'reduced';
  if (rate === baseline) return 'standard';
  return 'higher';
}

/** Los términos que se derivan de unos porcentajes (la vista previa del panel y las pruebas de paridad). */
export function termsFromRates(rates: CommissionRates, version = 0): PublicBillingTerms {
  const base = rates.garser_first;
  return {
    version,
    garserFirst: termLevel(rates.garser_first, base),
    linkFirst: termLevel(rates.link_first, base),
    garserRepeat: termLevel(rates.garser_repeat, base),
    linkRepeat: termLevel(rates.link_repeat, base),
    maintenanceVisit: termLevel(rates.maintenance_visit, base),
  };
}

const KEYS = ['garserFirst', 'linkFirst', 'garserRepeat', 'linkRepeat', 'maintenanceVisit'] as const;

/**
 * Lee lo que devuelve `get_public_billing_terms`. Estricto: cualquier cosa que no sea exactamente
 * lo esperado es `null`, y con `null` la web usa textos neutros que no prometen nada.
 */
export function parsePublicBillingTerms(data: unknown): PublicBillingTerms | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  const version = row.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return null;
  const levels: Partial<Record<(typeof KEYS)[number], BillingLevel>> = {};
  for (const key of KEYS) {
    const value = row[key];
    if (!isBillingLevel(value)) return null;
    levels[key] = value;
  }
  return { version, ...(levels as Record<(typeof KEYS)[number], BillingLevel>) };
}
