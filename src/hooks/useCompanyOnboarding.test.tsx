// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const db = vi.hoisted(() => ({
  companyId: null as string | null,
  application: { id: 'a1', status: 'submitted', review_comment: null } as Record<string, unknown> | null,
  fail: false,
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: async () => (db.fail ? { data: null, error: { message: 'Failed to fetch' } } : { data: db.companyId, error: null }),
    from: () => ({
      select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: db.application ? [db.application] : [], error: null }) }) }) }),
    }),
  },
}));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('../contexts/AccountContext', () => ({ useAccount: () => ({ role: 'company', loading: false }) }));

import { stageFromData, useCompanyOnboarding } from './useCompanyOnboarding';

describe('useCompanyOnboarding · recheck («Actualizar estado»)', () => {
  beforeEach(() => {
    db.companyId = null;
    db.application = { id: 'a1', status: 'submitted', review_comment: null };
    db.fail = false;
  });
  afterEach(cleanup);

  it('empieza en «enviada» y, cuando el admin la acepta, recheck lo detecta SIN poner la pantalla en «cargando»', async () => {
    const { result } = renderHook(() => useCompanyOnboarding());
    await waitFor(() => expect(result.current.stage).toBe('submitted'));

    db.companyId = 'c1'; // el administrador acepta la solicitud
    const seenLoading: boolean[] = [];
    let stage = '';
    await act(async () => {
      const p = result.current.recheck();
      seenLoading.push(result.current.loading);
      stage = await p;
    });
    expect(stage).toBe('approved');
    expect(result.current.stage).toBe('approved');
    expect(seenLoading).toEqual([false]);
  });

  it('si sigue en revisión, devuelve «submitted» y no toca nada', async () => {
    const { result } = renderHook(() => useCompanyOnboarding());
    await waitFor(() => expect(result.current.stage).toBe('submitted'));
    let stage = '';
    await act(async () => { stage = await result.current.recheck(); });
    expect(stage).toBe('submitted');
    expect(result.current.error).toBeNull();
  });

  it('un fallo de red se propaga (para decir «no se ha podido comprobar») y no estropea lo que ya se enseñaba', async () => {
    const { result } = renderHook(() => useCompanyOnboarding());
    await waitFor(() => expect(result.current.stage).toBe('submitted'));
    db.fail = true;
    await act(async () => { await expect(result.current.recheck()).rejects.toBeTruthy(); });
    expect(result.current.stage).toBe('submitted');
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('refresh (el de siempre) sigue funcionando', async () => {
    const { result } = renderHook(() => useCompanyOnboarding());
    await waitFor(() => expect(result.current.stage).toBe('submitted'));
    db.application = { id: 'a1', status: 'rejected', review_comment: 'Faltan datos' };
    await act(async () => { await result.current.refresh(); });
    expect(result.current.stage).toBe('rejected');
  });

  it('stageFromData: con empresa, aprobada; sin ella, manda la última solicitud', () => {
    expect(stageFromData('c1', null)).toBe('approved');
    expect(stageFromData(null, null)).toBe('none');
    expect(stageFromData(null, { id: 'a', status: 'approved', review_comment: null })).toBe('submitted');
    expect(stageFromData(null, { id: 'a', status: 'rejected', review_comment: null })).toBe('rejected');
  });
});
