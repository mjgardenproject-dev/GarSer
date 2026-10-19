// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchAppSettings: vi.fn(),
  updateAppSettings: vi.fn(),
  fetchOwnClientsFeeWaiverEnabled: vi.fn(),
  updateOwnClientsFeeWaiverEnabled: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../config/appSettings', () => ({
  DEFAULT_APP_SETTINGS: { businessName: 'GarSer', contactEmail: 'info@garser.es', contactPhone: '' },
  fetchAppSettings: mocks.fetchAppSettings,
  updateAppSettings: mocks.updateAppSettings,
  fetchOwnClientsFeeWaiverEnabled: mocks.fetchOwnClientsFeeWaiverEnabled,
  updateOwnClientsFeeWaiverEnabled: mocks.updateOwnClientsFeeWaiverEnabled,
}));

vi.mock('react-hot-toast', () => ({ default: mocks.toast }));

import AdminSettings from './AdminSettings';

// Lanzamiento (2026-10): interruptor «sin gastos de gestión para los clientes propios».
describe('AdminSettings: interruptor del lanzamiento', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchAppSettings.mockResolvedValue({ businessName: 'GarSer', contactEmail: 'info@garser.es', contactPhone: '' });
    mocks.fetchOwnClientsFeeWaiverEnabled.mockResolvedValue(false);
    mocks.updateOwnClientsFeeWaiverEnabled.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it('muestra el estado y solo lo cambia tras confirmar', async () => {
    render(<AdminSettings />);

    const toggle = await screen.findByRole('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Desactivado')).toBeTruthy();

    fireEvent.click(toggle);
    // Toca lo que pagan los clientes: nada se guarda sin confirmar.
    expect(mocks.updateOwnClientsFeeWaiverEnabled).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, activar' }));

    await waitFor(() => expect(mocks.updateOwnClientsFeeWaiverEnabled).toHaveBeenCalledWith(true));
    expect(await screen.findByText('Activado')).toBeTruthy();
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });

  it('si se cancela, no cambia nada', async () => {
    render(<AdminSettings />);
    fireEvent.click(await screen.findByRole('switch'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(mocks.updateOwnClientsFeeWaiverEnabled).not.toHaveBeenCalled();
    expect(screen.getByText('Desactivado')).toBeTruthy();
  });

  it('si no se puede leer el ajuste, no enseña un estado inventado', async () => {
    mocks.fetchOwnClientsFeeWaiverEnabled.mockRejectedValue(new Error('column does not exist'));
    render(<AdminSettings />);
    expect(await screen.findByText('No se ha podido leer este ajuste. Recarga la página.')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
