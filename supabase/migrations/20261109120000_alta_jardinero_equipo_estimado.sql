-- Alta de jardinero (2026-11-09): el formulario deja de preguntar por «trabajo por cuenta ajena» y pregunta
-- cuántas personas trabajarán desde el perfil.
--
-- Qué pasaba: el paso 3 del alta (experiencia) pedía el currículum y si el solicitante «ha trabajado para
-- empresas de jardinería». GarSer es para profesionales por cuenta propia y para empresas, no para
-- empleados, así que esas preguntas no ayudaban a decidir y confundían. Y faltaba lo que sí importa al
-- aceptar o rechazar: con cuánta gente va a trabajar (un autónomo solo no es lo mismo que una empresa).
--
-- Ahora:
--   1. `gardener_applications.estimated_team_size`: personas que trabajarán desde el perfil, CONTANDO al
--      propio solicitante (1 = trabaja solo). Es una estimación para el administrador: NO crea equipo ni
--      cambia el modo de la cuenta (eso lo sigue decidiendo `provider_kind`, que pasa a equipo cuando
--      acepta su primer compañero; ver 20261108120000). Nulo en las solicitudes anteriores.
--   2. `submit_gardener_application()` exige ese dato (entre 1 y 200) además de lo que ya exigía.
--
-- `worked_for_companies` y `can_prove` NO se tocan: el formulario ya no las escribe (quedan nulas) y la
-- aprobación sigue copiándolas tal cual a `gardener_profiles`.
--
-- Orden de despliegue: esta migración ANTES de fusionar el front. Sin la columna, el guardado del
-- formulario (que ya envía `estimated_team_size`) fallaría entero.
--
-- Vuelta atrás: restaurar `submit_gardener_application` de 20261009130000 y
-- `ALTER TABLE public.gardener_applications DROP COLUMN estimated_team_size`.

ALTER TABLE public.gardener_applications
  ADD COLUMN IF NOT EXISTS estimated_team_size integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.gardener_applications'::regclass
      AND conname = 'gardener_applications_estimated_team_size_range'
  ) THEN
    ALTER TABLE public.gardener_applications
      ADD CONSTRAINT gardener_applications_estimated_team_size_range
      CHECK (estimated_team_size IS NULL OR estimated_team_size BETWEEN 1 AND 200);
  END IF;
END $$;

COMMENT ON COLUMN public.gardener_applications.estimated_team_size IS
  'Personas que trabajarán desde el perfil, contando al solicitante (1 = solo). Estimación para la revisión del '
  'administrador; no crea equipo. Nulo en las solicitudes anteriores a 2026-11-09.';

CREATE OR REPLACE FUNCTION public.submit_gardener_application()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.gardener_applications%ROWTYPE;
  v_missing text[] := '{}';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Inicia sesión para continuar.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_app FROM public.gardener_applications WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No tienes ninguna solicitud.' USING ERRCODE = '22023';
  END IF;
  IF v_app.status = 'submitted' THEN
    -- Ya enviada (doble clic u otra pestaña): no es un error.
    RETURN jsonb_build_object('applicationId', v_app.id, 'status', 'submitted');
  END IF;
  IF v_app.status <> 'draft' THEN
    RAISE EXCEPTION 'Esta solicitud ya no se puede enviar.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(btrim(v_app.full_name), '') = '' THEN v_missing := array_append(v_missing, 'nombre'); END IF;
  IF regexp_replace(COALESCE(v_app.phone, ''), '[\s-]', '', 'g') !~ '^(\+34)?[6789][0-9]{8}$' THEN
    v_missing := array_append(v_missing, 'un teléfono válido');
  END IF;
  IF COALESCE(btrim(v_app.city_zone), '') = '' THEN v_missing := array_append(v_missing, 'zona de trabajo'); END IF;
  IF COALESCE(btrim(v_app.professional_photo_url), '') = '' THEN v_missing := array_append(v_missing, 'foto de perfil'); END IF;
  IF COALESCE(array_length(v_app.services, 1), 0) = 0 THEN v_missing := array_append(v_missing, 'servicios'); END IF;
  IF COALESCE(array_length(v_app.tools_available, 1), 0) = 0 THEN v_missing := array_append(v_missing, 'herramientas'); END IF;
  IF COALESCE(v_app.experience_years, 0) < 0 OR COALESCE(btrim(v_app.experience_description), '') = '' THEN
    v_missing := array_append(v_missing, 'experiencia');
  END IF;
  IF v_app.estimated_team_size IS NULL OR v_app.estimated_team_size NOT BETWEEN 1 AND 200 THEN
    v_missing := array_append(v_missing, 'cuántas personas trabajarán en tu perfil');
  END IF;
  IF NOT COALESCE(v_app.declaration_truth, false) OR NOT COALESCE(v_app.accept_terms, false) THEN
    v_missing := array_append(v_missing, 'aceptar las dos declaraciones');
  END IF;
  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'Falta: %.', array_to_string(v_missing, ', ') USING ERRCODE = '22023';
  END IF;

  UPDATE public.gardener_applications
  SET status = 'submitted', submitted_at = now(), updated_at = now(),
      email = COALESCE(email, (SELECT email FROM auth.users WHERE id = v_app.user_id))
  WHERE id = v_app.id;

  RETURN jsonb_build_object('applicationId', v_app.id, 'status', 'submitted');
END;
$$;
REVOKE ALL ON FUNCTION public.submit_gardener_application() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_gardener_application() TO authenticated;
