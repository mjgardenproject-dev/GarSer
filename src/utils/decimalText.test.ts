import { describe, expect, it } from 'vitest';
import { parseDecimalText, readManualNumber, sanitizeDecimalTyping } from './decimalText';

describe('parseDecimalText (tarifas del jardinero)', () => {
  it('lee la coma decimal y deja la casilla vacía como null', () => {
    expect(parseDecimalText('')).toBeNull();
    expect(parseDecimalText('0,')).toBe(0);
    expect(parseDecimalText('0,5')).toBe(0.5);
    expect(parseDecimalText('12,5')).toBe(12.5);
    expect(parseDecimalText('45')).toBe(45);
  });
});

describe('sanitizeDecimalTyping (lo que se teclea en una tarifa)', () => {
  it.each([
    ['1.5', '1,5'],
    ['12€', '12'],
    ['1,2,3', '1,23'],
    [',5', '0,5'],
    ['05', '5'],
    ['00,5', '0,5'],
    ['0', '0'],
    ['', ''],
  ])('«%s» → «%s»', (input, expected) => {
    expect(sanitizeDecimalTyping(input)).toBe(expected);
  });
});

describe('readManualNumber (campos del asistente manual)', () => {
  const num = (value: number) => ({ kind: 'number', value });

  it('vacío o solo espacios es «sin valor»', () => {
    expect(readManualNumber('', 'quantity')).toEqual({ kind: 'empty' });
    expect(readManualNumber('   ', 'decimal')).toEqual({ kind: 'empty' });
  });

  it('coma y punto decimal valen lo mismo (P-15: «1,5» nunca se lee como 15)', () => {
    expect(readManualNumber('1,5', 'decimal')).toEqual(num(1.5));
    expect(readManualNumber('1.5', 'decimal')).toEqual(num(1.5));
    expect(readManualNumber('2,5', 'quantity')).toEqual(num(2.5));
    expect(readManualNumber('12,5', 'quantity')).toEqual(num(12.5));
    expect(readManualNumber('12.5', 'quantity')).toEqual(num(12.5));
  });

  it('D-07: en cantidades, el punto seguido de grupos de tres cifras es separador de miles', () => {
    expect(readManualNumber('1.000', 'quantity')).toEqual(num(1000));
    expect(readManualNumber('12.500', 'quantity')).toEqual(num(12500));
    expect(readManualNumber('1.000.000', 'quantity')).toEqual(num(1000000));
    expect(readManualNumber('1.000,5', 'quantity')).toEqual(num(1000.5));
    expect(readManualNumber('12.50', 'quantity')).toEqual(num(12.5));
  });

  it('en medidas decimales el punto nunca es de miles', () => {
    expect(readManualNumber('1.500', 'decimal')).toEqual(num(1.5));
  });

  it('un separador al final se lee como el entero (se está escribiendo el decimal)', () => {
    expect(readManualNumber('2,', 'decimal')).toEqual(num(2));
    expect(readManualNumber('80.', 'quantity')).toEqual(num(80));
  });

  it('enteros y espacios', () => {
    expect(readManualNumber('80', 'quantity')).toEqual(num(80));
    expect(readManualNumber(' 1 000 ', 'quantity')).toEqual(num(1000));
    expect(readManualNumber('0', 'quantity')).toEqual(num(0));
  });

  it('lo que no es un número claro es inválido, nunca un número adivinado', () => {
    for (const input of ['abc', '1,2,3', '1..5', '-3', '+3', '1e3', ',5', '2 m²', '1.000.00']) {
      expect(readManualNumber(input, 'quantity')).toEqual({ kind: 'invalid' });
    }
  });
});
