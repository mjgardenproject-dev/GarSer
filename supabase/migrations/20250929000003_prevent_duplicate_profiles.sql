-- Migration to prevent duplicate profiles
-- This migration adds unique constraints to prevent multiple profiles for the same user

-- 1. Add unique constraint to profiles table to prevent duplicate user_id
-- First, let's check if there are any existing duplicates and clean them up
DO $$
DECLARE
    duplicate_count INTEGER;
BEGIN
    -- Count duplicates in profiles table
    SELECT COUNT(*) INTO duplicate_count
    FROM (
        SELECT user_id, COUNT(*) as count
        FROM profiles
        GROUP BY user_id
        HAVING COUNT(*) > 1
    ) duplicates;
    
    IF duplicate_count > 0 THEN
        RAISE NOTICE 'Found % duplicate user_ids in profiles table', duplicate_count;
        
        -- Keep only the most recent profile for each user_id
        DELETE FROM profiles
        WHERE id NOT IN (
            SELECT DISTINCT ON (user_id) id
            FROM profiles
            ORDER BY user_id, created_at DESC
        );
        
        RAISE NOTICE 'Cleaned up duplicate profiles';
    END IF;
END $$;

-- 2. Add unique constraint to profiles table
ALTER TABLE profiles 
ADD CONSTRAINT profiles_user_id_unique 
UNIQUE (user_id);

-- 3. Do the same for gardener_profiles table
DO $$
DECLARE
    duplicate_count INTEGER;
BEGIN
    -- Count duplicates in gardener_profiles table
    SELECT COUNT(*) INTO duplicate_count
    FROM (
        SELECT user_id, COUNT(*) as count
        FROM gardener_profiles
        GROUP BY user_id
        HAVING COUNT(*) > 1
    ) duplicates;
    
    IF duplicate_count > 0 THEN
        RAISE NOTICE 'Found % duplicate user_ids in gardener_profiles table', duplicate_count;
        
        -- Keep only the most recent gardener profile for each user_id
        DELETE FROM gardener_profiles
        WHERE id NOT IN (
            SELECT DISTINCT ON (user_id) id
            FROM gardener_profiles
            ORDER BY user_id, created_at DESC
        );
        
        RAISE NOTICE 'Cleaned up duplicate gardener profiles';
    END IF;
END $$;

-- 4. Add unique constraint to gardener_profiles table
ALTER TABLE gardener_profiles 
ADD CONSTRAINT gardener_profiles_user_id_unique 
UNIQUE (user_id);

-- 5. Create a function to prevent duplicate profile creation
CREATE OR REPLACE FUNCTION prevent_duplicate_profiles()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if a profile already exists for this user_id
    IF EXISTS (SELECT 1 FROM profiles WHERE user_id = NEW.user_id) THEN
        RAISE EXCEPTION 'Profile already exists for user_id: %', NEW.user_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Create trigger to prevent duplicate profiles
DROP TRIGGER IF EXISTS prevent_duplicate_profiles_trigger ON profiles;
CREATE TRIGGER prevent_duplicate_profiles_trigger
    BEFORE INSERT ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION prevent_duplicate_profiles();

-- 7. Create a function to prevent duplicate gardener profiles
CREATE OR REPLACE FUNCTION prevent_duplicate_gardener_profiles()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if a gardener profile already exists for this user_id
    IF EXISTS (SELECT 1 FROM gardener_profiles WHERE user_id = NEW.user_id) THEN
        RAISE EXCEPTION 'Gardener profile already exists for user_id: %', NEW.user_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 8. Create trigger to prevent duplicate gardener profiles
DROP TRIGGER IF EXISTS prevent_duplicate_gardener_profiles_trigger ON gardener_profiles;
CREATE TRIGGER prevent_duplicate_gardener_profiles_trigger
    BEFORE INSERT ON gardener_profiles
    FOR EACH ROW
    EXECUTE FUNCTION prevent_duplicate_gardener_profiles();

-- 9. Add comments for documentation
COMMENT ON CONSTRAINT profiles_user_id_unique ON profiles IS 'Ensures each user can have only one profile';
COMMENT ON CONSTRAINT gardener_profiles_user_id_unique ON gardener_profiles IS 'Ensures each user can have only one gardener profile';
COMMENT ON FUNCTION prevent_duplicate_profiles() IS 'Prevents creation of duplicate profiles for the same user';
COMMENT ON FUNCTION prevent_duplicate_gardener_profiles() IS 'Prevents creation of duplicate gardener profiles for the same user';