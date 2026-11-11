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

/**
 * Guarda las reglas de agenda (semanas que se abren y, si se da, la antelación mínima), sustituye el
 * horario semanal y regenera las horas reservables (RPC y, como siempre, también en el navegador).
 * Lanza el error si algo falla.
 */
export async function saveOwnRecurringSchedule(params: {
  userId: string;
  matrix: ScheduleMatrix;
  weeks: number;
  minNoticeHours: number | null;
}): Promise<void> {
  const { userId, matrix, weeks, minNoticeHours } = params;

  const { error: settError } = await supabase.from('recurring_availability_settings').upsert({
    gardener_id: userId,
    weeks_to_maintain: weeks,
    // Un empleado no elige la antelación (la decide su empresa): sin valor no se envía y no se toca.
    ...(minNoticeHours !== null ? { min_notice_hours: minNoticeHours } : {}),
    updated_at: new Date().toISOString(),
  });
  if (settError) throw settError;

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
