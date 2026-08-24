import { describe, expect, it } from 'vitest';
import { stripPhotoReferences } from './rebookService';

describe('stripPhotoReferences', () => {
  it('quita las fotos pero conserva lo que describe el trabajo', () => {
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
