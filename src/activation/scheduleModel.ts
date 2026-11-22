import type { ScheduleMatrix, ScheduleRule } from '../utils/recurringSchedulePersistence';

// Horario del cuestionario «Activa tu cuenta» (paso 3, 2026-11-11): por día, tramos de horas en punto
// («8:00-14:00», «16:00-19:00»). Mismos límites que «Horario fijo»: de 7:00 a 20:00.

export const FIRST_HOUR = 7;
export const LAST_HOUR = 20; // fin exclusivo: el último bloque es 19:00-20:00

export interface TimeRange {
  start: number;
  end: number;
}

/** 1 = lunes … 6 = sábado, 0 = domingo (como `day_of_week`). */
export type WeekRanges = Record<number, TimeRange[]>;

export const WEEK_DAYS = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
  { value: 0, label: 'Domingo' },
] as const;

const WORKDAYS = [1, 2, 3, 4, 5];

export const emptyWeek = (): WeekRanges => ({ 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] });

const fill = (days: number[], ranges: TimeRange[]): WeekRanges => {
  const week = emptyWeek();
  for (const day of days) week[day] = ranges.map((r) => ({ ...r }));
  return week;
};

export const SCHEDULE_TEMPLATES = [
  { id: 'split', label: 'Lunes a viernes, 8:00-14:00 y 16:00-19:00', week: () => fill(WORKDAYS, [{ start: 8, end: 14 }, { start: 16, end: 19 }]) },
  { id: 'continuous', label: 'Lunes a viernes, 8:00-17:00', week: () => fill(WORKDAYS, [{ start: 8, end: 17 }]) },
  { id: 'mornings', label: 'Lunes a sábado, mañanas (8:00-14:00)', week: () => fill([1, 2, 3, 4, 5, 6], [{ start: 8, end: 14 }]) },
] as const;

export const isValidRange = (r: TimeRange): boolean =>
  Number.isInteger(r.start) && Number.isInteger(r.end) && r.start >= FIRST_HOUR && r.end <= LAST_HOUR && r.end > r.start;

/** Horas (inicio de cada bloque de 1 h) de un día; tramos solapados cuentan una vez. */
const hoursOf = (ranges: TimeRange[]): number[] => {
  const set = new Set<number>();
  for (const r of ranges) if (isValidRange(r)) for (let h = r.start; h < r.end; h += 1) set.add(h);
  return Array.from(set).sort((a, b) => a - b);
};

export const rangesToMatrix = (week: WeekRanges): ScheduleMatrix => {
  const matrix: ScheduleMatrix = {};
  for (const { value } of WEEK_DAYS) matrix[value] = new Set(hoursOf(week[value] ?? []));
  return matrix;
};

/** De lo guardado (reglas) a tramos para editar; une los tramos seguidos. */
export const rulesToRanges = (rules: Array<Pick<ScheduleRule, 'day_of_week' | 'start_time' | 'end_time'>>): WeekRanges => {
  const week = emptyWeek();
  const byDay: Record<number, Set<number>> = {};
  for (const rule of rules) {
    const start = parseInt(String(rule.start_time).slice(0, 2), 10);
    const end = parseInt(String(rule.end_time).slice(0, 2), 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    byDay[rule.day_of_week] ??= new Set();
    for (let h = Math.max(start, FIRST_HOUR); h < Math.min(end, LAST_HOUR); h += 1) byDay[rule.day_of_week].add(h);
  }
  for (const [day, set] of Object.entries(byDay)) {
    const hours = Array.from(set).sort((a, b) => a - b);
    const ranges: TimeRange[] = [];
    for (const h of hours) {
      const last = ranges[ranges.length - 1];
      if (last && last.end === h) last.end = h + 1;
      else ranges.push({ start: h, end: h + 1 });
    }
    week[Number(day)] = ranges;
  }
  return week;
};

export const weeklyHours = (week: WeekRanges): number =>
  WEEK_DAYS.reduce((sum, { value }) => sum + hoursOf(week[value] ?? []).length, 0);

/** Lo que impide guardar, en lenguaje llano ('' si nada). */
export function scheduleProblem(week: WeekRanges): string {
  for (const { value, label } of WEEK_DAYS) {
    if ((week[value] ?? []).some((r) => !isValidRange(r))) {
      return `${label}: la hora de fin tiene que ser después de la de inicio.`;
    }
  }
  if (weeklyHours(week) === 0) return 'Marca al menos un día con horas de trabajo.';
  return '';
}

/** «Lunes a viernes» copia el horario del lunes a martes-viernes. */
export const copyMondayToWorkdays = (week: WeekRanges): WeekRanges => {
  const next = { ...week };
  for (const day of [2, 3, 4, 5]) next[day] = (week[1] ?? []).map((r) => ({ ...r }));
  return next;
};

export const NOTICE_CHOICES = [12, 24, 48, 72] as const;
export const WEEKS_CHOICES = [2, 4, 8] as const;
