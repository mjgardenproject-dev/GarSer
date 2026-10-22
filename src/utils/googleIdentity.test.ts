// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createNonce,
  detectEmbeddedBrowser,
  GIS_SCRIPT_SRC,
  googleSignInErrorMessage,
  loadGoogleIdentity,
  openInChromeHref,
  resetGoogleIdentityLoader,
  sha256Hex,
} from './googleIdentity';
import { callbackErrorMessage, readCallbackParams } from './authCallback';

const UA = {
  instagramIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0',
  facebookAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.0;]',
  tiktok: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_33.0 BytedanceWebview/d8a21c6',
  androidWebview: 'Mozilla/5.0 (Linux; Android 13; SM-A536B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36',
  whatsappAndroid: 'Mozilla/5.0 (Linux; Android 13; SM-A536B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36 WhatsApp/2.24',
  safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
};

describe('navegadores dentro de otras apps', () => {
  it('reconoce Instagram, Facebook, TikTok y los WebView de Android', () => {
    expect(detectEmbeddedBrowser(UA.instagramIos)).toBe('Instagram');
    expect(detectEmbeddedBrowser(UA.facebookAndroid)).toBe('Facebook');
    expect(detectEmbeddedBrowser(UA.tiktok)).toBe('TikTok');
    expect(detectEmbeddedBrowser(UA.androidWebview)).toBe('una app');
  });

  it('Safari, Chrome y WhatsApp no cuentan: ahí Google funciona', () => {
    expect(detectEmbeddedBrowser(UA.safari)).toBeNull();
    expect(detectEmbeddedBrowser(UA.chromeAndroid)).toBeNull();
    expect(detectEmbeddedBrowser(UA.whatsappAndroid)).toBeNull();
  });

  it('en Android hay enlace para abrir en Chrome; en iPhone, no', () => {
    expect(openInChromeHref('https://garser.es/reserva/confirmacion?auth=1', UA.facebookAndroid))
      .toBe('intent://garser.es/reserva/confirmacion?auth=1#Intent;scheme=https;package=com.android.chrome;end');
    expect(openInChromeHref('https://garser.es/', UA.instagramIos)).toBeNull();
  });
});

describe('nonce', () => {
  it('a Google va la huella SHA-256 del valor que recibe Supabase', async () => {
    const nonce = await createNonce();
    expect(nonce.raw).toMatch(/^[0-9a-f]{64}$/);
    expect(nonce.hashed).toBe(await sha256Hex(nonce.raw));
    expect((await createNonce()).raw).not.toBe(nonce.raw);
  });
});

describe('carga del script de Google', () => {
  afterEach(() => {
    resetGoogleIdentityLoader();
    document.head.querySelectorAll(`script[src="${GIS_SCRIPT_SRC}"]`).forEach((s) => s.remove());
    (window as unknown as { google?: unknown }).google = undefined;
  });

  it('añade el script una vez y resuelve cuando Google está listo', async () => {
    const pending = loadGoogleIdentity(1000);
    const again = loadGoogleIdentity(1000);
    const scripts = document.head.querySelectorAll(`script[src="${GIS_SCRIPT_SRC}"]`);
    expect(scripts).toHaveLength(1);
    const api = { initialize: vi.fn(), renderButton: vi.fn(), prompt: vi.fn(), cancel: vi.fn(), disableAutoSelect: vi.fn() };
    (window as unknown as { google: unknown }).google = { accounts: { id: api } };
    scripts[0].dispatchEvent(new Event('load'));
    await expect(pending).resolves.toBe(api);
    await expect(again).resolves.toBe(api);
  });

  it('si está bloqueado, falla (y se usará la redirección); el siguiente intento vuelve a probar', async () => {
    const pending = loadGoogleIdentity(1000);
    document.head.querySelector(`script[src="${GIS_SCRIPT_SRC}"]`)!.dispatchEvent(new Event('error'));
    await expect(pending).rejects.toThrow('google_identity_blocked');
    expect(document.head.querySelectorAll(`script[src="${GIS_SCRIPT_SRC}"]`)).toHaveLength(0);
    vi.useFakeTimers();
    const slow = loadGoogleIdentity(500);
    vi.advanceTimersByTime(600);
    await expect(slow).rejects.toThrow('google_identity_timeout');
    vi.useRealTimers();
  });
});

describe('mensajes de error', () => {
  it('explica cada caso sin tecnicismos', () => {
    expect(googleSignInErrorMessage(new Error('Provider (issuer "https://accounts.google.com") is not enabled')))
      .toBe('El acceso con Google aún no está activado. Entra con tu correo.');
    expect(googleSignInErrorMessage({ message: 'Nonces mismatch' })).toBe('La ventana de Google ha caducado. Vuelve a pulsar el botón.');
    expect(googleSignInErrorMessage(new Error('Failed to fetch'))).toContain('No hay conexión');
    expect(googleSignInErrorMessage('otra cosa')).toContain('No hemos podido entrar con Google');
  });
});

describe('vuelta de la redirección (/auth/callback)', () => {
  it('lee adónde volver solo si es una ruta interna', () => {
    expect(readCallbackParams('https://garser.es/auth/callback?next=%2Freserva%2Fconfirmacion%3Fauth%3D1').next).toBe('/reserva/confirmacion?auth=1');
    expect(readCallbackParams('https://garser.es/auth/callback?next=%2F%2Fevil.com').next).toBeNull();
    expect(readCallbackParams('https://garser.es/auth/callback?next=https%3A%2F%2Fevil.com').next).toBeNull();
    expect(readCallbackParams('https://garser.es/auth/callback?next=%2Fauth%2Fcallback').next).toBeNull();
    expect(readCallbackParams('https://garser.es/auth/callback').next).toBeNull();
  });

  it('recoge el error de la dirección (consulta o almohadilla) y lo explica', () => {
    const cancelled = readCallbackParams('https://garser.es/auth/callback#error=access_denied&error_description=The+user+denied');
    expect(cancelled.error).toBe('access_denied');
    expect(callbackErrorMessage(cancelled.error!, cancelled.errorDescription)).toContain('Has cancelado');
    const disabled = readCallbackParams('https://garser.es/auth/callback?error=validation_failed&error_description=Unsupported+provider%3A+provider+is+not+enabled');
    expect(callbackErrorMessage(disabled.error!, disabled.errorDescription)).toContain('aún no está activado');
  });
});
