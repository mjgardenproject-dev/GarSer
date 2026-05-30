export type SupabaseRuntimeKeyMetadata = {
  ref: string | null;
  role: string | null;
  kind: 'jwt' | 'publishable' | 'secret' | 'unknown';
};

export type SupabaseRuntimeDiagnostics = {
  url: string;
  urlProjectRef: string | null;
  keyProjectRef: string | null;
  keyRole: string | null;
  keyKind: SupabaseRuntimeKeyMetadata['kind'];
  hasServiceRoleInViteEnv: boolean;
  warnings: string[];
};

export type ResolvedSupabaseBrowserConfig = {
  supabaseUrl: string;
  supabasePublicKey: string;
  diagnostics: SupabaseRuntimeDiagnostics;
};

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');

  if (typeof globalThis.atob === 'function') {
    return globalThis.atob(padded);
  }

  throw new Error('Base64 decoder no disponible en este runtime.');
}

export function decodeSupabaseKeyMetadata(value: string): SupabaseRuntimeKeyMetadata {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return { ref: null, role: null, kind: 'unknown' };
  }

  if (trimmed.startsWith('sb_publishable_')) {
    return { ref: null, role: 'anon', kind: 'publishable' };
  }

  if (trimmed.startsWith('sb_secret_')) {
    return { ref: null, role: null, kind: 'secret' };
  }

  const parts = trimmed.split('.');
  if (parts.length < 2) {
    return { ref: null, role: null, kind: 'unknown' };
  }

  try {
    const payload = JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>;
    return {
      ref: typeof payload.ref === 'string' ? payload.ref : null,
      role: typeof payload.role === 'string' ? payload.role : null,
      kind: 'jwt',
    };
  } catch {
    return { ref: null, role: null, kind: 'unknown' };
  }
}

export function getProjectRefFromSupabaseUrl(url: string) {
  try {
    const host = new URL(url).hostname;
    const ref = host.split('.')[0]?.trim();
    return ref || null;
  } catch {
    return null;
  }
}

export function inspectSupabaseRuntimeConfig(params: {
  supabaseUrl: string;
  supabasePublicKey: string;
  hasViteServiceRoleKey?: boolean;
}): SupabaseRuntimeDiagnostics {
  const url = String(params.supabaseUrl || '').trim();
  const key = String(params.supabasePublicKey || '').trim();
  const hasServiceRoleInViteEnv = Boolean(params.hasViteServiceRoleKey);
  const warnings: string[] = [];
  const urlProjectRef = getProjectRefFromSupabaseUrl(url);
  const keyMetadata = decodeSupabaseKeyMetadata(key);

  if (!url) {
    warnings.push('Falta `VITE_SUPABASE_URL`.');
  }

  if (!key) {
    warnings.push('Falta `VITE_SUPABASE_PUBLISHABLE_KEY` o `VITE_SUPABASE_ANON_KEY`.');
  }

  if (hasServiceRoleInViteEnv) {
    warnings.push(
      'Se ha detectado `VITE_SUPABASE_SERVICE_ROLE_KEY` en el runtime del frontend. Es una configuración insegura y no debe exponerse al navegador.'
    );
  }

  if (keyMetadata.kind === 'secret') {
    warnings.push(
      'La clave pública embebida en el frontend tiene formato `sb_secret_*`. Debe usarse una `sb_publishable_*` o una `anon key` legacy.'
    );
  }

  if (keyMetadata.kind === 'jwt' && keyMetadata.role !== 'anon') {
    warnings.push(
      'La clave configurada en el frontend no tiene rol `anon`. Revisa el build activo y las variables embebidas.'
    );
  }

  if (urlProjectRef && keyMetadata.ref && urlProjectRef !== keyMetadata.ref) {
    warnings.push(
      `La ` +
        '`VITE_SUPABASE_URL`' +
        ` apunta al proyecto \`${urlProjectRef}\`, pero la clave pública embebida pertenece a \`${keyMetadata.ref}\`. El build puede estar desalineado.`
    );
  }

  return {
    url,
    urlProjectRef,
    keyProjectRef: keyMetadata.ref,
    keyRole: keyMetadata.role,
    keyKind: keyMetadata.kind,
    hasServiceRoleInViteEnv,
    warnings,
  };
}

export function resolveSupabaseBrowserConfig(
  env: Record<string, unknown>
): ResolvedSupabaseBrowserConfig {
  const supabaseUrl = String(env.VITE_SUPABASE_URL || '').trim();
  const supabasePublicKey = String(
    env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || ''
  ).trim();
  const diagnostics = inspectSupabaseRuntimeConfig({
    supabaseUrl,
    supabasePublicKey,
    hasViteServiceRoleKey: Boolean(String(env.VITE_SUPABASE_SERVICE_ROLE_KEY || '').trim()),
  });

  if (!diagnostics.url) {
    throw new Error('Falta `VITE_SUPABASE_URL` para inicializar Supabase.');
  }

  if (!supabasePublicKey) {
    throw new Error(
      'Falta `VITE_SUPABASE_PUBLISHABLE_KEY` o `VITE_SUPABASE_ANON_KEY` para inicializar Supabase.'
    );
  }

  return {
    supabaseUrl,
    supabasePublicKey,
    diagnostics,
  };
}
