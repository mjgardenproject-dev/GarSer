// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('react-hot-toast', () => ({ toast: mocks.toast, default: mocks.toast }));

import BookingLinkCard from './BookingLinkCard';

const ID = '11111111-1111-4111-8111-111111111111';
const CODE = '0123456789abcdef0123456789abcdef';
const CODE2 = 'fedcba9876543210fedcba9876543210';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: { providerId: ID, code: CODE }, error: null });
});
afterEach(() => cleanup());

describe('BookingLinkCard', () => {
  it('enseña el enlace con su clave y lo copia', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<BookingLinkCard />);
    const input = (await screen.findByLabelText('Tu enlace de reserva')) as HTMLInputElement;
    expect(input.value).toBe(`${window.location.origin}/reservar/${ID}?c=${CODE}`);
    fireEvent.click(screen.getByRole('button', { name: /Copiar/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(input.value));
    expect(mocks.toast.success).toHaveBeenCalledWith('Enlace copiado');
  });

  it('si no carga, no hay enlace que copiar y se puede reintentar', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    render(<BookingLinkCard />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByLabelText('Tu enlace de reserva')).toBeNull();
    expect(screen.queryByRole('button', { name: /Copiar/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/ }));
    expect(await screen.findByLabelText('Tu enlace de reserva')).toBeTruthy();
  });

  it('cambiar el enlace pide confirmación y deja claro que los anteriores dejan de servir', async () => {
    render(<BookingLinkCard />);
    await screen.findByLabelText('Tu enlace de reserva');
    fireEvent.click(screen.getByRole('button', { name: /Cambiar mi enlace/ }));
    expect(await screen.findByText(/dejarán de servir para reservar sin gastos de gestión/)).toBeTruthy();
    // Cancelar no toca nada.
    fireEvent.click(screen.getByRole('button', { name: /No, dejarlo como está/ }));
    expect(mocks.rpc).not.toHaveBeenCalledWith('rotate_my_booking_link');

    mocks.rpc.mockResolvedValueOnce({ data: { providerId: ID, code: CODE2 }, error: null });
    fireEvent.click(screen.getByRole('button', { name: /Cambiar mi enlace/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Sí, cambiar mi enlace/ }));
    await waitFor(() => expect((screen.getByLabelText('Tu enlace de reserva') as HTMLInputElement).value).toContain(CODE2));
    expect(mocks.toast.success).toHaveBeenCalledWith('Enlace cambiado. Reparte el nuevo.');
  });

  it('si el cambio falla, lo dice y conserva el enlace', async () => {
    render(<BookingLinkCard />);
    await screen.findByLabelText('Tu enlace de reserva');
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /Cambiar mi enlace/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Sí, cambiar mi enlace/ }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
    expect((screen.getByLabelText('Tu enlace de reserva') as HTMLInputElement).value).toContain(CODE);
  });
});
