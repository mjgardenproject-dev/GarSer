// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: mocks.rpc, functions: { invoke: mocks.invoke } } }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import AccountClosureAdmin from './AccountClosureAdmin';

const search = async (email: string) => {
  fireEvent.change(screen.getByLabelText('Correo de la cuenta'), { target: { value: email } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Revisar/ })); });
};

describe('Dar de baja o suspender una cuenta (F6)', () => {
  afterEach(() => { cleanup(); mocks.rpc.mockReset(); mocks.invoke.mockReset(); });

  it('bloqueada: explica por qué y no ofrece borrar ni dar de baja', async () => {
    mocks.rpc.mockResolvedValue({ data: { exists: true, userId: 'u1', email: 'e@x.es', role: 'company', mode: 'blocked',
      company: { id: 'c', status: 'active', name: 'Jardines', activeEmployees: 1 },
      blockers: [{ code: 'open_bookings', message: 'Tiene 2 reserva(s) sin terminar' }] }, error: null });
    render(<AccountClosureAdmin />);
    await search('e@x.es');
    expect(screen.getByText('Aún no se puede dar de baja')).toBeTruthy();
    expect(screen.getByText('Tiene 2 reserva(s) sin terminar')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Borrar cuenta|Dar de baja/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Suspender/ })).toBeTruthy();
  });

  it('sin historial ofrece borrar; con historial, dar de baja; un cliente no se suspende', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { exists: true, userId: 'u2', email: 'c@x.es', role: 'client', mode: 'delete', blockers: [] }, error: null });
    render(<AccountClosureAdmin />);
    await search('c@x.es');
    expect(screen.getByRole('button', { name: /Borrar cuenta/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Suspender/ })).toBeNull();
    mocks.rpc.mockResolvedValueOnce({ data: { exists: true, userId: 'u3', email: 'h@x.es', role: 'client', mode: 'deactivate', blockers: [] }, error: null });
    await search('h@x.es');
    expect(screen.getByRole('button', { name: /Dar de baja/ })).toBeTruthy();
  });

  it('si no existe lo dice', async () => {
    mocks.rpc.mockResolvedValue({ data: { exists: false }, error: null });
    render(<AccountClosureAdmin />);
    await search('nadie@x.es');
    expect(screen.getByText('No hay ninguna cuenta con ese correo.')).toBeTruthy();
  });
});
