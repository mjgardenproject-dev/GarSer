// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearPendingInvitation, invitationPath, readPendingInvitation, savePendingInvitation } from './pendingInvitation';

describe('pendingInvitation', () => {
  beforeEach(() => localStorage.clear());

  it('guarda y recupera el token', () => {
    savePendingInvitation('abc', 1000);
    expect(readPendingInvitation(2000)).toBe('abc');
  });

  it('caduca a las 24 horas y se limpia', () => {
    savePendingInvitation('abc', 0);
    expect(readPendingInvitation(24 * 60 * 60 * 1000 + 1)).toBeNull();
    expect(localStorage.getItem('garser_pending_invitation')).toBeNull();
  });

  it('ignora contenido manipulado', () => {
    localStorage.setItem('garser_pending_invitation', '{"token":42}');
    expect(readPendingInvitation()).toBeNull();
    localStorage.setItem('garser_pending_invitation', 'no-json');
    expect(readPendingInvitation()).toBeNull();
  });

  it('se borra al aceptar', () => {
    savePendingInvitation('abc');
    clearPendingInvitation();
    expect(readPendingInvitation()).toBeNull();
  });

  it('codifica el token en la ruta', () => {
    expect(invitationPath('a b')).toBe('/invitacion?token=a%20b');
  });
});
