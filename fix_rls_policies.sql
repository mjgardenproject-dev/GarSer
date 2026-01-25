-- Script completo para corregir políticas RLS
-- Ejecuta este script en el SQL Editor de Supabase

-- 1. ELIMINAR TODAS LAS POLÍTICAS EXISTENTES (ESPAÑOL E INGLÉS)
DROP POLICY IF EXISTS "Habilitar acceso de lectura para perfil propio" ON profiles;
DROP POLICY IF EXISTS "Habilitar acceso de inserción para perfil propio" ON profiles;
DROP POLICY IF EXISTS "Habilitar acceso de actualización para perfil propio" ON profiles;
DROP POLICY IF EXISTS "Habilitar acceso de eliminación para perfil propio" ON profiles;
DROP POLICY IF EXISTS "Enable read access for own profile" ON profiles;
DROP POLICY IF EXISTS "Enable insert access for own profile" ON profiles;
DROP POLICY IF EXISTS "Enable update access for own profile" ON profiles;
DROP POLICY IF EXISTS "Enable delete access for own profile" ON profiles;
DROP POLICY IF EXISTS "profiles_select_policy" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_policy" ON profiles;
DROP POLICY IF EXISTS "profiles_update_policy" ON profiles;
DROP POLICY IF EXISTS "profiles_delete_policy" ON profiles;

DROP POLICY IF EXISTS "Habilitar acceso de lectura para perfil de jardinero propio" ON gardener_profiles;
DROP POLICY IF EXISTS "Habilitar acceso de inserción para perfil de jardinero propio" ON gardener_profiles;
DROP POLICY IF EXISTS "Habilitar acceso de actualización para perfil de jardinero propio" ON gardener_profiles;
DROP POLICY IF EXISTS "Habilitar acceso de eliminación para perfil de jardinero propio" ON gardener_profiles;
DROP POLICY IF EXISTS "Enable read access for own gardener profile" ON gardener_profiles;
DROP POLICY IF EXISTS "Enable insert access for own gardener profile" ON gardener_profiles;
DROP POLICY IF EXISTS "Enable update access for own gardener profile" ON gardener_profiles;
DROP POLICY IF EXISTS "Enable delete access for own gardener profile" ON gardener_profiles;
DROP POLICY IF EXISTS "gardener_profiles_select_policy" ON gardener_profiles;
DROP POLICY IF EXISTS "gardener_profiles_insert_policy" ON gardener_profiles;
DROP POLICY IF EXISTS "gardener_profiles_update_policy" ON gardener_profiles;
DROP POLICY IF EXISTS "gardener_profiles_delete_policy" ON gardener_profiles;

DROP POLICY IF EXISTS "Habilitar acceso de lectura para logs de rol propios" ON role_logs;
DROP POLICY IF EXISTS "Habilitar acceso de inserción para logs de rol propios" ON role_logs;
DROP POLICY IF EXISTS "Habilitar acceso de actualización para logs de rol propios" ON role_logs;
DROP POLICY IF EXISTS "Habilitar acceso de eliminación para logs de rol propios" ON role_logs;
DROP POLICY IF EXISTS "Enable read access for own role logs" ON role_logs;
DROP POLICY IF EXISTS "Enable insert access for own role logs" ON role_logs;
DROP POLICY IF EXISTS "Enable update access for own role logs" ON role_logs;
DROP POLICY IF EXISTS "Enable delete access for own role logs" ON role_logs;
DROP POLICY IF EXISTS "role_logs_select_policy" ON role_logs;
DROP POLICY IF EXISTS "role_logs_insert_policy" ON role_logs;
DROP POLICY IF EXISTS "role_logs_update_policy" ON role_logs;
DROP POLICY IF EXISTS "role_logs_delete_policy" ON role_logs;

DROP POLICY IF EXISTS "Habilitar acceso de lectura para disponibilidad propia" ON availability;
DROP POLICY IF EXISTS "Habilitar acceso de inserción para disponibilidad propia" ON availability;
DROP POLICY IF EXISTS "Habilitar acceso de actualización para disponibilidad propia" ON availability;
DROP POLICY IF EXISTS "Habilitar acceso de eliminación para disponibilidad propia" ON availability;
DROP POLICY IF EXISTS "Enable read access for own availability" ON availability;
DROP POLICY IF EXISTS "Enable insert access for own availability" ON availability;
DROP POLICY IF EXISTS "Enable update access for own availability" ON availability;
DROP POLICY IF EXISTS "Enable delete access for own availability" ON availability;
DROP POLICY IF EXISTS "availability_select_policy" ON availability;
DROP POLICY IF EXISTS "availability_insert_policy" ON availability;
DROP POLICY IF EXISTS "availability_update_policy" ON availability;
DROP POLICY IF EXISTS "availability_delete_policy" ON availability;

-- 2. CREAR NUEVAS POLÍTICAS PARA PROFILES
CREATE POLICY "profiles_select_policy" ON profiles
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "profiles_insert_policy" ON profiles
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "profiles_update_policy" ON profiles
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "profiles_delete_policy" ON profiles
    FOR DELETE USING (auth.uid() = user_id);

-- 3. CREAR NUEVAS POLÍTICAS PARA GARDENER_PROFILES
CREATE POLICY "gardener_profiles_select_policy" ON gardener_profiles
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "gardener_profiles_insert_policy" ON gardener_profiles
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "gardener_profiles_update_policy" ON gardener_profiles
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "gardener_profiles_delete_policy" ON gardener_profiles
    FOR DELETE USING (auth.uid() = user_id);

-- 4. CREAR NUEVAS POLÍTICAS PARA ROLE_LOGS
CREATE POLICY "role_logs_select_policy" ON role_logs
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "role_logs_insert_policy" ON role_logs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "role_logs_update_policy" ON role_logs
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "role_logs_delete_policy" ON role_logs
    FOR DELETE USING (auth.uid() = user_id);

-- 5. CREAR NUEVAS POLÍTICAS PARA AVAILABILITY
CREATE POLICY "availability_select_policy" ON availability
    FOR SELECT USING (auth.uid() = gardener_id);

CREATE POLICY "availability_insert_policy" ON availability
    FOR INSERT WITH CHECK (auth.uid() = gardener_id);

CREATE POLICY "availability_update_policy" ON availability
    FOR UPDATE USING (auth.uid() = gardener_id);

CREATE POLICY "availability_delete_policy" ON availability
    FOR DELETE USING (auth.uid() = gardener_id);

-- 6. ASEGURAR QUE RLS ESTÁ HABILITADO
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE gardener_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability ENABLE ROW LEVEL SECURITY;

-- 7. VERIFICAR QUE LAS TABLAS EXISTEN Y TIENEN DATOS
SELECT 
    'profiles' as table_name, 
    count(*) as record_count 
FROM profiles
UNION ALL
SELECT 
    'gardener_profiles' as table_name, 
    count(*) as record_count 
FROM gardener_profiles
UNION ALL
SELECT 
    'role_logs' as table_name, 
    count(*) as record_count 
FROM role_logs
UNION ALL
SELECT 
    'availability' as table_name, 
    count(*) as record_count 
FROM availability;