import { describe, expect, it } from 'vitest';

import {
  COMMISSION_RULE_CODES,
  COMMISSION_RULES,
  claimedOriginFor,
  commissionRatesEqual,
  formatCommissionPercent,
  isCommissionRuleCode,
  readCommissionPercent,
  validateCommissionPercent,
  validateCommissionRates,
} from './commissionRules';

describe('las cinco reglas', () => {
  it('son cinco, en el orden del panel, con el nombre y la descripción pedidos', () => {
    expect(COMMISSION_RULE_CODES).toEqual(['garser_first', 'link_first', 'garser_repeat', 'maintenance_visit', 'link_repeat']);
    expect(COMMISSION_RULES.map((rule) => rule.code)).toEqual([...COMMISSION_RULE_CODES]);
    expect(COMMISSION_RULES.map((rule) => rule.description)).toEqual([
      'Comisión aplicada cuando un cliente contrata por primera vez a un jardinero a través de GarSer y la oportunidad comercial ha sido generada por la plataforma.',
      'Comisión aplicada a la primera reserva de un cliente que llega a GarSer a través del enlace personal de un jardinero.',
      'Comisión aplicada a las reservas posteriores de un cliente con un jardinero con el que ya ha contratado anteriormente.',
      'Comisión aplicada a cada visita correspondiente a un plan de mantenimiento de jardinería.',
      'Comisión aplicada a las reservas posteriores de un cliente con el mismo jardinero cuando la relación comercial se originó a través del enlace personal del profesional.',
    ]);
    expect(COMMISSION_RULES.map((rule) => rule.title)).toEqual([
      'Primera reserva de un cliente captado por GarSer',
      'Primera reserva de un cliente procedente del enlace personal del jardinero',
      'Reservas posteriores con el mismo jardinero',
      'Visitas de planes de mantenimiento',
      'Reservas posteriores con un jardinero procedentes del enlace personal de este',
    ]);
  });

  it('reconoce solo códigos de regla', () => {
    expect(isCommissionRuleCode('link_repeat')).toBe(true);
    expect(isCommissionRuleCode('otra')).toBe(false);
    expect(isCommissionRuleCode(undefined)).toBe(false);
  });
});

describe('readCommissionPercent (lo que se teclea)', () => {
  it.each([
    ['0', 0], ['3', 3], ['1,5', 1.5], ['1.5', 1.5], ['12,5', 12.5], ['100', 100], ['100,00', 100],
    ['0,25', 0.25], ['0,01', 0.01], ['  7 ', 7], ['1,230', 1.23], ['00,5', 0.5],
  ])('acepta «%s» como %s', (text, value) => {
    expect(readCommissionPercent(text)).toEqual({ ok: true, value });
  });

  it.each([
    ['', 'required'], ['   ', 'required'], [null, 'required'], [undefined, 'required'],
    ['abc', 'not_a_number'], ['12,5%', 'not_a_number'], ['1e2', 'not_a_number'], ['NaN', 'not_a_number'],
    ['Infinity', 'not_a_number'], ['1,2,3', 'not_a_number'], ['1.000,5', 'not_a_number'], [',5', 'not_a_number'],
    ['-1', 'negative'], ['-0,5', 'negative'],
    ['100,01', 'above_100'], ['101', 'above_100'], ['1000', 'above_100'],
    ['1,234', 'too_many_decimals'], ['0,005', 'too_many_decimals'],
  ] as const)('rechaza «%s» (%s) y nunca lo convierte en 0', (text, error) => {
    const reading = readCommissionPercent(text as string | null | undefined);
    expect(reading.ok).toBe(false);
    if (!reading.ok) {
      expect(reading.error).toBe(error);
      expect(reading.message.length).toBeGreaterThan(5);
    }
  });
});

describe('validateCommissionPercent (lo que viajaría a la base de datos)', () => {
  it.each([0, 0.01, 1.5, 3, 12.5, 99.99, 100])('acepta %s', (value) => {
    expect(validateCommissionPercent(value)).toEqual({ ok: true, value });
  });

  it.each([
    [Number.NaN, 'not_a_number'], [Number.POSITIVE_INFINITY, 'not_a_number'], [Number.NEGATIVE_INFINITY, 'not_a_number'],
    ['12', 'not_a_number'], [true, 'not_a_number'], [{}, 'not_a_number'],
    [null, 'required'], [undefined, 'required'], ['', 'required'],
    [-0.01, 'negative'], [100.01, 'above_100'], [1.005, 'too_many_decimals'], [0.123, 'too_many_decimals'],
  ] as const)('rechaza %s (%s)', (value, error) => {
    const reading = validateCommissionPercent(value);
    expect(reading.ok).toBe(false);
    if (!reading.ok) expect(reading.error).toBe(error);
  });
});

describe('validateCommissionRates (las cinco a la vez)', () => {
  const valid = { garser_first: 12.5, link_first: 0, garser_repeat: 3, maintenance_visit: 3, link_repeat: 0 };

  it('acepta una configuración completa y válida', () => {
    expect(validateCommissionRates(valid)).toEqual({ ok: true, rates: valid });
  });

  it('con un campo roto devuelve el error de ESE campo y no una configuración «arreglada»', () => {
    const result = validateCommissionRates({ ...valid, garser_repeat: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toEqual(['garser_repeat']);
  });

  it('un campo que falta es un error, no un 0', () => {
    const { link_repeat: _omit, ...incomplete } = valid;
    void _omit;
    const result = validateCommissionRates(incomplete);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.link_repeat).toBe('Indica un porcentaje.');
  });
});

describe('formato y comparación', () => {
  it.each([[12.5, '12,5'], [3, '3'], [0, '0'], [0.25, '0,25'], [100, '100'], [1.5, '1,5'], [10, '10'], [0.1, '0,1']])(
    'enseña %s como «%s»',
    (value, text) => expect(formatCommissionPercent(value)).toBe(text),
  );

  it('compara configuraciones sin errores de coma flotante', () => {
    const a = { garser_first: 12.5, link_first: 0, garser_repeat: 3, maintenance_visit: 3, link_repeat: 0 };
    expect(commissionRatesEqual(a, { ...a })).toBe(true);
    expect(commissionRatesEqual(a, { ...a, link_first: 0.01 })).toBe(false);
  });
});

describe('claimedOriginFor (lo único que declara el navegador)', () => {
  it('solo vale la declaración «enlace» para el mismo profesional del presupuesto', () => {
    expect(claimedOriginFor({ bookingOrigin: 'provider_link', originProviderId: 'pro-1' }, 'pro-1')).toBe('provider_link');
    expect(claimedOriginFor({ bookingOrigin: 'provider_link', originProviderId: ' pro-1 ' }, 'pro-1')).toBe('provider_link');
  });

  it.each([
    [{ bookingOrigin: 'provider_link', originProviderId: 'pro-2' }],
    [{ bookingOrigin: 'provider_link' }],
    [{ bookingOrigin: 'garser', originProviderId: 'pro-1' }],
    [{ bookingOrigin: 'PROVIDER_LINK', originProviderId: 'pro-1' }],
    [{ bookingOrigin: { toString: (): string => 'provider_link' }, originProviderId: 'pro-1' }],
    [{}],
  ])('ignora %j', (payload) => expect(claimedOriginFor(payload, 'pro-1')).toBeNull());
});
