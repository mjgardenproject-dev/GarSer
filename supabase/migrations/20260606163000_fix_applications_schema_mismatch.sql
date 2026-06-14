-- Corrección de discrepancia de esquema (Configuration Drift)
-- El frontend enviaba columnas que no existían en la base de datos, provocando un 400 Bad Request en PostgREST.

-- 1. Añadir columnas faltantes a la tabla de solicitudes
ALTER TABLE public.gardener_applications
ADD COLUMN IF NOT EXISTS experience_description text,
ADD COLUMN IF NOT EXISTS certification_photos text[] DEFAULT '{}';

-- 2. Añadir las mismas columnas a los perfiles de jardinero para mantener consistencia al aprobar
ALTER TABLE public.gardener_profiles
ADD COLUMN IF NOT EXISTS experience_description text,
ADD COLUMN IF NOT EXISTS certification_photos text[] DEFAULT '{}';

-- 3. Arreglar bug oculto de RLS que impedía enviar la solicitud (pasar de draft a submitted)
DROP POLICY IF EXISTS "applications_own_draft_rw" ON public.gardener_applications;

CREATE POLICY "applications_own_insert" ON public.gardener_applications
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND status = 'draft');

CREATE POLICY "applications_own_update" ON public.gardener_applications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND status = 'draft')
  WITH CHECK (auth.uid() = user_id AND status IN ('draft', 'submitted'));
