// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MemberSetupNotices, { membersToSetUp, missingSetup } from './MemberSetupNotices';
import type { TeamMember } from '../../hooks/useCompanyTeam';

const member = (over: Partial<TeamMember>): TeamMember => ({
  member_id: 'm1', user_id: 'u1', role: 'employee', status: 'active', counts_as_labour: true, joined_at: '2026-09-28',
  full_name: 'Ana García', phone: null, email: 'ana@x.es', services: [], license_status: null, has_valid_phyto_license: false,
  has_recurring_schedule: false, is_configured: false, ...over,
});

const renderNotices = (members: TeamMember[], onConfigureServices = vi.fn()) =>
  render(<MemoryRouter><MemberSetupNotices members={members} onConfigureServices={onConfigureServices} /></MemoryRouter>);

describe('Aviso de empleados por configurar (R-04)', () => {
  afterEach(() => cleanup());

  it('sale para un empleado activo sin horario ni servicios, y dice qué le falta', () => {
    renderNotices([member({})]);
    expect(screen.getByText(/ha aceptado tu solicitud de unirse a tu equipo/)).toBeTruthy();
    expect(screen.getByText('Le falta: horario fijo · servicios')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Configurar a Ana' }).getAttribute('href')).toBe('/empresa/equipo/m1/horario');
  });

  it('con horario pero sin servicios, el botón lleva a sus servicios', () => {
    const onServices = vi.fn();
    renderNotices([member({ has_recurring_schedule: true })], onServices);
    expect(screen.getByText('Le falta: servicios')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Configurar a Ana' }));
    expect(onServices).toHaveBeenCalledWith('m1');
  });

  it('no sale si ya está configurado, si es el dueño o si está de baja', () => {
    const members = [
      member({ member_id: 'a', is_configured: true, has_recurring_schedule: true, services: [{ id: 's', name: 'Césped' }] }),
      member({ member_id: 'b', role: 'owner' }),
      member({ member_id: 'c', status: 'inactive' }),
    ];
    expect(membersToSetUp(members)).toHaveLength(0);
    const { container } = renderNotices(members);
    expect(container.textContent).toBe('');
  });

  it('sin nombre todavía, el botón dice «Configurar» (no el correo entero)', () => {
    renderNotices([member({ full_name: null })]);
    expect(screen.getByRole('link', { name: 'Configurar' })).toBeTruthy();
    expect(screen.getByText('ana@x.es')).toBeTruthy();
  });

  it('solo sin servicios', () => {
    expect(missingSetup(member({ has_recurring_schedule: true }))).toEqual(['servicios']);
  });
});
