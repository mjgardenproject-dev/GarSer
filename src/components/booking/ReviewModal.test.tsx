// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  existing: [] as Array<Record<string, unknown>>,
  insert: vi.fn(async () => ({ error: null })),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ order: () => ({ limit: async () => ({ data: mocks.existing }) }), limit: async () => ({ data: mocks.existing }) }),
          order: () => ({ limit: async () => ({ data: mocks.existing }) }),
          limit: async () => ({ data: mocks.existing }),
        }),
      }),
      insert: mocks.insert,
    }),
  },
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'cliente-1' } }) }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../utils/reviewService', () => ({ canEditReview: () => true, updateOwnReview: vi.fn() }));

import ReviewModal from './ReviewModal';

const open = async () => {
  render(<ReviewModal bookingId="b1" gardenerId="g1" gardenerName="Antonio" onClose={vi.fn()} />);
  await screen.findByText('Puntuación');
};

describe('ReviewModal (QA-116: la valoración no llega puesta)', () => {
  beforeEach(() => { mocks.existing = []; mocks.insert.mockClear(); });
  afterEach(() => cleanup());

  it('arranca sin estrellas y no deja enviar sin puntuar', async () => {
    await open();
    expect(screen.getByText('Sin puntuar')).toBeTruthy();
    const send = screen.getByRole('button', { name: 'Enviar valoración' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await act(async () => { fireEvent.click(send); });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('al tocar una estrella se puede enviar con esa nota', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: '4 estrellas' }));
    expect(screen.getByText('4,0 / 5')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enviar valoración' })); });
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ rating: 4 }));
  });

  it('no ofrece media estrella como nota (el mínimo que admite la base de datos es 1)', async () => {
    await open();
    expect(screen.queryByRole('button', { name: '0.5 estrellas' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '1 estrella' }));
    expect(screen.getByText('1,0 / 5')).toBeTruthy();
  });

  it('una valoración ya hecha se abre con su nota', async () => {
    mocks.existing = [{ id: 'r1', rating: 3.5, comment: 'Bien', created_at: new Date().toISOString() }];
    await open();
    expect(screen.getByText('3,5 / 5')).toBeTruthy();
  });
});
