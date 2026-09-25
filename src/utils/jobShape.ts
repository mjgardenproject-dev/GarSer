// GarSer Empresas (F7): cómo se le cuenta a cada persona la forma de un trabajo — a qué hora,
// cuántos días y cuántas personas van. Una sola redacción para la reserva, el cliente, la
// empresa y el empleado.

export interface JobShapeLike {
  /** Primer día (AAAA-MM-DD). */
  date: string;
  startHour: number;
  /** Lo que dura el primer día. */
  durationHours: number;
  /** Último día si son varios. */
  endDate?: string | null;
  /** Cuántas personas van a la vez como mucho. */
  crew?: number | null;
  /** Horas de trabajo totales (solo trabajos de equipo o de varios días). */
  labourHours?: number | null;
}

const MONTH = new Intl.DateTimeFormat('es-ES', { month: 'long', timeZone: 'UTC' });
const DAY_MONTH = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const WEEKDAY_DAY = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', timeZone: 'UTC' });
const at = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`);

export const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

/** «del 5 al 9 de mayo» · «del 30 de abril al 2 de mayo». */
export function formatDateRange(from: string, to: string): string {
  const a = at(from);
  const b = at(to);
  if (a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()) {
    return `del ${a.getUTCDate()} al ${b.getUTCDate()} de ${MONTH.format(b)}`;
  }
  return `del ${DAY_MONTH.format(a)} al ${DAY_MONTH.format(b)}`;
}

/** «lunes 5» (para listas de días). */
export const formatWeekdayDay = (iso: string) => WEEKDAY_DAY.format(at(iso));

export const isMultiDay = (shape: Pick<JobShapeLike, 'date' | 'endDate'>) =>
  Boolean(shape.endDate && shape.endDate.slice(0, 10) > shape.date.slice(0, 10));

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * `when`: «08:00 – 12:00» en un día; «Del 5 al 9 de mayo, desde las 08:00» en varios.
 * `team`: «Van 2 personas a la vez» (en varios días, «Hasta 2…») si va más de una; si no, null.
 * `labour`: «36 h de trabajo» cuando el reloj no lo dice solo (equipo o varios días).
 */
export function describeJobShape(shape: JobShapeLike): { when: string; team: string | null; labour: string | null; multiDay: boolean } {
  const multiDay = isMultiDay(shape);
  const crew = Math.max(1, Number(shape.crew || 1));
  const when = multiDay
    ? `${capitalize(formatDateRange(shape.date, String(shape.endDate)))}, desde las ${hourLabel(shape.startHour)}`
    : `${hourLabel(shape.startHour)} – ${hourLabel(shape.startHour + Math.max(1, Math.ceil(shape.durationHours)))}`;
  const labourHours = Number(shape.labourHours || 0);
  return {
    when,
    // En varios días no todos los días van las mismas: «hasta».
    team: crew > 1 ? `${multiDay ? 'Hasta' : 'Van'} ${crew} personas a la vez` : null,
    labour: (multiDay || crew > 1) && labourHours > 0 ? `${labourHours} h de trabajo` : null,
    multiDay,
  };
}
