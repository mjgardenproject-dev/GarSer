import { describe, expect, it } from 'vitest';
import { anchorIdFromHash } from './anchorIdFromHash';

describe('anchorIdFromHash', () => {
  it('saca el id del ancla', () => {
    expect(anchorIdFromHash('#empresas')).toBe('empresas');
  });

  it('tolera los UTM que Meta deja detrás de la almohadilla', () => {
    expect(anchorIdFromHash('#empresas?utm_source=meta&utm_medium=paid_social')).toBe('empresas');
    expect(anchorIdFromHash('#empresas&utm_source=meta')).toBe('empresas');
  });

  it('sin hash, o con un paquete de parámetros que no es un ancla, es null', () => {
    expect(anchorIdFromHash('')).toBeNull();
    expect(anchorIdFromHash('#')).toBeNull();
    expect(anchorIdFromHash('#access_token=abc&token_type=bearer')).toBeNull();
  });
});
