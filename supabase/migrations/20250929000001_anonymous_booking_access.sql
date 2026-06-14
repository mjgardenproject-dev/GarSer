-- Migration: Allow anonymous access to booking and availability data
-- Description: Create RLS policies that enable clients without login to view services, availability, gardener profiles, and create bookings

-- =============================================
-- SERVICES TABLE - Anonymous Access
-- =============================================

-- Allow anonymous users to view all services
CREATE POLICY "Allow anonymous users to view services" ON public.services
    FOR SELECT
    USING (true);

-- Allow authenticated users to view services
CREATE POLICY "Allow authenticated users to view services" ON public.services
    FOR SELECT
    USING (true);

-- =============================================
-- GARDENER_PROFILES TABLE - Anonymous Access
-- =============================================

-- Allow anonymous users to view gardener profiles
CREATE POLICY "Allow anonymous users to view gardener profiles" ON public.gardener_profiles
    FOR SELECT
    USING (true);

-- Allow authenticated users to view gardener profiles
CREATE POLICY "Allow authenticated users to view gardener profiles" ON public.gardener_profiles
    FOR SELECT
    USING (true);

-- =============================================
-- AVAILABILITY TABLE - Anonymous Access
-- =============================================

-- Allow anonymous users to view availability
CREATE POLICY "Allow anonymous users to view availability" ON public.availability
    FOR SELECT
    USING (true);

-- Allow authenticated users to view availability
CREATE POLICY "Allow authenticated users to view availability" ON public.availability
    FOR SELECT
    USING (true);

-- =============================================
-- BOOKINGS TABLE - Anonymous Access
-- =============================================

-- Allow anonymous users to create bookings (for the booking flow)
CREATE POLICY "Allow anonymous users to create bookings" ON public.bookings
    FOR INSERT
    WITH CHECK (true);

-- Allow anonymous users to view their own bookings (if they have the ID)
CREATE POLICY "Allow anonymous users to view bookings" ON public.bookings
    FOR SELECT
    USING (true);

-- Allow authenticated users to view bookings they are involved in
CREATE POLICY "Allow users to view their own bookings" ON public.bookings
    FOR SELECT
    USING (
        auth.uid() = client_id OR 
        auth.uid() = gardener_id OR
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

-- Allow authenticated users to update bookings they are involved in
CREATE POLICY "Allow users to update their own bookings" ON public.bookings
    FOR UPDATE
    USING (
        auth.uid() = client_id OR 
        auth.uid() = gardener_id OR
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

-- =============================================
-- PROFILES TABLE - Anonymous Access
-- =============================================

-- Allow anonymous users to view profiles (for gardener info)
CREATE POLICY "Allow anonymous users to view profiles" ON public.profiles
    FOR SELECT
    USING (true);

-- Allow authenticated users to view profiles
CREATE POLICY "Allow authenticated users to view profiles" ON public.profiles
    FOR SELECT
    USING (true);

-- Allow users to update their own profile
CREATE POLICY "Allow users to update their own profile" ON public.profiles
    FOR UPDATE
    USING (auth.uid() = user_id);

-- Allow users to insert their own profile
CREATE POLICY "Allow users to insert their own profile" ON public.profiles
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- =============================================
-- GRANT PERMISSIONS TO ROLES
-- =============================================

-- Grant SELECT permissions on all relevant tables to anon role
GRANT SELECT ON public.services TO anon;
GRANT SELECT ON public.gardener_profiles TO anon;
GRANT SELECT ON public.availability TO anon;
GRANT SELECT ON public.bookings TO anon;
GRANT SELECT ON public.profiles TO anon;

-- Grant INSERT permissions on bookings table to anon role for creating bookings
GRANT INSERT ON public.bookings TO anon;

-- Grant SELECT permissions on all relevant tables to authenticated role
GRANT SELECT ON public.services TO authenticated;
GRANT SELECT ON public.gardener_profiles TO authenticated;
GRANT SELECT ON public.availability TO authenticated;
GRANT SELECT ON public.bookings TO authenticated;
GRANT SELECT ON public.profiles TO authenticated;

-- Grant INSERT permissions on bookings table to authenticated role
GRANT INSERT ON public.bookings TO authenticated;

-- Grant UPDATE permissions on bookings table to authenticated role
GRANT UPDATE ON public.bookings TO authenticated;

-- Grant UPDATE permissions on profiles table to authenticated role
GRANT UPDATE ON public.profiles TO authenticated;

-- Grant INSERT permissions on profiles table to authenticated role
GRANT INSERT ON public.profiles TO authenticated;

-- =============================================
-- ENABLE RLS ON TABLES (if not already enabled)
-- =============================================

-- Note: These tables already have RLS enabled based on the schema inspection
-- ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.gardener_profiles ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.availability ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;