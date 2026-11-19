// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderSetupStatus } from '../../shared/providerSetup';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  pending: 0,
  status: null as ProviderSetupStatus | null,
  createInvitation: vi.fn(),
  setServiceActive: vi.fn(async () => undefined),
  rpc: vi.fn(async () => ({ data: null, error: null })),
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: mocks.rpc, from: vi.fn() } }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('../../hooks/useProviderMode', () => ({ useProviderMode: () => ({ isTeam: false }) }));
vi.mock('../../hooks/usePendingRequestCount', () => ({ usePendingRequestCount: () => mocks.pending }));
vi.mock('../../hooks/useProviderSetupStatus', () => ({
  useProviderSetupStatus: () => ({ status: mocks.status, loading: false, error: null, refresh: vi.fn(async () => undefined) }),
}));
vi.mock('../../activation/activationData', () => ({
  loadActivationData: vi.fn(async () => ({
    firstName: 'Antonio',
    address: 'Marbella',
    maxDistance: 25,
    hasCoordinates: true,
    preselectedServices: ['Corte de césped'],
    estimatedTeamSize: 3,
    serviceIds: { 'Corte de césped': 'svc-lawn' },
    serviceUnits: { 'Corte de césped': 'area' },
    savedServices: { 'Corte de césped': { config: { ok: true }, active: false } },
    schedule: { rules: [], weeksToMaintain: 4, minNoticeHours: 24 },
  })),
  saveCoverage: vi.fn(),
  saveServiceConfig: vi.fn(),
}));
vi.mock('../../utils/serviceActivation', () => ({
  isSavedServiceConfigValid: () => true,
  setServiceActive: mocks.setServiceActive,
}));
vi.mock('../../utils/teamInvitations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/teamInvitations')>()),
  createTeamInvitation: mocks.createInvitation,
  setInvitationPreset: vi.fn(async () => undefined),
}));
vi.mock('../../components/activation/PhytoStep', () => ({ default: () => <div>fitosanitarios</div> }));
vi.mock('../../components/account/PushNotificationsCard', () => ({ default: () => <div>push</div> }));
vi.mock('../../hooks/useMyBookingLink', () => ({ useMyBookingLink: () => ({ state: { status: 'loading' } }) }));
vi.mock('../../utils/recurringSchedulePersistence', () => ({ saveOwnRecurringSchedule: vi.fn(async () => undefined) }));

import ActivationWizardPage from './ActivationWizardPage';
import { isActivationDoneLocally, readTeamDraft, writeActivationProgress } from '../../activation/activationFlow';
import { needsActivation } from '../../activation/useActivationAutoOpen';

const withLicenseTodo = (): ProviderSetupStatus => ({
  provider_id: 'u1',
  provider_kind: 'solo',
  suspended: false,
  window_days: 14,
  profile: { full_name: 'Antonio', address: 'Marbella', max_distance: 25, has_coordinates: true, has_description: true, has_photo: true },
  services: [
    { id: 'svc-lawn', name: 'Corte de césped', service_active: true, needs_license: false, workers: 1, workers_with_hours: 1, licensed_workers_with_hours: 1, visible: true, visible_chemical: true },
    { id: 'svc-phyto', name: 'Servicios fitosanitarios', service_active: true, needs_license: true, workers: 1, workers_with_hours: 1, licensed_workers_with_hours: 0, visible: false, visible_chemical: false },
  ],
  schedule: { has_recurring: true, free_hours_14d: 30 },
  license: { status: null, active: false },
  team: null,
  push_enabled: true,
  fee_waiver_enabled: false,
});

const open = async (step: 'team' | 'finish' | 'welcome') => {
  writeActivationProgress('u1', { step, selectedServices: ['Corte de césped'] });
  const view = render(<MemoryRouter><ActivationWizardPage /></MemoryRouter>);
  await waitFor(() => expect(screen.queryByText('Cargando')).toBeNull());
  return view;
};

describe('Activa tu cuenta (paquete 1.12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    mocks.pending = 0;
    mocks.status = withLicenseTodo();
  });
  afterEach(() => cleanup());

  it('QA-024 · la Bienvenida dice que la solicitud está aprobada', async () => {
    await open('welcome');
    expect(await screen.findByText('Te hemos aprobado')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Empezar' })).toBeTruthy();
  });

  it('QA-062 · con solicitudes sin responder, el cuestionario lo avisa y lleva a verlas (pausándose)', async () => {
    mocks.pending = 2;
    await open('welcome');
    expect(await screen.findByText('Tienes 2 solicitudes de reserva sin responder.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Verlas' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/dashboard?tab=requests');
    expect(sessionStorage.getItem('garser:activation:paused')).toBe('1');
  });

  it('OBS-ACT-01 · el aviso solo va en la Bienvenida (en los pasos siguientes quitaba espacio en el SE)', async () => {
    mocks.pending = 2;
    await open('team');
    await screen.findByRole('radio', { name: /Sí/ });
    expect(screen.queryByText(/solicitudes de reserva sin responder/)).toBeNull();
  });

  it('QA-062 · sin solicitudes pendientes no sale el aviso', async () => {
    await open('welcome');
    await screen.findByText('Te hemos aprobado');
    expect(screen.queryByText(/solicitud(es)? de reserva sin responder/)).toBeNull();
  });

  it('QA-025 · el motivo del error del equipo sale JUNTO al botón fijo, no al final de la página', async () => {
    await open('team');
    fireEvent.click(await screen.findByRole('radio', { name: /Sí/ }));
    fireEvent.change(screen.getByLabelText('Correo de la persona 1'), { target: { value: 'marta@ejemplo.es' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar invitaciones y seguir' }));
    const alert = await screen.findByText('Para invitar a tu equipo, marca la declaración del seguro.');
    expect(alert.getAttribute('role')).toBe('alert');
    // Está dentro del pie fijo (sticky bottom), donde también está el botón principal.
    const footer = alert.closest('.sticky');
    expect(footer).not.toBeNull();
    expect(footer?.textContent).toContain('Enviar invitaciones y seguir');
    expect(mocks.createInvitation).not.toHaveBeenCalled();
  });

  it('QA-025 · el aviso de error no viaja a otro paso: al volver atrás desaparece', async () => {
    await open('team');
    fireEvent.click(await screen.findByRole('radio', { name: /Sí/ }));
    fireEvent.change(screen.getByLabelText('Correo de la persona 1'), { target: { value: 'marta@ejemplo.es' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar invitaciones y seguir' }));
    await screen.findByText('Para invitar a tu equipo, marca la declaración del seguro.');
    fireEvent.click(screen.getByRole('button', { name: 'Atrás' }));
    expect(screen.queryByText('Para invitar a tu equipo, marca la declaración del seguro.')).toBeNull();
  });

  it('QA-025 · un correo mal escrito: el aviso general también va junto al botón', async () => {
    await open('team');
    fireEvent.click(await screen.findByRole('radio', { name: /Sí/ }));
    fireEvent.change(screen.getByLabelText('Correo de la persona 1'), { target: { value: 'no-es-un-correo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar invitaciones y seguir' }));
    const alert = await screen.findByText('Revisa los correos marcados en rojo.');
    expect(alert.closest('.sticky')?.textContent).toContain('Enviar invitaciones y seguir');
  });

  it('QA-026 · recargar no borra lo escrito en las invitaciones', async () => {
    const first = await open('team');
    fireEvent.click(await screen.findByRole('radio', { name: /Sí/ }));
    fireEvent.change(screen.getByLabelText('Correo de la persona 1'), { target: { value: 'marta@ejemplo.es' } });
    await waitFor(() => expect(readTeamDraft('u1')?.team.emails[0]).toBe('marta@ejemplo.es'));
    first.unmount();
    // «Recargar»: se monta de nuevo con lo que quedó guardado en el navegador.
    render(<MemoryRouter><ActivationWizardPage /></MemoryRouter>);
    const input = (await screen.findByLabelText('Correo de la persona 1')) as HTMLInputElement;
    expect(input.value).toBe('marta@ejemplo.es');
    expect(screen.getByRole('radio', { name: /Sí/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('QA-196/QA-108 · al activar con el carnet pendiente: «Ir a mi panel» va al panel y el cuestionario no vuelve a abrirse solo', async () => {
    await open('finish');
    fireEvent.click(await screen.findByRole('button', { name: 'Activar mi cuenta' }));
    expect(await screen.findByText('Tu cuenta está casi lista')).toBeTruthy();
    expect(isActivationDoneLocally('u1')).toBe(true);
    expect(readTeamDraft('u1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ir a mi panel' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/dashboard');
    // El estado que verá el panel: terminado → no se reabre aunque el carnet siga por subir.
    expect(needsActivation({ ...withLicenseTodo(), activation_done: isActivationDoneLocally('u1') })).toBe(false);
  });

  it('QA-197 · en el resultado no se sugiere subir la foto si ya la tiene', async () => {
    await open('finish');
    fireEvent.click(await screen.findByRole('button', { name: 'Activar mi cuenta' }));
    await screen.findByText('Tu cuenta está casi lista');
    expect(screen.queryByText('Sube tu foto o tu logo')).toBeNull();
    cleanup();
    localStorage.clear();
    mocks.status = { ...withLicenseTodo(), profile: { ...withLicenseTodo().profile, has_photo: false } };
    await open('finish');
    fireEvent.click(await screen.findByRole('button', { name: 'Activar mi cuenta' }));
    expect(await screen.findByText('Sube tu foto o tu logo')).toBeTruthy();
  });
});
