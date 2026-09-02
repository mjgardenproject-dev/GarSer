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

  it('quita todas las variantes de claves de foto de un payload real', () => {
    const payload = {
      address: 'Avenida Ricardo Soriano 12',
      photoUrls: ['https://x/firmada-caducada.jpg'],
      palmGroups: [
        {
          species: 'Phoenix canariensis',
          height: '>10m',
          quantity: 2,
          state: 'normal',
          photoUrl: 'https://x/otra.jpg',
          uploadedPhotoUrls: ['https://x/mas.jpg'],
          analyzedIndices: [0, 1],
        },
      ],
    };

    const result = stripPhotoReferences(payload) as any;

    // Lo que describe el trabajo sobrevive: es lo que permite repetir sin re-analizar.
    expect(result.address).toBe('Avenida Ricardo Soriano 12');
    expect(result.palmGroups[0].species).toBe('Phoenix canariensis');
    expect(result.palmGroups[0].height).toBe('>10m');
    expect(result.palmGroups[0].quantity).toBe(2);
    expect(result.palmGroups[0].state).toBe('normal');

    // Las fotos no: caducan en una hora y ademas se borran de Storage al completar la reserva.
    expect(result.photoUrls).toBeUndefined();
    expect(result.palmGroups[0].photoUrl).toBeUndefined();
    expect(result.palmGroups[0].uploadedPhotoUrls).toBeUndefined();
    expect(result.palmGroups[0].analyzedIndices).toBeUndefined();
  });

  it('no se rompe con valores nulos ni con anidamiento profundo', () => {
    const result = stripPhotoReferences({
      servicesData: { abc: { lawnZones: [{ quantity: 100, photoUrls: ['x'] }], nota: null } },
    }) as any;
    expect(result.servicesData.abc.lawnZones[0].quantity).toBe(100);
    expect(result.servicesData.abc.lawnZones[0].photoUrls).toBeUndefined();
    expect(result.servicesData.abc.nota).toBeNull();
  });
});
