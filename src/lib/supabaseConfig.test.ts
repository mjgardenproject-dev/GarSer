import { describe, expect, it } from 'vitest';

import { inspectSupabaseRuntimeConfig, resolveSupabaseBrowserConfig } from './supabaseConfig';

const anonJwt =
  'eyJhbGciOiJIUzI1NiJ9.eyJyZWYiOiJwcm9qZWN0cmVmIiwicm9sZSI6ImFub24ifQ.signature';
const serviceRoleJwt =
  'eyJhbGciOiJIUzI1NiJ9.eyJyZWYiOiJwcm9qZWN0cmVmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSJ9.signature';

describe('resolveSupabaseBrowserConfig', () => {
  it('prioriza la publishable key sobre la anon key legacy', () => {
    const config = resolveSupabaseBrowserConfig({
      VITE_SUPABASE_URL: 'https://projectref.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_publickey_checksum',
      VITE_SUPABASE_ANON_KEY: anonJwt,
    });

    expect(config.supabasePublicKey).toBe('sb_publishable_publickey_checksum');
    expect(config.diagnostics.keyKind).toBe('publishable');
    expect(config.diagnostics.warnings).toEqual([]);
  });

  it('detecta la presencia insegura de VITE_SUPABASE_SERVICE_ROLE_KEY', () => {
    const diagnostics = inspectSupabaseRuntimeConfig({
      supabaseUrl: 'https://projectref.supabase.co',
      supabasePublicKey: anonJwt,
      hasViteServiceRoleKey: true,
    });

    expect(diagnostics.hasServiceRoleInViteEnv).toBe(true);
    expect(diagnostics.warnings).toContain(
      'Se ha detectado `VITE_SUPABASE_SERVICE_ROLE_KEY` en el runtime del frontend. Es una configuración insegura y no debe exponerse al navegador.'
    );
  });

  it('rechaza claves JWT con rol distinto de anon en el frontend', () => {
    const diagnostics = inspectSupabaseRuntimeConfig({
      supabaseUrl: 'https://projectref.supabase.co',
      supabasePublicKey: serviceRoleJwt,
    });

    expect(diagnostics.keyKind).toBe('jwt');
    expect(diagnostics.keyRole).toBe('service_role');
    expect(diagnostics.warnings).toContain(
      'La clave configurada en el frontend no tiene rol `anon`. Revisa el build activo y las variables embebidas.'
    );
  });

  it('advierte si se embebe una secret key moderna en el frontend', () => {
    const diagnostics = inspectSupabaseRuntimeConfig({
      supabaseUrl: 'https://projectref.supabase.co',
      supabasePublicKey: 'sb_secret_supersecret_checksum',
    });

    expect(diagnostics.keyKind).toBe('secret');
    expect(diagnostics.warnings).toContain(
      'La clave pública embebida en el frontend tiene formato `sb_secret_*`. Debe usarse una `sb_publishable_*` o una `anon key` legacy.'
    );
  });
});
