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

  it('manda el evento ProviderApproved solo por CAPI, con el email de quien se aprueba', () => {
    trackProviderApproved('empresa@ejemplo.com');

    expect(mocks.sendMetaCapiEvent).toHaveBeenCalledTimes(1);
    const [eventName, eventId, userData] = mocks.sendMetaCapiEvent.mock.calls[0];
    expect(eventName).toBe('ProviderApproved');
    expect(eventId).toBeTruthy();
    expect(userData).toEqual({ email: 'empresa@ejemplo.com' });
  });

  it('dos llamadas generan event_id distintos', () => {
    trackProviderApproved('a@b.com');
    trackProviderApproved('a@b.com');

    const first = mocks.sendMetaCapiEvent.mock.calls[0][1];
    const second = mocks.sendMetaCapiEvent.mock.calls[1][1];
    expect(first).not.toBe(second);
  });

  it('no manda nada sin email', () => {
    trackProviderApproved(undefined);
    trackProviderApproved(null);
    trackProviderApproved('');

    expect(mocks.sendMetaCapiEvent).not.toHaveBeenCalled();
  });
});
