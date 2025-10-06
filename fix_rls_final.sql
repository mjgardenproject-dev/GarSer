-- SOLUCIÓN DEFINITIVA PARA ERRORES 406 RLS
-- Ejecutar en Supabase SQL Editor

-- 1. DESHABILITAR RLS TEMPORALMENTE
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE gardener_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE availability DISABLE ROW LEVEL SECURITY;

-- 2. ELIMINAR TODAS LAS POLÍTICAS EXISTENTES (CUALQUIER NOMBRE)
DO $$
DECLARE
    policy_record RECORD;
BEGIN
    -- Eliminar políticas de profiles
    FOR policy_record IN 
        SELECT policyname FROM pg_policies WHERE tablename = 'profiles' AND schemaname = 'public'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(policy_record.policyname) || ' ON profiles';
    END LOOP;
    
    -- Eliminar políticas de gardener_profiles
    FOR policy_record IN 
        SELECT policyname FROM pg_policies WHERE tablename = 'gardener_profiles' AND schemaname = 'public'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(policy_record.policyname) || ' ON gardener_profiles';
    END LOOP;
    
    -- Eliminar políticas de role_logs
    FOR policy_record IN 
        SELECT policyname FROM pg_policies WHERE tablename = 'role_logs' AND schemaname = 'public'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(policy_record.policyname) || ' ON role_logs';
    END LOOP;
    
    -- Eliminar políticas de availability
    FOR policy_record IN 
        SELECT policyname FROM pg_policies WHERE tablename = 'availability' AND schemaname = 'public'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(policy_record.policyname) || ' ON availability';
    END LOOP;
END $$;

-- 3. CREAR POLÍTICAS SIMPLES Y ROBUSTAS

-- PROFILES: Solo el usuario puede ver y modificar su propio perfil
CREATE POLICY "profiles_select_own" ON profiles
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "profiles_insert_own" ON profiles
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "profiles_update_own" ON profiles
    FOR UPDATE TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "profiles_delete_own" ON profiles
    FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

-- GARDENER_PROFILES: Solo el jardinero puede ver y modificar su perfil
CREATE POLICY "gardener_profiles_select_own" ON gardener_profiles
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "gardener_profiles_insert_own" ON gardener_profiles
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "gardener_profiles_update_own" ON gardener_profiles
    FOR UPDATE TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "gardener_profiles_delete_own" ON gardener_profiles
    FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

-- ROLE_LOGS: Solo el usuario puede ver sus propios logs
CREATE POLICY "role_logs_select_own" ON role_logs
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "role_logs_insert_own" ON role_logs
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "role_logs_update_own" ON role_logs
    FOR UPDATE TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "role_logs_delete_own" ON role_logs
    FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

-- AVAILABILITY: Solo el jardinero puede ver y modificar su disponibilidad
CREATE POLICY "availability_select_own" ON availability
    FOR SELECT TO authenticated
    USING (auth.uid() = gardener_id);

CREATE POLICY "availability_insert_own" ON availability
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = gardener_id);

CREATE POLICY "availability_update_own" ON availability
    FOR UPDATE TO authenticated
    USING (auth.uid() = gardener_id)
    WITH CHECK (auth.uid() = gardener_id);

CREATE POLICY "availability_delete_own" ON availability
    FOR DELETE TO authenticated
    USING (auth.uid() = gardener_id);

-- 4. HABILITAR RLS EN TODAS LAS TABLAS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE gardener_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability ENABLE ROW LEVEL SECURITY;

-- 5. VERIFICAR QUE TODO ESTÁ CORRECTO
SELECT 
    'Verificación de políticas RLS' as status,
    json_build_object(
        'profiles_policies', (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'profiles'),
        'gardener_profiles_policies', (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'gardener_profiles'),
        'role_logs_policies', (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'role_logs'),
        'availability_policies', (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'availability'),
        'profiles_rls', (SELECT rowsecurity FROM pg_tables WHERE tablename = 'profiles'),
        'gardener_profiles_rls', (SELECT rowsecurity FROM pg_tables WHERE tablename = 'gardener_profiles'),
        'role_logs_rls', (SELECT rowsecurity FROM pg_tables WHERE tablename = 'role_logs'),
        'availability_rls', (SELECT rowsecurity FROM pg_tables WHERE tablename = 'availability')
    ) as details;

-- 6. CONTAR REGISTROS PARA VERIFICAR ACCESO
SELECT 
    json_build_object(
        'profiles', (SELECT COUNT(*) FROM profiles),
        'gardener_profiles', (SELECT COUNT(*) FROM gardener_profiles),
        'role_logs', (SELECT COUNT(*) FROM role_logs),
        'availability', (SELECT COUNT(*) FROM availability)
    ) as record_counts;