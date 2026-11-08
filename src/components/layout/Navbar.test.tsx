// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ role: 'gardener' as string | null, isTeam: false }));

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'ana@correo.com' }, signOut: vi.fn() }) }));
vi.mock('../../contexts/AccountContext', () => ({ useAccount: () => ({ role: mocks.role }) }));
vi.mock('../../hooks/useProviderMode', () => ({ useProviderMode: () => ({ isTeam: mocks.isTeam }) }));
vi.mock('../../hooks/useUnreadChats', () => ({ useUnreadChats: () => 0 }));
vi.mock('../../hooks/useStickyHeight', () => ({
  HEADER_PAD_VAR: '--app-header-pad', NAVBAR_HEIGHT_VAR: '--app-navbar-h', usePublishStickyHeight: () => undefined,
}));
vi.mock('../common/GarserLogo', () => ({ default: () => <span>GarSer</span> }));

import Navbar from './Navbar';

const at = (path: string, status: 'pending' | 'active' | 'denied' | null = 'active') =>
  render(<MemoryRouter initialEntries={[path]}><Navbar applicationStatus={status} /></MemoryRouter>);

describe('Navbar · etiqueta y menú según el modo (D31)', () => {
  beforeEach(() => { mocks.role = 'gardener'; mocks.isTeam = false; });
  afterEach(cleanup);

  it('un profesional individual lleva la etiqueta de siempre: «Jardinero»', () => {
    at('/dashboard');
    expect(screen.getAllByText('Jardinero').length).toBeGreaterThan(0);
    expect(screen.queryByText('Empresa')).toBeNull();
  });

  it('con equipo la etiqueta es «Empresa»; sin él, jamás', () => {
    mocks.isTeam = true;
    at('/empresa');
    expect(screen.getAllByText('Empresa').length).toBeGreaterThan(0);
    expect(screen.queryByText('Jardinero')).toBeNull();
  });

  it('solicitud pendiente o rechazada: la etiqueta lo dice y no habla de empresa, aunque el modo sea equipo', () => {
    mocks.isTeam = true;
    at('/status', 'pending');
    expect(screen.getAllByText('Jardinero (pendiente)').length).toBeGreaterThan(0);
    expect(screen.queryByText('Empresa')).toBeNull();
    cleanup();
    at('/status', 'denied');
    expect(screen.getAllByText('Jardinero (no aceptado)').length).toBeGreaterThan(0);
  });

  it('el profesional no ve las «Valoraciones» del cliente (las suyas están en su panel); el cliente sí', () => {
    at('/dashboard');
    fireEvent.click(screen.getByRole('button', { name: /menú|Menu/i }));
    expect(screen.queryByText('Valoraciones')).toBeNull();
    cleanup();
    mocks.role = 'client';
    at('/dashboard', null);
    fireEvent.click(screen.getByRole('button', { name: /menú|Menu/i }));
    expect(screen.getAllByText('Valoraciones').length).toBeGreaterThan(0);
  });

  it('con equipo, «Dashboard» queda marcado también estando en /empresa', () => {
    mocks.isTeam = true;
    at('/empresa/configuracion');
    const dashboard = screen.getAllByRole('button', { name: 'Dashboard' })[0];
    expect(dashboard.className).toContain('bg-green-100');
  });

  it('en modo individual, /empresa no marca ninguna entrada', () => {
    at('/empresa');
    const dashboard = screen.getAllByRole('button', { name: 'Dashboard' })[0];
    expect(dashboard.className).not.toContain('bg-green-100');
  });
});
