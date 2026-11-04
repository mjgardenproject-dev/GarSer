/**
 * El enlace de reserva de un profesional: garser.es/reservar/<id>?c=<clave>.
 *
 * El identificador del profesional es público (sale en el directorio), así que por sí solo no
 * prueba nada. Lo que hace que una reserva cuente como «cliente del profesional» (y no pague los
 * gastos de gestión de un cliente de GarSer) es la CLAVE `c`: 32 caracteres que solo ve el propio
 * profesional en su cuenta. El servidor la contrasta con la guardada (SQL) y, sin ella, el enlace
 * sigue abriendo el perfil pero no exime de nada.
 *
 * Sin imports a propósito: lo usan la web, los materiales de marketing y las pruebas.
 */

/** Nombre del parámetro de la dirección que lleva la clave. */
export const PROVIDER_LINK_QUERY_PARAM = 'c';

export function buildProviderBookingUrl(params: {
  origin: string;
  providerId: string;
  /** La clave del profesional (32 hex). Sin ella el enlace no exime: no se construye uno «a medias». */
  code: string;
  /** Origen para medir (`utm_source`): flyer, qr, whatsapp… */
  source?: string;
}): string {
  const base = `${params.origin.replace(/\/+$/, '')}/reservar/${params.providerId}?${PROVIDER_LINK_QUERY_PARAM}=${params.code}`;
  return params.source ? `${base}&utm_source=${encodeURIComponent(params.source)}` : base;
}
