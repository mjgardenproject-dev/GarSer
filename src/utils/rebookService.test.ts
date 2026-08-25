import { describe, it, expect } from 'vitest';
import { hasRebookBreakdown, stripPhotoReferences } from './rebookService';

describe('hasRebookBreakdown', () => {
  it('reconoce un desglose en cualquiera de las siete secciones', () => {
    expect(hasRebookBreakdown({ palmGroups: [{ species: 'Phoenix canariensis' }] })).toBe(true);
    expect(hasRebookBreakdown({ lawnZones: [{ area: 120 }] })).toBe(true);
    expect(hasRebookBreakdown({ weedingZones: [{ area: 300 }] })).toBe(true);
  });

  it('no da por bueno un payload sin secciones o con secciones vacías', () => {
    // Es el caso de las reservas sin presupuesto asociado: solo dirección y servicio. Con esto
    // en falso, el funnel se salta el resumen en vez de enseñar una tarjeta vacía.
    expect(hasRebookBreakdown({ address: 'Marbella', serviceIds: ['abc'] })).toBe(false);
    expect(hasRebookBreakdown({ palmGroups: [], lawnZones: [] })).toBe(false);
    expect(hasRebookBreakdown({})).toBe(false);
  });

  it('ignora secciones que no sean listas', () => {
    expect(hasRebookBreakdown({ palmGroups: 'dos palmeras' as unknown })).toBe(false);
  });
});

describe('stripPhotoReferences', () => {
  it('quita las fotos pero conserva lo que describe el trabajo', () => {
    const limpio = stripPhotoReferences({
      palmGroups: [{ species: 'Phoenix canariensis', height: '4-10m', photoUrls: ['x'], analyzedIndices: [0] }],
    }) as { palmGroups: Array<Record<string, unknown>> };
    expect(limpio.palmGroups[0]).toEqual({ species: 'Phoenix canariensis', height: '4-10m' });
  });
});
