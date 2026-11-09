// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: null as { id: string } | null,
  authLoading: false,
  fetchRole: vi.fn(),
  fetchMode: vi.fn(),
}));

vi.mock('./AuthContext', () => ({
  useAuth: () => ({ user: mocks.user, loading: mocks.authLoading }),
}));

vi.mock('../lib/adminAccess', () => ({
  fetchCurrentUserProfileRole: (userId: string) => mocks.fetchRole(userId),
}));

vi.mock('../lib/providerMode', () => ({ fetchProviderMode: () => mocks.fetchMode() }));

import { AccountProvider, useAccount } from './AccountContext';

const INDIVIDUAL = {
  isProfessional: true, mode: 'individual', hasTeamStructure: false, activeEmployees: 0,
  pendingInvitations: 0, ownerWorks: true, suspended: false, liabilityDeclared: false,
};
const TEAM = { ...INDIVIDUAL, mode: 'team', hasTeamStructure: true, activeEmployees: 1 };

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
    mocks.fetchMode.mockReset();
    mocks.fetchMode.mockResolvedValue(INDIVIDUAL);
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

  describe('modo del profesional (individual o equipo, D31–D39)', () => {
    let refreshMode: () => Promise<unknown>;
    const ModeProbe = () => {
      const { role, loading, providerMode, providerModeError, refreshProviderMode } = useAccount();
      refreshMode = refreshProviderMode;
      return (
        <p data-testid="mode">
          {loading ? 'cargando' : `rol:${role ?? 'ninguno'}|modo:${providerMode?.mode ?? 'ninguno'}|error:${providerModeError}`}
        </p>
      );
    };
    const mount = () => render(<AccountProvider><ModeProbe /></AccountProvider>);
    const text = () => screen.getByTestId('mode').textContent;

    it('un profesional carga su modo junto al rol, ANTES de dar la cuenta por cargada', async () => {
      mocks.user = { id: 'pro-1' };
      mocks.fetchRole.mockResolvedValue('gardener');
      mocks.fetchMode.mockResolvedValue(TEAM);
      mount();
      expect(text()).toBe('cargando');
      await waitFor(() => expect(text()).toBe('rol:gardener|modo:team|error:false'));
      expect(mocks.fetchMode).toHaveBeenCalledTimes(1);
    });

    it('un cliente, un empleado y un admin no piden el modo (no lo tienen)', async () => {
      for (const role of ['client', 'employee', 'admin']) {
        mocks.fetchMode.mockClear();
        mocks.user = { id: `u-${role}` };
        mocks.fetchRole.mockResolvedValue(role);
        const view = mount();
        await waitFor(() => expect(text()).toBe(`rol:${role}|modo:ninguno|error:false`));
        expect(mocks.fetchMode).not.toHaveBeenCalled();
        view.unmount();
      }
    });

    it('si el modo no se pudo leer, la sesión sigue (rol gardener), sin modo y con el error a la vista', async () => {
      mocks.user = { id: 'pro-1' };
      mocks.fetchRole.mockResolvedValue('gardener');
      mocks.fetchMode.mockRejectedValue(new Error('red caída'));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      mount();
      await waitFor(() => expect(text()).toBe('rol:gardener|modo:ninguno|error:true'));
      consoleError.mockRestore();
    });

    it('refreshProviderMode relee el modo SIN poner la cuenta en «cargando» (el titular ve cambiar el panel, no una pantalla de espera)', async () => {
      mocks.user = { id: 'pro-1' };
      mocks.fetchRole.mockResolvedValue('gardener');
      mount();
      await waitFor(() => expect(text()).toBe('rol:gardener|modo:individual|error:false'));
      mocks.fetchMode.mockResolvedValue(TEAM);
      const seen: string[] = [];
      let pending!: Promise<unknown>;
      await act(async () => {
        pending = refreshMode();
        seen.push(text() ?? '');
        await pending;
      });
      expect(seen).toEqual(['rol:gardener|modo:individual|error:false']);
      expect(text()).toBe('rol:gardener|modo:team|error:false');
    });

    it('si la relectura falla (sin red), conserva el último modo que se sabía', async () => {
      mocks.user = { id: 'pro-1' };
      mocks.fetchRole.mockResolvedValue('gardener');
      mocks.fetchMode.mockResolvedValue(TEAM);
      mount();
      await waitFor(() => expect(text()).toBe('rol:gardener|modo:team|error:false'));
      mocks.fetchMode.mockRejectedValue(new Error('sin red'));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      let result: unknown = 'sin-llamar';
      await act(async () => { result = await refreshMode(); });
      expect(result).toBeNull();
      expect(text()).toBe('rol:gardener|modo:team|error:false');
      consoleError.mockRestore();
    });

    it('una relectura que llega tarde no pisa a una más nueva', async () => {
      mocks.user = { id: 'pro-1' };
      mocks.fetchRole.mockResolvedValue('gardener');
      mount();
      await waitFor(() => expect(text()).toContain('modo:individual'));
      const slow = deferred<typeof TEAM>();
      mocks.fetchMode.mockReturnValueOnce(slow.promise);
      mocks.fetchMode.mockResolvedValueOnce(INDIVIDUAL);
      await act(async () => { void refreshMode(); });       // la lenta (todavía sin respuesta)
      await act(async () => { await refreshMode(); });       // la nueva, que responde enseguida
      await act(async () => slow.resolve(TEAM));             // la lenta llega tarde
      expect(text()).toBe('rol:gardener|modo:individual|error:false');
    });

    it('al volver a la app relee el modo, pero no antes de 20 s desde la última lectura (no machaca la red)', async () => {
      const now = vi.spyOn(Date, 'now');
      now.mockReturnValue(1_000_000);
      mocks.user = { id: 'pro-1' };
      mocks.fetchRole.mockResolvedValue('gardener');
      mount();
      await waitFor(() => expect(text()).toContain('modo:individual'));
      mocks.fetchMode.mockClear();
      mocks.fetchMode.mockResolvedValue(TEAM);

      now.mockReturnValue(1_000_000 + 5_000);
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
      expect(mocks.fetchMode).not.toHaveBeenCalled();

      now.mockReturnValue(1_000_000 + 25_000);
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
      await waitFor(() => expect(mocks.fetchMode).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(text()).toBe('rol:gardener|modo:team|error:false'));
      now.mockRestore();
    });

    it('al cerrar sesión no se arrastra el modo de la cuenta anterior', async () => {
      mocks.user = { id: 'pro-1' };
      mocks.fetchRole.mockResolvedValue('gardener');
      mocks.fetchMode.mockResolvedValue(TEAM);
      const view = mount();
      await waitFor(() => expect(text()).toContain('modo:team'));
      mocks.user = null;
      view.rerender(<AccountProvider><ModeProbe /></AccountProvider>);
      await waitFor(() => expect(text()).toBe('rol:ninguno|modo:ninguno|error:false'));
    });
  });

  it('useAccount fuera del proveedor avisa en vez de devolver un rol inventado', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow('useAccount must be used within AccountProvider');
    consoleError.mockRestore();
  });
});
