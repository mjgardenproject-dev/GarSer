import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(async () => ({ error: null })),
  del: vi.fn(),
  insert: vi.fn(async () => ({ error: null })),
  rpc: vi.fn(async () => ({ error: null })),
  apply: vi.fn(async () => undefined),
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      upsert: table === 'recurring_availability_settings' ? mocks.upsert : undefined,
      delete: () => ({ eq: async () => { mocks.del(table); return { error: null }; } }),
      insert: mocks.insert,
    }),
    rpc: mocks.rpc,
  },
}));
vi.mock('./availabilityService', () => ({ applyRecurringSchedule: mocks.apply }));

import { planScheduleSave, saveOwnRecurringSchedule, type ScheduleMatrix } from './recurringSchedulePersistence';

const weekdays = (from: number, to: number): ScheduleMatrix => {
  const m: ScheduleMatrix = {};
  for (let d = 1; d <= 5; d++) m[d] = new Set(Array.from({ length: to - from }, (_, i) => from + i));
  return m;
};

describe('planScheduleSave · QA-043', () => {
  it('sin horario anterior (primera vez): se genera todo', () => {
    expect(planScheduleSave(undefined, { matrix: weekdays(8, 14), weeks: 4 })).toBe('full');
  });
  it('mismo horario y mismas semanas (solo cambió la antelación): no se toca la agenda', () => {
    expect(planScheduleSave({ matrix: weekdays(8, 14), weeks: 4 }, { matrix: weekdays(8, 14), weeks: 4 })).toBe('settings_only');
  });
  it('mismo horario y MÁS semanas: solo se alarga lo que falta', () => {
    expect(planScheduleSave({ matrix: weekdays(8, 14), weeks: 4 }, { matrix: weekdays(8, 14), weeks: 8 })).toBe('extend');
  });
  it('cambian las horas o se reducen las semanas: se regenera como siempre', () => {
    expect(planScheduleSave({ matrix: weekdays(8, 14), weeks: 4 }, { matrix: weekdays(8, 15), weeks: 4 })).toBe('full');
    expect(planScheduleSave({ matrix: weekdays(8, 14), weeks: 8 }, { matrix: weekdays(8, 14), weeks: 4 })).toBe('full');
  });
  it('un día vacío y un día ausente son lo mismo', () => {
    const a: ScheduleMatrix = { 1: new Set([8]), 2: new Set() };
    const b: ScheduleMatrix = { 1: new Set([8]) };
    expect(planScheduleSave({ matrix: a, weeks: 4 }, { matrix: b, weeks: 4 })).toBe('settings_only');
  });
});

describe('saveOwnRecurringSchedule · QA-043 guardar solo la antelación no borra excepciones', () => {
  beforeEach(() => vi.clearAllMocks());

  it('solo antelación: guarda los ajustes y NO borra ni regenera la agenda', async () => {
    await saveOwnRecurringSchedule({
      userId: 'u1', matrix: weekdays(8, 14), weeks: 4, minNoticeHours: 48,
      previous: { matrix: weekdays(8, 14), weeks: 4 },
    });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ gardener_id: 'u1', min_notice_hours: 48, weeks_to_maintain: 4 }));
    expect(mocks.del).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('más semanas: alarga sin forzar (no pisa lo existente) y no borra el horario', async () => {
    await saveOwnRecurringSchedule({
      userId: 'u1', matrix: weekdays(8, 14), weeks: 8, minNoticeHours: 24,
      previous: { matrix: weekdays(8, 14), weeks: 4 },
    });
    expect(mocks.del).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith('generate_recurring_slots', { target_gardener_id: 'u1', force_regenerate: false });
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('cambiando las horas: regenera todo, como antes', async () => {
    await saveOwnRecurringSchedule({
      userId: 'u1', matrix: weekdays(8, 15), weeks: 4, minNoticeHours: 24,
      previous: { matrix: weekdays(8, 14), weeks: 4 },
    });
    expect(mocks.del).toHaveBeenCalledWith('recurring_schedules');
    expect(mocks.rpc).toHaveBeenCalledWith('generate_recurring_slots', { target_gardener_id: 'u1', force_regenerate: true });
    expect(mocks.apply).toHaveBeenCalled();
  });

  it('sin «previous» (primera vez, cuestionario): regenera como antes', async () => {
    await saveOwnRecurringSchedule({ userId: 'u1', matrix: weekdays(8, 14), weeks: 4, minNoticeHours: 24 });
    expect(mocks.del).toHaveBeenCalledWith('recurring_schedules');
    expect(mocks.rpc).toHaveBeenCalledWith('generate_recurring_slots', { target_gardener_id: 'u1', force_regenerate: true });
  });
});
