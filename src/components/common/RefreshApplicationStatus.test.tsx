// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toast }));

import RefreshApplicationStatus, {
  REVIEW_APPROVED, REVIEW_CHECK_FAILED, REVIEW_REJECTED, REVIEW_STILL_PENDING,
} from './RefreshApplicationStatus';

describe('RefreshApplicationStatus (fallo 6: «no veo si me han aceptado»)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('es un botón con el texto «Actualizar estado» visible también en el móvil', () => {
    render(<RefreshApplicationStatus check={async () => 'pending'} />);
    const label = screen.getByText('Actualizar estado');
    expect(label.className).toContain('inline');
    expect(label.className).not.toContain('hidden');
  });

  it('si sigue en revisión, lo dice', async () => {
    render(<RefreshApplicationStatus check={async () => 'pending'} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar estado' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(REVIEW_STILL_PENDING, expect.objectContaining({ icon: '🕓' })));
  });

  it('si ya la han aceptado, avisa de que entra al panel', async () => {
    render(<RefreshApplicationStatus check={async () => 'approved'} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar estado' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(REVIEW_APPROVED, expect.anything()));
  });

  it('si la han rechazado, manda a mirar el motivo', async () => {
    render(<RefreshApplicationStatus check={async () => 'rejected'} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar estado' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(REVIEW_REJECTED, expect.anything()));
  });

  it('sin red, no se queda callado ni cambia nada: error con reintento posible', async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValueOnce('pending');
    render(<RefreshApplicationStatus check={check} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar estado' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REVIEW_CHECK_FAILED, expect.anything()));
    // El botón sigue disponible y funciona la segunda vez.
    await waitFor(() => expect((screen.getByRole('button', { name: 'Actualizar estado' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar estado' }));
    await waitFor(() => expect(check).toHaveBeenCalledTimes(2));
  });

  it('al volver a la app vuelve a comprobar en silencio y solo habla si ya la aceptaron', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const check = vi.fn().mockResolvedValueOnce('pending').mockResolvedValueOnce('approved');
    render(<RefreshApplicationStatus check={check} />);

    vi.setSystemTime(Date.now() + 11_000);
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    expect(toast).not.toHaveBeenCalled(); // sigue en revisión: ni un aviso
    expect(toast.success).not.toHaveBeenCalled();

    vi.setSystemTime(Date.now() + 11_000);
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(REVIEW_APPROVED, expect.anything()));
  });

  it('al volver sin red, no molesta', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const check = vi.fn().mockRejectedValue(new Error('offline'));
    render(<RefreshApplicationStatus check={check} />);
    vi.setSystemTime(Date.now() + 11_000);
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(check).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });
});
