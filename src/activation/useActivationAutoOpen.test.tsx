// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProviderSetupSteps, type ProviderSetupStatus } from '../shared/providerSetup';
import { needsActivation, useActivationAutoOpen } from './useActivationAutoOpen';
import { pauseActivation, resumeActivation } from './activationFlow';

// Profesional con TODO lo del cuestionario hecho y solo el carnet fitosanitario por subir: el caso de
// Antonio en QA-108 y QA-196.
// `noSchedule` quita el horario: un paso que SÍ resuelve el cuestionario.
const base = (overrides: Partial<ProviderSetupStatus> = {}): ProviderSetupStatus => ({
  provider_id: 'prov-1',
  provider_kind: 'solo',
  suspended: false,
  window_days: 14,
  profile: { full_name: 'Antonio', address: 'Marbella', max_distance: 25, has_coordinates: true, has_description: true, has_photo: true },
  services: [
    { id: 'lawn', name: 'Corte de césped', service_active: true, needs_license: false, workers: 1, workers_with_hours: 1, licensed_workers_with_hours: 1, visible: true, visible_chemical: true },
    { id: 'phyto', name: 'Servicios fitosanitarios', service_active: true, needs_license: true, workers: 1, workers_with_hours: 1, licensed_workers_with_hours: 0, visible: false, visible_chemical: false },
  ],
  schedule: { has_recurring: true, free_hours_14d: 30 },
  license: { status: null, active: false },
  team: null,
  push_enabled: true,
  fee_waiver_enabled: false,
  ...overrides,
});

const Where: React.FC = () => <span data-testid="where">{useLocation().pathname}</span>;
const Panel: React.FC<{ status: ProviderSetupStatus }> = ({ status }) => {
  const wanted = useActivationAutoOpen(status);
  return <span data-testid="wanted">{String(wanted)}</span>;
};
const mount = (status: ProviderSetupStatus) =>
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Where />
      <Routes>
        <Route path="/dashboard" element={<Panel status={status} />} />
        <Route path="/activar" element={<span>cuestionario</span>} />
      </Routes>
    </MemoryRouter>,
  );

const noSchedule = { schedule: { has_recurring: false, free_hours_14d: 0 } };

describe('cuándo se abre solo «Activa tu cuenta»', () => {
  beforeEach(() => { resumeActivation(); localStorage.clear(); });
  afterEach(() => cleanup());

  it('el caso de partida: con el carnet sin subir hay un paso obligatorio por hacer', () => {
    const summary = buildProviderSetupSteps(base());
    expect(summary.required.some((s) => s.id === 'license' && s.state === 'todo')).toBe(true);
  });

  it('QA-202/QA-108 · SOLO falta el carnet: el cuestionario no se abre (no lo resuelve él; lo explica «Completa tu cuenta»)', () => {
    expect(needsActivation(base())).toBe(false);
  });

  it('QA-108 · una empresa a la que solo le falta que alguien de su equipo haga el servicio con carnet tampoco lo reabre (se asigna en «Equipo»)', () => {
    const owner = { member_id: 'm1', user_id: 'prov-1', role: 'owner' as const, name: 'Antonio', service_ids: ['lawn'], has_recurring_schedule: true, free_hours_14d: 40, license_status: null, has_valid_license: false };
    const marta = { ...owner, member_id: 'm2', user_id: 'u2', role: 'employee' as const, name: 'Marta' };
    const noOnePhyto = base().services.map((x) => (x.id === 'phyto' ? { ...x, workers: 0, workers_with_hours: 0 } : x));
    const status = base({
      provider_kind: 'company',
      services: noOnePhyto,
      team: { company_status: 'active', owner_works: true, employees: 1, pending_invitations: 0, members: [owner, marta] },
    });
    const todo = buildProviderSetupSteps(status).required.filter((s) => s.state === 'todo').map((s) => s.id);
    expect(todo).toContain('team_services'); // el paso pendiente existe de verdad…
    expect(needsActivation(status)).toBe(false); // …pero no lo resuelve el cuestionario
  });

  it('si falta algo que SÍ resuelve el cuestionario (el horario), se abre', () => {
    expect(needsActivation(base(noSchedule))).toBe(true);
  });

  it('QA-196/QA-108 · una vez TERMINADO no se reabre, falte lo que falte', () => {
    expect(needsActivation(base({ ...noSchedule, activation_done: true }))).toBe(false);
  });

  it('QA-196 · terminado, el panel no te manda otra vez a /activar al volver de «Ir a mi panel»', () => {
    const view = mount(base({ ...noSchedule, activation_done: true }));
    expect(view.getByTestId('where').textContent).toBe('/dashboard');
    expect(view.getByTestId('wanted').textContent).toBe('false');
  });

  it('sin terminar, sigue abriéndose solo, salvo que lo pause con «Seguir luego»', () => {
    const open = mount(base(noSchedule));
    expect(open.getByTestId('where').textContent).toBe('/activar');
    cleanup();
    pauseActivation();
    const paused = mount(base(noSchedule));
    expect(paused.getByTestId('where').textContent).toBe('/dashboard');
    expect(paused.getByTestId('wanted').textContent).toBe('true');
  });

  it('una cuenta suspendida nunca se abre', () => {
    expect(needsActivation(base({ ...noSchedule, suspended: true }))).toBe(false);
  });
});
