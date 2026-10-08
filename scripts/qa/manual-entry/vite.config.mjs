/**
 * Servidor del banco de pruebas de la entrada manual. No forma parte de la aplicación: su raíz
 * es esta carpeta y el `vite build` del proyecto no la incluye.
 *
 * El builder de la entrada manual importa (vía telemetría) el cliente de Supabase, que exige
 * `VITE_SUPABASE_URL` al cargarse. El banco no hace ninguna llamada de red, así que si el
 * entorno no trae esas variables se ponen unas ficticias.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import tailwindConfig from '../../../tailwind.config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');

process.env.VITE_SUPABASE_URL ||= 'https://qaharnessqaharnes.supabase.co';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||= 'sb_publishable_qa_harness';

export default defineConfig({
  root: HERE,
  envDir: HERE,
  // Caché propia: con la de por defecto (`node_modules/.vite` del repo) el banco y el servidor de
  // la rama (5191) se invalidaban la caché el uno al otro → 504 «Outdated Optimize Dep» (H-N-18).
  cacheDir: path.join(REPO, 'node_modules/.vite-qa-bench'),
  plugins: [react()],
  css: {
    postcss: {
      plugins: [
        tailwindcss({
          ...tailwindConfig,
          content: [path.join(REPO, 'src/**/*.{ts,tsx}'), path.join(HERE, '*.tsx')],
        }),
        autoprefixer(),
      ],
    },
  },
  server: { host: '127.0.0.1', strictPort: true, fs: { allow: [REPO] } },
  logLevel: 'warn',
});
