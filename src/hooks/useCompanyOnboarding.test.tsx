// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const mode = vi.hoisted(() => ({
  state: { loading: false, isTeam: false, error: false },
  refresh: vi.fn(),
}));

vi.mock('./useProviderMode', () => ({
  useProviderMode: () => ({ ...mode.state, refresh: mode.refresh }),
}));

import { stageFromMode, useCompanyOnboarding } from './useCompanyOnboarding';

// Desde la cuenta de profesional única (D31) esta puerta ya no mira solicitudes de empresa: «aprobada»
// significa «está en modo equipo». Las pantallas de /empresa/* la usan para saber si dejan pasar.
describe('useCompanyOnboarding · puerta de las pantallas de equipo', () => {
  beforeEach(() => {
    mode.state = { loading: false, isTeam: false, error: false };
    mode.refresh.mockReset();
  });
  afterEach(cleanup);

  it('en modo equipo la puerta está abierta («approved»)', () => {
    mode.state = { loading: false, isTeam: true, error: false };
    const { result } = renderHook(() => useCompanyOnboarding());
    expect(result.current.stage).toBe('approved');
    expect(result.current.loading).toBe(false);
  });

  it('en modo individual (o sin ser profesional) está cerrada: la pantalla vuelve al panel', () => {
    const { result } = renderHook(() => useCompanyOnboarding());
    expect(result.current.stage).toBe('not_company');
  });

  it('mientras se lee el modo, sigue «cargando»', () => {
    mode.state = { loading: true, isTeam: false, error: false };
    const { result } = renderHook(() => useCompanyOnboarding());
    expect(result.current.loading).toBe(true);
  });

  it('si no se pudo leer el modo, lo dice y cae a «not_company» (el panel individual)', () => {
    mode.state = { loading: false, isTeam: false, error: true };
    const { result } = renderHook(() => useCompanyOnboarding());
    expect(result.current.error).toMatch(/no hemos podido comprobar/i);
    expect(result.current.stage).toBe('not_company');
  });

  it('ya no hay solicitud ni empresa que leer: el alta de empresa quedó latente (D38)', () => {
    mode.state = { loading: false, isTeam: true, error: false };
    const { result } = renderHook(() => useCompanyOnboarding());
    expect(result.current.application).toBeNull();
    expect(result.current.companyId).toBeNull();
  });

  it('recheck vuelve a leer el modo y devuelve la etapa nueva (equipo detectado tras aceptar el compañero)', async () => {
    mode.refresh.mockResolvedValue({ mode: 'team' });
    const { result } = renderHook(() => useCompanyOnboarding());
    let stage = '';
    await act(async () => { stage = await result.current.recheck(); });
    expect(mode.refresh).toHaveBeenCalledTimes(1);
    expect(stage).toBe('approved');
  });

  it('recheck sin red conserva lo último que se sabía', async () => {
    mode.state = { loading: false, isTeam: true, error: false };
    mode.refresh.mockResolvedValue(null);
    const { result } = renderHook(() => useCompanyOnboarding());
    let stage = '';
    await act(async () => { stage = await result.current.recheck(); });
    expect(stage).toBe('approved');
  });

  it('refresh relee el modo', async () => {
    mode.refresh.mockResolvedValue({ mode: 'individual' });
    const { result } = renderHook(() => useCompanyOnboarding());
    await act(async () => { await result.current.refresh(); });
    expect(mode.refresh).toHaveBeenCalledTimes(1);
  });

  it('stageFromMode: equipo = aprobada; todo lo demás = not_company', () => {
    expect(stageFromMode(true)).toBe('approved');
    expect(stageFromMode(false)).toBe('not_company');
  });
});
