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
