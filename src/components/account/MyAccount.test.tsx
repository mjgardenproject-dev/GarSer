// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const updateCalls: Array<{ values: unknown; column: string; value: string }> = [];
let updatedRows: Array<{ user_id: string }> = [{ user_id: USER_ID }];
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('react-hot-toast', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: USER_ID, email: 'yo@ejemplo.com' }, signOut: vi.fn(), signOutEverywhere: vi.fn() }),
}));
vi.mock('../../contexts/AccountContext', () => ({ useAccount: () => ({ role: 'client' }) }));
vi.mock('./PushNotificationsCard', () => ({ default: () => null }));
vi.mock('../common/InstallAppPrompt', () => ({ default: () => null }));
vi.mock('../common/AppHeader', () => ({ default: () => null }));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ or: () => ({ limit: async () => ({ data: [{ user_id: USER_ID, full_name: 'Yo', role: 'client' }] }) }) }),
      update: (values: unknown) => ({
        eq: (column: string, value: string) => {
          updateCalls.push({ values, column, value });
          return { select: async () => ({ data: updatedRows, error: null }) };
        },
      }),
    }),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: 'https://cdn/foto.jpg' } }),
      }),
    },
  },
}));

import MyAccount from './MyAccount';

const pickPhotoAndSave = async () => {
  render(<MemoryRouter><MyAccount /></MemoryRouter>);
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:foto');
  fireEvent.change(input, { target: { files: [new File(['x'], 'foto.jpg', { type: 'image/jpeg' })] } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
};

describe('«Mi cuenta»: la foto (PH-01)', () => {
  afterEach(cleanup);
  beforeEach(() => {
    updateCalls.length = 0;
    updatedRows = [{ user_id: USER_ID }];
    toastSuccess.mockClear();
    toastError.mockClear();
  });

  it('guarda la foto en SU fila (user_id) y solo entonces dice «actualizada»', async () => {
    await pickPhotoAndSave();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Foto de perfil actualizada'));
    expect(updateCalls).toEqual([{ values: { avatar_url: 'https://cdn/foto.jpg' }, column: 'user_id', value: USER_ID }]);
  });

  it('si no se ha guardado ninguna fila, lo dice en vez de mentir', async () => {
    updatedRows = [];
    await pickPhotoAndSave();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('No se ha podido guardar la foto. Vuelve a intentarlo.'));
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
