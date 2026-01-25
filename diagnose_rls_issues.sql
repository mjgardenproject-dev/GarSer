-- DIAGNÓSTICO AVANZADO DE POLÍTICAS RLS
-- Ejecutar en Supabase SQL Editor para identificar problemas

-- 1. VERIFICAR ESTADO DE RLS EN TODAS LAS TABLAS
SELECT 
    schemaname,
    tablename,
    rowsecurity as rls_enabled,
    hasrls as has_rls_policies
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('profiles', 'gardener_profiles', 'role_logs', 'availability')
ORDER BY tablename;

-- 2. LISTAR TODAS LAS POLÍTICAS EXISTENTES
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE schemaname = 'public' 
AND tablename IN ('profiles', 'gardener_profiles', 'role_logs', 'availability')
ORDER BY tablename, policyname;

-- 3. VERIFICAR PERMISOS DE USUARIO AUTHENTICATED
SELECT 
    table_schema,
    table_name,
    privilege_type,
    grantee
FROM information_schema.table_privileges 
WHERE table_schema = 'public' 
AND table_name IN ('profiles', 'gardener_profiles', 'role_logs', 'availability')
AND grantee = 'authenticated'
ORDER BY table_name, privilege_type;

-- 4. VERIFICAR ESTRUCTURA DE TABLAS
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name IN ('profiles', 'gardener_profiles', 'role_logs', 'availability')
ORDER BY table_name, ordinal_position;

-- 5. PROBAR CONSULTAS COMO USUARIO AUTENTICADO
-- Simular consulta que falla con 406
DO $$
DECLARE
    test_user_id uuid := '310ba962-1cd6-42be-b85a-a8e77c8f64ae';
    result_count integer;
BEGIN
    -- Probar consulta a profiles
    BEGIN
        SELECT COUNT(*) INTO result_count 
        FROM profiles 
        WHERE user_id = test_user_id;
        RAISE NOTICE 'Profiles query successful: % records', result_count;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Profiles query failed: %', SQLERRM;
    END;
    
    -- Probar consulta a gardener_profiles
    BEGIN
        SELECT COUNT(*) INTO result_count 
        FROM gardener_profiles 
        WHERE user_id = test_user_id;
        RAISE NOTICE 'Gardener_profiles query successful: % records', result_count;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Gardener_profiles query failed: %', SQLERRM;
    END;
END $$;

-- 6. VERIFICAR FUNCIÓN auth.uid()
SELECT 
    CASE 
        WHEN auth.uid() IS NULL THEN 'auth.uid() returns NULL - Usuario no autenticado'
        ELSE 'auth.uid() returns: ' || auth.uid()::text
    END as auth_status;

-- 7. CONTAR REGISTROS EN CADA TABLA
SELECT 
    'profiles' as tabla, 
    COUNT(*) as total_registros,
    COUNT(CASE WHEN user_id = '310ba962-1cd6-42be-b85a-a8e77c8f64ae' THEN 1 END) as registros_usuario_test
FROM profiles
UNION ALL
SELECT 
    'gardener_profiles' as tabla, 
    COUNT(*) as total_registros,
    COUNT(CASE WHEN user_id = '310ba962-1cd6-42be-b85a-a8e77c8f64ae' THEN 1 END) as registros_usuario_test
FROM gardener_profiles
UNION ALL
SELECT 
    'role_logs' as tabla, 
    COUNT(*) as total_registros,
    COUNT(CASE WHEN user_id = '310ba962-1cd6-42be-b85a-a8e77c8f64ae' THEN 1 END) as registros_usuario_test
FROM role_logs
UNION ALL
SELECT 
    'availability' as tabla, 
    COUNT(*) as total_registros,
    COUNT(CASE WHEN gardener_id = '310ba962-1cd6-42be-b85a-a8e77c8f64ae' THEN 1 END) as registros_usuario_test
FROM availability;