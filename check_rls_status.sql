WITH expected_tables AS (
    SELECT UNNEST(ARRAY[
        'profiles',
        'gardener_profiles',
        'role_logs',
        'availability',
        'gardener_applications',
        'bookings',
        'chat_messages',
        'gardener_service_prices'
    ]) AS name
)
SELECT 
    e.name AS table_name,
    (t.table_name IS NOT NULL) AS exists_in_public_schema
FROM expected_tables e
LEFT JOIN information_schema.tables t
    ON t.table_schema = 'public' AND t.table_name = e.name
ORDER BY e.name;

SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name IN (
    'profiles',
    'gardener_profiles',
    'role_logs',
    'availability',
    'gardener_applications',
    'bookings',
    'chat_messages',
    'gardener_service_prices'
)
ORDER BY table_name, ordinal_position;

SELECT 
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN (
    'profiles',
    'gardener_profiles',
    'role_logs',
    'availability',
    'gardener_applications',
    'bookings',
    'chat_messages',
    'gardener_service_prices'
);

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
AND tablename IN (
    'profiles',
    'gardener_profiles',
    'role_logs',
    'availability',
    'gardener_applications',
    'bookings',
    'chat_messages',
    'gardener_service_prices'
)
ORDER BY tablename, policyname;

SELECT *
FROM supabase_migrations.schema_migrations
ORDER BY version;
