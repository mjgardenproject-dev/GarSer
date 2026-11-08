import { describe, expect, it } from 'vitest';
import { ACCOUNT_ROLES, normalizeAccountRole } from './accountRole';

describe('normalizeAccountRole', () => {
  it('acepta los cuatro tipos de cuenta que se asignan (no hay tipo «empresa»: D31)', () => {
    expect(ACCOUNT_ROLES).toEqual(['client', 'gardener', 'admin', 'employee']);
    for (const role of ACCOUNT_ROLES) {
      expect(normalizeAccountRole(role)).toBe(role);
    }
  });

  it('trata «company» como profesional: cuentas anteriores a la migración o un valor viejo en el navegador', () => {
    expect(normalizeAccountRole('company')).toBe('gardener');
  });

  it('devuelve null para cualquier otra cosa, en vez de dejar pasar un rol desconocido', () => {
    for (const value of ['superadmin', 'Admin', ' admin', 'Company', '', null, undefined, 1, {}, ['admin']]) {
      expect(normalizeAccountRole(value)).toBeNull();
    }
  });
});
