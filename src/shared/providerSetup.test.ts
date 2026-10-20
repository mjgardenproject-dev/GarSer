import { describe, expect, it } from 'vitest';
import {
  buildProviderSetupSteps,
  joinNames,
  type ProviderSetupMember,
  type ProviderSetupService,
  type ProviderSetupStatus,
} from './providerSetup';

const service = (overrides: Partial<ProviderSetupService> = {}): ProviderSetupService => ({
  id: 'svc-lawn',
  name: 'Corte de césped',
  service_active: true,
  needs_license: false,
  workers: 1,
  workers_with_hours: 1,
  licensed_workers_with_hours: 1,
  visible: true,
  visible_chemical: true,
  ...overrides,
});

const phyto = (overrides: Partial<ProviderSetupService> = {}) =>
  service({ id: 'svc-phyto', name: 'Servicios fitosanitarios', needs_license: true, ...overrides });

const member = (overrides: Partial<ProviderSetupMember> = {}): ProviderSetupMember => ({
  member_id: 'm-owner',
  user_id: 'u-owner',
  role: 'owner',
  name: 'Laura Gómez',
  service_ids: ['svc-lawn'],
  has_recurring_schedule: true,
  free_hours_14d: 40,
  license_status: null,
  has_valid_license: false,
  ...overrides,
});

function solo(overrides: Partial<ProviderSetupStatus> = {}): ProviderSetupStatus {
  return {
    provider_id: 'prov-1',
    provider_kind: 'solo',
    suspended: false,
    window_days: 14,
    profile: {
      full_name: 'Miguel Ruiz',
      address: 'Marbella',
      max_distance: 25,
      has_coordinates: true,
      has_description: true,
      has_photo: true,
    },
    services: [service()],
    schedule: { has_recurring: true, free_hours_14d: 30 },
    license: { status: null, active: false },
    team: null,
    push_enabled: true,
    fee_waiver_enabled: false,
    ...overrides,
  };
}

/** Un jardinero recién aprobado: nada configurado. */
const freshSolo = () =>
  solo({
    profile: { full_name: 'Miguel Ruiz', address: 'Marbella', max_distance: 25, has_coordinates: false, has_description: false, has_photo: false },
    services: [],
    schedule: { has_recurring: false, free_hours_14d: 0 },
    push_enabled: false,
  });

function company(overrides: Partial<ProviderSetupStatus> = {}, members: ProviderSetupMember[] = [member()]): ProviderSetupStatus {
  return solo({
    provider_kind: 'company',
    team: { company_status: 'active', owner_works: members.some((m) => m.role === 'owner'), employees: 0, pending_invitations: 0, members },
    ...overrides,
  });
}

const stepById = (summary: ReturnType<typeof buildProviderSetupSteps>, id: string) =>
  [...summary.required, ...summary.recommended].find((s) => s.id === id);

describe('joinNames', () => {
  it('une como en castellano', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B'])).toBe('A y B');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B y C');
  });
});

describe('buildProviderSetupSteps · jardinero', () => {
  it('recién aprobado: no aparece y empieza por los servicios', () => {
    const summary = buildProviderSetupSteps(freshSolo());
    expect(summary.required.map((s) => s.id)).toEqual(['services', 'coverage', 'schedule']);
    expect(summary.required.every((s) => s.state === 'todo')).toBe(true);
    expect(summary.requiredDone).toBe(0);
    expect(summary.nextStep?.id).toBe('services');
    expect(summary.nextStep?.cta?.target).toEqual({ kind: 'profile', tab: 'services' });
    expect(summary.headline).toMatchObject({ tone: 'warning', title: 'Todavía no apareces a los clientes' });
    expect(summary.headline.detail).toContain('faltan 3 pasos');
    expect(summary.share.show).toBe(false);
    expect(summary.recommended.map((s) => [s.id, s.state])).toEqual([['photo', 'todo'], ['description', 'todo'], ['push', 'todo']]);
  });

  it('todo hecho: aparece en todos sus servicios y puede compartir su enlace', () => {
    const summary = buildProviderSetupSteps(solo({ fee_waiver_enabled: true }));
    expect(summary.allRequiredDone).toBe(true);
    expect(summary.headline).toMatchObject({ tone: 'success', title: 'Ya apareces a los clientes' });
    expect(summary.visibleServices).toEqual(['Corte de césped']);
    expect(summary.share).toEqual({ show: true, feeWaiver: true });
    expect(summary.nextStep).toBeNull();
    expect(stepById(summary, 'coverage')?.detail).toBe('Hasta 25 km desde Marbella.');
    expect(stepById(summary, 'schedule')?.detail).toBe('30 horas libres en los próximos 14 días.');
  });

  it('sin el carnet, con fitosanitarios: sale en los ecológicos y le falta el carnet', () => {
    const summary = buildProviderSetupSteps(solo({ services: [service(), phyto({ visible_chemical: false, licensed_workers_with_hours: 0 })] }));
    const license = stepById(summary, 'license');
    expect(license?.state).toBe('todo');
    expect(license?.detail).toContain('ecológicos');
    expect(license?.cta?.target).toEqual({ kind: 'profile', tab: 'personal' });
    expect(summary.nextStep?.id).toBe('license');
    expect(summary.headline.tone).toBe('info');
    expect(summary.headline.title).toBe('Ya apareces en Corte de césped y Servicios fitosanitarios');
    expect(summary.headline.detail).toBe('Completa 1 paso más para salir también en los tratamientos con producto químico.');
  });

  it('el carnet no se pide si no ofrece nada que lo necesite', () => {
    expect(stepById(buildProviderSetupSteps(solo()), 'license')).toBeUndefined();
  });

  it('carnet en revisión: no es el siguiente paso (no puede hacer nada)', () => {
    const summary = buildProviderSetupSteps(solo({ services: [phyto()], license: { status: 'pending', active: false } }));
    expect(stepById(summary, 'license')?.state).toBe('review');
    expect(summary.nextStep?.id).not.toBe('license');
  });

  it('carnet caducado: aviso y botón para renovarlo', () => {
    const summary = buildProviderSetupSteps(solo({ services: [phyto()], license: { status: 'expired', active: false } }));
    expect(stepById(summary, 'license')).toMatchObject({ state: 'warning', cta: { label: 'Renovar carnet' } });
  });

  it('carnet vigente: hecho aunque no haya fila en la tabla de carnets', () => {
    const summary = buildProviderSetupSteps(solo({ services: [phyto()], license: { status: null, active: true } }));
    expect(stepById(summary, 'license')?.state).toBe('done');
  });

  it('agenda llena: avisa en vez de pedir crear horario', () => {
    const summary = buildProviderSetupSteps(solo({
      schedule: { has_recurring: true, free_hours_14d: 0 },
      services: [service({ visible: false, workers_with_hours: 0 })],
    }));
    expect(stepById(summary, 'schedule')).toMatchObject({ state: 'warning', cta: { label: 'Abrir más horas', target: { kind: 'schedule' } } });
    expect(summary.headline.title).toBe('Todavía no apareces a los clientes');
  });

  it('cuenta suspendida: lo dice primero y no ofrece compartir el enlace', () => {
    const summary = buildProviderSetupSteps(solo({ suspended: true, services: [service({ visible: false })] }));
    expect(summary.headline).toMatchObject({ tone: 'danger', title: 'Tu cuenta está suspendida' });
    expect(summary.share.show).toBe(false);
  });
});

describe('buildProviderSetupSteps · empresa', () => {
  it('recién aprobada: tiene sus propios pasos y los que dependen de otros esperan', () => {
    const summary = buildProviderSetupSteps(company({
      profile: { full_name: 'Jardines Sol', address: 'Málaga', max_distance: 30, has_coordinates: false, has_description: true, has_photo: false },
      services: [],
    }, []));
    expect(summary.required.map((s) => [s.id, s.state])).toEqual([
      ['services', 'todo'],
      ['coverage', 'todo'],
      ['team', 'todo'],
      ['team_services', 'blocked'],
      ['schedule', 'blocked'],
    ]);
    expect(stepById(summary, 'team')?.cta?.target).toEqual({ kind: 'team' });
    expect(stepById(summary, 'photo')?.title).toBe('Logo o foto');
  });

  it('dice qué servicio no hace nadie', () => {
    const summary = buildProviderSetupSteps(company({
      services: [service(), service({ id: 'svc-hedge', name: 'Poda de setos', workers: 0, workers_with_hours: 0, visible: false })],
    }));
    expect(stepById(summary, 'team_services')).toMatchObject({ state: 'todo', detail: 'Nadie de tu equipo hace Poda de setos. Asígnalo a alguien.' });
    expect(summary.hiddenServices).toEqual(['Poda de setos']);
    expect(summary.headline.detail).toContain('Poda de setos');
  });

  it('un empleado sin horario: el botón lleva a su horario', () => {
    const ana = member({ member_id: 'm-ana', user_id: 'u-ana', role: 'employee', name: 'Ana Pérez', service_ids: ['svc-lawn'], has_recurring_schedule: false, free_hours_14d: 0 });
    const summary = buildProviderSetupSteps(company(
      { services: [service({ workers_with_hours: 0, visible: false })] },
      [ana],
    ));
    const schedule = stepById(summary, 'schedule');
    expect(schedule?.state).toBe('todo');
    expect(schedule?.detail).toContain('Ana (sin horario)');
    expect(schedule?.cta).toEqual({ label: 'Horario de Ana', target: { kind: 'member_schedule', memberId: 'm-ana' } });
  });

  it('el dueño con la agenda llena: aviso y botón a su horario', () => {
    const summary = buildProviderSetupSteps(company(
      { services: [service({ workers_with_hours: 0, visible: false })] },
      [member({ free_hours_14d: 0 })],
    ));
    expect(stepById(summary, 'schedule')).toMatchObject({ state: 'warning', cta: { label: 'Abrir mi horario', target: { kind: 'schedule' } } });
  });

  it('fitosanitarios sin nadie con carnet: el dueño que trabaja puede subir el suyo', () => {
    const summary = buildProviderSetupSteps(company(
      { services: [service(), phyto({ visible_chemical: false, licensed_workers_with_hours: 0 })] },
      [member({ service_ids: ['svc-lawn', 'svc-phyto'] })],
    ));
    expect(stepById(summary, 'license')).toMatchObject({ state: 'todo', title: 'Carnets fitosanitarios', cta: { target: { kind: 'company_license' } } });
  });

  it('fitosanitarios con un carnet en revisión', () => {
    const ana = member({ member_id: 'm-ana', role: 'employee', name: 'Ana Pérez', service_ids: ['svc-phyto'], license_status: 'pending' });
    const summary = buildProviderSetupSteps(company({ services: [phyto({ visible_chemical: false })] }, [ana]));
    expect(stepById(summary, 'license')).toMatchObject({ state: 'review' });
    expect(stepById(summary, 'license')?.detail).toContain('Ana');
  });

  it('fitosanitarios con alguien con carnet que lo hace: hecho', () => {
    const summary = buildProviderSetupSteps(company(
      { services: [phyto()] },
      [member({ service_ids: ['svc-phyto'], has_valid_license: true, license_status: 'approved' })],
    ));
    expect(stepById(summary, 'license')?.state).toBe('done');
    expect(summary.allRequiredDone).toBe(true);
  });
});
