// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const restart = vi.fn();
vi.mock('../../utils/gardenerApplicationRetry', () => ({ restartRejectedApplication: () => restart() }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, signOut: vi.fn() }) }));

import GardenerStatusPage from './GardenerStatusPage';

describe('«Corregir y volver a enviar» (PH-02)', () => {
  const assign = vi.fn();
  beforeEach(() => {
    restart.mockReset();
    assign.mockReset();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign } });
    localStorage.setItem('gardener_wizard_progress_u1', '{"step":3}');
  });
  afterEach(cleanup);

  const open = () => {
    render(<MemoryRouter><GardenerStatusPage status="denied" denialReason="Faltan fotos" /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Corregir y volver a enviar' }));
  };

  it('reabre la solicitud en el servidor, borra el borrador local viejo y lleva al formulario', async () => {
    restart.mockResolvedValue(undefined);
    open();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/apply'));
    expect(restart).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('gardener_wizard_progress_u1')).toBeNull();
  });

  it('si no se puede, lo dice y se queda donde está', async () => {
    restart.mockRejectedValue(new Error('Solo se puede corregir una solicitud rechazada.'));
    open();
    expect((await screen.findByRole('alert')).textContent).toBe('Solo se puede corregir una solicitud rechazada.');
    expect(assign).not.toHaveBeenCalled();
    expect(localStorage.getItem('gardener_wizard_progress_u1')).toBe('{"step":3}');
  });
});
