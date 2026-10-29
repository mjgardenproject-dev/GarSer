import { describe, expect, it } from 'vitest';
import { readCallbackParams } from './authCallback';

describe('readCallbackParams', () => {
  it('lee next y role cuando los dos están presentes', () => {
    const params = readCallbackParams('https://garser.es/auth/callback?next=%2Fempresa&role=company');
    expect(params).toMatchObject({ next: '/empresa', role: 'company', error: null, errorDescription: null });
  });

  it('sin role en la URL, role es null (vuelta de un cliente o del popup)', () => {
    const params = readCallbackParams('https://garser.es/auth/callback?next=%2Freserva%2Fconfirmacion');
    expect(params.role).toBeNull();
  });

  it('ignora un role que no sea gardener ni company', () => {
    const params = readCallbackParams('https://garser.es/auth/callback?role=admin');
    expect(params.role).toBeNull();
  });

  it('acepta gardener', () => {
    const params = readCallbackParams('https://garser.es/auth/callback?role=gardener');
    expect(params.role).toBe('gardener');
  });

  it('recoge el error de Google desde la query o el hash', () => {
    expect(readCallbackParams('https://garser.es/auth/callback?error=access_denied').error).toBe('access_denied');
    expect(readCallbackParams('https://garser.es/auth/callback#error=access_denied').error).toBe('access_denied');
  });
});
