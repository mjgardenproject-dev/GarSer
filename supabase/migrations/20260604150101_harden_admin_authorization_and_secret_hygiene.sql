-- Security hardening:
-- 1. Make `admin` a valid application role in `profiles`.
-- 2. Remove email-based admin fallbacks from RLS policies.
-- 3. Normalize admin checks to `profiles.user_id = auth.uid()`.

ALTER TABLE public.profiles
DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
ADD CONSTRAINT profiles_role_check
CHECK (role IN ('client', 'gardener', 'admin'));

ALTER TABLE public.gardener_licenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read all licenses" ON public.gardener_licenses;
CREATE POLICY "Admins can read all licenses"
ON public.gardener_licenses
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.user_id = auth.uid()
      AND p.role = 'admin'
  )
);

DROP POLICY IF EXISTS "Admins can update licenses" ON public.gardener_licenses;
CREATE POLICY "Admins can update licenses"
ON public.gardener_licenses
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.user_id = auth.uid()
      AND p.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.user_id = auth.uid()
      AND p.role = 'admin'
  )
);

DROP POLICY IF EXISTS "Admins can read all gardener profiles" ON public.gardener_profiles;
CREATE POLICY "Admins can read all gardener profiles"
ON public.gardener_profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.user_id = auth.uid()
      AND p.role = 'admin'
  )
);

DROP POLICY IF EXISTS "Admins can read all licenses" ON storage.objects;
CREATE POLICY "Admins can read all licenses"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'private_licenses'
  AND EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.user_id = auth.uid()
      AND p.role = 'admin'
  )
);

DROP POLICY IF EXISTS "Admins can update all licenses" ON storage.objects;
CREATE POLICY "Admins can update all licenses"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'private_licenses'
  AND EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.user_id = auth.uid()
      AND p.role = 'admin'
  )
);

DROP POLICY IF EXISTS "Admins can delete all licenses" ON storage.objects;
CREATE POLICY "Admins can delete all licenses"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'private_licenses'
  AND EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.user_id = auth.uid()
      AND p.role = 'admin'
  )
);
