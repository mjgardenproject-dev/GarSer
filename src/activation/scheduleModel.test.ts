import { describe, expect, it } from 'vitest';
import {
  SCHEDULE_TEMPLATES,
  copyMondayToWorkdays,
  emptyWeek,
  rangesToMatrix,
  rulesToRanges,
  scheduleProblem,
  weeklyHours,
} from './scheduleModel';
import { matrixToRules } from '../utils/recurringSchedulePersistence';

describe('horario del cuestionario', () => {
  it('la plantilla partida da 9 h al día, 45 h a la semana', () => {
    const week = SCHEDULE_TEMPLATES.find((t) => t.id === 'split')!.week();
    expect(weeklyHours(week)).toBe(45);
    expect(week[6]).toEqual([]);
    expect(week[0]).toEqual([]);
  });

  it('de tramos a las reglas que guarda «Horario fijo» y vuelta', () => {
    const week = SCHEDULE_TEMPLATES.find((t) => t.id === 'split')!.week();
    const rules = matrixToRules(rangesToMatrix(week));
    expect(rules.filter((r) => r.day_of_week === 1)).toEqual([
      { day_of_week: 1, start_time: '08:00:00', end_time: '14:00:00' },
      { day_of_week: 1, start_time: '16:00:00', end_time: '19:00:00' },
    ]);
    expect(rulesToRanges(rules)).toEqual(week);
  });

  it('tramos solapados cuentan una vez y se unen al releerlos', () => {
    const week = emptyWeek();
    week[1] = [{ start: 8, end: 12 }, { start: 10, end: 14 }];
    expect(weeklyHours(week)).toBe(6);
    expect(rulesToRanges(matrixToRules(rangesToMatrix(week)))[1]).toEqual([{ start: 8, end: 14 }]);
  });

  it('dice qué impide guardar', () => {
    expect(scheduleProblem(emptyWeek())).toMatch(/al menos un día/);
    const bad = emptyWeek();
    bad[3] = [{ start: 14, end: 9 }];
    expect(scheduleProblem(bad)).toMatch(/Miércoles/);
    const outside = emptyWeek();
    outside[1] = [{ start: 6, end: 9 }];
    expect(scheduleProblem(outside)).not.toBe('');
    expect(scheduleProblem(SCHEDULE_TEMPLATES[1].week())).toBe('');
  });

  it('copia el lunes al resto de días laborables', () => {
    const week = emptyWeek();
    week[1] = [{ start: 9, end: 13 }];
    const copied = copyMondayToWorkdays(week);
    expect(copied[5]).toEqual([{ start: 9, end: 13 }]);
    expect(copied[6]).toEqual([]);
    copied[5][0].end = 14;
    expect(copied[1][0].end).toBe(13); // copia, no la misma referencia
  });

  it('las reglas fuera de 7:00-20:00 se recortan al leerlas', () => {
    expect(rulesToRanges([{ day_of_week: 2, start_time: '06:00:00', end_time: '22:00:00' }])[2]).toEqual([{ start: 7, end: 20 }]);
  });
});
