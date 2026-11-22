import { describe, expect, it } from 'vitest';
import {
  costaDelSolContent, costaDelSolFaqs, generalHomeContent, generalHomeFaqs, marbellaContent, marbellaFaqs,
} from './publicSiteContent';

// QA-008, QA-094 y la ronda de la landing de anuncios (1.18): el texto público no habla de la propia página ni
// usa jerga de producto («landing», «flujo», «borrador», «pensada para…», «vender humo»).
const INTERNAL = /landing|flujo|borrador|pensada para|proceso guiado|vender humo|slot|supabase|storage|path:/i;

const strings = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
};

describe('texto público de la portada y las páginas de zona', () => {
  it.each([
    ['portada', [generalHomeContent, generalHomeFaqs]],
    ['Marbella', [marbellaContent, marbellaFaqs]],
    ['Costa del Sol', [costaDelSolContent, costaDelSolFaqs]],
  ])('%s: sin jerga interna', (_name, parts) => {
    const offenders = strings(parts).filter((s) => INTERNAL.test(s));
    expect(offenders).toEqual([]);
  });
});
