// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: mocks.invoke,
    },
  },
}));

import { sendMetaCapiEvent } from './metaConversionsApi';
import { CONSENT_STORAGE_KEY } from './cookieConsentStorage';

const storeConsent = (advertising: boolean, decidedAt = new Date().toISOString()) =>
  window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ advertising, decidedAt }));

describe('metaConversionsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    storeConsent(true);
    mocks.invoke.mockResolvedValue({ data: null, error: null });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    window.localStorage.clear();
  });

  it('sin VITE_META_PIXEL_ID no llama a la función', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '');
    sendMetaCapiEvent('Lead', 'evt-1', { email: 'a@b.com' });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('sin decidir lo de las cookies, no manda nada a Meta', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '2034090553963036');
    window.localStorage.clear();
    sendMetaCapiEvent('Lead', 'evt-1', { email: 'a@b.com' });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('si rechazó la publicidad, no manda nada a Meta', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '2034090553963036');
    storeConsent(false);
    sendMetaCapiEvent('Lead', 'evt-1', { email: 'a@b.com' });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('si su decisión caducó (más de 24 meses), no manda nada a Meta', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '2034090553963036');
    const old = new Date();
    old.setMonth(old.getMonth() - 25);
    storeConsent(true, old.toISOString());
    sendMetaCapiEvent('Lead', 'evt-1', { email: 'a@b.com' });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('retirar el consentimiento surte efecto en el acto, sin recargar', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '2034090553963036');
    sendMetaCapiEvent('Lead', 'evt-1');
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    storeConsent(false);
    sendMetaCapiEvent('Lead', 'evt-2');
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it('con el identificador y el consentimiento, manda el evento con el mismo event_id del píxel', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '2034090553963036');
    sendMetaCapiEvent('Lead', 'evt-1', { email: 'a@b.com' }, { value: 1 });
    expect(mocks.invoke).toHaveBeenCalledWith('meta-capi-send', {
      body: expect.objectContaining({
        event_name: 'Lead',
        event_id: 'evt-1',
        user_data: { email: 'a@b.com', phone: undefined },
        custom_data: { value: 1 },
      }),
    });
  });

  it('un evento «recorded» (el admin, por otra persona) sale aunque este navegador no tenga consentimiento, sin la página del admin', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '2034090553963036');
    window.localStorage.clear();
    sendMetaCapiEvent('ProviderApproved', 'evt-9', { email: 'a@b.com' }, undefined, { origin: 'recorded' });
    expect(mocks.invoke).toHaveBeenCalledWith('meta-capi-send', {
      body: expect.objectContaining({
        event_name: 'ProviderApproved',
        event_id: 'evt-9',
        origin: 'recorded',
        event_source_url: undefined,
      }),
    });
  });

  it('un evento normal lleva origen «visitor» y la página', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '2034090553963036');
    sendMetaCapiEvent('Lead', 'evt-1', { email: 'a@b.com' });
    expect(mocks.invoke).toHaveBeenCalledWith('meta-capi-send', {
      body: expect.objectContaining({ origin: 'visitor', event_source_url: expect.any(String) }),
    });
  });

  it('si la función falla, no lanza (best-effort)', async () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '2034090553963036');
    mocks.invoke.mockRejectedValue(new Error('network down'));
    expect(() => sendMetaCapiEvent('Lead', 'evt-1')).not.toThrow();
    await Promise.resolve();
  });
});
