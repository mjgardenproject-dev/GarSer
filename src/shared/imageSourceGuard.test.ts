import { describe, it, expect } from 'vitest';
import { isAllowedImageUrl } from '../../supabase/functions/_shared/imageSourceGuard.ts';

// El origen del proyecto en producción. La lista blanca se deriva de él, así que estos casos
// valen igual para local (127.0.0.1:54321) cambiando solo esta constante.
const SUPABASE_URL = 'https://abcdefgh.supabase.co';

describe('isAllowedImageUrl', () => {
  it('acepta una URL firmada de nuestro propio Storage', () => {
    expect(
      isAllowedImageUrl(
        `${SUPABASE_URL}/storage/v1/object/sign/booking-photos/drafts/u1/foto.jpg?token=abc`,
        SUPABASE_URL,
      ),
    ).toBe(true);
  });

  it('acepta también el objeto público de Storage', () => {
    expect(
      isAllowedImageUrl(`${SUPABASE_URL}/storage/v1/object/public/booking-photos/x.jpg`, SUPABASE_URL),
    ).toBe(true);
  });

  it('rechaza un host ajeno: es el SSRF que cierra esta guarda', () => {
    expect(isAllowedImageUrl('https://evil.example.com/a.jpg', SUPABASE_URL)).toBe(false);
  });

  it('rechaza direcciones internas de la infraestructura', () => {
    // El caso que de verdad importa: los metadatos de la nube, que desde fuera son
    // inalcanzables pero desde dentro del servidor devuelven credenciales.
    expect(isAllowedImageUrl('http://169.254.169.254/latest/meta-data/', SUPABASE_URL)).toBe(false);
    expect(isAllowedImageUrl('http://localhost:8000/admin', SUPABASE_URL)).toBe(false);
    expect(isAllowedImageUrl('http://10.0.0.5/', SUPABASE_URL)).toBe(false);
  });

  it('rechaza esquemas que no son http(s)', () => {
    expect(isAllowedImageUrl('file:///etc/passwd', SUPABASE_URL)).toBe(false);
    expect(isAllowedImageUrl('data:image/jpeg;base64,AAAA', SUPABASE_URL)).toBe(false);
    expect(isAllowedImageUrl('gopher://x/', SUPABASE_URL)).toBe(false);
  });

  it('rechaza otros endpoints del propio proyecto, no solo otros hosts', () => {
    // Mismo host permitido, pero fuera de Storage: sin esto la función podría hablar con la
    // API REST o con Auth desde dentro.
    expect(isAllowedImageUrl(`${SUPABASE_URL}/rest/v1/profiles?select=*`, SUPABASE_URL)).toBe(false);
    expect(isAllowedImageUrl(`${SUPABASE_URL}/auth/v1/admin/users`, SUPABASE_URL)).toBe(false);
  });

  it('rechaza un host que solo empieza igual', () => {
    // `abcdefgh.supabase.co.evil.com` contiene el host permitido como prefijo: una comparación
    // con startsWith lo habría dejado pasar.
    expect(
      isAllowedImageUrl('https://abcdefgh.supabase.co.evil.com/storage/v1/object/x.jpg', SUPABASE_URL),
    ).toBe(false);
  });

  it('rechaza credenciales embebidas que disfrazan el host real', () => {
    expect(
      isAllowedImageUrl(`https://abcdefgh.supabase.co@evil.com/storage/v1/x.jpg`, SUPABASE_URL),
    ).toBe(false);
  });

  it('rechaza el mismo host en otro puerto', () => {
    const local = 'http://127.0.0.1:54321';
    expect(isAllowedImageUrl('http://127.0.0.1:54321/storage/v1/object/x.jpg', local)).toBe(true);
    expect(isAllowedImageUrl('http://127.0.0.1:9000/storage/v1/object/x.jpg', local)).toBe(false);
  });

  it('rechaza basura y URLs relativas', () => {
    expect(isAllowedImageUrl('no-es-una-url', SUPABASE_URL)).toBe(false);
    expect(isAllowedImageUrl('/storage/v1/object/x.jpg', SUPABASE_URL)).toBe(false);
  });

  it('sin origen configurado no acepta nada (falla cerrado)', () => {
    expect(isAllowedImageUrl(`${SUPABASE_URL}/storage/v1/object/x.jpg`, undefined)).toBe(false);
  });
});
