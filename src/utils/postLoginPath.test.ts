import { describe, expect, it } from 'vitest';
import { postLoginPath, safeRedirectPath } from './postLoginPath';

describe('postLoginPath (R-01b)', () => {
  it('cada cuenta va directa a su panel', () => {
    expect(postLoginPath('admin')).toBe('/admin/dashboard');
    expect(postLoginPath('company')).toBe('/empresa');
    expect(postLoginPath('employee')).toBe('/mi-trabajo');
    expect(postLoginPath('client')).toBe('/dashboard');
    expect(postLoginPath('gardener')).toBe('/dashboard');
    expect(postLoginPath(null)).toBe('/dashboard');
  });

  it('la ruta de vuelta manda si es interna', () => {
    expect(postLoginPath('admin', '/bookings?x=1')).toBe('/bookings?x=1');
  });

  it('rechaza rutas de vuelta que saldrían de la web', () => {
    expect(safeRedirectPath('//evil.example')).toBeNull();
    expect(safeRedirectPath('https://evil.example')).toBeNull();
    expect(safeRedirectPath('/\\evil.example')).toBeNull();
    expect(safeRedirectPath('/auth')).toBeNull();
    expect(safeRedirectPath(42)).toBeNull();
    expect(postLoginPath('company', '//evil.example')).toBe('/empresa');
  });
});
