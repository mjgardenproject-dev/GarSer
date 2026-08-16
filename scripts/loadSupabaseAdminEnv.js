import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Rutas ancladas a la RAÍZ del proyecto, no al directorio desde el que se lance el script.
// Antes era `.env` a secas, que se resuelve contra el cwd: funcionaba solo si lo ejecutabas
// desde la raíz. Ahora que estos scripts viven en `scripts/`, `node scripts/x.js` desde dentro
// de la carpeta habría fallado con un "no se encontró .env" desconcertante.
//
// Y se prueba `.env.local` además de `.env`: este proyecto usa `.env.local` (la convención de
// Vite) y nunca ha tenido un `.env`, así que estos scripts fallaban siempre, dijeran lo que
// dijeran los comandos de package.json.
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANDIDATE_ENV_PATHS = [path.join(PROJECT_ROOT, '.env'), path.join(PROJECT_ROOT, '.env.local')];

function resolveEnvPath() {
  return CANDIDATE_ENV_PATHS.find((candidate) => fs.existsSync(candidate)) || CANDIDATE_ENV_PATHS[0];
}

const DEFAULT_ENV_PATH = resolveEnvPath();

function parseEnvFile(content) {
  const envVars = {};

  content.split('\n').forEach((line) => {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      return;
    }

    const key = line.substring(0, separatorIndex).trim();
    if (!key || key.startsWith('#')) {
      return;
    }

    const value = line.substring(separatorIndex + 1).trim().replace(/^["']|["']$/g, '');
    envVars[key] = value;
  });

  return envVars;
}

export function loadLocalEnv(envPath = DEFAULT_ENV_PATH) {
  if (!fs.existsSync(envPath)) {
    throw new Error(`No se encontró ${envPath} en el directorio del proyecto.`);
  }

  return parseEnvFile(fs.readFileSync(envPath, 'utf8'));
}

export function requireSupabaseAdminEnv(envPath = DEFAULT_ENV_PATH) {
  const envVars = loadLocalEnv(envPath);
  const supabaseUrl = String(envVars.SUPABASE_URL || envVars.VITE_SUPABASE_URL || '').trim();
  const supabaseServiceRoleKey = String(envVars.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const leakedViteServiceRoleKey = String(envVars.VITE_SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl) {
    throw new Error('Falta `SUPABASE_URL` o `VITE_SUPABASE_URL` en `.env`.');
  }

  if (supabaseServiceRoleKey) {
    return { envVars, supabaseUrl, supabaseServiceRoleKey };
  }

  if (leakedViteServiceRoleKey) {
    throw new Error(
      'Se detectó `VITE_SUPABASE_SERVICE_ROLE_KEY` en `.env`. Renómbrala a `SUPABASE_SERVICE_ROLE_KEY` para que el secreto no quede expuesto al frontend.'
    );
  }

  throw new Error('Falta `SUPABASE_SERVICE_ROLE_KEY` en `.env` para ejecutar tooling administrativo.');
}
