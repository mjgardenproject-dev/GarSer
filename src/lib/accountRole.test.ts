import { describe, expect, it } from 'vitest';
import { ACCOUNT_ROLES, normalizeAccountRole } from './accountRole';

describe('normalizeAccountRole', () => {
  it('acepta los cinco tipos de cuenta que admite profiles_role_check', () => {
    expect(ACCOUNT_ROLES).toEqual(['client', 'gardener', 'admin', 'company', 'employee']);
    for (const role of ACCOUNT_ROLES) {
      expect(normalizeAccountRole(role)).toBe(role);
    }
  });

  it('devuelve null para cualquier otra cosa, en vez de dejar pasar un rol desconocido', () => {
    for (const value of ['superadmin', 'Admin', ' admin', '', null, undefined, 1, {}, ['admin']]) {
      expect(normalizeAccountRole(value)).toBeNull();
    }
  });
});
