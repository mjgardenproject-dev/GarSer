// Identificadores de las etiquetas de publicidad, 2026-10-22. Igual que getGoogleClientId() en
// googleIdentity.ts: una función que lee la variable de entorno en cada llamada (no una constante
// congelada al importar el módulo), para que los tests puedan activarla o desactivarla con
// vi.stubEnv(). Si falta, la etiqueta correspondiente no se carga nunca — ninguna de las dos se activa,
// además, hasta que el visitante acepta la categoría «Publicidad» del banner de cookies
// (src/contexts/CookieConsentContext.tsx).

/** Identificador del píxel de Meta (Meta Business Suite → Orígenes de datos → Píxeles). */
export function getMetaPixelId(): string {
  return String(import.meta.env.VITE_META_PIXEL_ID || '').trim();
}

/** Identificador de conversión de Google Ads, con el formato AW-XXXXXXXXX. */
export function getGoogleAdsId(): string {
  return String(import.meta.env.VITE_GOOGLE_ADS_ID || '').trim();
}

export const metaPixelConfigured = (): boolean => getMetaPixelId().length > 0;
export const googleAdsConfigured = (): boolean => getGoogleAdsId().length > 0;

/** Hay algo que medir: enseña el banner solo si al menos una etiqueta está configurada. */
export const advertisingAvailable = (): boolean => metaPixelConfigured() || googleAdsConfigured();
