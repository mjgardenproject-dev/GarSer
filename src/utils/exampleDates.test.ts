import { describe, expect, it } from 'vitest';
import { exampleDates, longDayEs, shortDayMonthEs } from './exampleDates';

// Hoy en estos casos: jueves 19 de noviembre de 2026.
const THU_19_NOV_2026 = new Date(2026, 10, 19, 12, 0, 0);

describe('exampleDates · QA-204/QA-011 (las fechas de los ejemplos de la web nunca están pasadas)', () => {
  it('el sábado de la solicitud es el próximo sábado (al menos 2 días vista)', () => {
    const d = exampleDates(THU_19_NOV_2026);
    expect(longDayEs(d.requestSaturday)).toBe('sábado, 21 de noviembre');
  });

  it('si hoy es sábado, salta al del otro fin de semana (nunca «hoy» ni «mañana»)', () => {
    const sat = new Date(2026, 10, 21, 9, 0, 0);
    expect(longDayEs(exampleDates(sat).requestSaturday)).toBe('sábado, 28 de noviembre');
    const fri = new Date(2026, 10, 20, 9, 0, 0);
    expect(longDayEs(exampleDates(fri).requestSaturday)).toBe('sábado, 28 de noviembre');
  });

  it('la semana de la agenda empieza en el lunes siguiente y trae sus 7 días', () => {
    const d = exampleDates(THU_19_NOV_2026);
    expect(shortDayMonthEs(d.week[0])).toBe('23 nov');
    expect(shortDayMonthEs(d.week[6])).toBe('29 nov');
    expect(d.week.map((x) => x.getDate())).toEqual([23, 24, 25, 26, 27, 28, 29]);
    expect(d.weekRange).toBe('23 nov - 29 nov');
  });

  it('el jueves del equipo es el jueves de esa semana', () => {
    expect(longDayEs(exampleDates(THU_19_NOV_2026).teamThursday, { capital: true })).toBe('Jueves 26 de noviembre');
  });

  it('cruza el cambio de mes y de año sin errores', () => {
    const dec = new Date(2026, 11, 29, 10, 0, 0);
    const d = exampleDates(dec);
    expect(d.weekRange).toBe('4 ene - 10 ene');
    expect(longDayEs(d.requestSaturday)).toBe('sábado, 2 de enero');
  });

  it('siempre en el futuro', () => {
    for (let i = 0; i < 400; i += 7) {
      const now = new Date(2026, 0, 1 + i, 10, 0, 0);
      const d = exampleDates(now);
      expect(d.requestSaturday.getTime()).toBeGreaterThan(now.getTime());
      expect(d.week[0].getTime()).toBeGreaterThan(now.getTime());
      expect(d.teamThursday.getTime()).toBeGreaterThan(now.getTime());
    }
  });
});
