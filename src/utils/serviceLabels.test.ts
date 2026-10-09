import { describe, expect, it } from 'vitest';
import { isServiceId, serviceLabels } from './serviceLabels';

const LAWN = '1fba0ae9-cb86-4607-a31a-815882e34222';
const HEDGE = '8b0c8868-4554-48e3-9a30-597094f35166';

describe('servicios del perfil público', () => {
  it('pasa los identificadores a nombres y deja los nombres antiguos', () => {
    expect(serviceLabels([LAWN, 'Poda de setos', HEDGE], { [LAWN]: 'Corte de césped', [HEDGE]: 'Poda de setos' }))
      .toEqual(['Corte de césped', 'Poda de setos']);
  });

  it('no enseña identificadores que no conoce ni valores vacíos', () => {
    expect(serviceLabels([LAWN, '', '  '], {})).toEqual([]);
    expect(serviceLabels(null, {})).toEqual([]);
  });

  it('reconoce un identificador', () => {
    expect(isServiceId(LAWN)).toBe(true);
    expect(isServiceId('Corte de césped')).toBe(false);
  });
});
