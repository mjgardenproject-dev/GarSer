// Notificaciones al móvil (web push), prueba real F7 (R-08, D25).
//
// Implementación directa de los dos estándares, solo con Web Crypto (sin dependencias, para que
// funcione igual en las funciones de Supabase y en las pruebas de vitest):
//   · RFC 8291 — cifrado del mensaje (`aes128gcm`) con las claves de la suscripción del navegador;
//   · RFC 8292 — VAPID: la firma ES256 con la que el servicio de push sabe que el envío es nuestro.
//
// Seguridad: el `endpoint` lo manda el navegador del usuario. Solo se envía a servicios de push
// conocidos y por https (`isAllowedPushEndpoint`): si no, cualquiera podría registrar una
// dirección suya y hacer que nuestro servidor le hiciera peticiones (SSRF).

export type PushSubscriptionKeys = { endpoint: string; p256dh: string; auth: string };
export type PushMessage = { title: string; body: string; url: string; tag?: string };

const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,                // Chrome, Edge (Android y escritorio), Samsung…
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^([a-z0-9-]+\.)*push\.apple\.com$/,     // Safari / iPhone (web.push.apple.com)
  /^([a-z0-9-]+\.)*notify\.windows\.com$/,  // Edge en Windows (WNS)
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.port && PUSH_HOSTS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}

const enc = new TextEncoder();

export function b64urlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function bytesToB64url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  parts.forEach((p) => { out.set(p, offset); offset += p.length; });
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** RFC 8291: el cuerpo cifrado (cabecera + registro único) para esa suscripción. */
export async function encryptPushPayload(
  payload: Uint8Array,
  uaPublicB64: string,
  authSecretB64: string,
  options: { salt?: Uint8Array; serverKeys?: CryptoKeyPair } = {},
): Promise<Uint8Array> {
  const uaPublic = b64urlToBytes(uaPublicB64);
  const authSecret = b64urlToBytes(authSecretB64);
  const serverKeys = options.serverKeys
    || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, serverKeys.privateKey, 256));

  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const salt = options.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plaintext = concat(payload, new Uint8Array([2])); // 0x02: último (y único) registro
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

/** RFC 8292: la cabecera Authorization VAPID para el servicio de push de ese endpoint. */
export async function vapidAuthorization(endpoint: string, keys: { publicKey: string; privateKey: string; subject: string }, now = Date.now()): Promise<string> {
  const pub = b64urlToBytes(keys.publicKey);
  const jwk: JsonWebKey = {
    kty: 'EC', crv: 'P-256', d: keys.privateKey,
    x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33, 65)), ext: true,
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToB64url(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: keys.subject,
  })));
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${bytesToB64url(signature)}, k=${keys.publicKey}`;
}

export type PushSendResult = { ok: boolean; status: number; gone: boolean };

/** Envía una notificación. `gone`: la suscripción ya no existe (404/410) y hay que borrarla. */
export async function sendWebPush(
  sub: PushSubscriptionKeys,
  message: PushMessage,
  keys: { publicKey: string; privateKey: string; subject: string },
  fetchImpl: typeof fetch = fetch,
): Promise<PushSendResult> {
  if (!isAllowedPushEndpoint(sub.endpoint)) return { ok: false, status: 0, gone: true };
  const body = await encryptPushPayload(enc.encode(JSON.stringify(message)), sub.p256dh, sub.auth);
  const response = await fetchImpl(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, keys),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body,
  });
  return { ok: response.status >= 200 && response.status < 300, status: response.status, gone: response.status === 404 || response.status === 410 };
}

/** Texto de la notificación a partir del correo: el asunto y una línea sin HTML. */
export function pushMessageFromEmail(subject: string, introHtml: string, url: string): PushMessage {
  const text = String(introHtml || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return { title: subject, body: text.length > 160 ? `${text.slice(0, 157)}…` : text, url: url || 'https://garser.es/' };
}
