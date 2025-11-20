import React, { useState } from 'react';
import { fixDatabaseIssues, fixDatabaseIssuesAlternative } from '../../utils/databaseFix';

// Script SQL completo para políticas RLS y storage (incluye services público y bucket booking-photos público)
const FULL_RLS_SCRIPT = `
-- ===========================================
-- HABILITAR RLS
-- ===========================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE gardener_profiles ENABLE ROW LEVEL SECURITY;
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
-- PROFILES
-- ===========================================
DROP POLICY IF EXISTS "profiles_select_own_or_counterpart" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
DROP POLICY IF EXISTS "profiles_delete_own" ON profiles;

CREATE POLICY "profiles_select_own_or_counterpart" ON profiles
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM bookings b
      WHERE (b.client_id = profiles.user_id AND b.gardener_id = auth.uid())
         OR (b.gardener_id = profiles.user_id AND b.client_id = auth.uid())
    )
  );

CREATE POLICY "profiles_insert_own" ON profiles
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "profiles_delete_own" ON profiles
  FOR DELETE USING (user_id = auth.uid());

-- ===========================================
-- GARDENER_PROFILES
-- ===========================================
DROP POLICY IF EXISTS "gardener_profiles_select_public_or_own" ON gardener_profiles;
DROP POLICY IF EXISTS "gardener_profiles_insert_own" ON gardener_profiles;
DROP POLICY IF EXISTS "gardener_profiles_update_own" ON gardener_profiles;
DROP POLICY IF EXISTS "gardener_profiles_delete_own" ON gardener_profiles;

CREATE POLICY "gardener_profiles_select_public_or_own" ON gardener_profiles
  FOR SELECT USING (
    (auth.uid() IS NOT NULL AND is_available = true)
    OR user_id = auth.uid()
  );

CREATE POLICY "gardener_profiles_insert_own" ON gardener_profiles
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "gardener_profiles_update_own" ON gardener_profiles
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "gardener_profiles_delete_own" ON gardener_profiles
  FOR DELETE USING (user_id = auth.uid());

-- ===========================================
-- SERVICES (lectura pública)
-- ===========================================
DROP POLICY IF EXISTS "services_select_authenticated" ON services;
DROP POLICY IF EXISTS "services_select_public" ON services;

CREATE POLICY "services_select_public" ON services
  FOR SELECT USING (true);

-- ===========================================
-- BOOKINGS
-- ===========================================
DROP POLICY IF EXISTS "bookings_select_participants" ON bookings;
DROP POLICY IF EXISTS "bookings_insert_client_only" ON bookings;
DROP POLICY IF EXISTS "bookings_update_participants" ON bookings;
DROP POLICY IF EXISTS "bookings_delete_participants" ON bookings;

CREATE POLICY "bookings_select_participants" ON bookings
  FOR SELECT USING (
    client_id = auth.uid() OR gardener_id = auth.uid()
  );

CREATE POLICY "bookings_insert_client_only" ON bookings
  FOR INSERT WITH CHECK (
    client_id = auth.uid()
  );

CREATE POLICY "bookings_update_participants" ON bookings
  FOR UPDATE USING (
    client_id = auth.uid() OR gardener_id = auth.uid()
  );

CREATE POLICY "bookings_delete_participants" ON bookings
  FOR DELETE USING (
    client_id = auth.uid() OR gardener_id = auth.uid()
  );

-- ===========================================
-- AVAILABILITY
-- ===========================================
DROP POLICY IF EXISTS "availability_select_public_or_owner" ON availability;
DROP POLICY IF EXISTS "availability_insert_owner" ON availability;
DROP POLICY IF EXISTS "availability_update_owner" ON availability;
DROP POLICY IF EXISTS "availability_delete_owner" ON availability;

CREATE POLICY "availability_select_public_or_owner" ON availability
  FOR SELECT USING (
    (auth.uid() IS NOT NULL AND is_available = true)
    OR gardener_id = auth.uid()
  );

CREATE POLICY "availability_insert_owner" ON availability
  FOR INSERT WITH CHECK (gardener_id = auth.uid());

CREATE POLICY "availability_update_owner" ON availability
  FOR UPDATE USING (gardener_id = auth.uid());

CREATE POLICY "availability_delete_owner" ON availability
  FOR DELETE USING (gardener_id = auth.uid());

DO $$
BEGIN
  IF to_regclass('public.availability_blocks') IS NOT NULL THEN
    EXECUTE $pol$
      DROP POLICY IF EXISTS "availability_blocks_select_public_or_owner" ON availability_blocks;
      DROP POLICY IF EXISTS "availability_blocks_insert_owner" ON availability_blocks;
      DROP POLICY IF EXISTS "availability_blocks_update_owner" ON availability_blocks;
      DROP POLICY IF EXISTS "availability_blocks_delete_owner" ON availability_blocks;

      CREATE POLICY "availability_blocks_select_public_or_owner" ON availability_blocks
        FOR SELECT USING (
          (auth.uid() IS NOT NULL AND is_available = true)
          OR gardener_id = auth.uid()
        );

      CREATE POLICY "availability_blocks_insert_owner" ON availability_blocks
        FOR INSERT WITH CHECK (gardener_id = auth.uid());

      CREATE POLICY "availability_blocks_update_owner" ON availability_blocks
        FOR UPDATE USING (gardener_id = auth.uid());

      CREATE POLICY "availability_blocks_delete_owner" ON availability_blocks
        FOR DELETE USING (gardener_id = auth.uid());
    $pol$;
  END IF;
END $$;

-- ===========================================
-- CHAT_MESSAGES
-- ===========================================
DROP POLICY IF EXISTS "chat_messages_select_booking_participants" ON chat_messages;
DROP POLICY IF EXISTS "chat_messages_insert_booking_participants" ON chat_messages;
DROP POLICY IF EXISTS "chat_messages_update_booking_participants" ON chat_messages;
DROP POLICY IF EXISTS "chat_messages_delete_booking_participants" ON chat_messages;

CREATE POLICY "chat_messages_select_booking_participants" ON chat_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM bookings b
      WHERE b.id = chat_messages.booking_id
        AND (b.client_id = auth.uid() OR b.gardener_id = auth.uid())
    )
  );

CREATE POLICY "chat_messages_insert_booking_participants" ON chat_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM bookings b
      WHERE b.id = chat_messages.booking_id
        AND (b.client_id = auth.uid() OR b.gardener_id = auth.uid())
    )
  );

CREATE POLICY "chat_messages_update_booking_participants" ON chat_messages
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM bookings b
      WHERE b.id = chat_messages.booking_id
        AND (b.client_id = auth.uid() OR b.gardener_id = auth.uid())
    )
  );

CREATE POLICY "chat_messages_delete_booking_participants" ON chat_messages
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM bookings b
      WHERE b.id = chat_messages.booking_id
        AND (b.client_id = auth.uid() OR b.gardener_id = auth.uid())
    )
  );

-- ===========================================
-- ROLE_LOGS
-- ===========================================
DROP POLICY IF EXISTS "role_logs_select_own" ON role_logs;
DROP POLICY IF EXISTS "role_logs_insert_own" ON role_logs;
DROP POLICY IF EXISTS "role_logs_update_own" ON role_logs;
DROP POLICY IF EXISTS "role_logs_delete_own" ON role_logs;

CREATE POLICY "role_logs_select_own" ON role_logs
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "role_logs_insert_own" ON role_logs
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "role_logs_update_own" ON role_logs
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "role_logs_delete_own" ON role_logs
  FOR DELETE USING (user_id = auth.uid());

-- ===========================================
-- STORAGE: BUCKET booking-photos PÚBLICO + POLÍTICAS
-- ===========================================
INSERT INTO storage.buckets (id, name, public)
SELECT 'booking-photos', 'booking-photos', true
WHERE NOT EXISTS (
  SELECT 1 FROM storage.buckets WHERE id = 'booking-photos'
);

UPDATE storage.buckets SET public = true WHERE id = 'booking-photos';

-- Lectura simplificada: cualquiera puede leer objetos del bucket público
DROP POLICY IF EXISTS "storage_objects_select_own_photos" ON storage.objects;
DROP POLICY IF EXISTS "storage_objects_select_public_bucket" ON storage.objects;

CREATE POLICY "storage_objects_select_public_bucket" ON storage.objects
  FOR SELECT USING (bucket_id = 'booking-photos');

-- Escritura/actualización/borrado restringidos al dueño por ruta
DROP POLICY IF EXISTS "storage_objects_insert_own_photos" ON storage.objects;
DROP POLICY IF EXISTS "storage_objects_update_own_photos" ON storage.objects;
DROP POLICY IF EXISTS "storage_objects_delete_own_photos" ON storage.objects;

CREATE POLICY "storage_objects_insert_own_photos" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'booking-photos'
    AND (
      name LIKE ('drafts/' || auth.uid() || '/%')
      OR name LIKE ('bookings/' || auth.uid() || '/%')
    )
  );

CREATE POLICY "storage_objects_update_own_photos" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'booking-photos'
    AND (
      name LIKE ('drafts/' || auth.uid() || '/%')
      OR name LIKE ('bookings/' || auth.uid() || '/%')
    )
  );

CREATE POLICY "storage_objects_delete_own_photos" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'booking-photos'
    AND (
      name LIKE ('drafts/' || auth.uid() || '/%')
      OR name LIKE ('bookings/' || auth.uid() || '/%')
    )
  );
-- ===========================================
-- STORAGE: BUCKET applications PÚBLICO + POLÍTICAS
-- ===========================================
INSERT INTO storage.buckets (id, name, public)
SELECT 'applications', 'applications', true
WHERE NOT EXISTS (
  SELECT 1 FROM storage.buckets WHERE id = 'applications'
);

UPDATE storage.buckets SET public = true WHERE id = 'applications';

DROP POLICY IF EXISTS "storage_objects_select_public_applications" ON storage.objects;
CREATE POLICY "storage_objects_select_public_applications" ON storage.objects
  FOR SELECT USING (bucket_id = 'applications');

DROP POLICY IF EXISTS "storage_objects_insert_applications" ON storage.objects;
DROP POLICY IF EXISTS "storage_objects_update_applications" ON storage.objects;
DROP POLICY IF EXISTS "storage_objects_delete_applications" ON storage.objects;

CREATE POLICY "storage_objects_insert_applications" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'applications'
    AND (
      name LIKE (auth.uid() || '/avatar/%')
      OR name LIKE (auth.uid() || '/proof/%')
    )
  );

CREATE POLICY "storage_objects_update_applications" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'applications'
    AND (
      name LIKE (auth.uid() || '/avatar/%')
      OR name LIKE (auth.uid() || '/proof/%')
    )
  );

CREATE POLICY "storage_objects_delete_applications" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'applications'
    AND (
      name LIKE (auth.uid() || '/avatar/%')
      OR name LIKE (auth.uid() || '/proof/%')
    )
  );
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