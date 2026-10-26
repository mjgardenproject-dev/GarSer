import { supabase } from '../lib/supabase';
import { metaPixelConfigured } from '../config/analytics';

// Lado cliente del Conversions API de Meta (Fase 2, 2026-10-24). Dispara el mismo evento que el
// píxel (metaPixel.ts) con el mismo event_id, para que Meta las deduplique — procesado por
// supabase/functions/meta-capi-send. Best-effort: nunca bloquea ni interrumpe el flujo de la
// persona si falla (igual que el envío a Meta ya es best-effort del lado del servidor).

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
  if (!metaPixelConfigured()) return;

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
