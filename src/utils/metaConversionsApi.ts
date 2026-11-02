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
// la de cookies. Por lo mismo se retiró el evento «ProviderApproved» (PR #66): lo mandaba el navegador
// del admin con el correo de quien se aprueba, y no queda guardado en ninguna parte si esa persona
// aceptó la publicidad. Para volver a mandarlo hace falta registrar ese consentimiento en la solicitud.

interface MetaCapiUserData {
  email?: string;
  phone?: string;
}

export function sendMetaCapiEvent(
  eventName: string,
  eventId: string,
  userData?: MetaCapiUserData,
  customData?: Record<string, unknown>,
): void {
  if (!metaPixelConfigured() || !advertisingConsentGranted()) return;

  void supabase.functions.invoke('meta-capi-send', {
    body: {
      event_name: eventName,
      event_id: eventId,
      event_source_url: typeof window !== 'undefined' ? window.location.href : undefined,
      user_data: { email: userData?.email, phone: userData?.phone },
      custom_data: customData,
    },
  }).catch(() => { /* best-effort: el píxel ya mandó el evento por su cuenta */ });
}
