-- Verificar si existe la tabla gardener_applications
SELECT 
    EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'gardener_applications'
    ) as table_gardener_applications_exists;

-- Verificar si existen las columnas extendidas en gardener_profiles
SELECT 
    column_name, 
    data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name = 'gardener_profiles'
AND column_name IN ('professional_photo_url', 'experience_years', 'proof_photos');

-- Verificar si la migración consta como aplicada
SELECT version, name 
FROM supabase_migrations.schema_migrations 
WHERE version = '20251117_gardener_application_and_profile_extend' 
   OR name LIKE '%gardener_application%';
