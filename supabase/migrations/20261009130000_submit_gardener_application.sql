-- Pendientes (PH-18, 2026-10-09): el alta de jardinero se envía por el servidor, que comprueba que
-- está completa, como ya hacen las empresas (`submit_company_application`).
--
-- Antes el formulario (GardenerApplicationWizard) hacía un UPDATE a 'submitted' desde el
-- navegador, y la regla `applications_own_update` lo dejaba con cualquier borrador: con una
-- llamada directa se podía enviar una solicitud vacía. El usuario dejó la decisión al chat
-- («realiza las acciones que veas convenientes»).
--
-- Ahora:
--   1. `submit_gardener_application()`: sobre la PROPIA solicitud y solo si es un borrador;
--      comprueba lo mismo que el formulario (nombre, teléfono español, zona, foto, al menos un
--      servicio y una herramienta, experiencia descrita y las dos declaraciones) y la envía.
--   2. El navegador ya no puede pasarla a 'submitted' por su cuenta: solo editar su borrador.
--
-- Vuelta atrás: volver a crear `applications_own_update` con
-- `WITH CHECK (auth.uid() = user_id AND status IN ('draft','submitted'))` y borrar la función.

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

-- El navegador solo edita su borrador; enviarlo es cosa de la función de arriba.
DROP POLICY IF EXISTS applications_own_update ON public.gardener_applications;
CREATE POLICY applications_own_update ON public.gardener_applications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND status = 'draft')
  WITH CHECK (auth.uid() = user_id AND status = 'draft');
