import { supabase } from '../lib/supabase';
import { metaPixelConfigured } from '../config/analytics';
import { advertisingConsentGranted } from './cookieConsentStorage';

// Lado cliente del Conversions API de Meta (Fase 2, 2026-10-24). Dispara el mismo evento que el
// píxel (metaPixel.ts) con el mismo event_id, para que Meta las deduplique — procesado por
// supabase/functions/meta-capi-send. Best-effort: nunca bloquea ni interrumpe el flujo de la
// persona si falla (igual que el envío a Meta ya es best-effort del lado del servidor).
//
// Solo sale si la persona aceptó la categoría «Publicidad» del banner de cookies (2026-11-02): el
// píxel ya respetaba eso, pero esta vía sale por el servidor y llevaba el correo cifrado, la IP y el
// navegador a Meta aunque hubiera rechazado, lo contrario de lo que dicen la política de privacidad y
// la de cookies. El evento «ProviderApproved» (PR #66) lo manda el admin con el correo de quien se
// aprueba, así que no puede mirar el banner de quien está delante: se retiró en el PR #69 y vuelve
// (providerApproved.ts) solo para quien dejó su consentimiento guardado en la solicitud.

interface MetaCapiUserData {
  email?: string;
  phone?: string;
}

interface MetaCapiOptions {
  /** 'visitor' (por defecto): el evento sale del navegador de la propia persona, y solo si ELLA aceptó la
   * publicidad (se mira aquí). 'recorded': lo manda otra persona —el admin— y el permiso lo comprueba
   * quien llama contra el que la persona dejó guardado en su solicitud; el servidor no adjunta entonces
   * la IP, el navegador ni la página del admin. */
  origin?: 'visitor' | 'recorded';
}

export function sendMetaCapiEvent(
  eventName: string,
  eventId: string,
  userData?: MetaCapiUserData,
  customData?: Record<string, unknown>,
  options?: MetaCapiOptions,
): void {
  const origin = options?.origin ?? 'visitor';
  if (!metaPixelConfigured()) return;
  if (origin === 'visitor' && !advertisingConsentGranted()) return;

  void supabase.functions.invoke('meta-capi-send', {
    body: {
      event_name: eventName,
      event_id: eventId,
      event_source_url: origin === 'visitor' && typeof window !== 'undefined' ? window.location.href : undefined,
      origin,
      user_data: { email: userData?.email, phone: userData?.phone },
      custom_data: customData,
    },
  }).catch(() => { /* best-effort: el píxel ya mandó el evento por su cuenta */ });
}
