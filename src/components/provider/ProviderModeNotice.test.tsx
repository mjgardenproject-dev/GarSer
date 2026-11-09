// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  mode: {} as Record<string, unknown>,
  navigate: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../../hooks/useProviderMode', () => ({ useProviderMode: () => mocks.mode }));

import ProviderModeNotice from './ProviderModeNotice';
import { readLastSeenMode, writeLastSeenMode } from '../../lib/providerModeNotice';

const set = (mode: 'individual' | 'team' | null, over: Record<string, unknown> = {}) => {
  mocks.mode = { loading: false, mode, isApprovedProfessional: mode !== null, ...over };
};

describe('ProviderModeNotice · aviso de la transición individual ⇄ equipo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.user = { id: 'u1' };
    set('individual');
  });
  afterEach(cleanup);

  it('la primera vez que se ve la cuenta no avisa de nada y apunta el modo', () => {
    render(<ProviderModeNotice />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(readLastSeenMode('u1')).toBe('individual');
  });

  it('individual → equipo: «Ya tienes equipo», con lo que cambia y lo que sigue igual, y «Ver mi equipo» lleva al panel de equipo', () => {
    writeLastSeenMode('u1', 'individual');
    set('team');
    render(<ProviderModeNotice />);
    const dialog = screen.getByRole('dialog', { name: 'Ya tienes equipo' });
    expect(dialog.textContent).toMatch(/Qué cambia/);
    expect(dialog.textContent).toMatch(/Qué sigue igual/);
    expect(dialog.textContent).toMatch(/Tus reseñas y tus reservas/);
    fireEvent.click(screen.getByRole('button', { name: 'Ver mi equipo' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/empresa');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(readLastSeenMode('u1')).toBe('team');
  });

  it('equipo → individual: «Vuelves al modo individual: tu panel es el de siempre», y «Entendido» no navega', () => {
    writeLastSeenMode('u1', 'team');
    set('individual');
    render(<ProviderModeNotice />);
    const dialog = screen.getByRole('dialog', { name: 'Vuelves al modo individual' });
    expect(dialog.textContent).toMatch(/Tu panel es el de siempre/);
    fireEvent.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sale UNA vez por cambio: ni al repintar ni al volver a abrir la app', () => {
    writeLastSeenMode('u1', 'individual');
    set('team');
    const view = render(<ProviderModeNotice />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ver mi equipo' }));
    view.rerender(<ProviderModeNotice />);
    expect(screen.queryByRole('dialog')).toBeNull();
    view.unmount();
    render(<ProviderModeNotice />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('el aviso se apunta como visto aunque la persona cierre la app sin tocarlo', () => {
    writeLastSeenMode('u1', 'team');
    set('individual');
    const view = render(<ProviderModeNotice />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    view.unmount();
    render(<ProviderModeNotice />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sin cambio de modo, sin sesión, sin ser profesional aprobado o mientras carga: nada', () => {
    writeLastSeenMode('u1', 'individual');
    set('individual');
    const a = render(<ProviderModeNotice />); expect(screen.queryByRole('dialog')).toBeNull(); a.unmount();

    set('team', { loading: true });
    const b = render(<ProviderModeNotice />); expect(screen.queryByRole('dialog')).toBeNull(); b.unmount();

    set('team', { isApprovedProfessional: false });
    const c = render(<ProviderModeNotice />); expect(screen.queryByRole('dialog')).toBeNull(); c.unmount();

    mocks.user = null;
    set('team');
    render(<ProviderModeNotice />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cada cuenta tiene su propio último modo (otra persona en el mismo navegador no hereda avisos)', () => {
    writeLastSeenMode('u1', 'individual');
    mocks.user = { id: 'u2' };
    set('team');
    render(<ProviderModeNotice />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(readLastSeenMode('u2')).toBe('team');
    expect(readLastSeenMode('u1')).toBe('individual');
  });
});
