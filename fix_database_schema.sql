-- 1. Crear tabla gardener_applications si no existe
CREATE TABLE IF NOT EXISTS public.gardener_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  status text CHECK (status IN ('draft','submitted','approved','rejected')) DEFAULT 'draft',
  full_name text,
  phone text,
  email text,
  city_zone text,
  professional_photo_url text,
  services text[] DEFAULT '{}',
  tools_available text[] DEFAULT '{}',
  experience_years int,
  experience_range text CHECK (experience_range IN ('<1','1-3','3-5','>5')),
  worked_for_companies boolean,
  can_prove boolean,
  proof_photos text[] DEFAULT '{}',
  test_grass_frequency text CHECK (test_grass_frequency IN ('semana','3_meses')),
  test_hedge_season text CHECK (test_hedge_season IN ('invierno','verano')),
  test_pest_action text,
  certification_text text,
  declaration_truth boolean DEFAULT false,
  accept_terms boolean DEFAULT false,
  other_services text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewer_id uuid REFERENCES auth.users(id),
  review_comment text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Habilitar RLS
ALTER TABLE public.gardener_applications ENABLE ROW LEVEL SECURITY;

-- 3. Políticas (borrar antiguas para evitar duplicados si se re-ejecuta mal)
DROP POLICY IF EXISTS "applications_own_draft_rw" ON public.gardener_applications;
CREATE POLICY "applications_own_draft_rw" ON public.gardener_applications
  FOR ALL TO authenticated
  USING (auth.uid() = user_id AND status = 'draft')
  WITH CHECK (auth.uid() = user_id AND status = 'draft');

DROP POLICY IF EXISTS "applications_own_select" ON public.gardener_applications;
CREATE POLICY "applications_own_select" ON public.gardener_applications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "applications_team_select" ON public.gardener_applications;
CREATE POLICY "applications_team_select" ON public.gardener_applications
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "applications_team_update" ON public.gardener_applications;
CREATE POLICY "applications_team_update" ON public.gardener_applications
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin'));

-- 4. Ampliar gardener_profiles con columnas faltantes (usando IF NOT EXISTS por seguridad)
ALTER TABLE public.gardener_profiles
  ADD COLUMN IF NOT EXISTS professional_photo_url text,
  ADD COLUMN IF NOT EXISTS city_zone text,
  ADD COLUMN IF NOT EXISTS tools_available text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS experience_years int,
  ADD COLUMN IF NOT EXISTS experience_range text CHECK (experience_range IN ('<1','1-3','3-5','>5')),
  ADD COLUMN IF NOT EXISTS worked_for_companies boolean,
  ADD COLUMN IF NOT EXISTS can_prove boolean,
  ADD COLUMN IF NOT EXISTS proof_photos text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS test_grass_frequency text CHECK (test_grass_frequency IN ('semana','3_meses')),
  ADD COLUMN IF NOT EXISTS test_hedge_season text CHECK (test_hedge_season IN ('invierno','verano')),
  ADD COLUMN IF NOT EXISTS test_pest_action text,
  ADD COLUMN IF NOT EXISTS certification_text text,
  ADD COLUMN IF NOT EXISTS declaration_truth boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS accept_terms boolean DEFAULT false;

-- 5. Registrar migración para evitar que se pida de nuevo
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20251117_gardener_application_and_profile_extend',
  '20251117_gardener_application_and_profile_extend.sql',
  '{manual_fix}'
) ON CONFLICT (version) DO NOTHING;
