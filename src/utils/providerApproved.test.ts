// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendMetaCapiEvent: vi.fn(),
}));

vi.mock('./metaConversionsApi', () => ({
  sendMetaCapiEvent: mocks.sendMetaCapiEvent,
}));

import { trackProviderApproved } from './providerApproved';

describe('providerApproved', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('con el consentimiento guardado en la solicitud, manda el evento solo por CAPI y como «recorded»', () => {
    trackProviderApproved({ email: 'empresa@ejemplo.com', ads_consent: true });

    expect(mocks.sendMetaCapiEvent).toHaveBeenCalledTimes(1);
    const [eventName, eventId, userData, customData, options] = mocks.sendMetaCapiEvent.mock.calls[0];
    expect(eventName).toBe('ProviderApproved');
    expect(eventId).toBeTruthy();
    expect(userData).toEqual({ email: 'empresa@ejemplo.com' });
    expect(customData).toBeUndefined();
    expect(options).toEqual({ origin: 'recorded' });
  });

  it('sin consentimiento guardado no manda nada: rechazado, ausente o solicitud anterior a la migración', () => {
    trackProviderApproved({ email: 'a@b.com', ads_consent: false });
    trackProviderApproved({ email: 'a@b.com', ads_consent: null });
    trackProviderApproved({ email: 'a@b.com' });

    expect(mocks.sendMetaCapiEvent).not.toHaveBeenCalled();
  });

  it('dos llamadas generan event_id distintos', () => {
    trackProviderApproved({ email: 'a@b.com', ads_consent: true });
    trackProviderApproved({ email: 'a@b.com', ads_consent: true });

    const first = mocks.sendMetaCapiEvent.mock.calls[0][1];
    const second = mocks.sendMetaCapiEvent.mock.calls[1][1];
    expect(first).not.toBe(second);
  });

  it('no manda nada sin email', () => {
    trackProviderApproved({ email: undefined, ads_consent: true });
    trackProviderApproved({ email: null, ads_consent: true });
    trackProviderApproved({ email: '', ads_consent: true });

    expect(mocks.sendMetaCapiEvent).not.toHaveBeenCalled();
  });
});
