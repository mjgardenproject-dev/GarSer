import { sendMetaCapiEvent } from './metaConversionsApi';

// Evento "ProviderApproved" (Fase 4 del plan de captación de empresas, 2026-10-28): CAPI puro, sin
// píxel — quien aprueba es el admin, no el jardinero/empresa en su propio navegador, así que no hay
// ningún evento de cliente con el que deduplicar. Sirve para dos cosas desde el primer día: (1) la
// audiencia de exclusión de ya-aprobados en Meta Ads, que se actualiza sola con cada llamada; (2)
// ver en Meta Events Manager qué anuncio trae solicitudes que de verdad se aprueban, no solo que se
// envían. Se llama justo después de que la revisión en el panel de admin confirme el alta.
export function trackProviderApproved(email?: string | null): void {
  if (!email) return;

  const eventId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `approved-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

  sendMetaCapiEvent('ProviderApproved', eventId, { email });
}
