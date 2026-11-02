/** El id del ancla de un hash, o null si no hay. Corta en «?» o «&» porque las herramientas de anuncios
 * (Meta añade los UTM al final de la dirección) pueden dejar `#empresas?utm_source=meta` en vez de
 * poner los parámetros antes de la «#». Un hash con «=» (`#access_token=…` al volver de un inicio de
 * sesión) es un paquete de parámetros, no un ancla. */
export function anchorIdFromHash(hash: string): string | null {
  const raw = hash.replace(/^#/, '').split(/[?&]/)[0];
  if (!raw || raw.includes('=')) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
