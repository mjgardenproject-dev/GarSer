import React, { useState } from 'react';
import { fixDatabaseIssues, fixDatabaseIssuesAlternative } from '../../utils/databaseFix';

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

      {/* Mostrar script de corrección RLS si hay errores 406 */}
      <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
        <h3 className="font-semibold text-red-800 mb-2">🔧 Script de Corrección RLS</h3>
        <p className="text-sm text-red-700 mb-3">
          Si ves errores 406 en la consola, ejecuta este script en Supabase SQL Editor:
        </p>
        <div className="bg-gray-900 text-green-400 p-3 rounded text-xs font-mono overflow-x-auto">
          <div className="mb-2 text-gray-400">-- Ejecutar en Supabase Dashboard → SQL Editor</div>
          <div>
            {`-- Script completo para corregir todas las políticas RLS
-- Ejecutar en Supabase SQL Editor paso a paso

-- 1. ELIMINAR TODAS LAS POLÍTICAS EXISTENTES
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "Users can delete own profile" ON profiles;

DROP POLICY IF EXISTS "Users can view own gardener profile" ON gardener_profiles;
DROP POLICY IF EXISTS "Users can update own gardener profile" ON gardener_profiles;
DROP POLICY IF EXISTS "Users can insert own gardener profile" ON gardener_profiles;
DROP POLICY IF EXISTS "Users can delete own gardener profile" ON gardener_profiles;

DROP POLICY IF EXISTS "Users can view own role logs" ON role_logs;
DROP POLICY IF EXISTS "Users can insert own role logs" ON role_logs;

-- 2. CREAR POLÍTICAS COMPLETAS PARA PROFILES
CREATE POLICY "Enable read access for own profile" ON profiles
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Enable insert access for own profile" ON profiles
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Enable update access for own profile" ON profiles
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Enable delete access for own profile" ON profiles
    FOR DELETE USING (auth.uid() = user_id);

-- 3. CREAR POLÍTICAS COMPLETAS PARA GARDENER_PROFILES
CREATE POLICY "Enable read access for own gardener profile" ON gardener_profiles
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Enable insert access for own gardener profile" ON gardener_profiles
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Enable update access for own gardener profile" ON gardener_profiles
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Enable delete access for own gardener profile" ON gardener_profiles
    FOR DELETE USING (auth.uid() = user_id);

-- 4. CREAR POLÍTICAS COMPLETAS PARA ROLE_LOGS
CREATE POLICY "Enable read access for own role logs" ON role_logs
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Enable insert access for own role logs" ON role_logs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 5. ASEGURAR QUE RLS ESTÁ HABILITADO
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE gardener_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability ENABLE ROW LEVEL SECURITY;

-- 6. VERIFICAR QUE LAS TABLAS EXISTEN
SELECT 'profiles' as tabla, count(*) as registros FROM profiles
UNION ALL
SELECT 'gardener_profiles' as tabla, count(*) as registros FROM gardener_profiles
UNION ALL
SELECT 'role_logs' as tabla, count(*) as registros FROM role_logs
UNION ALL
SELECT 'availability' as tabla, count(*) as registros FROM availability;`}
          </div>
        </div>
        <button 
          onClick={() => navigator.clipboard.writeText(`-- Script completo disponible en fix_rls_policies.sql`)}
          className="mt-2 px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
        >
          📋 Copiar Script
        </button>
      </div>
    </div>
  );
};

export default DatabaseFix;