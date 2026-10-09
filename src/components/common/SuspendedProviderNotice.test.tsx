// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

let row: { suspended_at: string | null } | null = null;
const eq = vi.fn();
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: (...a: unknown[]) => { eq(...a); return { maybeSingle: async () => ({ data: row }) }; } }) }) },
}));

import SuspendedProviderNotice, { SUSPENDED_TITLE } from './SuspendedProviderNotice';

describe('aviso de cuenta suspendida (PR-02)', () => {
  afterEach(cleanup);

  it('sale si la ficha propia está suspendida', async () => {
    row = { suspended_at: '2026-10-09T10:00:00Z' };
    render(<SuspendedProviderNotice />);
    expect((await screen.findByRole('status')).textContent).toContain(SUSPENDED_TITLE);
    expect(eq).toHaveBeenCalledWith('user_id', 'u1');
  });

  it('no sale si está activa', async () => {
    row = { suspended_at: null };
    const { container } = render(<SuspendedProviderNotice />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe('');
  });
});
