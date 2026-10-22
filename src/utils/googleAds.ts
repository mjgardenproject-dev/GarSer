// Etiqueta de Google Ads + Consent Mode v2, 2026-10-22. Igual criterio que el píxel de Meta
// (src/utils/metaPixel.ts): nada se carga hasta que se llama a loadGoogleAdsTag(), y eso solo ocurre
// tras aceptar la categoría «Publicidad» del banner de cookies.
//
// Implementación «básica» de Consent Mode v2 (la que recomienda Google cuando no se carga nada antes
// del consentimiento): no hace falta la señal «denegado por defecto» que usa el modo avanzado para
// estimar conversiones sin cookies — aquí no hay conversiones que estimar porque, sencillamente, no se
// carga nada hasta que el consentimiento ya es «concedido». La señal de consentimiento se manda igual,
// en el momento en que se carga la etiqueta.

import { getGoogleAdsId, googleAdsConfigured } from '../config/analytics';

type GtagFn = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: GtagFn;
  }
}

let loaded = false;

export function loadGoogleAdsTag(): void {
  if (loaded || !googleAdsConfigured()) return;
  const id = getGoogleAdsId();

  window.dataLayer ||= [];
  const gtag: GtagFn = (...args) => { window.dataLayer!.push(args); };
  window.gtag = gtag;

  gtag('consent', 'default', {
    ad_storage: 'granted',
    ad_user_data: 'granted',
    ad_personalization: 'granted',
    analytics_storage: 'granted',
  });
  gtag('js', new Date());
  gtag('config', id);

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.appendChild(script);

  loaded = true;
}

export function isGoogleAdsTagLoaded(): boolean {
  return loaded;
}

/** Conversiones de Google Ads (ver la tabla de mapeo en el documento del plan). No hace nada si la
 * etiqueta todavía no se ha cargado. `label` es la etiqueta de conversión que da Google Ads al crear
 * cada acción de conversión (Herramientas y configuración → Conversiones) — se añade en la Fase 2. */
export function trackGoogleAdsConversion(label?: string, params?: Record<string, unknown>): void {
  if (!loaded) return;
  const id = getGoogleAdsId();
  window.gtag?.('event', 'conversion', { send_to: label ? `${id}/${label}` : id, ...params });
}

/** Solo para los tests: vuelve a dejar el módulo como si no se hubiera cargado nunca. */
export function resetGoogleAdsTagForTests(): void {
  loaded = false;
  delete window.gtag;
  delete window.dataLayer;
}
