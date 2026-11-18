import { describe, expect, it } from 'vitest';

import { describeServiceItem } from './ServiceDetailCard';

describe('describeServiceItem: nunca enseña claves internas (R3-1.7 OBS-03)', () => {
  it.each([
    ['dificultad_media', 'Dificultad media'],
    ['dificultad_alta', 'Dificultad alta'],
    ['dificultad_baja', 'Dificultad baja'],
    ['normal', 'Normal'],
    ['muy_descuidado', 'Muy descuidado'],
  ])('el estado «%s» se lee «%s»', (raw, shown) => {
    expect(describeServiceItem({ state: raw }, 'weedingZones')).toEqual([{ label: 'Estado', value: shown }]);
  });

  it('un valor desconocido se enseña sin guiones bajos', () => {
    const [row] = describeServiceItem({ state: 'otro_valor_raro' }, 'weedingZones');
    expect(row.value).not.toContain('_');
  });
});
