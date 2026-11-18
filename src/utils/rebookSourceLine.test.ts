import { describe, expect, it } from 'vitest';

import { describeRebookSource } from './rebookService';

describe('describeRebookSource (R3-1.7 OBS-02: no decir «lo contrataste» de lo que nunca se hizo)', () => {
  const date = '1 de diciembre de 2026';
  it('completada: «Lo contrataste el …»', () => {
    expect(describeRebookSource('completed', date)).toBe('Lo contrataste el 1 de diciembre de 2026');
  });
  it('caducada: dice que caducó, no que se contrató', () => {
    const text = describeRebookSource('expired', date);
    expect(text).not.toContain('contrataste');
    expect(text).toContain('caducó sin respuesta');
    expect(text).toContain(date);
  });
  it('cancelada o rechazada: tampoco', () => {
    expect(describeRebookSource('cancelled', date)).not.toContain('contrataste');
    expect(describeRebookSource('rejected', date)).not.toContain('contrataste');
  });
  it('sin estado conocido (borrador antiguo): texto neutro', () => {
    const text = describeRebookSource(undefined, date);
    expect(text).not.toContain('contrataste');
    expect(text).toContain(date);
  });
  it('sin fecha no hay línea', () => {
    expect(describeRebookSource('completed', null)).toBeNull();
  });
});
