import { describe, it, expect } from 'vitest';
import {
  MANUAL_ENTRY_SURVEYS,
  MANUAL_SERVICE_KEYS,
  getFieldOptions,
  getManualSurvey,
  getPalmHeightRanges,
  getVisibleFields,
  isManualOnlyService,
  resolveManualServiceKey,
} from './manualEntrySchema';

describe('resolveManualServiceKey', () => {
  it('maps canonical service names to keys', () => {
    expect(resolveManualServiceKey('Corte de césped')).toBe('lawn');
    expect(resolveManualServiceKey('Poda de setos')).toBe('hedge');
    expect(resolveManualServiceKey('Poda de árboles')).toBe('tree');
    expect(resolveManualServiceKey('Poda de palmeras')).toBe('palm');
    expect(resolveManualServiceKey('Poda de plantas y arbustos')).toBe('shrub');
    expect(resolveManualServiceKey('Servicios fitosanitarios')).toBe('phytosanitary');
    expect(resolveManualServiceKey('Desbroce de malas hierbas')).toBe('weeding');
  });

  it('disambiguates trees/palms before the generic "poda" → shrub fallback', () => {
    expect(resolveManualServiceKey('poda de árbol grande')).toBe('tree');
    expect(resolveManualServiceKey('poda palmera')).toBe('palm');
    expect(resolveManualServiceKey('poda general')).toBe('shrub');
  });

  it('returns null for unknown services', () => {
    expect(resolveManualServiceKey('Limpieza de piscina')).toBeNull();
    expect(resolveManualServiceKey('')).toBeNull();
  });
});

describe('survey integrity', () => {
  it('every service key has a survey with at least one step and field', () => {
    MANUAL_SERVICE_KEYS.forEach((key) => {
      const survey = MANUAL_ENTRY_SURVEYS[key];
      expect(survey).toBeTruthy();
      expect(survey.steps.length).toBeGreaterThan(0);
      survey.steps.forEach((step) => expect(step.fields.length).toBeGreaterThan(0));
    });
  });

  it('getManualSurvey resolves by service name', () => {
    expect(getManualSurvey('Corte de césped')?.serviceKey).toBe('lawn');
    expect(getManualSurvey('nope')).toBeNull();
  });
});

describe('manual-only services (no photo/manual chooser)', () => {
  it('marks only weeding as manual-only', () => {
    expect(isManualOnlyService('weeding')).toBe(true);
    (['lawn', 'hedge', 'tree', 'palm', 'shrub', 'phytosanitary'] as const).forEach((key) => {
      expect(isManualOnlyService(key)).toBe(false);
    });
  });

  it('is safe for null/undefined', () => {
    expect(isManualOnlyService(null)).toBe(false);
    expect(isManualOnlyService(undefined)).toBe(false);
  });
});

describe('dynamic palm height options', () => {
  it('returns species-specific buckets', () => {
    expect(getPalmHeightRanges('Phoenix canariensis')).toEqual(['0-4m', '4-10m', '>10m']);
    expect(getPalmHeightRanges('Roystonea regia')).toEqual(['0-6m', '>6m']);
  });

  it('palm height field exposes options that depend on the chosen species', () => {
    const survey = MANUAL_ENTRY_SURVEYS.palm;
    const heightField = survey.steps.flatMap((s) => s.fields).find((f) => f.key === 'height');
    expect(heightField).toBeTruthy();
    const options = getFieldOptions(heightField!, { species: 'Trachycarpus fortunei' });
    expect(options.map((o) => o.value)).toEqual(['0-3m', '3-6m', '>6m']);
  });
});

describe('conditional visibility', () => {
  it('hides curativeTarget unless the intent is curative', () => {
    const survey = MANUAL_ENTRY_SURVEYS.phytosanitary;
    const targetStep = survey.steps.find((s) => s.id === 'target')!;
    expect(getVisibleFields(targetStep, { intent: 'preventive' })).toHaveLength(0);
    expect(getVisibleFields(targetStep, { intent: 'curative' })).toHaveLength(1);
  });

  it('hides trunk-peeling option for species that do not support it', () => {
    const survey = MANUAL_ENTRY_SURVEYS.palm;
    const extrasStep = survey.steps.find((s) => s.id === 'extras')!;
    const visibleForRoystonea = getVisibleFields(extrasStep, { species: 'Roystonea regia' }).map((f) => f.key);
    expect(visibleForRoystonea).not.toContain('hasTrunkPeeling');
    expect(visibleForRoystonea).not.toContain('hasPhytosanitary');
    const visibleForPhoenix = getVisibleFields(extrasStep, { species: 'Phoenix canariensis' }).map((f) => f.key);
    expect(visibleForPhoenix).toContain('hasTrunkPeeling');
  });
});
