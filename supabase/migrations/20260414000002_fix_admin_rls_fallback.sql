-- Script to forcefully allow admins to read gardener_licenses and profiles
-- even if previous RLS policies were misconfigured or missing

-- 1. Ensure RLS is enabled but policies allow admins
ALTER TABLE public.gardener_licenses ENABLE ROW LEVEL SECURITY;

-- Drop existing admin policies to recreate them cleanly
DROP POLICY IF EXISTS "Admins can read all licenses" ON public.gardener_licenses;
DROP POLICY IF EXISTS "Admins can update licenses" ON public.gardener_licenses;

-- Recreate policy for SELECT
CREATE POLICY "Admins can read all licenses"
ON public.gardener_licenses
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles p 
        WHERE p.id = auth.uid() AND p.role = 'admin'
    )
    OR 
    -- Fallback checking email just in case the role wasn't synced
    auth.jwt() ->> 'email' IN ('admin@jardineria.com', 'developer@jardineria.com', 'mjgardenproject@gmail.com', 'migardenproject@gmail.com')
);

-- Recreate policy for UPDATE
CREATE POLICY "Admins can update licenses"
ON public.gardener_licenses
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles p 
        WHERE p.id = auth.uid() AND p.role = 'admin'
    )
    OR 
    auth.jwt() ->> 'email' IN ('admin@jardineria.com', 'developer@jardineria.com', 'mjgardenproject@gmail.com', 'migardenproject@gmail.com')
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.profiles p 
        WHERE p.id = auth.uid() AND p.role = 'admin'
    )
    OR 
    auth.jwt() ->> 'email' IN ('admin@jardineria.com', 'developer@jardineria.com', 'mjgardenproject@gmail.com', 'migardenproject@gmail.com')
);

-- Also ensure admins can read gardener profiles
DROP POLICY IF EXISTS "Admins can read all gardener profiles" ON public.gardener_profiles;

CREATE POLICY "Admins can read all gardener profiles"
ON public.gardener_profiles
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles p 
        WHERE p.id = auth.uid() AND p.role = 'admin'
    )
    OR 
    auth.jwt() ->> 'email' IN ('admin@jardineria.com', 'developer@jardineria.com', 'mjgardenproject@gmail.com', 'migardenproject@gmail.com')
);
