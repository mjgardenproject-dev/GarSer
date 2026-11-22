-- En qué paso del cuestionario «Activa tu cuenta» va cada profesional (2026-11-11, medición del diseño §7).
--
-- Para qué: ver en «Admin → Profesionales» quién se quedó a medias y dónde («poniendo tarifas, hace 3 días»)
-- y poder llamarle. No cambia nada de lo que ven los clientes ni de quién aparece.
--
--   · gardener_profiles.activation_step / activation_step_at: último paso al que llegó y cuándo.
--   · record_my_activation_step(paso): lo anota el propio profesional (solo en su ficha, solo pasos válidos).
--   · admin_activation_progress(): la lista para el administrador (is_admin dentro).
--
-- Vuelta atrás: borrar las dos funciones y las dos columnas.

ALTER TABLE public.gardener_profiles
  ADD COLUMN IF NOT EXISTS activation_step text,
  ADD COLUMN IF NOT EXISTS activation_step_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.gardener_profiles'::regclass AND conname = 'gardener_profiles_activation_step_valid'
  ) THEN
    ALTER TABLE public.gardener_profiles
      ADD CONSTRAINT gardener_profiles_activation_step_valid CHECK (
        activation_step IS NULL
        OR activation_step IN ('welcome', 'zone', 'services', 'service', 'schedule', 'team', 'finish', 'done')
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.record_my_activation_step(p_step text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Inicia sesión para continuar.' USING ERRCODE = '42501';
  END IF;
  IF p_step IS NULL OR p_step NOT IN ('welcome', 'zone', 'services', 'service', 'schedule', 'team', 'finish', 'done') THEN
    RAISE EXCEPTION 'Paso no válido.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.gardener_profiles
  SET activation_step = p_step, activation_step_at = now()
  WHERE user_id = auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.record_my_activation_step(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_my_activation_step(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_activation_progress()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo para administradores.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('provider_id', user_id, 'step', activation_step, 'at', activation_step_at))
    FROM public.gardener_profiles
    WHERE activation_step IS NOT NULL
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_activation_progress() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_activation_progress() TO authenticated;
