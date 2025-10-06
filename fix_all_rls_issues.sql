-- Comprehensive fix for all RLS and relationship issues (Version 2)
-- Execute this in Supabase SQL Editor

DO $$
BEGIN
    RAISE NOTICE 'Starting comprehensive RLS cleanup and fix...';
END $$;

-- 1. AGGRESSIVELY DROP ALL EXISTING POLICIES
-- Drop all policies from profiles table
DO $$
DECLARE
    policy_record RECORD;
BEGIN
    FOR policy_record IN 
        SELECT policyname FROM pg_policies WHERE tablename = 'profiles' AND schemaname = 'public'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || policy_record.policyname || '" ON profiles';
        RAISE NOTICE 'Dropped policy: %', policy_record.policyname;
    END LOOP;
END $$;

-- Drop all policies from gardener_profiles table
DO $$
DECLARE
    policy_record RECORD;
BEGIN
    FOR policy_record IN 
        SELECT policyname FROM pg_policies WHERE tablename = 'gardener_profiles' AND schemaname = 'public'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || policy_record.policyname || '" ON gardener_profiles';
        RAISE NOTICE 'Dropped policy: %', policy_record.policyname;
    END LOOP;
END $$;

-- Drop all policies from bookings table
DO $$
DECLARE
    policy_record RECORD;
BEGIN
    FOR policy_record IN 
        SELECT policyname FROM pg_policies WHERE tablename = 'bookings' AND schemaname = 'public'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || policy_record.policyname || '" ON bookings';
        RAISE NOTICE 'Dropped policy: %', policy_record.policyname;
    END LOOP;
END $$;

-- Drop all policies from services table
DO $$
DECLARE
    policy_record RECORD;
BEGIN
    FOR policy_record IN 
        SELECT policyname FROM pg_policies WHERE tablename = 'services' AND schemaname = 'public'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || policy_record.policyname || '" ON services';
        RAISE NOTICE 'Dropped policy: %', policy_record.policyname;
    END LOOP;
END $$;

-- Drop all policies from availability table
DO $$
DECLARE
    policy_record RECORD;
BEGIN
    FOR policy_record IN 
        SELECT policyname FROM pg_policies WHERE tablename = 'availability' AND schemaname = 'public'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || policy_record.policyname || '" ON availability';
        RAISE NOTICE 'Dropped policy: %', policy_record.policyname;
    END LOOP;
END $$;

-- Drop all policies from role_logs table
DO $$
DECLARE
    policy_record RECORD;
BEGIN
    FOR policy_record IN 
        SELECT policyname FROM pg_policies WHERE tablename = 'role_logs' AND schemaname = 'public'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || policy_record.policyname || '" ON role_logs';
        RAISE NOTICE 'Dropped policy: %', policy_record.policyname;
    END LOOP;
END $$;

-- 2. Ensure RLS is enabled on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE gardener_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_logs ENABLE ROW LEVEL SECURITY;

-- 3. Create NEW policies for profiles table
CREATE POLICY "new_profiles_select" ON profiles
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "new_profiles_insert" ON profiles
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "new_profiles_update" ON profiles
    FOR UPDATE USING (auth.uid() = user_id);

-- 4. Create NEW policies for gardener_profiles table
CREATE POLICY "new_gardener_select" ON gardener_profiles
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "new_gardener_insert" ON gardener_profiles
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "new_gardener_update" ON gardener_profiles
    FOR UPDATE USING (auth.uid() = user_id);

-- 5. Create NEW policies for bookings table
CREATE POLICY "new_bookings_select" ON bookings
    FOR SELECT USING (
        auth.uid() = client_id OR 
        auth.uid() IN (
            SELECT user_id FROM gardener_profiles 
            WHERE gardener_profiles.user_id = auth.uid()
        )
    );

CREATE POLICY "new_bookings_insert" ON bookings
    FOR INSERT WITH CHECK (auth.uid() = client_id);

CREATE POLICY "new_bookings_update" ON bookings
    FOR UPDATE USING (
        auth.uid() = client_id OR 
        auth.uid() IN (
            SELECT user_id FROM gardener_profiles 
            WHERE gardener_profiles.user_id = auth.uid()
        )
    );

-- 6. Create NEW policies for services table
CREATE POLICY "new_services_select" ON services
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "new_services_manage" ON services
    FOR ALL USING (
        auth.uid() IN (
            SELECT user_id FROM gardener_profiles 
            WHERE gardener_profiles.user_id = auth.uid()
        )
    );

-- 7. Create NEW policies for availability table
CREATE POLICY "new_availability_select" ON availability
    FOR SELECT USING (
        auth.uid() IN (
            SELECT user_id FROM gardener_profiles 
            WHERE gardener_profiles.user_id = auth.uid()
        )
    );

CREATE POLICY "new_availability_manage" ON availability
    FOR ALL USING (
        auth.uid() IN (
            SELECT user_id FROM gardener_profiles 
            WHERE gardener_profiles.user_id = auth.uid()
        )
    );

-- 8. Create NEW policies for role_logs table
CREATE POLICY "new_role_logs_select" ON role_logs
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "new_role_logs_insert" ON role_logs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 9. Fix foreign key relationships
DO $$
BEGIN
    -- Add foreign key for bookings -> auth.users if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'bookings_client_id_fkey' 
        AND table_name = 'bookings'
    ) THEN
        ALTER TABLE bookings 
        ADD CONSTRAINT bookings_client_id_fkey 
        FOREIGN KEY (client_id) REFERENCES auth.users(id) ON DELETE CASCADE;
        RAISE NOTICE 'Added foreign key: bookings_client_id_fkey';
    END IF;
    
    -- Add foreign key for gardener_profiles -> auth.users if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'gardener_profiles_user_id_fkey' 
        AND table_name = 'gardener_profiles'
    ) THEN
        ALTER TABLE gardener_profiles 
        ADD CONSTRAINT gardener_profiles_user_id_fkey 
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
        RAISE NOTICE 'Added foreign key: gardener_profiles_user_id_fkey';
    END IF;
    
    -- Add foreign key for profiles -> auth.users if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'profiles_user_id_fkey' 
        AND table_name = 'profiles'
    ) THEN
        ALTER TABLE profiles 
        ADD CONSTRAINT profiles_user_id_fkey 
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
        RAISE NOTICE 'Added foreign key: profiles_user_id_fkey';
    END IF;
END $$;

-- 10. Grant necessary permissions
GRANT ALL ON profiles TO authenticated;
GRANT ALL ON gardener_profiles TO authenticated;
GRANT ALL ON bookings TO authenticated;
GRANT ALL ON services TO authenticated;
GRANT ALL ON availability TO authenticated;
GRANT ALL ON role_logs TO authenticated;

-- 11. Refresh the schema cache
NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
    RAISE NOTICE 'Comprehensive RLS cleanup and fix completed successfully!';
    RAISE NOTICE 'All old policies have been removed and new policies created.';
END $$;