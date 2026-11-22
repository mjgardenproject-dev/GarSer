// Píxel de Meta, 2026-10-22. El código base que da Meta Business Suite, pero solo se instala cuando se
// llama a loadMetaPixel() — y eso solo ocurre tras aceptar la categoría «Publicidad» del banner de
// cookies (CookieConsentContext). Nunca antes: ni el script, ni una sola cookie.
//
// No se instala el <noscript><img .../></noscript> de respaldo de Meta: solo sirve con JavaScript
// desactivado (un caso casi inexistente en el móvil) y sería otra vía de carga sin consentimiento.

import { getMetaPixelId, metaPixelConfigured } from '../config/analytics';
import { deleteTrackingCookies } from './trackingCookies';

type FbqFn = {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[];
  push?: FbqFn;
  loaded?: boolean;
  version?: string;
};

declare global {
  interface Window {
    fbq?: FbqFn;
    _fbq?: FbqFn;
  }
}

let loaded = false;
// El script de Meta, una vez descargado, no se puede «desinstalar»: tras retirar el consentimiento se
// queda en memoria pero mudo (consent revoke + no se le manda nada). Si se vuelve a aceptar, se concede
// otra vez en lugar de descargarlo de nuevo.
let revoked = false;

/** El código base de Meta, adaptado: sin el IIFE con nombres de una letra, mismo comportamiento. */
function installBaseCode(): void {
  if (window.fbq) return;
  const fbq: FbqFn = function fbq(...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else (fbq.queue ||= []).push(args);
  };
  if (!window._fbq) window._fbq = fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.queue = [];
  window.fbq = fbq;

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://connect.facebook.net/en_US/fbevents.js';
  document.head.appendChild(script);
}

/** Carga el píxel y manda el PageView inicial. Idempotente: llamarlo dos veces no duplica nada. */
export function loadMetaPixel(): void {
  if (loaded || !metaPixelConfigured()) return;
  installBaseCode();
  if (revoked) {
    window.fbq?.('consent', 'grant');
    revoked = false;
  }
  window.fbq?.('init', getMetaPixelId());
  window.fbq?.('track', 'PageView');
  loaded = true;
}

/**
 * Retirar el consentimiento de «Publicidad» (QA-007): Meta deja de recibir eventos en el acto
 * (`consent revoke`, y `trackMetaEvent` no manda nada) y se borran sus cookies (`_fbp`, `_fbc`).
 * Si el píxel nunca se cargó, no hace nada.
 */
export function revokeMetaPixel(): void {
  if (!loaded && !window.fbq) return;
  if (loaded) {
    window.fbq?.('consent', 'revoke');
    revoked = true;
  }
  loaded = false;
  deleteTrackingCookies();
}

export function isMetaPixelLoaded(): boolean {
  return loaded;
}

/** Eventos estándar de Meta (ver la tabla de mapeo en el documento del plan). No hace nada si el píxel
 * todavía no se ha cargado (el visitante no ha aceptado, o no hay identificador configurado).
 * `eventId`, si se pasa, es el mismo identificador que se manda por el Conversions API
 * (metaConversionsApi.ts) para que Meta deduplique las dos vías del mismo evento. */
export function trackMetaEvent(eventName: string, params?: Record<string, unknown>, eventId?: string): void {
  if (!loaded) return;
  if (eventId) {
    window.fbq?.('track', eventName, params || {}, { eventID: eventId });
  } else {
    window.fbq?.('track', eventName, params);
  }
}

/** Solo para los tests: vuelve a dejar el módulo como si no se hubiera cargado nunca. */
export function resetMetaPixelForTests(): void {
  loaded = false;
  revoked = false;
  delete window.fbq;
  delete window._fbq;
}
