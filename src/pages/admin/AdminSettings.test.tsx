// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchAppSettings: vi.fn(),
  updateAppSettings: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../config/appSettings', () => ({
  DEFAULT_APP_SETTINGS: { businessName: 'GarSer', contactEmail: 'info@garser.es', contactPhone: '' },
  fetchAppSettings: mocks.fetchAppSettings,
  updateAppSettings: mocks.updateAppSettings,
}));

vi.mock('react-hot-toast', () => ({ default: mocks.toast }));

import AdminSettings from './AdminSettings';

const renderPage = () =>
  render(
    <MemoryRouter>
      <AdminSettings />
    </MemoryRouter>,
  );

describe('AdminSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchAppSettings.mockResolvedValue({ businessName: 'GarSer', contactEmail: 'info@garser.es', contactPhone: '' });
    mocks.updateAppSettings.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it('sigue guardando los datos de contacto', async () => {
    renderPage();
    const phone = await screen.findByLabelText(/Teléfono de contacto/);
    fireEvent.change(phone, { target: { value: '+34 600 000 000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(mocks.updateAppSettings).toHaveBeenCalledWith(expect.objectContaining({ contactPhone: '+34 600 000 000' })));
  });

  // El «sin gastos para los clientes propios» era un interruptor aquí. Ahora son las reglas de
  // Comisiones: no puede quedar un segundo control que las contradiga.
  it('ya no tiene el interruptor de «sin gastos de gestión» y manda a Comisiones', async () => {
    renderPage();
    await screen.findByLabelText(/Teléfono de contacto/);
    expect(screen.queryByRole('switch')).toBeNull();
    const link = screen.getByRole('link', { name: 'Comisiones' });
    expect(link.getAttribute('href')).toBe('/admin/commissions');
  });
});
