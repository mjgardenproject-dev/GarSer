import { describe, expect, it } from 'vitest';
import { describeJobShape, formatDateRange, isMultiDay } from './jobShape';

describe('jobShape (F7)', () => {
  it('rango de fechas en el mismo mes y entre meses', () => {
    expect(formatDateRange('2026-05-05', '2026-05-09')).toBe('del 5 al 9 de mayo');
    expect(formatDateRange('2026-04-30', '2026-05-02')).toBe('del 30 de abril al 2 de mayo');
  });

  it('un día, una persona: solo el horario', () => {
    expect(describeJobShape({ date: '2026-05-05', startHour: 8, durationHours: 3 })).toEqual({
      when: '08:00 – 11:00', team: null, labour: null, multiDay: false,
    });
  });

  it('equipo en un día: horario de reloj, personas y horas de trabajo', () => {
    expect(describeJobShape({ date: '2026-05-05', startHour: 8, durationHours: 4, crew: 2, labourHours: 8 })).toEqual({
      when: '08:00 – 12:00', team: 'Van 2 personas a la vez', labour: '8 h de trabajo', multiDay: false,
    });
  });

  it('varios días: «Del 5 al 9 de mayo, desde las 08:00»', () => {
    const shape = describeJobShape({ date: '2026-05-05', startHour: 8, durationHours: 4, endDate: '2026-05-09', crew: 1, labourHours: 20 });
    expect(shape.when).toBe('Del 5 al 9 de mayo, desde las 08:00');
    expect(shape.labour).toBe('20 h de trabajo');
    expect(shape.team).toBeNull();
    expect(describeJobShape({ date: '2026-05-05', startHour: 8, durationHours: 4, endDate: '2026-05-09', crew: 2, labourHours: 36 }).team).toBe('Hasta 2 personas a la vez');
    expect(isMultiDay({ date: '2026-05-05', endDate: null })).toBe(false);
  });
});
