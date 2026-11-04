// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));

import { useMyBookingLink } from './useMyBookingLink';

const ID = '11111111-1111-4111-8111-111111111111';
const CODE = '0123456789abcdef0123456789abcdef';
const CODE2 = 'fedcba9876543210fedcba9876543210';

beforeEach(() => mocks.rpc.mockReset());

describe('useMyBookingLink', () => {
  it('carga el enlace del profesional', async () => {
    mocks.rpc.mockResolvedValue({ data: { providerId: ID, code: CODE }, error: null });
    const { result } = renderHook(() => useMyBookingLink(true));
    expect(result.current.state.status).toBe('loading');
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', providerId: ID, code: CODE }));
    expect(mocks.rpc).toHaveBeenCalledWith('my_booking_link');
  });

  it('no pide nada si no está habilitado', () => {
    renderHook(() => useMyBookingLink(false));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['un error de la base de datos', { data: null, error: { message: 'x' } }],
    ['sin datos', { data: null, error: null }],
    ['una clave mal formada', { data: { providerId: ID, code: 'abc' }, error: null }],
    ['sin identificador', { data: { code: CODE }, error: null }],
  ])('%s es un error, nunca un enlace a medias', async (_label, response) => {
    mocks.rpc.mockResolvedValue(response);
    const { result } = renderHook(() => useMyBookingLink(true));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
  });

  it('una excepción de red también es un error, y reintentar lo recupera', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useMyBookingLink(true));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    mocks.rpc.mockResolvedValue({ data: { providerId: ID, code: CODE }, error: null });
    await act(async () => { await result.current.reload(); });
    expect(result.current.state.status).toBe('ready');
  });

  it('cambiar la clave actualiza el enlace', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { providerId: ID, code: CODE }, error: null });
    const { result } = renderHook(() => useMyBookingLink(true));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    mocks.rpc.mockResolvedValueOnce({ data: { providerId: ID, code: CODE2 }, error: null });
    let ok = false;
    await act(async () => { ok = await result.current.rotate(); });
    expect(ok).toBe(true);
    expect(mocks.rpc).toHaveBeenLastCalledWith('rotate_my_booking_link');
    expect(result.current.state).toEqual({ status: 'ready', providerId: ID, code: CODE2 });
    expect(result.current.rotating).toBe(false);
  });

  it('si cambiar la clave falla, se queda con la que tenía y avisa', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { providerId: ID, code: CODE }, error: null });
    const { result } = renderHook(() => useMyBookingLink(true));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    let ok = true;
    await act(async () => { ok = await result.current.rotate(); });
    expect(ok).toBe(false);
    expect(result.current.state).toEqual({ status: 'ready', providerId: ID, code: CODE });
    mocks.rpc.mockRejectedValueOnce(new Error('offline'));
    await act(async () => { ok = await result.current.rotate(); });
    expect(ok).toBe(false);
  });
});
