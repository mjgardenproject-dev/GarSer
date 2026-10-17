import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ maybeSingle: vi.fn() }));

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
  },
}));

import {
  getKnownProviderLinkProfile,
  loadProviderLinkProfile,
  rememberProviderLinkProfile,
  resetProviderLinkProfiles,
} from './providerLinkProfile';

describe('providerLinkProfile', () => {
  beforeEach(() => {
    resetProviderLinkProfiles();
    mocks.maybeSingle.mockReset();
  });

  it('el perfil público lo deja guardado y la reserva no lo vuelve a pedir', async () => {
    rememberProviderLinkProfile({ user_id: 'g-1', full_name: ' Ana Jardines ', services: ['svc-lawn', 7], max_distance: 25 });

    expect(await loadProviderLinkProfile('g-1')).toEqual({
      userId: 'g-1',
      fullName: 'Ana Jardines',
      serviceIds: ['svc-lawn'],
      maxDistanceKm: 25,
    });
    expect(mocks.maybeSingle).not.toHaveBeenCalled();
  });

  it('pide una sola vez aunque varias pantallas lo pidan a la vez', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { user_id: 'g-2', full_name: 'Jardines Sur', services: null, max_distance: null }, error: null });

    const [a, b] = await Promise.all([loadProviderLinkProfile('g-2'), loadProviderLinkProfile('g-2')]);

    expect(a).toEqual({ userId: 'g-2', fullName: 'Jardines Sur', serviceIds: [], maxDistanceKm: null });
    expect(b).toBe(a);
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it('un profesional que no está en el directorio queda como null; un error no se guarda', async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await loadProviderLinkProfile('g-missing')).toBeNull();
    expect(getKnownProviderLinkProfile('g-missing')).toBeNull();

    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: new Error('timeout') });
    await expect(loadProviderLinkProfile('g-3')).rejects.toThrow('timeout');
    expect(getKnownProviderLinkProfile('g-3')).toBeUndefined();
  });
});
