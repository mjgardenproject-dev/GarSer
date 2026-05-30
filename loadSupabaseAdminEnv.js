import fs from 'fs';

const DEFAULT_ENV_PATH = '.env';

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
