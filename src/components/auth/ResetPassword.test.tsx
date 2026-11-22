// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  session: null as null | { user: { email: string } },
  updateUser: vi.fn(),
  signOut: vi.fn(async (..._args: unknown[]) => ({ error: null })),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: mocks.session } }),
      updateUser: (...a: unknown[]) => mocks.updateUser(...a),
      signOut: (...a: unknown[]) => mocks.signOut(...a),
    },
  },
}));
vi.mock('react-hot-toast', () => ({ default: mocks.toast }));

import ResetPassword from './ResetPassword';

const renderPage = () => render(
  <MemoryRouter initialEntries={['/reset-password']}>
    <Routes>
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/dashboard" element={<p>Inicio de la cuenta</p>} />
      <Route path="/auth" element={<p>Pantalla de entrar</p>} />
    </Routes>
  </MemoryRouter>,
);

describe('ResetPassword (QA-040: clara, y dice de qué cuenta es)', () => {
  beforeEach(() => { mocks.session = { user: { email: 'ana@ejemplo.com' } }; vi.clearAllMocks(); mocks.updateUser.mockResolvedValue({ error: null }); });
  afterEach(cleanup);

  it('explica qué hace y de qué cuenta es', async () => {
    renderPage();
    expect(await screen.findByText('ana@ejemplo.com')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Elige tu nueva contraseña' })).toBeTruthy();
    expect(document.body.textContent).toContain('al menos 8 caracteres');
    expect(document.body.textContent).toContain('Cerraremos la sesión en tus otros dispositivos');
  });

  it('con el enlace caducado o ya usado, lo dice y lleva a pedir otro (no un formulario muerto)', async () => {
    mocks.session = null;
    renderPage();
    expect(await screen.findByText(/Este enlace ya no sirve/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Guardar nueva contraseña' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pedir un enlace nuevo' }));
    expect(await screen.findByText('Pantalla de entrar')).toBeTruthy();
  });

  it('las contraseñas se comprueban junto al campo, no con un cartel de 5 s', async () => {
    renderPage();
    await screen.findByText('ana@ejemplo.com');
    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'corta' } });
    fireEvent.change(screen.getByLabelText('Repite la contraseña'), { target: { value: 'corta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nueva contraseña' }));
    expect((await screen.findByText('Usa al menos 8 caracteres.')).getAttribute('role')).toBe('alert');
    expect(mocks.updateUser).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'larguisima1' } });
    fireEvent.change(screen.getByLabelText('Repite la contraseña'), { target: { value: 'otra-distinta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nueva contraseña' }));
    expect((await screen.findByText('Las contraseñas no coinciden.')).getAttribute('role')).toBe('alert');
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('el error de un campo se quita en cuanto se corrige (no deja un mensaje falso mientras escribes)', async () => {
    renderPage();
    await screen.findByText('ana@ejemplo.com');
    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'corta' } });
    fireEvent.change(screen.getByLabelText('Repite la contraseña'), { target: { value: 'distinta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nueva contraseña' }));
    await screen.findByText('Usa al menos 8 caracteres.');
    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'larguisima1' } });
    expect(screen.queryByText('Usa al menos 8 caracteres.')).toBeNull();
    // El otro campo sigue mal y su error se mantiene hasta que lo arregle.
    expect(screen.getByText('Las contraseñas no coinciden.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Repite la contraseña'), { target: { value: 'larguisima1' } });
    expect(screen.queryByText('Las contraseñas no coinciden.')).toBeNull();
  });

  it('guarda la contraseña, cierra las otras sesiones y entra a su inicio con un aviso claro', async () => {
    renderPage();
    await screen.findByText('ana@ejemplo.com');
    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'larguisima1' } });
    fireEvent.change(screen.getByLabelText('Repite la contraseña'), { target: { value: 'larguisima1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nueva contraseña' }));
    expect(await screen.findByText('Inicio de la cuenta')).toBeTruthy();
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'larguisima1' });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'others' });
    expect(mocks.toast.success).toHaveBeenCalledWith('Contraseña cambiada. Ya has entrado con la nueva.', expect.objectContaining({ duration: 8000 }));
  });

  it('si el servidor la rechaza, lo explica en español', async () => {
    mocks.updateUser.mockResolvedValue({ error: { message: 'New password should be different from the old password.', code: 'same_password' } });
    renderPage();
    await screen.findByText('ana@ejemplo.com');
    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'larguisima1' } });
    fireEvent.change(screen.getByLabelText('Repite la contraseña'), { target: { value: 'larguisima1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nueva contraseña' }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
    expect(String(mocks.toast.error.mock.calls[0][0])).not.toMatch(/should be different/);
  });
});
