import { describe, expect, it, vi } from 'vitest';
import {
  b64urlToBytes, bytesToB64url, encryptPushPayload, isAllowedPushEndpoint, pushMessageFromEmail, sendWebPush, vapidAuthorization,
} from '../../supabase/functions/_shared/webPush';

// Prueba real · F7 (R-08): el cifrado y la firma de las notificaciones al móvil, comprobados
// haciendo de navegador (se descifra con sus claves, como lo haría Chrome o Safari).

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

async function browserKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { pair, p256dh: bytesToB64url(raw), auth: bytesToB64url(auth), raw, authBytes: auth };
}

/** Lo que hace el navegador al recibirla (RFC 8291). */
async function decrypt(body: Uint8Array, ua: Awaited<ReturnType<typeof browserKeys>>) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.pair.privateKey, 256));
  const enc = new TextEncoder();
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...ua.raw, ...asPublic]);
  const ikm = await hkdf(ua.authBytes, ecdh, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext));
  expect(plain[plain.length - 1]).toBe(2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

async function vapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { pair, keys: { publicKey: bytesToB64url(pub), privateKey: String(jwk.d), subject: 'mailto:hola@garser.es' } };
}

describe('web push (F7)', () => {
  it('el navegador descifra exactamente el mensaje', async () => {
    const ua = await browserKeys();
    const message = JSON.stringify({ title: 'Nuevo trabajo', body: 'Corte de césped, jueves 1', url: 'https://garser.es/mi-trabajo' });
    const body = await encryptPushPayload(new TextEncoder().encode(message), ua.p256dh, ua.auth);
    expect(new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0)).toBe(4096);
    expect(await decrypt(body, ua)).toBe(message);
  });

  it('la firma VAPID es válida para el servicio de push y lleva nuestra clave pública', async () => {
    const { pair, keys } = await vapidKeys();
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, Date.UTC(2026, 8, 29));
    const [, token, k] = header.match(/^vapid t=([^,]+), k=(.+)$/) || [];
    expect(k).toBe(keys.publicKey);
    const [h, c, s] = token.split('.');
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(c)));
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(claims.sub).toBe('mailto:hola@garser.es');
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, b64urlToBytes(s), new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });

  it('solo envía a servicios de push conocidos por https (sin SSRF)', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/QG')).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isAllowedPushEndpoint('https://wns2-db5p.notify.windows.com/w/?token=x')).toBe(true);
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://evil.example/fcm.googleapis.com')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.example/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://127.0.0.1/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com:8443/x')).toBe(false);
  });

  it('envía con las cabeceras del estándar y marca como caducada una suscripción 410', async () => {
    const ua = await browserKeys();
    const { keys } = await vapidKeys();
    const fetchMock = vi.fn(async () => new Response(null, { status: 410 }));
    const result = await sendWebPush({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: ua.p256dh, auth: ua.auth },
      { title: 't', body: 'b', url: 'https://garser.es' }, keys, fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, status: 410, gone: true });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Encoding']).toBe('aes128gcm');
    expect(headers.TTL).toBe('86400');
    expect(headers.Authorization.startsWith('vapid t=')).toBe(true);
  });

  it('una dirección no permitida no se llama nunca', async () => {
    const fetchMock = vi.fn();
    const result = await sendWebPush({ endpoint: 'https://evil.example/x', p256dh: 'x', auth: 'y' }, { title: '', body: '', url: '' },
      { publicKey: '', privateKey: '', subject: '' }, fetchMock as unknown as typeof fetch);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.gone).toBe(true);
  });

  it('el texto sale del asunto y de la entradilla sin HTML', () => {
    expect(pushMessageFromEmail('Nuevo trabajo', '<b>Jardines Sol</b> te ha asignado un trabajo.&nbsp;', 'https://garser.es/mi-trabajo'))
      .toEqual({ title: 'Nuevo trabajo', body: 'Jardines Sol te ha asignado un trabajo.', url: 'https://garser.es/mi-trabajo' });
  });
});
