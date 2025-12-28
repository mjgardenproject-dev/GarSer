import { createClient } from '@supabase/supabase-js';

// Configuración exacta solicitada + patrón singleton para evitar recreación en HMR/F5
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL!;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY!;
const globalForSupabase = globalThis as any;

export const supabase =
  globalForSupabase.__supabaseClient ||
  createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: localStorage,
    },
  });

if (!globalForSupabase.__supabaseClient) {
  globalForSupabase.__supabaseClient = supabase;
}

// Logger de peticiones Supabase y exposición del cliente
if (typeof window !== 'undefined') {
  // Exponer cliente para pruebas en consola
  (window as any).supabaseClient = supabase;
  // Exponer configuración para pruebas manuales
  (window as any).__SUPABASE_URL = SUPABASE_URL;
  try {
    const host = new URL(SUPABASE_URL).host;
    console.log('🔧 Supabase listo', { host, anonKeyPresent: !!SUPABASE_ANON_KEY });
  } catch {}

  // Parchear fetch para loguear SOLO llamadas a /rest/v1 del host de Supabase
  const SUPABASE_HOST = (() => {
    try { return new URL(SUPABASE_URL).host; } catch { return ''; }
  })();

  if (!globalForSupabase.__supabaseFetchPatched && SUPABASE_HOST) {
    const originalFetch = window.fetch.bind(window) as typeof window.fetch;
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      // Interceptar SOLO llamadas a Supabase REST o Edge Functions
      const isSupabase =
        typeof url === 'string' &&
        url.includes(SUPABASE_HOST) && (
          url.includes('/rest/v1') || url.includes('/functions/v1')
        );
      if (!isSupabase) {
        return originalFetch(input, init);
      }
      const start = Date.now();
      try {
        const res = await originalFetch(input, init);
        console.log('🛰️ Supabase HTTP', {
          method: (init?.method || 'GET'),
          url,
          status: res.status,
        });
        if (res.status >= 400) {
          const bodyText = await res.clone().text();
          console.error('❌ Supabase HTTP error', { status: res.status, body: bodyText });
        }
        console.log('⏱️ Supabase HTTP duration(ms)', Date.now() - start);
        return res;
      } catch (err) {
        console.error('🌩️ Supabase fetch failed', err);
        throw err;
      }
    }) as typeof window.fetch;
    globalForSupabase.__supabaseFetchPatched = true;
  }
}
