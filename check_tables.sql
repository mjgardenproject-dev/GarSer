-- Check which availability tables exist in the database
SELECT table_name, table_schema 
FROM information_schema.tables 
WHERE table_name LIKE '%availability%' 
AND table_schema = 'public';

-- Check columns for availability table if it exists
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'availability' 
AND table_schema = 'public'
ORDER BY ordinal_position;

-- Check columns for availability_blocks table if it exists
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'availability_blocks' 
AND table_schema = 'public'
ORDER BY ordinal_position;