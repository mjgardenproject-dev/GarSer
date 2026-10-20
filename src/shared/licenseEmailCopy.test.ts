import { describe, expect, it } from 'vitest';
import {
  companyLicenseEmailCopy,
  holderLicenseEmailCopy,
  licensePathFor,
  licenseRequestEmailCopy,
} from '../../supabase/functions/_shared/licenseEmailCopy.ts';

// Avisos del carnet fitosanitario (2026-10-20): cada uno dice qué ha pasado, qué consecuencia tiene
// y lleva al sitio donde se sube el carnet de cada tipo de cuenta.
describe('licenseEmailCopy', () => {
  it('cada tipo de cuenta va a donde sube su carnet', () => {
    expect(licensePathFor('employee')).toBe('/mi-trabajo?tab=profile');
    expect(licensePathFor('company_owner')).toBe('/empresa?tab=company');
    expect(licensePathFor('solo')).toBe('/dashboard');
  });

  it('aprobado: dice hasta cuándo vale y qué puede hacer ahora cada uno', () => {
    const employee = holderLicenseEmailCopy({ event: 'approved', kind: 'employee', name: 'Ana López', companyName: 'Jardines Sol', expiresLabel: '3 de marzo de 2031' });
    expect(employee.heading).toBe('Hola Ana');
    expect(employee.intro).toContain('Jardines Sol ya puede asignarte tratamientos fitosanitarios');
    expect(employee.pairs).toEqual([['Válido hasta', '3 de marzo de 2031']]);
    expect(employee.ctaPath).toBe('/mi-trabajo?tab=profile');
    const solo = holderLicenseEmailCopy({ event: 'approved', kind: 'solo', name: '', expiresLabel: '1 de enero de 2030' });
    expect(solo.heading).toBe('Hola');
    expect(solo.intro).toContain('sales a los clientes en los tratamientos con producto químico');
  });

  it('rechazado: lleva el motivo, y si era una renovación, que el actual sigue valiendo', () => {
    const first = holderLicenseEmailCopy({ event: 'rejected', kind: 'employee', companyName: 'Jardines Sol', reason: 'No se lee el número' });
    expect(first.pairs).toEqual([['Motivo', 'No se lee el número']]);
    expect(first.footerNote).toContain('Jardines Sol puede enviarlo por ti');
    const renewal = holderLicenseEmailCopy({ event: 'rejected', kind: 'solo', reason: 'Es el mismo de antes', stillValidLabel: '5 de mayo de 2027' });
    expect(renewal.intro).toContain('Tu carnet actual sigue valiendo hasta el 5 de mayo de 2027');
  });

  it('caducidad: aviso antes y al caducar, con la consecuencia', () => {
    const soon = holderLicenseEmailCopy({ event: 'expiring', kind: 'employee', companyName: 'Jardines Sol', expiresLabel: '20 de noviembre de 2026' });
    expect(soon.subject).toBe('Tu carnet fitosanitario caduca el 20 de noviembre de 2026');
    expect(soon.intro).toContain('el actual sigue valiendo');
    const gone = holderLicenseEmailCopy({ event: 'expired', kind: 'employee', companyName: 'Jardines Sol' });
    expect(gone.intro).toContain('Jardines Sol no puede asignarte tratamientos fitosanitarios');
  });

  it('enviado por la empresa: se lo dice al empleado y cómo actuar si no dio permiso', () => {
    const copy = holderLicenseEmailCopy({ event: 'submitted_for_you', kind: 'employee', companyName: 'Jardines Sol' });
    expect(copy.subject).toBe('Jardines Sol ha enviado tu carnet fitosanitario a GarSer');
    expect(copy.footerNote).toContain('Si no le diste permiso a Jardines Sol');
  });

  it('a la empresa: aprobado (asignar), rechazado (motivo) y caducado (se le quitó el servicio)', () => {
    const approved = companyLicenseEmailCopy({ event: 'approved', personName: 'Ana López', expiresLabel: '3 de marzo de 2031' });
    expect(approved.subject).toBe('El carnet fitosanitario de Ana López está aprobado');
    expect(approved.intro).toContain('«Servicios fitosanitarios»');
    expect(approved.ctaPath).toBe('/empresa?tab=team');
    expect(companyLicenseEmailCopy({ event: 'rejected', personName: 'Ana', reason: 'Caducado' }).pairs).toEqual([['Motivo', 'Caducado']]);
    expect(companyLicenseEmailCopy({ event: 'expired', personName: 'Ana' }).intro).toContain('le hemos quitado ese servicio');
    expect(companyLicenseEmailCopy({ event: 'expiring', personName: '' }).subject).toBe('El carnet de Una persona de tu equipo caduca pronto');
  });

  it('la petición de la empresa explica cómo subirlo', () => {
    const copy = licenseRequestEmailCopy({ name: 'Pepe Ruiz', companyName: 'Jardines Sol' });
    expect(copy.subject).toBe('Jardines Sol te pide tu carnet fitosanitario');
    expect(copy.heading).toBe('Hola Pepe');
    expect(copy.pairs.map(([, step]) => step).join(' ')).toContain('«Hacer foto»');
    expect(copy.ctaPath).toBe('/mi-trabajo?tab=profile');
  });
});
