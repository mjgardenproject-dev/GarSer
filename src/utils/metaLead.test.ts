// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  trackMetaEvent: vi.fn(),
  sendMetaCapiEvent: vi.fn(),
}));

vi.mock('./metaPixel', () => ({
  trackMetaEvent: mocks.trackMetaEvent,
}));
vi.mock('./metaConversionsApi', () => ({
  sendMetaCapiEvent: mocks.sendMetaCapiEvent,
}));

import { trackMetaLead } from './metaLead';

describe('metaLead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('manda el mismo event_id al píxel y al CAPI, para que Meta los deduplique', () => {
    trackMetaLead('a@b.com');

    expect(mocks.trackMetaEvent).toHaveBeenCalledTimes(1);
    expect(mocks.sendMetaCapiEvent).toHaveBeenCalledTimes(1);

    const pixelEventId = mocks.trackMetaEvent.mock.calls[0][2];
    const capiEventId = mocks.sendMetaCapiEvent.mock.calls[0][1];
    expect(pixelEventId).toBeTruthy();
    expect(pixelEventId).toBe(capiEventId);

    expect(mocks.trackMetaEvent).toHaveBeenCalledWith('Lead', undefined, pixelEventId);
    expect(mocks.sendMetaCapiEvent).toHaveBeenCalledWith('Lead', capiEventId, { email: 'a@b.com' });
  });

  it('dos llamadas generan event_id distintos', () => {
    trackMetaLead();
    trackMetaLead();

    const first = mocks.trackMetaEvent.mock.calls[0][2];
    const second = mocks.trackMetaEvent.mock.calls[1][2];
    expect(first).not.toBe(second);
  });
});
