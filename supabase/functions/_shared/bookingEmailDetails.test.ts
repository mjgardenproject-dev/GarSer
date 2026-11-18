import { describe, expect, it } from 'vitest';

import { withPhytosanitaryNote } from './bookingEmailDetails';
import { PHYTOSANITARY_SHORT_NOTE } from '../../../src/shared/manualEntry/legalCopy';

describe('correo de confirmación: frase de fitosanitarios (QA-170)', () => {
  it('en fitosanitarios añade la frase corta a la nota existente', () => {
    const text = withPhytosanitaryNote('Los 12,00 € de gastos de gestión están retenidos.', 'Servicios fitosanitarios');
    expect(text).toContain('Los 12,00 € de gastos de gestión están retenidos.');
    expect(text).toContain(PHYTOSANITARY_SHORT_NOTE);
  });
  it('si no había nota, solo la frase', () => {
    expect(withPhytosanitaryNote('', 'Servicios fitosanitarios')).toBe(PHYTOSANITARY_SHORT_NOTE);
  });
  it('en otros servicios no toca nada', () => {
    expect(withPhytosanitaryNote('Nota.', 'Corte de césped')).toBe('Nota.');
    expect(withPhytosanitaryNote('Nota.', 'Corte de césped + Poda de setos')).toBe('Nota.');
  });
  it('en una visita de varios servicios que incluye fitosanitarios, sí', () => {
    expect(withPhytosanitaryNote('Nota.', 'Corte de césped + Servicios fitosanitarios')).toContain(PHYTOSANITARY_SHORT_NOTE);
  });
});
