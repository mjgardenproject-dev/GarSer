// Cookies de Meta y de Google Ads (QA-007). Al retirar el consentimiento de «Publicidad» no basta con
// dejar de mandar eventos: las cookies que ya pusieron esas etiquetas hay que borrarlas. Son de
// primera parte (las escriben sus scripts en el dominio de garser.es), así que se pueden borrar desde
// aquí. Lista por nombre, no «todas»: la sesión y lo que necesita la web no se tocan.

/** Nombres que ponen Meta Pixel (`_fbp`, `_fbc`) y Google (`_gcl_*`, `_gac_*`, `_ga`, `_ga_<id>`). */
export const TRACKING_COOKIE_MATCHERS: RegExp[] = [
  /^_fbp$/,
  /^_fbc$/,
  /^_gcl_[a-z]+$/,
  /^_gac_.+$/,
  /^_ga$/,
  /^_ga_.+$/,
];

function expire(name: string, domain?: string): void {
  document.cookie = `${name}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain ? `; domain=${domain}` : ''}`;
}

/** Borra las cookies de seguimiento en el dominio actual y en el principal (`.garser.es`). */
export function deleteTrackingCookies(): void {
  if (typeof document === 'undefined') return;
  const names = document.cookie
    .split(';')
    .map((part) => part.trim().split('=')[0])
    .filter((name) => name && TRACKING_COOKIE_MATCHERS.some((matcher) => matcher.test(name)));
  if (names.length === 0) return;
  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  const parts = host.split('.');
  // `garser.es` y `www.garser.es` comparten `.garser.es`; en localhost no hay dominio padre.
  const parent = parts.length >= 2 && !/^\d+(\.\d+){3}$/.test(host) ? `.${parts.slice(-2).join('.')}` : undefined;
  for (const name of names) {
    expire(name);
    if (host) expire(name, host);
    if (parent) expire(name, parent);
  }
}
