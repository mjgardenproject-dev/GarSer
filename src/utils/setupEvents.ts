// «Algo de la configuración acaba de cambiar» (2026-11-05). Lo avisan los sitios donde el profesional
// guarda lo que pide la ayuda de «Completa tu cuenta» (activar un servicio, confirmar la zona, guardar
// el horario) y lo escuchan la ayuda y la franja «Paso X de N» de cada pantalla, para releer el estado
// al momento en vez de enseñar lo de antes hasta volver a entrar.

export const SETUP_CHANGED_EVENT = 'garser:setup-changed';

export function notifySetupChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SETUP_CHANGED_EVENT));
}
