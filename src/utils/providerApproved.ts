import { sendMetaCapiEvent } from './metaConversionsApi';

// Evento "ProviderApproved" (Fase 4 del plan de captación de empresas): CAPI puro, sin píxel — quien
// aprueba es el admin, no el jardinero/empresa en su propio navegador, así que no hay ningún evento de
// cliente con el que deduplicar. Sirve para dos cosas: (1) la audiencia de exclusión de ya-aprobados en
// Meta Ads; (2) ver en Meta Events Manager qué anuncio trae solicitudes que de verdad se aprueban, no
// solo que se envían.
//
// Solo si la persona aceptó la publicidad al rellenar su solicitud (columna ads_consent, migración
// 20261102120000). El navegador del admin no sabe qué decidió ella, así que se mira lo guardado; sin
// registro —las solicitudes anteriores a la migración, o quien rechazó— no sale nada. Retirado en el
// PR #69 mientras no existía ese registro.
export function trackProviderApproved(application: { email?: string | null; ads_consent?: boolean | null }): void {
  const { email, ads_consent } = application;
  if (!email || ads_consent !== true) return;

  const eventId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `approved-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

  sendMetaCapiEvent('ProviderApproved', eventId, { email }, undefined, { origin: 'recorded' });
}
