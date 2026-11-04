import { describe, expect, it } from 'vitest';

import { BILLING_LEVELS, type BillingLevel, type PublicBillingTerms } from '../shared/billingTerms';
import {
  feeSplitCopy,
  gardenersFaqs,
  gardenersHighlights,
  ownClientsHighlight,
  ownClientsLine,
  ownClientsPayNothing,
} from './billingCopy';

const terms = (overrides: Partial<PublicBillingTerms> = {}): PublicBillingTerms => ({
  version: 1, garserFirst: 'standard', linkFirst: 'none', garserRepeat: 'reduced', linkRepeat: 'none', maintenanceVisit: 'reduced', ...overrides,
});

// Todas las combinaciones posibles de las cinco reglas: 4^5 = 1024.
const ALL: PublicBillingTerms[] = [];
for (const garserFirst of BILLING_LEVELS) for (const linkFirst of BILLING_LEVELS) for (const garserRepeat of BILLING_LEVELS)
  for (const linkRepeat of BILLING_LEVELS) for (const maintenanceVisit of BILLING_LEVELS) {
    ALL.push({ version: 1, garserFirst, linkFirst, garserRepeat, linkRepeat, maintenanceVisit });
  }

const everything = (t: PublicBillingTerms | null) =>
  [
    ownClientsLine(t),
    ownClientsHighlight(t),
    JSON.stringify(feeSplitCopy(t)),
    JSON.stringify(gardenersFaqs(t)),
    gardenersHighlights(t).join(' '),
  ].join('\n');

const claimsNothingPays = /sin gastos de gestión|no pagan gastos|deja de pagar|ya no pagan|tampoco pagan|pagan tu precio y nada más/i;

describe('textos neutros (no se sabe qué dicen los ajustes)', () => {
  it.each([[null], [undefined]])('con %s no prometen que nadie deje de pagar ni que pague menos', (value) => {
    const text = everything(value as null);
    expect(text).not.toMatch(claimsNothingPays);
    expect(text).not.toMatch(/reducid|menos gastos|primera reserva|primera vez/i);
  });

  it('siguen diciendo lo que es cierto con cualquier configuración', () => {
    expect(ownClientsLine(null)).toBe('Tus clientes reservan directamente contigo.');
    expect(ownClientsHighlight(null)).toBe('Tus clientes reservan directamente contigo');
    const copy = feeSplitCopy(null);
    expect(copy.title).toBe('Para ti es gratis. Los gastos de gestión, los paga el cliente.');
    expect(copy.rows.every((row) => row.badge === null)).toBe(true);
    expect(copy.rows[1].result).toContain('Los gastos de gestión, si los hay, los paga el cliente, aparte. Tú cobras tu precio entero.');
    expect(copy.loyaltyNote).toBeNull();
    expect(gardenersHighlights(null)).toEqual([
      'Gratis para ti: sin cuota ni comisión',
      'Tus clientes reservan directamente contigo',
      'Cobras el 100 % de tu precio',
    ]);
  });
});

describe('la configuración de fábrica (12,5 % GarSer · 0 % enlace · 3 % repetición y planes)', () => {
  const t = terms();

  it('sus clientes del enlace no pagan, y los planes sí (se dice)', () => {
    expect(ownClientsLine(t)).toBe('Tus clientes reservan contigo sin gastos de gestión (salvo en las visitas de un plan de mantenimiento).');
    expect(ownClientsHighlight(t)).toBe('Tus clientes reservan sin gastos de gestión (salvo en planes de mantenimiento)');
    const copy = feeSplitCopy(t);
    expect(copy.rows[0]).toMatchObject({ id: 'own', badge: 'Sin gastos de gestión' });
    expect(copy.rows[0].result).toContain('Pagan tu precio y nada más.');
    expect(copy.rows[0].result).toContain('Las visitas de un plan de mantenimiento sí llevan gastos de gestión.');
    expect(copy.rows[1]).toMatchObject({ id: 'garser', badge: 'Gastos de gestión' });
  });

  it('y el cliente que trajo GarSer paga menos al volver (no «deja de pagar»)', () => {
    expect(feeSplitCopy(t).loyaltyNote).toBe('Y si un cliente que te trajo GarSer vuelve a reservar contigo, paga menos gastos de gestión.');
    expect(everything(t)).not.toContain('deja de pagar');
  });
});

describe('cada afirmación solo sale cuando los ajustes la cumplen (1024 combinaciones)', () => {
  it.each(ALL.map((t) => [JSON.stringify(t), t] as const))('%s', (_label, t) => {
    const bothOwnNone = t.linkFirst === 'none' && t.linkRepeat === 'none';
    const planWarning = (t.linkFirst === 'none' || t.linkRepeat === 'none') && t.maintenanceVisit !== 'none';
    const split = feeSplitCopy(t);
    const faqs = gardenersFaqs(t);
    const all = everything(t);

    // Ningún texto cita un porcentaje.
    expect(all.replace(/100 %/g, '')).not.toMatch(/\d\s*%/);

    // «Tus clientes reservan sin gastos de gestión» (a secas) ⇒ los dos casos del enlace a 0 % y planes a 0 %.
    for (const text of [ownClientsHighlight(t), ownClientsLine(t)]) {
      if (/sin gastos de gestión/.test(text)) {
        expect(t.linkFirst === 'none', text).toBe(true);
        if (!/la primera vez/.test(text)) expect(bothOwnNone, text).toBe(true);
        if (!/salvo/.test(text) && !/la primera vez/.test(text)) expect(t.maintenanceVisit, text).toBe('none');
      }
    }
    expect(ownClientsPayNothing(t)).toBe(bothOwnNone);
    if (/salvo/.test(ownClientsLine(t))) expect(planWarning).toBe(true);

    // El título solo promete «sin gastos de gestión» si de verdad nadie del enlace paga ni en planes.
    if (/sin gastos de gestión/.test(split.title)) {
      expect(bothOwnNone && t.maintenanceVisit === 'none').toBe(true);
    }
    // La fila de «tus clientes».
    const own = split.rows[0];
    if (own.badge === 'Sin gastos de gestión') expect(bothOwnNone).toBe(true);
    if (/pagan tu precio y nada más/i.test(own.result)) expect(bothOwnNone).toBe(true);
    if (planWarning && bothOwnNone) expect(own.result).toContain('plan de mantenimiento');
    // La fila de los clientes de GarSer.
    const garser = split.rows[1];
    if (garser.badge === 'Sin gastos de gestión') expect(t.garserFirst).toBe('none');
    if (garser.badge === 'Gastos de gestión') expect(t.garserFirst).not.toBe('none');
    // La nota de fidelidad.
    if (split.loyaltyNote) {
      expect(t.garserFirst).not.toBe('none');
      if (/deja de pagar/.test(split.loyaltyNote)) expect(t.garserRepeat).toBe('none');
      if (/paga menos/.test(split.loyaltyNote)) expect(t.garserRepeat).toBe('reduced');
    } else {
      expect(t.garserFirst === 'none' || t.garserRepeat === 'standard' || t.garserRepeat === 'higher').toBe(true);
    }
    // Las preguntas frecuentes: siempre las 7 y con respuesta.
    expect(faqs).toHaveLength(7);
    expect(faqs.every((f) => f.question && f.answer)).toBe(true);
    const ownAnswer = faqs[1].answer;
    if (/pagan tu precio y nada más/.test(ownAnswer)) expect(bothOwnNone).toBe(true);
    if (/reducidos/.test(ownAnswer)) expect(t.linkFirst === 'reduced' || t.linkRepeat === 'reduced').toBe(true);
    const newAnswer = faqs[2].answer;
    if (/Tampoco pagan/.test(newAnswer)) expect(t.garserFirst).toBe('none');
    if (/pagan unos gastos de gestión a GarSer/.test(newAnswer)) expect(t.garserFirst).not.toBe('none');
    // Lo del profesional nunca cambia.
    expect(faqs[0].answer).toBe('Nada. No hay cuota ni comisión para ti: cobras el 100 % de tu precio.');
    expect(gardenersHighlights(t)[0]).toBe('Gratis para ti: sin cuota ni comisión');
    expect(gardenersHighlights(t)[2]).toBe('Cobras el 100 % de tu precio');
  });
});

describe('casos concretos', () => {
  const lv = (level: BillingLevel) => level;

  it('todo a 0 %: nadie paga, ni los de GarSer', () => {
    const t = terms({ garserFirst: lv('none'), linkFirst: 'none', garserRepeat: 'none', linkRepeat: 'none', maintenanceVisit: 'none' });
    expect(ownClientsLine(t)).toBe('Tus clientes reservan contigo sin gastos de gestión.');
    const copy = feeSplitCopy(t);
    expect(copy.title).toBe('Para ti es gratis. Para tus clientes, sin gastos de gestión.');
    expect(copy.rows[1]).toMatchObject({ badge: 'Sin gastos de gestión' });
    expect(copy.loyaltyNote).toBeNull();
    expect(gardenersFaqs(t)[2].answer).toBe('Tampoco pagan gastos de gestión. Y a ti no se te descuenta nada.');
  });

  it('el enlace cobra como GarSer: ya no hay diferencia que contar', () => {
    const t = terms({ linkFirst: 'standard', linkRepeat: 'reduced', garserRepeat: 'reduced' });
    const copy = feeSplitCopy(t);
    expect(copy.intro).toContain('Los gastos de gestión, si los hay, los paga siempre el cliente');
    expect(copy.rows[0].result).toContain('En su primera reserva pagan gastos de gestión; después pagan unos gastos de gestión reducidos.');
    expect(ownClientsLine(t)).toBe('Tus clientes reservan directamente contigo.');
  });

  it('solo la primera reserva del enlace es gratis', () => {
    const t = terms({ linkFirst: 'none', linkRepeat: 'standard', maintenanceVisit: 'none' });
    expect(ownClientsLine(t)).toBe('Tus clientes reservan contigo sin gastos de gestión la primera vez.');
    expect(feeSplitCopy(t).rows[0].result).toContain('En su primera reserva no pagan gastos de gestión; después pagan gastos de gestión.');
    expect(gardenersFaqs(t)[1].answer).toContain('en su primera reserva no pagan gastos de gestión; después pagan gastos de gestión');
  });

  it('la primera es de pago y las siguientes son gratis', () => {
    const t = terms({ linkFirst: 'reduced', linkRepeat: 'none', maintenanceVisit: 'none' });
    expect(feeSplitCopy(t).rows[0].result).toContain('En su primera reserva pagan unos gastos de gestión reducidos; después ya no pagan gastos de gestión.');
  });

  it('el cliente que trajo GarSer deja de pagar al repetir: se promete exactamente eso', () => {
    const t = terms({ garserRepeat: 'none' });
    expect(feeSplitCopy(t).loyaltyNote).toBe('Y si un cliente que te trajo GarSer vuelve a reservar contigo, deja de pagar gastos de gestión.');
  });
});
