// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: null as { id: string } | null,
  authLoading: false,
  fetchRole: vi.fn(),
}));

vi.mock('./AuthContext', () => ({
  useAuth: () => ({ user: mocks.user, loading: mocks.authLoading }),
}));

vi.mock('../lib/adminAccess', () => ({
  fetchCurrentUserProfileRole: (userId: string) => mocks.fetchRole(userId),
}));

import { AccountProvider, useAccount } from './AccountContext';

const Probe = () => {
  const { role, loading } = useAccount();
  return <p data-testid="probe">{loading ? 'cargando' : `rol:${role ?? 'ninguno'}`}</p>;
};

const renderWithProvider = () =>
  render(
    <AccountProvider>
      <Probe />
    </AccountProvider>,
  );

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('AccountContext', () => {
  beforeEach(() => {
    mocks.user = null;
    mocks.authLoading = false;
    mocks.fetchRole.mockReset();
  });

  afterEach(() => cleanup());

  it('sin sesión no consulta nada y no deja la app cargando', async () => {
    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('rol:ninguno'));
    expect(mocks.fetchRole).not.toHaveBeenCalled();
  });

  it('con sesión lee el rol de profiles una sola vez y lo expone', async () => {
    mocks.user = { id: 'jardinero-1' };
    mocks.fetchRole.mockResolvedValue('gardener');
    renderWithProvider();
    expect(screen.getByTestId('probe').textContent).toBe('cargando');
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('rol:gardener'));
    expect(mocks.fetchRole).toHaveBeenCalledTimes(1);
    expect(mocks.fetchRole).toHaveBeenCalledWith('jardinero-1');
  });

  it('mientras la autenticación carga, espera y no consulta', () => {
    mocks.user = { id: 'cliente-1' };
    mocks.authLoading = true;
    renderWithProvider();
    expect(screen.getByTestId('probe').textContent).toBe('cargando');
    expect(mocks.fetchRole).not.toHaveBeenCalled();
  });

  it('si la consulta falla, el rol queda en null (mínimo privilegio), nunca en el anterior', async () => {
    mocks.user = { id: 'cliente-1' };
    mocks.fetchRole.mockRejectedValue(new Error('red caída'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('rol:ninguno'));
    consoleError.mockRestore();
  });

  it('una respuesta tardía de la sesión anterior no pisa la de la sesión actual', async () => {
    const adminAnswer = deferred<string>();
    const clientAnswer = deferred<string>();
    mocks.fetchRole.mockImplementation((userId: string) =>
      userId === 'admin-1' ? adminAnswer.promise : clientAnswer.promise,
    );

    mocks.user = { id: 'admin-1' };
    const view = renderWithProvider();

    // Cierra sesión y entra otra cuenta antes de que responda la primera consulta.
    mocks.user = { id: 'cliente-1' };
    view.rerender(
      <AccountProvider>
        <Probe />
      </AccountProvider>,
    );

    await act(async () => clientAnswer.resolve('client'));
    await act(async () => adminAnswer.resolve('admin'));

    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('rol:client'));
  });

  it('useAccount fuera del proveedor avisa en vez de devolver un rol inventado', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow('useAccount must be used within AccountProvider');
    consoleError.mockRestore();
  });
});
