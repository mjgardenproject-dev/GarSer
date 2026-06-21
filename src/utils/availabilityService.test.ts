import { describe, expect, it } from 'vitest';

import { generateDailyTimeBlocks } from './availabilityService';

describe('generateDailyTimeBlocks (rango 7:00–20:00)', () => {
  const blocks = generateDailyTimeBlocks();

  it('genera 13 bloques de inicio (7:00 .. 19:00)', () => {
    expect(blocks).toHaveLength(13);
  });

  it('el primer bloque empieza a las 7:00 (nuevo mínimo)', () => {
    expect(blocks[0].hour).toBe(7);
    expect(blocks[0].label).toBe('07:00');
  });

  it('el último bloque de inicio es 19:00 (cubre 19:00–20:00, tope 20:00)', () => {
    expect(blocks[blocks.length - 1].hour).toBe(19);
    expect(blocks[blocks.length - 1].label).toBe('19:00');
  });

  it('las horas son consecutivas sin huecos', () => {
    const hours = blocks.map((b) => b.hour);
    expect(hours).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it('todos los bloques nacen como no disponibles', () => {
    expect(blocks.every((b) => b.available === false)).toBe(true);
  });
});
