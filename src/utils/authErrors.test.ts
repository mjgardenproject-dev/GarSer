import { describe, expect, it } from 'vitest';

import { classifyAuthError } from './authErrors';

describe('classifyAuthError (QA-039: nada de errores de acceso en inglés)', () => {
  it.each([
    [{ message: 'Email not confirmed' }, 'email_not_confirmed'],
    [{ message: 'Email not confirmed', code: 'email_not_confirmed' }, 'email_not_confirmed'],
    [{ message: 'algo', code: 'email_not_confirmed' }, 'email_not_confirmed'],
    [{ message: 'Verifica tu correo para continuar.' }, 'email_not_confirmed'],
  ])('«correo sin confirmar» (%j)', (error, kind) => {
    const result = classifyAuthError(error);
    expect(result.kind).toBe(kind);
    expect(result.message).toContain('confirmar tu correo');
    expect(result.message).not.toMatch(/Email not confirmed/i);
  });

  it('credenciales incorrectas', () => {
    const r = classifyAuthError({ message: 'Invalid login credentials' });
    expect(r.kind).toBe('invalid_credentials');
    expect(r.message).toContain('contraseña es incorrecta');
  });

  it('cuenta ya registrada', () => {
    expect(classifyAuthError({ message: 'User already registered' }).kind).toBe('already_registered');
  });

  it('demasiados intentos / correos (límite de Supabase)', () => {
    for (const message of ['email rate limit exceeded', 'For security purposes, you can only request this after 59 seconds.', 'Request rate limit reached']) {
      const r = classifyAuthError({ message, code: 'over_email_send_rate_limit' });
      expect(r.kind, message).toBe('rate_limited');
      expect(r.message).toContain('Espera');
      expect(r.message).not.toMatch(/rate limit|security purposes/i);
    }
  });

  it('sin red', () => {
    const r = classifyAuthError({ message: 'Failed to fetch' });
    expect(r.kind).toBe('network');
    expect(r.message).toContain('conexión');
  });

  it('contraseña débil', () => {
    expect(classifyAuthError({ message: 'Password should be at least 6 characters.', code: 'weak_password' }).kind).toBe('weak_password');
  });

  it('un mensaje ya en español se respeta y uno desconocido no se enseña en inglés crudo', () => {
    expect(classifyAuthError({ message: 'Las contraseñas no coinciden' }).message).toBe('Las contraseñas no coinciden');
    const unknown = classifyAuthError({ message: 'Some internal gotrue error' });
    expect(unknown.kind).toBe('unknown');
    expect(unknown.message).not.toMatch(/gotrue/i);
  });

  it('un error vacío no rompe', () => {
    expect(classifyAuthError(null).kind).toBe('unknown');
    expect(classifyAuthError(undefined).message.length).toBeGreaterThan(5);
  });
});
