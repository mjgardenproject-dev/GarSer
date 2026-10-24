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

describe('metaConversionsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue({ data: null, error: null });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sin VITE_META_PIXEL_ID no llama a la función', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '');
    sendMetaCapiEvent('Lead', 'evt-1', { email: 'a@b.com' });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('con el identificador, manda el evento con el mismo event_id del píxel', () => {
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

  it('si la función falla, no lanza (best-effort)', async () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '2034090553963036');
    mocks.invoke.mockRejectedValue(new Error('network down'));
    expect(() => sendMetaCapiEvent('Lead', 'evt-1')).not.toThrow();
    await Promise.resolve();
  });
});
