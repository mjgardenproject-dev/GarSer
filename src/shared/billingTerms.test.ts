import { describe, expect, it } from 'vitest';

import fixture from './billingTerms.cases.json';

import { COMMISSION_RULE_CODES, type CommissionRates } from './commissionRules';
import { parsePublicBillingTerms, termLevel, termsFromRates } from './billingTerms';

const rates = (overrides: Partial<CommissionRates> = {}): CommissionRates => ({
  garser_first: 12.5, link_first: 0, garser_repeat: 3, maintenance_visit: 3, link_repeat: 0, ...overrides,
});

describe('termLevel', () => {
  it.each([
    [0, 12.5, 'none'],
    [0.01, 12.5, 'reduced'],
    [12.49, 12.5, 'reduced'],
    [12.5, 12.5, 'standard'],
    [12.51, 12.5, 'higher'],
    [100, 12.5, 'higher'],
    [0, 0, 'none'],
    [0.01, 0, 'higher'],
    [100, 100, 'standard'],
  ])('%s respecto a %s = %s', (rate, baseline, expected) => {
    expect(termLevel(rate, baseline)).toBe(expected);
  });
});

describe('termLevel · casos compartidos con la prueba de SQL (commission_term_level)', () => {
  it.each(fixture.cases as Array<[number, number, string]>)('%s respecto a %s = %s', (rate, baseline, expected) => {
    expect(termLevel(rate, baseline)).toBe(expected);
  });
});

describe('termsFromRates', () => {
  it('la configuración de fábrica', () => {
    expect(termsFromRates(rates(), 4)).toEqual({
      version: 4, garserFirst: 'standard', linkFirst: 'none', garserRepeat: 'reduced', linkRepeat: 'none', maintenanceVisit: 'reduced',
    });
  });

  it('no incluye ningún porcentaje', () => {
    expect(JSON.stringify(termsFromRates(rates()))).not.toMatch(/[0-9]\.[0-9]|%/);
  });

  it('cubre las cinco reglas', () => {
    expect(Object.keys(termsFromRates(rates())).sort()).toEqual(
      ['garserFirst', 'garserRepeat', 'linkFirst', 'linkRepeat', 'maintenanceVisit', 'version'],
    );
    expect(COMMISSION_RULE_CODES).toHaveLength(5);
  });
});

describe('parsePublicBillingTerms', () => {
  const valid = { version: 3, garserFirst: 'standard', linkFirst: 'none', garserRepeat: 'reduced', linkRepeat: 'none', maintenanceVisit: 'reduced' };

  it('lee una respuesta completa', () => {
    expect(parsePublicBillingTerms(valid)).toEqual(valid);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['un texto', 'x'],
    ['una lista', []],
    ['sin versión', { ...valid, version: undefined }],
    ['versión 0', { ...valid, version: 0 }],
    ['versión decimal', { ...valid, version: 1.5 }],
    ['versión en texto', { ...valid, version: '3' }],
    ['un nivel inventado', { ...valid, linkFirst: 'gratis' }],
    ['un nivel que falta', { ...valid, linkRepeat: undefined }],
    ['un porcentaje en lugar del nivel', { ...valid, linkFirst: 0 }],
  ])('rechaza %s', (_label, data) => {
    expect(parsePublicBillingTerms(data)).toBeNull();
  });

  it('ignora campos de más (no los propaga)', () => {
    expect(parsePublicBillingTerms({ ...valid, rate_garser_first: 12.5 })).toEqual(valid);
  });
});
