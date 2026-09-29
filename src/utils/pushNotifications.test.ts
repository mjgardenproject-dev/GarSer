// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
import { getPushState, isIos } from './pushNotifications';

const setUA = (ua: string) => Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36';

describe('estado de las notificaciones al móvil (F7)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('iPhone sin añadir a la pantalla de inicio: hay que instalarla primero', async () => {
    setUA(IPHONE);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(isIos()).toBe(true);
    expect(await getPushState()).toBe('ios-needs-install');
  });

  it('un navegador sin push: no disponible', async () => {
    setUA(ANDROID);
    expect(await getPushState()).toBe('unsupported');
  });

  it('con push: bloqueadas, activadas o por activar según el permiso y la suscripción', async () => {
    setUA(ANDROID);
    let subscription: object | null = null;
    Object.defineProperty(window.navigator, 'serviceWorker', {
      value: { getRegistration: async () => ({ pushManager: { getSubscription: async () => subscription } }) }, configurable: true,
    });
    vi.stubGlobal('PushManager', function PushManager() {});
    vi.stubGlobal('Notification', { permission: 'denied' });
    expect(await getPushState()).toBe('denied');
    vi.stubGlobal('Notification', { permission: 'default' });
    expect(await getPushState()).toBe('disabled');
    subscription = { endpoint: 'https://fcm.googleapis.com/x' };
    vi.stubGlobal('Notification', { permission: 'granted' });
    expect(await getPushState()).toBe('enabled');
  });
});
