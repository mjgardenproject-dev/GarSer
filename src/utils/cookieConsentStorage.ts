// Decisión de cookies guardada en el navegador (2026-11-02). Vive aquí, y no dentro de
// CookieConsentContext, para que también la lean las piezas que no son React —el Conversions API de
// Meta, que sale del navegador sin pasar por el píxel— y comprueben exactamente la misma decisión que
// el banner: si el visitante no ha aceptado «Publicidad», no sale nada hacia Meta por ninguna vía.

export const CONSENT_STORAGE_KEY = 'garser.cookie-consent.v1';
const RENEW_AFTER_MS = 24 * 30 * 24 * 60 * 60 * 1000; // 24 meses, en meses de 30 días: sobra margen.

export interface StoredConsent {
  advertising: boolean;
  decidedAt: string;
}

export function readStoredConsent(): StoredConsent | null {
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredConsent>;
    if (typeof parsed.advertising !== 'boolean' || typeof parsed.decidedAt !== 'string') return null;
    const decidedAt = new Date(parsed.decidedAt).getTime();
    if (!Number.isFinite(decidedAt) || Date.now() - decidedAt > RENEW_AFTER_MS) return null; // caducado: se vuelve a preguntar
    return { advertising: parsed.advertising, decidedAt: parsed.decidedAt };
  } catch {
    return null; // localStorage bloqueado o dato corrupto: se trata como «sin decidir».
  }
}

export function writeStoredConsent(advertising: boolean): void {
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ advertising, decidedAt: new Date().toISOString() }));
  } catch {
    // Sin almacenamiento disponible: el banner volverá a salir la próxima vez. No es grave.
  }
}

/** true solo si el visitante aceptó la categoría «Publicidad» y su decisión no ha caducado. Sin decisión,
 * rechazada, caducada o sin poder leer el almacenamiento: false. Se lee en cada llamada, no se congela,
 * para que retirar el consentimiento surta efecto en el acto. */
export function advertisingConsentGranted(): boolean {
  return readStoredConsent()?.advertising === true;
}
