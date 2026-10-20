// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { TeamMember, TeamService } from '../../hooks/useCompanyTeam';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ data: {}, error: null as null | { message: string } })),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('../../lib/supabase', () => ({ supabase: { rpc: mocks.rpc, storage: { from: () => ({ upload: vi.fn() }) } } }));
vi.mock('react-hot-toast', () => ({ default: mocks.toast }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner-1' } }) }));

import TeamMemberCard from './TeamMemberCard';

const services: TeamService[] = [
  { id: 'lawn', name: 'Corte de césped' },
  { id: 'phyto', name: 'Servicios fitosanitarios' },
];

const member = (overrides: Partial<TeamMember> = {}): TeamMember => ({
  member_id: 'm-1', user_id: 'u-1', role: 'employee', status: 'active', counts_as_labour: true, joined_at: '2026-10-01',
  full_name: 'Pepe Ruiz', phone: null, email: 'pepe@correo.es', services: [{ id: 'lawn', name: 'Corte de césped' }],
  license_status: null, has_valid_phyto_license: false, ...overrides,
});

const renderCard = (m: TeamMember, onChanged = vi.fn()) => render(
  <MemoryRouter>
    <ul><TeamMemberCard member={m} offeredServices={services} offersChemical onChanged={onChanged} onAskDeactivate={vi.fn()} /></ul>
  </MemoryRouter>,
);

describe('TeamMemberCard · carnet fitosanitario', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('sin carnet: se lo puede pedir (le llega un aviso) o subirlo por él', async () => {
    const onChanged = vi.fn();
    renderCard(member(), onChanged);
    expect(screen.getByText('Sin carnet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Pedírselo/ }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('request_member_phyto_license', { p_member_id: 'm-1' }));
    expect(mocks.toast.success).toHaveBeenCalledWith('Le hemos avisado a Pepe Ruiz por correo y en el móvil');
    expect(onChanged).toHaveBeenCalled();
  });

  it('pedido hoy: el botón queda como «Pedido» y dice cuándo', () => {
    renderCard(member({ license_requested_at: new Date().toISOString() }));
    expect((screen.getByRole('button', { name: /Pedido/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Se lo pediste hoy.')).toBeTruthy();
  });

  it('rechazado: enseña el motivo, y «Subir su carnet» abre la hoja para enviarlo en su nombre', () => {
    renderCard(member({ license_status: 'rejected', license_rejection_reason: 'Falta la otra cara.' }));
    expect(screen.getByText('Motivo: Falta la otra cara. Puede subirlo de nuevo, o súbelo tú.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Subir su carnet/ }));
    const dialog = screen.getByRole('dialog', { name: 'Carnet de Pepe Ruiz' });
    expect(within(dialog).getByText(/Declaro que es el carnet de Pepe Ruiz/)).toBeTruthy();
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Cerrar' })[0]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('en revisión o aprobado: nada que pedir ni subir; aprobado deja asignar fitosanitarios', () => {
    renderCard(member({ license_status: 'pending', license_submitted_at: new Date().toISOString() }));
    expect(screen.getByText('En revisión')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Pedírselo|Subir su carnet/ })).toBeNull();
    cleanup();

    const inAYear = new Date(Date.now() + 365 * 86_400_000).toISOString();
    renderCard(member({ license_status: 'approved', has_valid_phyto_license: true, license_expires_at: inAYear }));
    expect(screen.getByText('Carnet aprobado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Pedírselo|Subir su carnet/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Servicios/ }));
    const phyto = screen.getByRole('checkbox', { name: /Servicios fitosanitarios/ }) as HTMLInputElement;
    expect(phyto.disabled).toBe(false);
  });

  it('sin carnet aprobado no se le pueden marcar fitosanitarios', () => {
    renderCard(member());
    fireEvent.click(screen.getByRole('button', { name: /Servicios/ }));
    expect((screen.getByRole('checkbox', { name: /Servicios fitosanitarios/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/pídeselo o súbelo tú/)).toBeTruthy();
  });

  it('el titular no lleva este bloque (su carnet está en «Tu empresa»)', () => {
    renderCard(member({ role: 'owner', member_id: 'm-0' }));
    expect(screen.queryByText('Carnet fitosanitario')).toBeNull();
  });
});
