// Lista blanca de orígenes de imagen para el análisis con IA.
//
// Vive fuera de la edge function por dos motivos: es lógica de seguridad y merece pruebas
// propias, y el módulo de la función arranca un servidor al importarse, así que no se puede
// examinar desde un test sin efectos secundarios.

/**
 * ¿Es esta URL una foto de nuestro propio Storage?
 *
 * Sin esta comprobación, `photo_urls` es una lista de direcciones que nuestro servidor visita
 * obedientemente: eso es un SSRF. El atacante no ve la respuesta, pero puede usar el servidor
 * como proxy hacia direcciones internas de la infraestructura —inalcanzables desde fuera— y
 * deducir cuáles existen por cómo y cuánto tarda en responder.
 *
 * El origen permitido se deriva de `supabaseUrl`, así que vale igual en local y en producción
 * sin configurar nada aparte. Las fotos del funnel son URLs firmadas de Storage.
 */
export function isAllowedImageUrl(rawUrl: string, supabaseUrl: string | undefined | null): boolean {
  if (!supabaseUrl) return false;
  let url: URL;
  let allowed: URL;
  try {
    url = new URL(rawUrl);
    allowed = new URL(supabaseUrl);
  } catch {
    return false;
  }

  // Solo http/https: descarta file://, data:, blob:, gopher:// y demás esquemas.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  // Comparar el host COMPLETO (incluye el puerto). Comparar solo el hostname dejaría pasar
  // otro servicio del mismo equipo en un puerto distinto.
  if (url.host !== allowed.host) return false;

  // Credenciales embebidas (`https://user:pass@host/`) fuera: son una vía clásica para
  // confundir a un parser laxo sobre cuál es el host real.
  if (url.username || url.password) return false;

  // Y solo la API de Storage, no cualquier endpoint del propio proyecto: sin esto, la función
  // podría hablar con /rest o /auth desde dentro de la red del proyecto.
  return url.pathname.startsWith('/storage/v1/');
}
