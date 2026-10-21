// Completar la cuenta profesional (2026-10-20): de la verdad del servidor (my_provider_setup_status /
// admin_provider_setup_overview, migración 20261020120000) a los pasos que ve el profesional y el
// admin. Función pura: el servidor decide qué está hecho con las mismas reglas que deciden quién
// sale en «Profesionales»; aquí solo se ordena y se cuenta.

export type ProviderKind = 'solo' | 'company';
export type LicenseStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface ProviderSetupService {
  id: string;
  name: string;
  service_active: boolean;
  /** Fitosanitarios, o desbroce con herbicida: los tratamientos químicos piden carnet. */
  needs_license: boolean;
  /** Personas que pueden hacerlo (autónomo: él; empresa: quien lo tiene asignado y trabaja). */
  workers: number;
  workers_with_hours: number;
  licensed_workers_with_hours: number;
  /** Sale a los clientes (para fitosanitarios, al menos en los ecológicos). */
  visible: boolean;
  visible_chemical: boolean;
}

export interface ProviderSetupMember {
  member_id: string;
  user_id: string;
  role: 'owner' | 'manager' | 'employee';
  name: string | null;
  service_ids: string[];
  has_recurring_schedule: boolean;
  free_hours_14d: number;
  license_status: LicenseStatus | null;
  has_valid_license: boolean;
}

export interface ProviderSetupTeam {
  company_status: string;
  owner_works: boolean;
  employees: number;
  pending_invitations: number;
  /** Solo quien trabaja: el dueño si «también trabaja» y los empleados activos. */
  members: ProviderSetupMember[];
}

export interface ProviderSetupStatus {
  provider_id: string;
  provider_kind: ProviderKind;
  suspended: boolean;
  window_days: number;
  profile: {
    full_name: string | null;
    address: string | null;
    max_distance: number | null;
    has_coordinates: boolean;
    has_description: boolean;
    has_photo: boolean;
  };
  services: ProviderSetupService[];
  schedule: { has_recurring: boolean; free_hours_14d: number };
  license: { status: LicenseStatus | null; active: boolean };
  team: ProviderSetupTeam | null;
  push_enabled: boolean;
  fee_waiver_enabled: boolean;
}

export type SetupStepId =
  | 'services'
  | 'coverage'
  | 'team'
  | 'team_services'
  | 'schedule'
  | 'license'
  | 'photo'
  | 'description'
  | 'push';

/** done: hecho · todo: por hacer · review: lo está revisando GarSer · warning: estaba y ya no
 * (caducado, agenda llena) · blocked: falta un paso anterior. */
export type SetupStepState = 'done' | 'todo' | 'review' | 'warning' | 'blocked';

/** Adónde lleva cada botón. Cada panel lo traduce a su pantalla. */
export type SetupTarget =
  | { kind: 'profile'; tab: 'services' | 'coverage' | 'personal' }
  /** `recurring`: abre en «Horario fijo» (crear el horario semanal). */
  | { kind: 'schedule'; tab?: 'recurring' }
  | { kind: 'member_schedule'; memberId: string; tab?: 'recurring' }
  | { kind: 'team' }
  | { kind: 'company_license' }
  | { kind: 'account' }
  /** Apartado «Marketing»: flyer, tarjetas, vinilo… */
  | { kind: 'marketing' };

export interface SetupStep {
  id: SetupStepId;
  title: string;
  detail: string;
  state: SetupStepState;
  cta?: { label: string; target: SetupTarget };
}

export interface ProviderSetupSummary {
  kind: ProviderKind;
  suspended: boolean;
  required: SetupStep[];
  recommended: SetupStep[];
  requiredDone: number;
  requiredTotal: number;
  recommendedDone: number;
  allRequiredDone: boolean;
  /** El primer paso que se puede hacer ya: obligatorio si queda alguno, si no, recomendado. */
  nextStep: SetupStep | null;
  visibleServices: string[];
  /** Servicios ofrecidos que hoy no salen a ningún cliente. */
  hiddenServices: string[];
  headline: { tone: 'danger' | 'warning' | 'info' | 'success'; title: string; detail: string };
  /** «Comparte tu enlace»: en cuanto sale en algún servicio. */
  share: { show: boolean; feeWaiver: boolean };
}

const PHYTO_SERVICE_NAME = 'Servicios fitosanitarios';

/** «A», «A y B», «A, B y C». */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** «3 servicios: A, B y C» (con más de 3, «y 2 más»). */
function serviceList(names: string[]): string {
  if (names.length <= 3) return joinNames(names);
  return `${names.slice(0, 3).join(', ')} y ${names.length - 3} más`;
}

function memberLabel(member: ProviderSetupMember): string {
  if (member.role === 'owner') return 'tú';
  return (member.name || 'una persona de tu equipo').split(' ')[0];
}

/** «tu carnet», «el carnet de Ana» o «tu carnet y el de Ana y Luis». */
function whoseLicense(members: ProviderSetupMember[]): string {
  const others = members.filter((m) => m.role !== 'owner').map(memberLabel);
  const own = members.some((m) => m.role === 'owner');
  if (own && others.length === 0) return 'tu carnet';
  if (own) return `tu carnet y el de ${joinNames(others)}`;
  return `el carnet de ${joinNames(others)}`;
}

const isPending = (step: SetupStep) => step.state === 'todo' || step.state === 'warning';

function servicesStep(status: ProviderSetupStatus): SetupStep {
  const names = status.services.map((s) => s.name);
  if (names.length === 0) {
    return {
      id: 'services',
      title: 'Servicios y precios',
      detail: 'Activa al menos un servicio con tus precios: es lo que los clientes pueden reservarte.',
      state: 'todo',
      cta: { label: 'Configurar servicios', target: { kind: 'profile', tab: 'services' } },
    };
  }
  return {
    id: 'services',
    title: 'Servicios y precios',
    detail: `${names.length} ${plural(names.length, 'servicio activo', 'servicios activos')}: ${serviceList(names)}.`,
    state: 'done',
    cta: { label: 'Revisar servicios', target: { kind: 'profile', tab: 'services' } },
  };
}

function coverageStep(status: ProviderSetupStatus): SetupStep {
  const { has_coordinates, address, max_distance } = status.profile;
  if (!has_coordinates) {
    return {
      id: 'coverage',
      title: 'Zona de trabajo',
      detail: 'Guarda tu dirección base y hasta cuántos kilómetros te desplazas. Sin ella no te podemos ofrecer a los clientes de tu zona.',
      state: 'todo',
      cta: { label: 'Configurar zona', target: { kind: 'profile', tab: 'coverage' } },
    };
  }
  const radius = Number(max_distance) > 0 ? `Hasta ${max_distance} km` : 'Sin límite de distancia';
  return {
    id: 'coverage',
    title: 'Zona de trabajo',
    detail: address ? `${radius} desde ${address}.` : `${radius}.`,
    state: 'done',
    cta: { label: 'Cambiar zona', target: { kind: 'profile', tab: 'coverage' } },
  };
}

function soloScheduleStep(status: ProviderSetupStatus): SetupStep {
  const { has_recurring, free_hours_14d } = status.schedule;
  const days = status.window_days || 14;
  if (free_hours_14d > 0) {
    return {
      id: 'schedule',
      title: 'Horario',
      detail: `${free_hours_14d} ${plural(free_hours_14d, 'hora libre', 'horas libres')} en los próximos ${days} días.`,
      state: 'done',
      cta: { label: 'Ver horario', target: { kind: 'schedule' } },
    };
  }
  if (!has_recurring) {
    return {
      id: 'schedule',
      title: 'Horario',
      detail: 'Crea tu horario semanal: los clientes solo pueden reservarte en tus horas libres.',
      state: 'todo',
      cta: { label: 'Crear horario', target: { kind: 'schedule', tab: 'recurring' } },
    };
  }
  return {
    id: 'schedule',
    title: 'Horario',
    detail: `No tienes horas libres en los próximos ${days} días (agenda llena o días cerrados). Abre más horas para seguir recibiendo reservas.`,
    state: 'warning',
    cta: { label: 'Abrir más horas', target: { kind: 'schedule' } },
  };
}

function soloLicenseStep(status: ProviderSetupStatus): SetupStep | null {
  if (!status.services.some((s) => s.needs_license)) return null;
  const base = { id: 'license' as const, title: 'Carnet fitosanitario' };
  const cta = (label: string) => ({ label, target: { kind: 'profile', tab: 'personal' } as SetupTarget });
  if (status.license.active) {
    return { ...base, state: 'done', detail: 'Aprobado: apareces también en los tratamientos con producto químico.' };
  }
  switch (status.license.status) {
    case 'pending':
      return { ...base, state: 'review', detail: 'GarSer lo está revisando. Mientras, solo apareces en los tratamientos ecológicos.' };
    case 'expired':
    case 'approved': // aprobado en la tabla pero sin vigencia en la ficha: a efectos del cliente, caducado.
      return { ...base, state: 'warning', detail: 'Tu carnet ha caducado: súbelo de nuevo para volver a salir en los tratamientos químicos.', cta: cta('Renovar carnet') };
    case 'rejected':
      return { ...base, state: 'todo', detail: 'No pudimos aprobar el que subiste. Súbelo de nuevo para salir en los tratamientos químicos.', cta: cta('Subir carnet') };
    default:
      return { ...base, state: 'todo', detail: 'Súbelo para salir en los tratamientos con producto químico o herbicida. Sin él solo apareces en los ecológicos.', cta: cta('Subir carnet') };
  }
}

function companyTeamStep(team: ProviderSetupTeam): SetupStep {
  if (team.members.length === 0) {
    const invites = team.pending_invitations > 0
      ? ` Tienes ${team.pending_invitations} ${plural(team.pending_invitations, 'invitación pendiente', 'invitaciones pendientes')}.`
      : '';
    return {
      id: 'team',
      title: 'Quién hace los trabajos',
      detail: `Activa «Yo también trabajo» o invita a tu equipo: sin nadie que trabaje no recibes reservas.${invites}`,
      state: 'todo',
      cta: { label: 'Ir a Equipo', target: { kind: 'team' } },
    };
  }
  const names = team.members.map((m) => (m.role === 'owner' ? 'tú' : (m.name || 'una persona')));
  return {
    id: 'team',
    title: 'Quién hace los trabajos',
    detail: `${team.members.length} ${plural(team.members.length, 'persona trabaja', 'personas trabajan')}: ${joinNames(names)}.`,
    state: 'done',
    cta: { label: 'Ver equipo', target: { kind: 'team' } },
  };
}

function companyServicesStep(status: ProviderSetupStatus, team: ProviderSetupTeam): SetupStep {
  const base = { id: 'team_services' as const, title: 'Servicios de cada persona' };
  if (status.services.length === 0) {
    return { ...base, state: 'blocked', detail: 'Primero activa los servicios que ofreces.' };
  }
  if (team.members.length === 0) {
    return { ...base, state: 'blocked', detail: 'Primero indica quién hace los trabajos.' };
  }
  const uncovered = status.services.filter((s) => s.workers === 0);
  if (uncovered.length === 0) {
    return {
      ...base,
      state: 'done',
      detail: 'Cada servicio que ofreces lo hace alguien de tu equipo.',
      cta: { label: 'Ver equipo', target: { kind: 'team' } },
    };
  }
  const phytoNeedsLicense = uncovered.some((s) => s.name === PHYTO_SERVICE_NAME) && !team.members.some((m) => m.has_valid_license);
  return {
    ...base,
    state: 'todo',
    detail: `Nadie de tu equipo hace ${joinNames(uncovered.map((s) => s.name))}. ${uncovered.length === 1 ? 'Asígnalo' : 'Asígnalos'} a alguien.${
      phytoNeedsLicense ? ' Los fitosanitarios necesitan a alguien con el carnet aprobado.' : ''
    }`,
    cta: { label: 'Asignar servicios', target: { kind: 'team' } },
  };
}

function companyScheduleStep(status: ProviderSetupStatus, team: ProviderSetupTeam): SetupStep {
  const base = { id: 'schedule' as const, title: 'Horario del equipo' };
  const days = status.window_days || 14;
  const covered = status.services.filter((s) => s.workers > 0);
  if (team.members.length === 0 || covered.length === 0) {
    return { ...base, state: 'blocked', detail: 'Primero reparte los servicios entre tu equipo.' };
  }
  const withoutHours = covered.filter((s) => s.workers_with_hours === 0);
  if (withoutHours.length === 0) {
    const free = team.members.reduce((sum, m) => sum + (m.service_ids.length > 0 ? m.free_hours_14d : 0), 0);
    return {
      ...base,
      state: 'done',
      detail: `Todos tus servicios tienen a alguien con horas libres (${free} ${plural(free, 'hora', 'horas')} en los próximos ${days} días).`,
      cta: { label: 'Ver equipo', target: { kind: 'team' } },
    };
  }
  // Quién hace esos servicios y no tiene horas libres: a esas personas hay que abrirles horario.
  const missingIds = new Set(withoutHours.map((s) => s.id));
  const people = team.members.filter((m) => m.free_hours_14d === 0 && m.service_ids.some((id) => missingIds.has(id)));
  const reason = (m: ProviderSetupMember) => `${memberLabel(m)} (${m.has_recurring_schedule ? 'agenda llena' : 'sin horario'})`;
  const who = people.length > 0 ? `Sin horas libres: ${joinNames(people.map(reason))}. ` : '';
  const single = people.length === 1 ? people[0] : null;
  const cta = single
    ? {
        label: single.role === 'owner' ? 'Abrir mi horario' : `Horario de ${memberLabel(single)}`,
        target: (single.role === 'owner'
          ? { kind: 'schedule', ...(single.has_recurring_schedule ? {} : { tab: 'recurring' }) }
          : { kind: 'member_schedule', memberId: single.member_id, ...(single.has_recurring_schedule ? {} : { tab: 'recurring' }) }) as SetupTarget,
      }
    : { label: 'Ver equipo', target: { kind: 'team' } as SetupTarget };
  return {
    ...base,
    state: people.some((m) => m.has_recurring_schedule) && people.every((m) => m.has_recurring_schedule) ? 'warning' : 'todo',
    detail: `${who}Los clientes no pueden reservar ${joinNames(withoutHours.map((s) => s.name))} en los próximos ${days} días.`,
    cta,
  };
}

function companyLicenseStep(status: ProviderSetupStatus, team: ProviderSetupTeam): SetupStep | null {
  const licensed = status.services.filter((s) => s.needs_license);
  if (licensed.length === 0) return null;
  const base = { id: 'license' as const, title: 'Carnets fitosanitarios' };
  const missing = licensed.filter((s) => !team.members.some((m) => m.has_valid_license && m.service_ids.includes(s.id)));
  if (missing.length === 0) {
    return { ...base, state: 'done', detail: 'Hay alguien con carnet aprobado para los tratamientos con producto químico.' };
  }
  const inReview = team.members.filter((m) => m.license_status === 'pending');
  if (inReview.length > 0) {
    return {
      ...base,
      state: 'review',
      detail: `GarSer está revisando ${whoseLicense(inReview)}. Mientras, ${joinNames(missing.map((s) => s.name))} no sale en los tratamientos químicos.`,
    };
  }
  const owner = team.members.find((m) => m.role === 'owner');
  const ownerCanUpload = Boolean(owner && !owner.has_valid_license);
  const expired = team.members.some((m) => m.license_status === 'expired');
  // Fitosanitarios solo se puede asignar a quien tiene carnet: sin nadie, ni siquiera sale para
  // los ecológicos. Con alguien que lo hace (o desbroce con herbicida), falta solo lo químico.
  const consequence = missing.every((s) => s.workers === 0)
    ? 'para ofrecerlo, alguien de tu equipo necesita el carnet'
    : 'no sale en los tratamientos con producto químico';
  return {
    ...base,
    state: expired ? 'warning' : 'todo',
    detail: `Nadie con el carnet aprobado hace ${joinNames(missing.map((s) => s.name))}: ${consequence}. ${
      ownerCanUpload ? 'Sube el tuyo o pide a tu equipo que suba el suyo desde su panel.' : 'Cada persona sube su carnet desde su panel.'
    }`,
    cta: ownerCanUpload
      ? { label: 'Subir mi carnet', target: { kind: 'company_license' } }
      : { label: 'Ver equipo', target: { kind: 'team' } },
  };
}

function recommendedSteps(status: ProviderSetupStatus): SetupStep[] {
  const company = status.provider_kind === 'company';
  return [
    status.profile.has_photo
      ? { id: 'photo', title: company ? 'Logo o foto' : 'Foto de perfil', state: 'done', detail: 'Los clientes ya la ven en tu perfil.' }
      : {
          id: 'photo',
          title: company ? 'Logo o foto' : 'Foto de perfil',
          state: 'todo',
          detail: company
            ? 'El logo de tu empresa da confianza: sale junto a tu nombre cuando un cliente elige profesional.'
            : 'Los clientes confían más en un perfil con foto: sale junto a tu nombre cuando eligen profesional.',
          cta: { label: 'Subir foto', target: { kind: 'account' } },
        },
    status.profile.has_description
      ? { id: 'description', title: 'Descripción', state: 'done', detail: 'Sale en tu perfil público.' }
      : {
          id: 'description',
          title: 'Descripción',
          state: 'todo',
          detail: company
            ? 'Presenta tu empresa en dos líneas: sale en tu perfil público.'
            : 'Cuenta tu experiencia en dos líneas: sale en tu perfil público.',
          cta: { label: 'Escribir descripción', target: { kind: 'profile', tab: 'personal' } },
        },
    status.push_enabled
      ? { id: 'push', title: 'Avisos en el móvil', state: 'done', detail: 'Te avisamos al momento de cada solicitud.' }
      : {
          id: 'push',
          title: 'Avisos en el móvil',
          state: 'todo',
          detail: 'Actívalos para enterarte al momento de cada solicitud: si no la respondes a tiempo, caduca.',
          cta: { label: 'Activar avisos', target: { kind: 'account' } },
        },
  ];
}

export function buildProviderSetupSteps(status: ProviderSetupStatus): ProviderSetupSummary {
  const company = status.provider_kind === 'company';
  const team = status.team ?? { company_status: 'active', owner_works: false, employees: 0, pending_invitations: 0, members: [] };

  const required = (company
    ? [
        servicesStep(status),
        coverageStep(status),
        companyTeamStep(team),
        companyServicesStep(status, team),
        companyScheduleStep(status, team),
        companyLicenseStep(status, team),
      ]
    : [servicesStep(status), coverageStep(status), soloScheduleStep(status), soloLicenseStep(status)]
  ).filter((step): step is SetupStep => step !== null);
  const recommended = recommendedSteps(status);

  const requiredDone = required.filter((s) => s.state === 'done').length;
  const allRequiredDone = requiredDone === required.length;
  const nextStep = required.find(isPending) ?? recommended.find(isPending) ?? null;

  const visibleServices = status.services.filter((s) => s.visible).map((s) => s.name);
  const hiddenServices = status.services.filter((s) => !s.visible).map((s) => s.name);
  const missing = required.length - requiredDone;
  const steps = `${missing} ${plural(missing, 'paso', 'pasos')}`;

  let headline: ProviderSetupSummary['headline'];
  if (status.suspended) {
    headline = {
      tone: 'danger',
      title: 'Tu cuenta está suspendida',
      detail: 'Mientras siga así no apareces a los clientes. Puedes seguir preparando tu perfil.',
    };
  } else if (visibleServices.length === 0) {
    headline = {
      tone: 'warning',
      title: 'Todavía no apareces a los clientes',
      detail: missing > 0
        ? `Te ${plural(missing, 'falta', 'faltan')} ${steps} para que puedan reservarte.`
        : 'Revisa tus servicios: ahora mismo ninguno se puede reservar.',
    };
  } else if (!allRequiredDone) {
    const also = hiddenServices.length > 0 ? joinNames(hiddenServices) : 'los tratamientos con producto químico';
    headline = {
      tone: 'info',
      title: `Ya apareces en ${joinNames(visibleServices)}`,
      detail: `Completa ${steps} más para salir también en ${also}.`,
    };
  } else {
    headline = {
      tone: 'success',
      title: 'Ya apareces a los clientes',
      detail: hiddenServices.length > 0
        ? `En ${joinNames(visibleServices)}.`
        : `En ${plural(visibleServices.length, 'tu servicio', 'todos tus servicios')}: ${joinNames(visibleServices)}.`,
    };
  }

  return {
    kind: status.provider_kind,
    suspended: status.suspended,
    required,
    recommended,
    requiredDone,
    requiredTotal: required.length,
    recommendedDone: recommended.filter((s) => s.state === 'done').length,
    allRequiredDone,
    nextStep,
    visibleServices,
    hiddenServices,
    headline,
    share: { show: !status.suspended && visibleServices.length > 0, feeWaiver: status.fee_waiver_enabled },
  };
}

/** El enlace de reserva directo del profesional (el mismo que «Mi cuenta»). */
export const providerBookingLink = (origin: string, providerId: string) => `${origin}/reservar/${providerId}`;
