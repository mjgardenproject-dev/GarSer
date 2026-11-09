import { describe, expect, it } from 'vitest';
import { postLoginPath, safeRedirectPath } from './postLoginPath';

describe('postLoginPath (R-01b)', () => {
  it('cada cuenta va directa a su panel', () => {
    expect(postLoginPath('admin')).toBe('/admin/dashboard');
    expect(postLoginPath('employee')).toBe('/mi-trabajo');
    expect(postLoginPath('client')).toBe('/dashboard');
    expect(postLoginPath('gardener')).toBe('/dashboard');
    expect(postLoginPath(null)).toBe('/dashboard');
  });

  it('un profesional con equipo también entra por /dashboard: allí se decide su panel según su modo (D31)', () => {
    expect(postLoginPath('gardener')).toBe('/dashboard');
    // Una cuenta «company» heredada se trata igual: ya no hay un tipo de cuenta de empresa.
    expect(postLoginPath('company')).toBe('/dashboard');
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
    expect(postLoginPath('gardener', '//evil.example')).toBe('/dashboard');
  });
});
