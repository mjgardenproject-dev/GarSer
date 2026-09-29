// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readPriceDrafts, writePriceDrafts } from './sessionDrafts';

describe('borradores de propuesta (R-06)', () => {
  beforeEach(() => sessionStorage.clear());

  it('se guardan por usuario y se recuperan', () => {
    writePriceDrafts('u1', { b1: { amount: '80', reason: 'Más setos', duration: '3', loading: true } });
    expect(readPriceDrafts('u1')).toEqual({ b1: { amount: '80', reason: 'Más setos', duration: '3' } });
    expect(readPriceDrafts('u2')).toEqual({});
  });

  it('un borrador vacío no se guarda y limpia la clave', () => {
    writePriceDrafts('u1', { b1: { amount: '80', reason: '' } });
    writePriceDrafts('u1', { b1: { amount: '', reason: '' } });
    expect(sessionStorage.length).toBe(0);
  });

  it('sin usuario o con datos corruptos no rompe', () => {
    expect(readPriceDrafts(null)).toEqual({});
    sessionStorage.setItem('garser:price-drafts:u1', '{roto');
    expect(readPriceDrafts('u1')).toEqual({});
  });
});
