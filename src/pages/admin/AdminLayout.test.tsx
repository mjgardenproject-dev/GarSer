// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { email: 'admin@test.local' }, signOut: vi.fn() }) }));
vi.mock('../../lib/supabase', () => {
  const query = { select: () => query, in: () => Promise.resolve({ count: 0 }) };
  return { supabase: { from: () => query } };
});

import AdminLayout from './AdminLayout';

describe('panel de admin: «Mi cuenta» (pruebas en garser.es, 2026-10-12)', () => {
  afterEach(cleanup);

  it('lleva a /account en el menú lateral y en el del móvil', () => {
    render(<MemoryRouter initialEntries={['/admin/dashboard']}><AdminLayout /></MemoryRouter>);
    const links = screen.getAllByRole('link', { name: 'Mi cuenta' });
    expect(links).toHaveLength(2);
    links.forEach((link) => expect(link.getAttribute('href')).toBe('/account'));
  });
});
