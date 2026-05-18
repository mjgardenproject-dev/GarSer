import { describe, expect, it } from 'vitest';
import {
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
