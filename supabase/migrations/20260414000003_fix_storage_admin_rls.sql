-- Fix Storage RLS for admins using email fallback
-- This allows admins to view and manage files in the private_licenses bucket
-- even if the profiles.role sync hasn't occurred.

DROP POLICY IF EXISTS "Admins can read all licenses" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update all licenses" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete all licenses" ON storage.objects;

-- Recreate SELECT Policy
CREATE POLICY "Admins can read all licenses"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'private_licenses' AND (
        EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
        OR auth.jwt() ->> 'email' IN ('admin@jardineria.com', 'developer@jardineria.com', 'mjgardenproject@gmail.com', 'migardenproject@gmail.com')
    )
);

-- Recreate UPDATE Policy
CREATE POLICY "Admins can update all licenses"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
    bucket_id = 'private_licenses' AND (
        EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
        OR auth.jwt() ->> 'email' IN ('admin@jardineria.com', 'developer@jardineria.com', 'mjgardenproject@gmail.com', 'migardenproject@gmail.com')
    )
);

-- Recreate DELETE Policy
CREATE POLICY "Admins can delete all licenses"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'private_licenses' AND (
        EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
        OR auth.jwt() ->> 'email' IN ('admin@jardineria.com', 'developer@jardineria.com', 'mjgardenproject@gmail.com', 'migardenproject@gmail.com')
    )
);
