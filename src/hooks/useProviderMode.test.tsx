// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

const account = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));

vi.mock('../contexts/AccountContext', () => ({ useAccount: () => account.value }));

import { useProviderMode } from './useProviderMode';

const refresh = vi.fn();
const set = (value: Record<string, unknown>) => {
  account.value = { role: null, loading: false, providerMode: null, providerModeError: false, refreshProviderMode: refresh, ...value };
};
const individual = {
  isProfessional: true, mode: 'individual', hasTeamStructure: false, activeEmployees: 0,
  pendingInvitations: 0, ownerWorks: true, suspended: false, liabilityDeclared: false,
};
const team = { ...individual, mode: 'team', hasTeamStructure: true, activeEmployees: 2, pendingInvitations: 1, liabilityDeclared: true };

describe('useProviderMode · el único sitio que decide individual o equipo', () => {
  beforeEach(() => { refresh.mockReset(); set({}); });
  afterEach(cleanup);

  it('profesional aprobado sin empleados: modo individual', () => {
    set({ role: 'gardener', providerMode: individual });
    const { result } = renderHook(() => useProviderMode());
    expect(result.current).toMatchObject({
      isProfessionalAccount: true, isApprovedProfessional: true, mode: 'individual', isIndividual: true, isTeam: false,
      activeEmployees: 0, hasTeamStructure: false, error: false,
    });
  });

  it('profesional con empleados: modo equipo, con sus contadores', () => {
    set({ role: 'gardener', providerMode: team });
    const { result } = renderHook(() => useProviderMode());
    expect(result.current).toMatchObject({
      mode: 'team', isTeam: true, isIndividual: false, activeEmployees: 2, pendingInvitations: 1,
      hasTeamStructure: true, liabilityDeclared: true,
    });
  });

  it('aspirante a profesional (cuenta gardener sin ficha todavía): es cuenta de profesional pero no tiene modo', () => {
    set({ role: 'gardener', providerMode: { ...individual, isProfessional: false, mode: null } });
    const { result } = renderHook(() => useProviderMode());
    expect(result.current).toMatchObject({ isProfessionalAccount: true, isApprovedProfessional: false, mode: null, isTeam: false, isIndividual: false });
  });

  it('cliente, empleado y admin no tienen modo, aunque el contexto trajera uno por error', () => {
    for (const role of ['client', 'employee', 'admin', null]) {
      set({ role, providerMode: team });
      const { result } = renderHook(() => useProviderMode());
      expect(result.current).toMatchObject({ isProfessionalAccount: false, mode: null, isTeam: false, activeEmployees: 0 });
    }
  });

  it('mientras la cuenta carga, lo dice y no afirma ningún modo', () => {
    set({ role: null, loading: true });
    const { result } = renderHook(() => useProviderMode());
    expect(result.current.loading).toBe(true);
    expect(result.current.mode).toBeNull();
  });

  it('si el modo no se pudo leer: cuenta de profesional sin modo, con el error a la vista (la interfaz cae a individual)', () => {
    set({ role: 'gardener', providerMode: null, providerModeError: true });
    const { result } = renderHook(() => useProviderMode());
    expect(result.current).toMatchObject({ isProfessionalAccount: true, mode: null, isTeam: false, error: true });
  });

  it('el error de un no profesional no se arrastra', () => {
    set({ role: 'client', providerModeError: true });
    const { result } = renderHook(() => useProviderMode());
    expect(result.current.error).toBe(false);
  });

  it('refresh relee el modo en el servidor y devuelve el nuevo', async () => {
    refresh.mockResolvedValue(team);
    set({ role: 'gardener', providerMode: individual });
    const { result } = renderHook(() => useProviderMode());
    await expect(result.current.refresh()).resolves.toBe(team);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('mismo resultado entre pintados si nada cambia (no provoca renders de más)', () => {
    set({ role: 'gardener', providerMode: individual });
    const { result, rerender } = renderHook(() => useProviderMode());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
