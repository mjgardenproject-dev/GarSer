import { supabase } from '../lib/supabase';
import { applyRecurringSchedule } from './availabilityService';

// Guardar el horario fijo del PROPIO profesional (2026-11-11). Es lo que hacía «Horario → Horario fijo»
// (RecurringScheduleManager.commitSave) sacado a una función para que lo use también el cuestionario
// «Activa tu cuenta», sin duplicar la lógica: reglas de agenda, horario semanal y horas reservables.

export type ScheduleMatrix = Record<number, Set<number>>;
// `type` (no `interface`): así se puede mandar tal cual como JSON a la RPC del horario de un empleado.
export type ScheduleRule = {
  day_of_week: number;
  start_time: string;
  end_time: string;
};

const hh = (h: number) => `${String(h).padStart(2, '0')}:00:00`;

/** Matriz día → horas a reglas {day_of_week, start_time, end_time} agrupando horas seguidas. */
export function matrixToRules(matrix: ScheduleMatrix): ScheduleRule[] {
  const rules: ScheduleRule[] = [];
  Object.entries(matrix).forEach(([day, set]) => {
    const hours = Array.from(set || []).sort((a, b) => a - b);
    let from: number | null = null;
    hours.forEach((h, i) => {
      if (from === null) from = h;
      if (hours[i + 1] !== h + 1) {
        rules.push({ day_of_week: Number(day), start_time: hh(from), end_time: hh(h + 1) });
        from = null;
      }
    });
  });
  return rules;
}

export type ScheduleSaveSnapshot = { matrix: ScheduleMatrix; weeks: number };

const matrixKey = (matrix: ScheduleMatrix) =>
  Object.keys(matrix)
    .map(Number)
    .sort((x, y) => x - y)
    .map((day) => `${day}:${Array.from(matrix[day] || []).sort((x, y) => x - y).join(',')}`)
    .filter((entry) => !entry.endsWith(':'))
    .join('|');

/**
 * Qué hay que rehacer al guardar (QA-043). Regenerar la agenda BORRA las excepciones del profesional
 * (un día bloqueado, unas horas extra), así que solo se hace si cambió lo que las genera:
 *  · `settings_only`: mismas horas y mismas semanas (solo cambió la antelación, que se comprueba al reservar).
 *  · `extend`: mismas horas y MÁS semanas: se añaden las semanas nuevas sin tocar las que ya hay.
 *  · `full`: cualquier otro caso (o no hay horario anterior con el que comparar).
 */
export function planScheduleSave(previous: ScheduleSaveSnapshot | undefined, next: ScheduleSaveSnapshot): 'full' | 'extend' | 'settings_only' {
  if (!previous || matrixKey(previous.matrix) !== matrixKey(next.matrix)) return 'full';
  if (next.weeks === previous.weeks) return 'settings_only';
  return next.weeks > previous.weeks ? 'extend' : 'full';
}

/**
 * Guarda las reglas de agenda (semanas que se abren y, si se da, la antelación mínima), sustituye el
 * horario semanal y regenera las horas reservables (RPC y, como siempre, también en el navegador).
 * Con `previous` (lo que había cargado) solo regenera si cambió algo que lo exige: ver `planScheduleSave`.
 * Lanza el error si algo falla.
 */
export async function saveOwnRecurringSchedule(params: {
  userId: string;
  matrix: ScheduleMatrix;
  weeks: number;
  minNoticeHours: number | null;
  previous?: ScheduleSaveSnapshot;
}): Promise<void> {
  const { userId, matrix, weeks, minNoticeHours, previous } = params;
  const plan = planScheduleSave(previous, { matrix, weeks });

  const { error: settError } = await supabase.from('recurring_availability_settings').upsert({
    gardener_id: userId,
    weeks_to_maintain: weeks,
    // Un empleado no elige la antelación (la decide su empresa): sin valor no se envía y no se toca.
    ...(minNoticeHours !== null ? { min_notice_hours: minNoticeHours } : {}),
    updated_at: new Date().toISOString(),
  });
  if (settError) throw settError;

  if (plan === 'settings_only') return;

  if (plan === 'extend') {
    // Sin forzar: solo genera desde donde se quedó la última vez; no borra lo que ya hay.
    const { error: extendError } = await supabase.rpc('generate_recurring_slots', { target_gardener_id: userId, force_regenerate: false });
    if (extendError) throw extendError;
    return;
  }

  const { error: delError } = await supabase.from('recurring_schedules').delete().eq('gardener_id', userId);
  if (delError) throw delError;

  const rows = matrixToRules(matrix).map((rule) => ({ gardener_id: userId, ...rule }));
  if (rows.length > 0) {
    const { error: insError } = await supabase.from('recurring_schedules').insert(rows);
    if (insError) throw insError;
  }

  const { error: rpcError } = await supabase.rpc('generate_recurring_slots', {
    target_gardener_id: userId,
    force_regenerate: true,
  });
  if (rpcError) console.warn('RPC generate_recurring_slots failed or not found, using client-side fallback', rpcError);

  // Siempre también en el navegador (cubre un RPC ausente o desactualizado); si fallan los dos, error.
  try {
    await applyRecurringSchedule(userId, matrix, weeks);
  } catch (clientError) {
    console.error('Client-side generation failed:', clientError);
    if (rpcError) throw clientError;
  }
}
