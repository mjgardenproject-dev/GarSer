// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));

import { useOwnPhytoLicenseStatus } from './useOwnPhytoLicenseStatus';

describe('useOwnPhytoLicenseStatus (QA-050: el estado del carnet no puede depender de haber visitado «Personal»)', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('lee el estado del carnet propio al entrar, sin pasar por otra pestaña', async () => {
    mocks.rpc.mockResolvedValue({ data: { status: 'approved' }, error: null });
    const { result } = renderHook(() => useOwnPhytoLicenseStatus(true));
    expect(result.current[0]).toBeNull();
    await waitFor(() => expect(result.current[0]).toBe('approved'));
    expect(mocks.rpc).toHaveBeenCalledWith('my_phyto_license');
  });

  it('permite que la pestaña «Personal» lo actualice al subir un carnet', async () => {
    mocks.rpc.mockResolvedValue({ data: { status: null }, error: null });
    const { result, rerender } = renderHook(() => useOwnPhytoLicenseStatus(true));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    result.current[1]('pending');
    rerender();
    await waitFor(() => expect(result.current[0]).toBe('pending'));
  });

  it('desactivado (cuenta de equipo) no pregunta nada', () => {
    renderHook(() => useOwnPhytoLicenseStatus(false));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('si falla, queda sin dato (no bloquea ni inventa)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'x' } });
    const { result } = renderHook(() => useOwnPhytoLicenseStatus(true));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    expect(result.current[0]).toBeNull();
  });
});
