// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { email: 'admin@test.local' }, signOut: vi.fn() }) }));

const rpc = vi.fn();
const incidentsCount = vi.fn();
vi.mock('../../lib/supabase', () => {
  const query = { select: () => query, in: () => incidentsCount() };
  return { supabase: { from: () => query, rpc: (...args: unknown[]) => rpc(...args) } };
});

import AdminLayout from './AdminLayout';

const renderLayout = () => render(<MemoryRouter initialEntries={['/admin/dashboard']}><AdminLayout /></MemoryRouter>);
const badgeOf = (label: string) => {
  // El menú se pinta dos veces (escritorio y móvil): se mira el del escritorio, el primero.
  const link = screen.getAllByRole('link', { name: new RegExp(`^${label}`) })[0];
  return within(link).queryByText(/^\d+\+?$/)?.textContent ?? null;
};

describe('panel de admin: «Mi cuenta» (pruebas en garser.es, 2026-10-12)', () => {
  beforeEach(() => {
    rpc.mockResolvedValue({ data: { gardenerApplications: 0, companyApplications: 0, licenses: 0, incidents: 0 }, error: null });
    incidentsCount.mockResolvedValue({ count: 0 });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('lleva a /account en el menú lateral y en el del móvil', () => {
    renderLayout();
    const links = screen.getAllByRole('link', { name: 'Mi cuenta' });
    expect(links).toHaveLength(2);
    links.forEach((link) => expect(link.getAttribute('href')).toBe('/account'));
  });
});

describe('panel de admin: contadores de lo que espera su revisión', () => {
  beforeEach(() => {
    incidentsCount.mockResolvedValue({ count: 0 });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('muestra solicitudes (jardinero + empresa), carnets e incidencias pendientes', async () => {
    rpc.mockResolvedValue({ data: { gardenerApplications: 2, companyApplications: 1, licenses: 4, incidents: 3 }, error: null });
    renderLayout();
    await waitFor(() => expect(badgeOf('Usuarios')).toBe('3'));
    expect(badgeOf('Certificados Fito.')).toBe('4');
    expect(badgeOf('Incidencias')).toBe('3');
    expect(rpc).toHaveBeenCalledWith('admin_pending_review_counts');
    // Con la función disponible no hace falta la consulta de respaldo.
    expect(incidentsCount).not.toHaveBeenCalled();
  });

  it('sin nada pendiente no pinta ningún número', async () => {
    rpc.mockResolvedValue({ data: { gardenerApplications: 0, companyApplications: 0, licenses: 0, incidents: 0 }, error: null });
    renderLayout();
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(badgeOf('Usuarios')).toBeNull();
    expect(badgeOf('Certificados Fito.')).toBeNull();
    expect(badgeOf('Incidencias')).toBeNull();
  });

  it('si la función aún no está en la base, las incidencias siguen saliendo como antes', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function not found' } });
    incidentsCount.mockResolvedValue({ count: 5 });
    renderLayout();
    await waitFor(() => expect(badgeOf('Incidencias')).toBe('5'));
    expect(badgeOf('Usuarios')).toBeNull();
    expect(badgeOf('Certificados Fito.')).toBeNull();
  });
});
