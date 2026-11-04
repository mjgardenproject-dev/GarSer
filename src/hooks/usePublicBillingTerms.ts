import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { parsePublicBillingTerms, type PublicBillingTerms } from '../shared/billingTerms';

/**
 * Los términos de facturación que la web puede afirmar (`get_public_billing_terms`, solo niveles).
 *
 * Devuelve `null` mientras carga y cuando no se pueden obtener (sin red, sin configuración, respuesta
 * inesperada): con `null` los textos son los neutros, que son ciertos con cualquier configuración. Un
 * error nunca se traduce en una promesa.
 *
 * Una sola petición compartida por todos los componentes de la página, que se repite pasados unos
 * minutos para que un cambio de ajustes llegue a quien tiene la web abierta.
 */

const FRESH_FOR_MS = 5 * 60 * 1000;
const RETRY_AFTER_ERROR_MS = 30 * 1000;

let cached: { terms: PublicBillingTerms | null; at: number; ok: boolean } | null = null;
let inFlight: Promise<PublicBillingTerms | null> | null = null;

const isFresh = (now: number) => cached !== null && now - cached.at < (cached.ok ? FRESH_FOR_MS : RETRY_AFTER_ERROR_MS);

export function loadPublicBillingTerms(now: number = Date.now()): Promise<PublicBillingTerms | null> {
  if (isFresh(now) && cached) return Promise.resolve(cached.terms);
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const { data, error } = await supabase.rpc('get_public_billing_terms');
      const terms = error ? null : parsePublicBillingTerms(data);
      cached = { terms, at: Date.now(), ok: terms !== null };
      return terms;
    } catch {
      cached = { terms: null, at: Date.now(), ok: false };
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Solo para las pruebas. */
export function resetPublicBillingTermsCache(): void {
  cached = null;
  inFlight = null;
}

export function usePublicBillingTerms(): PublicBillingTerms | null {
  const [terms, setTerms] = useState<PublicBillingTerms | null>(() => (cached && isFresh(Date.now()) ? cached.terms : null));

  useEffect(() => {
    let alive = true;
    void loadPublicBillingTerms().then((next) => {
      if (alive) setTerms(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  return terms;
}
