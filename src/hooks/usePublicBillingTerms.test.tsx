// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));

import { loadPublicBillingTerms, resetPublicBillingTermsCache, usePublicBillingTerms } from './usePublicBillingTerms';

const TERMS = { version: 3, garserFirst: 'standard', linkFirst: 'none', garserRepeat: 'reduced', linkRepeat: 'none', maintenanceVisit: 'reduced' };

beforeEach(() => {
  mocks.rpc.mockReset();
  resetPublicBillingTermsCache();
});

describe('usePublicBillingTerms', () => {
  it('devuelve null mientras carga y los términos cuando llegan', async () => {
    mocks.rpc.mockResolvedValue({ data: TERMS, error: null });
    const { result } = renderHook(() => usePublicBillingTerms());
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toEqual(TERMS));
    expect(mocks.rpc).toHaveBeenCalledWith('get_public_billing_terms');
  });

  it('varios componentes a la vez hacen una sola petición, y la siguiente usa la caché', async () => {
    mocks.rpc.mockResolvedValue({ data: TERMS, error: null });
    const a = renderHook(() => usePublicBillingTerms());
    const b = renderHook(() => usePublicBillingTerms());
    await waitFor(() => expect(a.result.current).toEqual(TERMS));
    await waitFor(() => expect(b.result.current).toEqual(TERMS));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const c = renderHook(() => usePublicBillingTerms());
    expect(c.result.current).toEqual(TERMS);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('pasados 5 minutos vuelve a preguntar (un cambio de ajustes llega a quien tiene la web abierta)', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: TERMS, error: null });
    const t0 = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(t0);
    await loadPublicBillingTerms(t0);
    mocks.rpc.mockResolvedValueOnce({ data: { ...TERMS, version: 4, linkFirst: 'standard' }, error: null });
    expect(await loadPublicBillingTerms(t0 + 4 * 60 * 1000)).toMatchObject({ version: 3 });
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 6 * 60 * 1000);
    expect(await loadPublicBillingTerms(t0 + 6 * 60 * 1000)).toMatchObject({ version: 4, linkFirst: 'standard' });
    vi.restoreAllMocks();
  });

  it.each([
    ['un error de la base de datos', { data: null, error: { message: 'x' } }],
    ['sin configuración (null)', { data: null, error: null }],
    ['una respuesta con otra forma', { data: { garserFirst: 'gratis' }, error: null }],
    ['porcentajes en lugar de niveles', { data: { version: 1, garserFirst: 12.5, linkFirst: 0, garserRepeat: 3, linkRepeat: 0, maintenanceVisit: 3 }, error: null }],
  ])('%s: null, nunca una promesa', async (_label, response) => {
    mocks.rpc.mockResolvedValue(response);
    const { result } = renderHook(() => usePublicBillingTerms());
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toBeNull();
  });

  it('una excepción de red también es null, y se reintenta a los 30 segundos', async () => {
    const t0 = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(t0);
    mocks.rpc.mockRejectedValueOnce(new Error('offline'));
    expect(await loadPublicBillingTerms(t0)).toBeNull();
    // Dentro de los 30 s no insiste.
    expect(await loadPublicBillingTerms(t0 + 10_000)).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    mocks.rpc.mockResolvedValueOnce({ data: TERMS, error: null });
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 31_000);
    expect(await loadPublicBillingTerms(t0 + 31_000)).toEqual(TERMS);
    vi.restoreAllMocks();
  });

  it('desmontar antes de que llegue la respuesta no rompe nada', async () => {
    mocks.rpc.mockResolvedValue({ data: TERMS, error: null });
    const { unmount } = renderHook(() => usePublicBillingTerms());
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
