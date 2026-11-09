// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  mode: {} as Record<string, unknown>,
  refresh: vi.fn(),
  rpc: vi.fn(),
  invitations: [] as Array<{ id: string; email: string; expires_at: string }>,
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../hooks/useProviderMode', () => ({ useProviderMode: () => ({ ...mocks.mode, refresh: mocks.refresh }) }));
vi.mock('react-hot-toast', () => ({ default: mocks.toast }));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: mocks.rpc,
    functions: { invoke: vi.fn(async () => ({ error: null })) },
    from: () => ({
      select: () => ({ is: () => ({ is: () => ({ gt: () => ({ order: async () => ({ data: mocks.invitations, error: null }) }) }) }) }),
    }),
  },
}));

import TeamEntryCard from './TeamEntryCard';

const set = (over: Record<string, unknown> = {}) => {
  mocks.mode = {
    isApprovedProfessional: true, isIndividual: true, isTeam: false, suspended: false, pendingInvitations: 0,
    hasTeamStructure: false, error: false, ...over,
  };
};

describe('TeamEntryCard · «¿Trabajas con más gente?»', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invitations = [];
    mocks.refresh.mockResolvedValue({ mode: 'individual' });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    set();
  });
  afterEach(cleanup);

  it('un profesional individual ve la pregunta discreta y el botón', () => {
    render(<TeamEntryCard />);
    expect(screen.getByRole('heading', { name: '¿Trabajas con más gente?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Añadir a mi equipo' })).toBeTruthy();
    expect(screen.queryByText(/Invitaciones pendientes/)).toBeNull();
  });

  it('no sale en modo equipo (allí el equipo ya es el panel), sin ser profesional aprobado, ni suspendido', () => {
    for (const over of [
      { isIndividual: false, isTeam: true },
      { isApprovedProfessional: false },
      { suspended: true },
    ]) {
      set(over);
      const { container, unmount } = render(<TeamEntryCard />);
      expect(container.textContent).toBe('');
      unmount();
    }
  });

  it('el botón abre la hoja: qué cambia, qué sigue igual y la frase del seguro (aún no hay empresa)', () => {
    render(<TeamEntryCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Añadir a mi equipo' }));
    const dialog = screen.getByRole('dialog', { name: 'Añade a tu equipo' });
    expect(within(dialog).getByText('Qué cambia')).toBeTruthy();
    expect(within(dialog).getByText(/Agenda por persona/)).toBeTruthy();
    expect(within(dialog).getByText('Qué sigue igual')).toBeTruthy();
    expect(within(dialog).getByText(/Tus servicios y precios/)).toBeTruthy();
    expect(within(dialog).getByText(/seguro de responsabilidad civil/)).toBeTruthy();
    expect(within(dialog).getByText(/tu cuenta sigue como está/)).toBeTruthy();
  });

  it('si la empresa ya existe (hubo equipo antes), no se vuelve a pedir el seguro', () => {
    set({ hasTeamStructure: true });
    render(<TeamEntryCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Añadir a mi equipo' }));
    expect(within(screen.getByRole('dialog')).queryByText(/seguro de responsabilidad civil/)).toBeNull();
  });

  it('en individual, ni una palabra de empresa: ni la tarjeta ni la hoja', () => {
    render(<TeamEntryCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Añadir a mi equipo' }));
    expect(document.body.textContent).not.toMatch(/empresa/i);
  });

  it('con invitaciones pendientes las lista con su fecha y avisa de que la cuenta no cambia', async () => {
    mocks.invitations = [{ id: 'i1', email: 'ana@correo.com', expires_at: '2026-12-01T10:00:00Z' }];
    set({ pendingInvitations: 1, hasTeamStructure: true });
    render(<TeamEntryCard />);
    expect(await screen.findByText('ana@correo.com')).toBeTruthy();
    expect(screen.getByText('Invitaciones pendientes (1)')).toBeTruthy();
    expect(screen.getByText('Mientras no acepten, tu cuenta no cambia.')).toBeTruthy();
    expect(screen.getByText(/Caduca el/)).toBeTruthy();
  });

  it('«Anular» pide confirmación, anula en el servidor y relee el modo', async () => {
    mocks.invitations = [{ id: 'i1', email: 'ana@correo.com', expires_at: '2026-12-01T10:00:00Z' }];
    set({ pendingInvitations: 1, hasTeamStructure: true });
    render(<TeamEntryCard />);
    fireEvent.click(await screen.findByRole('button', { name: /Anular/ }));
    expect(screen.getByRole('dialog', { name: '¿Anular la invitación?' })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Anular' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('revoke_company_invitation', { p_invitation_id: 'i1' }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(mocks.toast.success).toHaveBeenCalledWith('Invitación anulada');
  });

  it('«¿Ya ha aceptado? Actualizar» relee el modo; si sigue individual lo dice', async () => {
    set({ pendingInvitations: 1, hasTeamStructure: true });
    mocks.invitations = [{ id: 'i1', email: 'ana@correo.com', expires_at: '2026-12-01T10:00:00Z' }];
    render(<TeamEntryCard />);
    fireEvent.click(await screen.findByRole('button', { name: /Actualizar/ }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Todo al día: tu cuenta sigue en modo individual.'));
  });

  it('si no se pudo comprobar, lo dice en vez de callarse', async () => {
    mocks.refresh.mockResolvedValue(null);
    set({ pendingInvitations: 1, hasTeamStructure: true });
    mocks.invitations = [{ id: 'i1', email: 'ana@correo.com', expires_at: '2026-12-01T10:00:00Z' }];
    render(<TeamEntryCard />);
    fireEvent.click(await screen.findByRole('button', { name: /Actualizar/ }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
  });

  it('si la lectura del modo falló, ofrece reintentar (no se esconde ni se inventa un modo)', () => {
    set({ error: true });
    render(<TeamEntryCard />);
    expect(screen.getByRole('status').textContent).toMatch(/No hemos podido comprobar si tu cuenta tiene equipo/);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
