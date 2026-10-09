import { supabase } from '../lib/supabase';

// Pendiente PH-01: el propio usuario cierra su cuenta desde «Mi cuenta», con la misma baja segura
// que la del admin (F6, D23). El servidor decide; aquí solo se pide el análisis, se traduce a
// frases para el usuario y se ejecuta lo que el análisis dijo.

export type SelfClosurePlan = {
  exists: boolean;
  role?: string | null;
  company?: { id: string; status: string; name: string | null; activeEmployees: number } | null;
  employeeOf?: string | null;
  hasHistory?: boolean;
  mode?: 'delete' | 'deactivate' | 'blocked';
  blockers?: Array<{ code: string; message: string; count?: number }>;
  openBookings?: Array<{ date: string; status: string; service: string | null; asClient: boolean }>;
  assignedJobs?: Array<{ date: string; service: string | null }>;
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'pendiente de aceptar',
  confirmed: 'confirmada',
  disputed: 'en revisión por una incidencia',
};

/** «3 de octubre», en la hora de España (la fecha de la reserva es un día, sin hora). */
export function formatClosureDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' }).format(d);
}

/** Qué le impide cerrar la cuenta y qué tiene que hacer, dicho al propio usuario. */
export function describeClosureBlockers(plan: SelfClosurePlan): string[] {
  const lines: string[] = [];
  for (const blocker of plan.blockers || []) {
    if (blocker.code === 'open_bookings') {
      for (const b of plan.openBookings || []) {
        const what = b.service ? ` de ${b.service}` : '';
        const action = b.status === 'disputed'
          ? 'espera a que se resuelva la incidencia'
          : b.asClient ? 'cancélala o espera a que termine' : 'termínala o cancélala desde tus reservas';
        lines.push(`Tienes una reserva${what} ${STATUS_LABEL[b.status] || b.status} el ${formatClosureDate(b.date)}: ${action}.`);
      }
      const more = (blocker.count || 0) - (plan.openBookings || []).length;
      if (more > 0) lines.push(`Y ${more} reserva(s) más sin terminar.`);
    } else if (blocker.code === 'assigned_jobs') {
      for (const j of plan.assignedJobs || []) {
        lines.push(`Tienes un trabajo${j.service ? ` de ${j.service}` : ''} asignado el ${formatClosureDate(j.date)}: pide a tu empresa que se lo asigne a otra persona.`);
      }
    } else if (blocker.code === 'payments_in_progress') {
      lines.push('Tienes un pago en curso. Espera unos minutos a que termine y vuelve a intentarlo.');
    } else if (blocker.code === 'open_incidents') {
      lines.push('Tienes una incidencia abierta. Hay que resolverla antes de cerrar la cuenta.');
    } else if (blocker.code === 'active_plans') {
      lines.push('Tienes un plan de mantenimiento activo. Cancélalo antes de cerrar la cuenta.');
    } else if (blocker.code === 'admin') {
      lines.push('Es una cuenta de administración: no se cierra desde aquí.');
    } else {
      lines.push(blocker.message);
    }
  }
  return lines;
}

/** Qué pasará si confirma, según lo que diga el servidor. */
export function describeClosureOutcome(plan: SelfClosurePlan): string[] {
  if (plan.mode === 'delete') {
    return [
      'Se borrará tu cuenta entera: tus datos, tus fotos y todo lo que hayas guardado.',
      ...(plan.company ? ['Tu empresa se borrará con ella.'] : []),
      'No se puede deshacer.',
    ];
  }
  if (plan.mode === 'deactivate') {
    return [
      'Se borrarán tus datos personales (nombre, teléfono, dirección y fotos) y no podrás volver a entrar.',
      'Tus reservas pasadas y sus importes se conservan, sin tus datos, porque forman parte de las cuentas de la otra persona.',
      ...(plan.company
        ? [`Tu empresa dejará de aparecer y de recibir reservas, y tu equipo (${plan.company.activeEmployees} persona(s)) dejará de tener acceso a ella.`]
        : []),
      'Los mensajes del chat se conservan para la otra persona.',
      'No se puede deshacer.',
    ];
  }
  return [];
}

export async function fetchSelfClosurePlan(): Promise<SelfClosurePlan> {
  const { data, error } = await supabase.rpc('my_account_closure_preview');
  if (error) throw new Error(error.message || 'No se ha podido revisar tu cuenta.');
  return data as SelfClosurePlan;
}

export async function closeOwnAccount(expectedMode: 'delete' | 'deactivate'): Promise<void> {
  const { data, error } = await supabase.functions.invoke('account-closure', { body: { expectedMode } });
  // functions.invoke no lanza en errores HTTP: el motivo viene en el cuerpo.
  const message = (data as { error?: string } | null)?.error
    || (error ? await (error as { context?: Response }).context?.json?.().then((b: { error?: string }) => b?.error).catch(() => null) : null);
  if (error || message) throw new Error(message || 'No se ha podido cerrar tu cuenta.');
}

// Al cerrar la cuenta, la web cierra la sesión y recarga en /auth (que borra sessionStorage). Esta
// marca, sin ningún dato personal, deja que la siguiente página diga «Tu cuenta se ha cerrado».
const ACCOUNT_CLOSED_KEY = 'garser:accountClosed';
export const ACCOUNT_CLOSED_MESSAGE = 'Tu cuenta se ha cerrado. Gracias por haber usado GarSer.';

export function markAccountClosed(): void {
  try { localStorage.setItem(ACCOUNT_CLOSED_KEY, '1'); } catch { /* sin almacenamiento: no pasa nada */ }
}

export function consumeAccountClosed(): boolean {
  try {
    if (localStorage.getItem(ACCOUNT_CLOSED_KEY) !== '1') return false;
    localStorage.removeItem(ACCOUNT_CLOSED_KEY);
    return true;
  } catch {
    return false;
  }
}
