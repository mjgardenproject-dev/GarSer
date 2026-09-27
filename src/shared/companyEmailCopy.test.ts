import { describe, it, expect } from 'vitest';
import { invitationEmailCopy } from '../../supabase/functions/_shared/companyEmailCopy.ts';

// H-39: el correo de invitación parecía dirigido a una empresa y no decía qué hacer.
describe('invitationEmailCopy', () => {
  const copy = invitationEmailCopy({ companyName: 'Jardines Sol', email: 'ana@correo.com', expiresLabel: '3 de octubre' });

  it('dice quién invita y que es para trabajar como empleado', () => {
    expect(copy.subject).toBe('Jardines Sol te invita a trabajar con su equipo en GarSer');
    expect(copy.heading).toBe('Jardines Sol quiere que formes parte de su equipo');
    expect(copy.intro).toContain('como empleado');
    expect(copy.intro).not.toMatch(/Tu empresa/);
  });

  it('explica los pasos de la invitación (contraseña en la propia página, sin confirmar correo)', () => {
    expect(copy.ctaLabel).toBe('Unirme al equipo');
    expect(copy.steps.map(([n]) => n)).toEqual(['1', '2', '3']);
    expect(copy.steps.map(([, text]) => text).join(' ')).toMatch(/contraseña.*panel de empleado/);
    expect(copy.steps.join(' ')).not.toMatch(/confirm/i);
  });

  it('pie: personal, para qué correo, cuándo caduca y cómo volver', () => {
    expect(copy.footerNote).toContain('solo sirve para ana@correo.com');
    expect(copy.footerNote).toContain('caduca el 3 de octubre');
    expect(copy.footerNote).toContain('garser.es con este correo y tu contraseña');
  });

  it('sin nombre de empresa no sale «null»', () => {
    const plain = invitationEmailCopy({ companyName: null, email: null, expiresLabel: '1 de enero' });
    expect(plain.subject).toBe('Una empresa de jardinería te invita a trabajar con su equipo en GarSer');
    expect(plain.footerNote).toMatch(/^La invitación es personal y caduca/);
  });
});
