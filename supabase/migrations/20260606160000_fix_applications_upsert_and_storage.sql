-- 1. Fix Error 1: Add UNIQUE constraint to gardener_applications.user_id
-- This allows PostgREST to perform ON CONFLICT (user_id) DO UPDATE (upsert)
ALTER TABLE public.gardener_applications 
ADD CONSTRAINT gardener_applications_user_id_key UNIQUE (user_id);

-- 2. Fix Error 2: Create missing 'applications' storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'applications',
  'applications',
  true, -- Needs to be public because frontend uses getPublicUrl
  5242880, -- 5MB limit for avatars/documents
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- 3. Storage Policies for 'applications' bucket
DROP POLICY IF EXISTS "Public Read Applications" ON storage.objects;
CREATE POLICY "Public Read Applications"
ON storage.objects FOR SELECT
USING (bucket_id = 'applications');

DROP POLICY IF EXISTS "Authenticated Upload Applications" ON storage.objects;
CREATE POLICY "Authenticated Upload Applications"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'applications' 
  AND auth.uid()::text = (string_to_array(name, '/'))[1]
);

DROP POLICY IF EXISTS "Authenticated Update Applications" ON storage.objects;
CREATE POLICY "Authenticated Update Applications"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'applications'
  AND auth.uid()::text = (string_to_array(name, '/'))[1]
);

DROP POLICY IF EXISTS "Authenticated Delete Applications" ON storage.objects;
CREATE POLICY "Authenticated Delete Applications"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'applications'
  AND auth.uid()::text = (string_to_array(name, '/'))[1]
);
