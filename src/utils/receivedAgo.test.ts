import { describe, expect, it } from 'vitest';
import { receivedAgo } from './receivedAgo';

const now = new Date('2026-09-28T19:40:00Z');
const ago = (seconds: number) => receivedAgo(new Date(now.getTime() - seconds * 1000), now);

describe('receivedAgo (R-06d)', () => {
  it('redondea hacia abajo, en minutos por debajo de una hora', () => {
    expect(ago(30)).toBe('Recién recibida');
    expect(ago(5 * 60)).toBe('Hace 5 min');
    expect(ago(59 * 60 + 59)).toBe('Hace 59 min');
    expect(ago(61 * 60)).toBe('Hace 1 hora');
    expect(ago(23 * 3600 + 59 * 60)).toBe('Hace 23 horas');
    expect(ago(25 * 3600)).toBe('Hace 1 día');
    expect(ago(49 * 3600)).toBe('Hace 2 días');
  });

  it('acepta la fecha de la base de datos y un reloj un poco adelantado', () => {
    expect(receivedAgo('2026-09-28T19:30:09.351795+00:00', now)).toBe('Hace 9 min');
    expect(ago(-20)).toBe('Recién recibida');
    expect(receivedAgo('no-es-fecha', now)).toBe('');
  });
});
