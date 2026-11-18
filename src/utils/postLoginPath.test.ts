import { describe, expect, it } from 'vitest';
import { isPathAllowedForRole, postLoginPath, safeRedirectPath } from './postLoginPath';

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

  it('la ruta de vuelta manda si es interna y es de la zona de esa cuenta', () => {
    expect(postLoginPath('client', '/bookings?x=1')).toBe('/bookings?x=1');
    expect(postLoginPath('admin', '/admin/solicitudes')).toBe('/admin/solicitudes');
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

describe('la ruta de vuelta no es de otra cuenta (QA-155, QA-085, QA-122, QA-130)', () => {
  it('una página de administrador no se le ofrece a quien no lo es (antes: «Acceso denegado»)', () => {
    for (const role of ['client', 'gardener', 'company', 'employee', null]) {
      expect(postLoginPath(role, '/admin/dashboard'), String(role)).not.toBe('/admin/dashboard');
    }
    expect(postLoginPath('client', '/admin/dashboard')).toBe('/dashboard');
    expect(postLoginPath('employee', '/admin')).toBe('/mi-trabajo');
  });

  it('un administrador solo vuelve a páginas de administración; si no, a su panel', () => {
    expect(postLoginPath('admin', '/mis-reservas')).toBe('/admin/dashboard');
    expect(postLoginPath('admin', '/admin/incidencias')).toBe('/admin/incidencias');
  });

  it('«Mi trabajo» es solo del empleado', () => {
    expect(postLoginPath('employee', '/mi-trabajo/agenda')).toBe('/mi-trabajo/agenda');
    expect(postLoginPath('client', '/mi-trabajo/agenda')).toBe('/dashboard');
    expect(postLoginPath('gardener', '/mi-trabajo')).toBe('/dashboard');
  });

  it('un empleado no vuelve a la zona de empresa de otra persona', () => {
    expect(postLoginPath('employee', '/empresa/solicitudes')).toBe('/mi-trabajo');
  });

  it('si la ruta de vuelta era de la sesión de OTRA cuenta, se ignora y cada uno va a su inicio', () => {
    expect(postLoginPath('gardener', '/chats', { redirectUserId: 'antonio', userId: 'miguel' })).toBe('/dashboard');
    expect(postLoginPath('client', '/mis-reservas', { redirectUserId: 'a', userId: 'b' })).toBe('/dashboard');
  });

  it('si era de la misma cuenta (la sesión se cerró sola), vuelve a donde estaba', () => {
    expect(postLoginPath('gardener', '/chats', { redirectUserId: 'antonio', userId: 'antonio' })).toBe('/chats');
  });

  it('si la ruta es de una sesión pero no se sabe quién entró, se ignora (más seguro que mandar a ciegas)', () => {
    expect(postLoginPath('client', '/mis-reservas', { redirectUserId: 'a', userId: undefined })).toBe('/dashboard');
  });

  it('sin cuenta anterior (enlace de un correo, página protegida) vale si es de su zona', () => {
    expect(postLoginPath('client', '/reservas/abc')).toBe('/reservas/abc');
  });

  it('isPathAllowedForRole', () => {
    expect(isPathAllowedForRole('/admin/x', 'admin')).toBe(true);
    expect(isPathAllowedForRole('/admin/x', 'client')).toBe(false);
    expect(isPathAllowedForRole('/dashboard', 'admin')).toBe(false);
    expect(isPathAllowedForRole('/dashboard', 'client')).toBe(true);
  });
});
