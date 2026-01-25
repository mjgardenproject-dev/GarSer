import React, { useState } from 'react';
import { fixDatabaseIssues, fixDatabaseIssuesAlternative } from '../../utils/databaseFix';

const FULL_RLS_SCRIPT = `
-- ===========================================
-- 1. FUNCIÓN HELPER PARA EVITAR RECURSIÓN
-- ===========================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles
    WHERE user_id = auth.uid()
    AND role = 'admin'
  );
$$;

-- ===========================================
-- 2. HABILITAR RLS
-- ===========================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE gardener_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE gardener_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF to_regclass('public.availability_blocks') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE availability_blocks ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- ===========================================
-- 3. PROFILES
-- ===========================================
DROP POLICY IF EXISTS "profiles_select_own_or_counterpart" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
DROP POLICY IF EXISTS "profiles_delete_own" ON profiles;
DROP POLICY IF EXISTS "profiles_select_self" ON profiles;
DROP POLICY IF EXISTS "profiles_admin_all" ON profiles;

-- Usuario ve su propio perfil
CREATE POLICY "profiles_select_self" ON profiles
  FOR SELECT USING (user_id = auth.uid());

-- Admin ve y edita todo (usa la función para evitar recursión)
CREATE POLICY "profiles_admin_all" ON profiles
  FOR ALL USING (is_admin());

-- Usuario inserta su perfil
CREATE POLICY "profiles_insert_own" ON profiles
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Usuario actualiza su perfil
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (user_id = auth.uid());

-- ===========================================
-- 4. GARDENER_PROFILES
-- ===========================================
DROP POLICY IF EXISTS "gardener_profiles_select_public_or_own" ON gardener_profiles;
DROP POLICY IF EXISTS "gardener_profiles_insert_own" ON gardener_profiles;
DROP POLICY IF EXISTS "gardener_profiles_update_own" ON gardener_profiles;
DROP POLICY IF EXISTS "gardener_profiles_delete_own" ON gardener_profiles;
DROP POLICY IF EXISTS "gp_admin_all" ON gardener_profiles;

-- Todo el mundo puede ver perfiles (catálogo)
CREATE POLICY "gardener_profiles_select_public_or_own" ON gardener_profiles
  FOR SELECT USING (true);

-- Admin gestiona todo
CREATE POLICY "gp_admin_all" ON gardener_profiles
  FOR ALL USING (is_admin());

-- Jardinero gestiona su perfil
CREATE POLICY "gardener_profiles_insert_own" ON gardener_profiles
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "gardener_profiles_update_own" ON gardener_profiles
  FOR UPDATE USING (user_id = auth.uid());

-- ===========================================
-- 5. GARDENER_APPLICATIONS
-- ===========================================
DROP POLICY IF EXISTS "apps_admin_all" ON gardener_applications;
DROP POLICY IF EXISTS "apps_select_own" ON gardener_applications;
DROP POLICY IF EXISTS "apps_insert_own" ON gardener_applications;
DROP POLICY IF EXISTS "apps_update_own" ON gardener_applications;

-- Admin gestiona todo
CREATE POLICY "apps_admin_all" ON gardener_applications
  FOR ALL USING (is_admin());

-- Usuario ve/crea/edita su propia solicitud
CREATE POLICY "apps_select_own" ON gardener_applications
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "apps_insert_own" ON gardener_applications
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "apps_update_own" ON gardener_applications
  FOR UPDATE USING (user_id = auth.uid());

-- ===========================================
-- 6. SERVICES (lectura pública)
-- ===========================================
DROP POLICY IF EXISTS "services_select_authenticated" ON services;
DROP POLICY IF EXISTS "services_select_public" ON services;

CREATE POLICY "services_select_public" ON services
  FOR SELECT USING (true);

-- ===========================================
-- 7. BOOKINGS & OTHERS
-- ===========================================
DROP POLICY IF EXISTS "bookings_select_participants" ON bookings;
DROP POLICY IF EXISTS "bookings_insert_client_only" ON bookings;
DROP POLICY IF EXISTS "bookings_update_participants" ON bookings;
DROP POLICY IF EXISTS "bookings_delete_participants" ON bookings;

CREATE POLICY "bookings_select_participants" ON bookings
  FOR SELECT USING (client_id = auth.uid() OR gardener_id = auth.uid());

CREATE POLICY "bookings_insert_client_only" ON bookings
  FOR INSERT WITH CHECK (client_id = auth.uid());

CREATE POLICY "bookings_update_participants" ON bookings
  FOR UPDATE USING (client_id = auth.uid() OR gardener_id = auth.uid());

-- ===========================================
-- 8. COLUMNAS FALTANTES
-- ===========================================
ALTER TABLE gardener_applications ADD COLUMN IF NOT EXISTS experience_description text;
ALTER TABLE gardener_applications ADD COLUMN IF NOT EXISTS certification_photos text[] DEFAULT '{}';
ALTER TABLE gardener_applications ADD COLUMN IF NOT EXISTS other_services text;

ALTER TABLE gardener_profiles ADD COLUMN IF NOT EXISTS experience_description text;
ALTER TABLE gardener_profiles ADD COLUMN IF NOT EXISTS certification_photos text[] DEFAULT '{}';
ALTER TABLE gardener_profiles ADD COLUMN IF NOT EXISTS tools_available text[] DEFAULT '{}';
ALTER TABLE gardener_profiles ADD COLUMN IF NOT EXISTS experience_years int DEFAULT 0;
ALTER TABLE gardener_profiles ADD COLUMN IF NOT EXISTS worked_for_companies boolean DEFAULT false;
ALTER TABLE gardener_profiles ADD COLUMN IF NOT EXISTS can_prove boolean DEFAULT false;
ALTER TABLE gardener_profiles ADD COLUMN IF NOT EXISTS proof_photos text[] DEFAULT '{}';
ALTER TABLE gardener_profiles ADD COLUMN IF NOT EXISTS certification_text text;
ALTER TABLE gardener_profiles ADD COLUMN IF NOT EXISTS declaration_truth boolean DEFAULT false;
ALTER TABLE gardener_profiles ADD COLUMN IF NOT EXISTS other_services text;

-- ===========================================
-- 9. CHECK EMAIL EXISTS (Auth Helper)
-- ===========================================
CREATE OR REPLACE FUNCTION public.check_email_exists(email_to_check text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Verifica si el email existe en auth.users
  RETURN EXISTS (
    SELECT 1 FROM auth.users WHERE email = email_to_check
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_email_exists(text) TO anon, authenticated, service_role;
`;

const DatabaseFix: React.FC = () => {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleFixDatabase = async () => {
    setLoading(true);
    console.log('🚀 Iniciando corrección de base de datos...');
    try {
      const result = await fixDatabaseIssues();
      setResult(result);
    } catch (error) {
      setResult({ success: false, error });
    } finally {
      setLoading(false);
    }
  };

  const handleCheckDatabase = async () => {
    setLoading(true);
    try {
      const result = await fixDatabaseIssuesAlternative();
      setResult(result);
    } catch (error) {
      setResult({ success: false, error });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 m-4">
      <h3 className="text-lg font-semibold text-yellow-800 mb-2">
        🔧 Database Fix Tool
      </h3>
      <p className="text-yellow-700 mb-4">
        Si ves errores 404 o 406 en la consola, usa esta herramienta para corregir la base de datos.
      </p>
      
      <div className="flex gap-2 mb-4">
        <button
          onClick={handleFixDatabase}
          disabled={loading}
          className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {loading ? 'Procesando...' : 'Verificar Base de Datos'}
        </button>
        
        <button
          onClick={handleCheckDatabase}
          disabled={loading}
          className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {loading ? 'Procesando...' : 'Check Database Status'}
        </button>
      </div>

      {result && (
        <div className={`p-3 rounded ${result.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          <h4 className="font-semibold">
            {result.success ? '✅ Éxito' : '❌ Error'}
          </h4>
          <p className="mb-2">{result.message || 'Operación completada'}</p>
          
          {result.instructions && (
            <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
              <h5 className="font-semibold text-blue-800 mb-2">📋 Instrucciones para corregir manualmente:</h5>
              <ol className="list-decimal list-inside space-y-1 text-blue-700">
                {result.instructions.map((instruction: string, index: number) => (
                  <li key={index} className="text-sm">{instruction}</li>
                ))}
              </ol>
              <div className="mt-3 p-2 bg-blue-100 rounded">
                <p className="text-xs text-blue-600">
                  💡 <strong>Tip:</strong> Después de ejecutar las migraciones en Supabase, recarga esta página para verificar que todo funcione correctamente.
                </p>
              </div>
            </div>
          )}
          
          {result.error && (
            <pre className="mt-2 text-sm overflow-auto bg-gray-100 p-2 rounded">
              {JSON.stringify(result.error, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Mostrar script de corrección RLS completo (incluye services y storage) */}
      <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
        <h3 className="font-semibold text-red-800 mb-2">🔧 Script de Corrección RLS</h3>
        <p className="text-sm text-red-700 mb-3">
          Si ves errores 406/404 o necesitas exponer services y fotos, ejecuta este script en Supabase SQL Editor:
        </p>
        <div className="bg-gray-900 text-green-400 p-3 rounded text-xs font-mono overflow-x-auto">
          <div className="mb-2 text-gray-400">-- Ejecutar en Supabase Dashboard → SQL Editor</div>
          <pre>{FULL_RLS_SCRIPT}</pre>
        </div>
        <button 
          onClick={() => navigator.clipboard.writeText(FULL_RLS_SCRIPT)}
          className="mt-2 px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
        >
          📋 Copiar Script
        </button>
      </div>
    </div>
  );
};

export default DatabaseFix;