// Fechas de los ejemplos de la web pública (maquetas de la app en /para-jardineros). Estaban escritas a mano
// («sábado, 18 de octubre», «13 oct - 19 oct»): con los anuncios en marcha, unas semanas después la web se
// veía abandonada (QA-204, QA-011). Ahora se calculan a partir de hoy y siempre son futuras.

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const atNoon = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12, 0, 0);

/** «sábado, 21 de noviembre» (o «Sábado 21 de noviembre» con `capital`, sin coma, como en la agenda). */
export function longDayEs(date: Date, options: { capital?: boolean } = {}): string {
  const day = DAYS[date.getDay()];
  if (options.capital) return `${day.charAt(0).toUpperCase()}${day.slice(1)} ${date.getDate()} de ${MONTHS[date.getMonth()]}`;
  return `${day}, ${date.getDate()} de ${MONTHS[date.getMonth()]}`;
}

/** «23 nov» */
export function shortDayMonthEs(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()].slice(0, 3)}`;
}

export interface ExampleDates {
  /** Próximo sábado con al menos dos días de margen. */
  requestSaturday: Date;
  /** Lunes a domingo de la semana siguiente. */
  week: Date[];
  weekRange: string;
  /** El jueves de esa misma semana. */
  teamThursday: Date;
  /** Lunes a domingo de la semana que contiene `requestSaturday` (la tira de días de la reserva del cliente). */
  requestWeek: Date[];
}

export function exampleDates(now: Date = new Date()): ExampleDates {
  const today = atNoon(now);
  // Sábado: 6. Si faltan menos de 2 días, el del siguiente fin de semana.
  let untilSaturday = (6 - today.getDay() + 7) % 7;
  if (untilSaturday < 2) untilSaturday += 7;
  const requestSaturday = addDays(today, untilSaturday);

  // Lunes siguiente (estrictamente después de hoy).
  const untilMonday = ((1 - today.getDay() + 7) % 7) || 7;
  const monday = addDays(today, untilMonday);
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  return {
    requestSaturday,
    week,
    weekRange: `${shortDayMonthEs(week[0])} - ${shortDayMonthEs(week[6])}`,
    teamThursday: week[3],
    requestWeek: Array.from({ length: 7 }, (_, i) => addDays(requestSaturday, i - 5)),
  };
}
