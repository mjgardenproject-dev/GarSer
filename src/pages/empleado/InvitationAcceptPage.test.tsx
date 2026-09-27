// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// D21 / H-39: el empleado invitado crea su contraseña en la propia invitación y entra directo a
// su panel; si ya tiene cuenta, entra y se une en el mismo paso.
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  rpc: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: mocks.rpc, functions: { invoke: mocks.invoke } },
}));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, signIn: mocks.signIn, signOut: mocks.signOut }),
}));
vi.mock('../../contexts/AccountContext', () => ({
  useAccount: () => ({ role: null, loading: false, refresh: mocks.refresh }),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/common/GarserLogo', () => ({ default: () => null }));

import InvitationAcceptPage from './InvitationAcceptPage';

const renderPage = () => render(
  <MemoryRouter initialEntries={['/invitacion?token=tok123']}>
    <Routes>
      <Route path="/invitacion" element={<InvitationAcceptPage />} />
      <Route path="/mi-trabajo" element={<p>Panel de empleado</p>} />
    </Routes>
  </MemoryRouter>,
);

describe('InvitationAcceptPage sin sesión (D21)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.rpc.mockImplementation(async (fn: string) => (
      fn === 'invitation_preview'
        ? { data: { state: 'valid', company_name: 'Jardines Sol', email: 'ana@correo.com' }, error: null }
        : { data: {}, error: null }
    ));
    mocks.signIn.mockResolvedValue(undefined);
    mocks.refresh.mockResolvedValue(undefined);
  });
  afterEach(() => cleanup());

  it('crea la cuenta con nombre y contraseña, entra y llega a su panel', async () => {
    mocks.invoke.mockResolvedValue({ data: { ok: true, email: 'ana@correo.com' }, error: null });
    renderPage();
    expect(await screen.findByText('Jardines Sol te invita a su equipo')).toBeTruthy();
    expect((screen.getByLabelText('Tu correo') as HTMLInputElement).value).toBe('ana@correo.com');
    fireEvent.change(screen.getByLabelText('Tu nombre'), { target: { value: 'Ana Pérez' } });
    fireEvent.change(screen.getByLabelText('Elige una contraseña'), { target: { value: 'ClaveSegura1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unirme al equipo' }));

    expect(await screen.findByText('Panel de empleado')).toBeTruthy();
    expect(mocks.invoke).toHaveBeenCalledWith('company-invitation-signup', {
      body: { token: 'tok123', fullName: 'Ana Pérez', password: 'ClaveSegura1' },
    });
    expect(mocks.signIn).toHaveBeenCalledWith('ana@correo.com', 'ClaveSegura1');
  });

  it('no envía nada con una contraseña de menos de 8', async () => {
    renderPage();
    await screen.findByText('Jardines Sol te invita a su equipo');
    fireEvent.change(screen.getByLabelText('Tu nombre'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Elige una contraseña'), { target: { value: '1234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unirme al equipo' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('si ya tiene cuenta con ese correo, pide su contraseña, entra y se une', async () => {
    mocks.invoke.mockResolvedValue({ data: { ok: false, error: 'account_exists' }, error: null });
    renderPage();
    await screen.findByText('Jardines Sol te invita a su equipo');
    fireEvent.change(screen.getByLabelText('Tu nombre'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Elige una contraseña'), { target: { value: 'ClaveSegura1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unirme al equipo' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Entrar y unirme' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Tu contraseña'), { target: { value: 'MiClaveDeSiempre' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar y unirme' }));

    expect(await screen.findByText('Panel de empleado')).toBeTruthy();
    expect(mocks.signIn).toHaveBeenCalledWith('ana@correo.com', 'MiClaveDeSiempre');
    expect(mocks.rpc).toHaveBeenCalledWith('accept_company_invitation', { p_token: 'tok123' });
  });
});
