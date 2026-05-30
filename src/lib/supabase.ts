import { createClient } from '@supabase/supabase-js';
import {
  resolveSupabaseBrowserConfig,
  type SupabaseRuntimeDiagnostics,
} from './supabaseConfig';

const globalForSupabase = globalThis as typeof globalThis & {
  __supabaseClient?: ReturnType<typeof createClient>;
  __supabaseRuntimeDiagnosticsLogged?: boolean;
};

export type { SupabaseRuntimeDiagnostics } from './supabaseConfig';

function logSupabaseRuntimeDiagnostics(diagnostics: SupabaseRuntimeDiagnostics) {
  if (!import.meta.env.DEV || globalForSupabase.__supabaseRuntimeDiagnosticsLogged) {
    return;
  }

  globalForSupabase.__supabaseRuntimeDiagnosticsLogged = true;

  if (diagnostics.warnings.length > 0) {
    diagnostics.warnings.forEach((warning) => {
      console.warn(`[supabase-runtime] ${warning}`);
    });
  } else {
    console.info(
      `[supabase-runtime] Cliente inicializado para projectRef=${diagnostics.urlProjectRef || 'desconocido'} con keyRole=${diagnostics.keyRole || 'desconocido'}.`
    );
  }
}

const runtimeConfig = resolveSupabaseBrowserConfig(import.meta.env);
const { supabaseUrl: SUPABASE_URL, supabasePublicKey: SUPABASE_PUBLIC_KEY, diagnostics: runtimeDiagnostics } =
  runtimeConfig;
logSupabaseRuntimeDiagnostics(runtimeDiagnostics);

function resolveSupabaseStorage() {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }

  if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
    return globalThis.localStorage;
  }

  return undefined;
}

export const supabase =
  globalForSupabase.__supabaseClient ||
  createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: resolveSupabaseStorage(),
    },
  });

if (!globalForSupabase.__supabaseClient) {
  globalForSupabase.__supabaseClient = supabase;
}
