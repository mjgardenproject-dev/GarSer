import { trackMetaEvent } from './metaPixel';
import { sendMetaCapiEvent } from './metaConversionsApi';

// Punto de entrada único para el evento "Lead" de Meta (Fase 2, 2026-10-24): lo manda por el
// píxel y por el Conversions API con el mismo event_id, para que Meta las deduplique. Los dos
// sitios donde GarSer genera un lead real —alta de jardinero y alta de empresa— llaman aquí en
// vez de repetir la coordinación entre las dos vías.
export function trackMetaLead(email?: string): void {
  const eventId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `lead-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

  trackMetaEvent('Lead', undefined, eventId);
  sendMetaCapiEvent('Lead', eventId, { email });
}
