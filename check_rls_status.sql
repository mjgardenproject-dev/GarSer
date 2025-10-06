-- Script para verificar el estado actual de las políticas RLS
-- Ejecuta este script en el SQL Editor de Supabase

-- 1. VERIFICAR POLÍTICAS EXISTENTES
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

-- 2. VERIFICAR ESTADO DE RLS
SELECT 
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('profiles', 'gardener_profiles', 'role_logs', 'availability');

-- 3. VERIFICAR ESTRUCTURA DE TABLAS
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name IN ('profiles', 'gardener_profiles', 'role_logs', 'availability')
ORDER BY table_name, ordinal_position;

-- 4. VERIFICAR DATOS DE EJEMPLO
SELECT 'profiles' as table_name, count(*) as record_count FROM profiles
UNION ALL
SELECT 'gardener_profiles' as table_name, count(*) as record_count FROM gardener_profiles
UNION ALL
SELECT 'role_logs' as table_name, count(*) as record_count FROM role_logs
UNION ALL
SELECT 'availability' as table_name, count(*) as record_count FROM availability;