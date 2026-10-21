import { describe, expect, it } from 'vitest';
import { applicantRedirect } from './applicantRedirect';

describe('a dónde va un jardinero según su solicitud', () => {
  it('pendiente o rechazada: a /status, salvo «Mi cuenta»', () => {
    expect(applicantRedirect('pending', '/dashboard')).toBe('/status');
    expect(applicantRedirect('denied', '/bookings')).toBe('/status');
    expect(applicantRedirect('pending', '/status')).toBeNull();
    expect(applicantRedirect('pending', '/account')).toBeNull();
    expect(applicantRedirect('denied', '/account')).toBeNull();
  });

  it('aprobado: fuera de /apply y /status', () => {
    expect(applicantRedirect('active', '/apply')).toBe('/dashboard');
    expect(applicantRedirect('active', '/status')).toBe('/dashboard');
    expect(applicantRedirect('active', '/account')).toBeNull();
    expect(applicantRedirect('active', '/chat')).toBeNull();
  });

  it('sin enviar: a /apply, salvo la entrada y «Mi cuenta»', () => {
    expect(applicantRedirect(null, '/dashboard')).toBe('/apply');
    expect(applicantRedirect(null, '/apply')).toBeNull();
    expect(applicantRedirect(null, '/auth')).toBeNull();
    expect(applicantRedirect(null, '/account')).toBeNull();
  });

  it('las páginas legales se pueden leer siempre', () => {
    for (const status of ['pending', 'denied', 'active', null] as const) {
      expect(applicantRedirect(status, '/privacidad')).toBeNull();
      expect(applicantRedirect(status, '/terminos')).toBeNull();
    }
  });
});
