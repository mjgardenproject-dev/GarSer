import { describe, expect, it } from 'vitest';
import {
  PALM_CANONICAL_SPECIES,
  PALM_SPECIES_HEIGHT_BANDS,
  getMaxPlausiblePalmHeightM,
  getPalmHeightBandsForSpecies,
  mapPalmHeightToBand,
  supportsPhytosanitaryForSpecies,
  supportsTrunkPeelingForSpecies,
} from './speciesBusinessRules';

describe('Palm Pruning Extras Rules', () => {
  it('should enable phytosanitary and trunk peeling for Phoenix canariensis', () => {
    const species = 'Phoenix canariensis';
    expect(supportsPhytosanitaryForSpecies(species)).toBe(true);
    expect(supportsTrunkPeelingForSpecies(species)).toBe(true);
  });

  it('should disable phytosanitary and trunk peeling for Syagrus romanzoffiana', () => {
    const species = 'Syagrus romanzoffiana';
    expect(supportsPhytosanitaryForSpecies(species)).toBe(false);
    expect(supportsTrunkPeelingForSpecies(species)).toBe(false);
  });

  it('should disable phytosanitary and trunk peeling for Roystonea regia', () => {
    const species = 'Roystonea regia';
    expect(supportsPhytosanitaryForSpecies(species)).toBe(false);
    expect(supportsTrunkPeelingForSpecies(species)).toBe(false);
  });

  it('should handle variations of species names correctly', () => {
    expect(supportsPhytosanitaryForSpecies('Phoenix canariensis o similar')).toBe(true);
    expect(supportsPhytosanitaryForSpecies('SYAGRUS ROMANZOFFIANA')).toBe(false);
  });
});

describe('Palm height bands SSOT', () => {
  it('define bandas para todas las especies canónicas y la primera coincide con el umbral mínimo', () => {
    for (const species of PALM_CANONICAL_SPECIES) {
      const bands = PALM_SPECIES_HEIGHT_BANDS[species];
      expect(bands.length).toBeGreaterThan(0);
      expect(getPalmHeightBandsForSpecies(species)).toEqual(bands);
    }
  });

  it('resuelve bandas con alias y sufijo " o similar"', () => {
    expect(getPalmHeightBandsForSpecies('Washingtonia o similar')).toEqual(['0-4', '4-12', '12-20', '>20']);
    expect(getPalmHeightBandsForSpecies('especie desconocida')).toEqual([]);
  });

  it('mapea alturas de tronco a la banda de precio correcta por especie', () => {
    expect(mapPalmHeightToBand('Phoenix canariensis', 2)).toBe('0-4');
    // Frontera exacta: pertenece a la banda superior
    expect(mapPalmHeightToBand('Phoenix canariensis', 4)).toBe('4-10');
    expect(mapPalmHeightToBand('Phoenix canariensis', 10)).toBe('>10');
    expect(mapPalmHeightToBand('Trachycarpus fortunei', 5)).toBe('3-6');
    expect(mapPalmHeightToBand('Trachycarpus fortunei', 7)).toBe('>6');
    expect(mapPalmHeightToBand('Roystonea regia', 1)).toBe('0-6');
  });

  it('devuelve null para especies no canónicas o alturas inválidas', () => {
    expect(mapPalmHeightToBand('desconocida', 5)).toBeNull();
    expect(mapPalmHeightToBand('Phoenix canariensis', Number.NaN)).toBeNull();
    expect(mapPalmHeightToBand('Phoenix canariensis', -1)).toBeNull();
  });

  it('expone altura máxima plausible por especie para la post-validación', () => {
    expect(getMaxPlausiblePalmHeightM('Trachycarpus fortunei')).toBe(12);
    expect(getMaxPlausiblePalmHeightM('Washingtonia robusta/filifera')).toBe(30);
    expect(getMaxPlausiblePalmHeightM('desconocida')).toBeNull();
  });
});
