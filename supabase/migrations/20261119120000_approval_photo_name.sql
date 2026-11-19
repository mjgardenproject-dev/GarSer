-- La foto y el nombre dados en el alta pasan al perfil al aprobar (FASE 4, paquete 1.14, QA-014, 2026-11-19).
--
-- Antes: al aprobar se copiaba professional_photo_url pero no avatar_url, que es lo que ven los clientes
-- y lo que mira «Completa tu cuenta» (has_photo); y profiles.full_name / avatar_url («Mi cuenta») quedaban
-- vacíos. El profesional aprobado figuraba «sin foto», sin nombre, y tenía que subir otra vez la foto.
--
-- Qué hace:
--   1. admin_review_gardener_application y admin_review_company_application copian la foto/logo y el
--      nombre a gardener_profiles.avatar_url, profiles.avatar_url y profiles.full_name SOLO si estaban
--      vacíos (lo que la persona ya hubiera puesto no se pisa).
--   2. Rellena lo mismo en los profesionales ya aprobados (solo huecos).
--
-- Vuelta atrás: reponer las dos funciones desde 20261009110000_gardener_application_restart.sql y
-- 20260924130000_empresas_f3_onboarding_server.sql (los datos rellenados son inofensivos).

CREATE OR REPLACE FUNCTION public.admin_review_gardener_application(p_application_id uuid, p_status text, p_comment text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin boolean;
  v_application record;
BEGIN
  -- Verificar que el usuario que llama a la función es administrador
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Acceso denegado: El usuario no es administrador.';
  END IF;

  -- Validar el estado
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Estado inválido. Debe ser "approved" o "rejected".';
  END IF;

  -- Obtener la solicitud
  SELECT * INTO v_application FROM public.gardener_applications WHERE id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada.';
  END IF;

  IF v_application.status != 'submitted' THEN
    RAISE EXCEPTION 'La solicitud no está en estado "submitted" (actual: %).', v_application.status;
  END IF;

  -- Actualizar la solicitud
  UPDATE public.gardener_applications
  SET 
    status = p_status,
    reviewer_id = auth.uid(),
    reviewed_at = now(),
    review_comment = p_comment,
    updated_at = now()
  WHERE id = p_application_id;

  -- Si es aprobada, actualizar perfiles
  IF p_status = 'approved' THEN
    
    -- Actualizar el rol en la tabla profiles
    UPDATE public.profiles
    SET role = 'gardener',
        updated_at = now()
    WHERE user_id = v_application.user_id;

    -- Upsert en gardener_profiles
    IF EXISTS (SELECT 1 FROM public.gardener_profiles WHERE user_id = v_application.user_id) THEN
      UPDATE public.gardener_profiles
      SET
        full_name = v_application.full_name,
        phone = v_application.phone,
        services = v_application.services,
        other_services = v_application.other_services,
        tools_available = v_application.tools_available,
        experience_years = v_application.experience_years,
        experience_range = v_application.experience_range,
        worked_for_companies = v_application.worked_for_companies,
        can_prove = v_application.can_prove,
        proof_photos = v_application.proof_photos,
        test_grass_frequency = v_application.test_grass_frequency,
        test_hedge_season = v_application.test_hedge_season,
        test_pest_action = v_application.test_pest_action,
        certification_text = v_application.certification_text,
        declaration_truth = v_application.declaration_truth,
        accept_terms = v_application.accept_terms,
        city_zone = v_application.city_zone,
        professional_photo_url = v_application.professional_photo_url,
        experience_description = v_application.experience_description,
        certification_photos = v_application.certification_photos,
        address = COALESCE(v_application.city_zone, address),
        updated_at = now()
      WHERE user_id = v_application.user_id;
    ELSE
      INSERT INTO public.gardener_profiles (
        user_id,
        full_name,
        phone,
        address,
        services,
        other_services,
        tools_available,
        experience_years,
        experience_range,
        worked_for_companies,
        can_prove,
        proof_photos,
        test_grass_frequency,
        test_hedge_season,
        test_pest_action,
        certification_text,
        declaration_truth,
        accept_terms,
        city_zone,
        professional_photo_url,
        experience_description,
        certification_photos
      )
      VALUES (
        v_application.user_id,
        v_application.full_name,
        v_application.phone,
        COALESCE(v_application.city_zone, ''),
        v_application.services,
        v_application.other_services,
        v_application.tools_available,
        v_application.experience_years,
        v_application.experience_range,
        v_application.worked_for_companies,
        v_application.can_prove,
        v_application.proof_photos,
        v_application.test_grass_frequency,
        v_application.test_hedge_season,
        v_application.test_pest_action,
        v_application.certification_text,
        v_application.declaration_truth,
        v_application.accept_terms,
        v_application.city_zone,
        v_application.professional_photo_url,
        v_application.experience_description,
        v_application.certification_photos
      );
    END IF;

    -- QA-014: la foto y el nombre que dio en el alta pasan a su perfil. Sin esto el profesional aprobado
    -- figuraba «sin foto» (los clientes y «Completa tu cuenta» miran avatar_url, no professional_photo_url)
    -- y «Mi cuenta» no tenía su nombre. Lo que la persona ya tuviera puesto allí NO se pisa.
    UPDATE public.gardener_profiles
    SET avatar_url = v_application.professional_photo_url,
        updated_at = now()
    WHERE user_id = v_application.user_id
      AND NULLIF(BTRIM(COALESCE(avatar_url, '')), '') IS NULL
      AND NULLIF(BTRIM(COALESCE(v_application.professional_photo_url, '')), '') IS NOT NULL;

    UPDATE public.profiles
    SET full_name = CASE WHEN NULLIF(BTRIM(COALESCE(full_name, '')), '') IS NULL THEN NULLIF(BTRIM(v_application.full_name), '') ELSE full_name END,
        avatar_url = CASE WHEN NULLIF(BTRIM(COALESCE(avatar_url, '')), '') IS NULL
                          THEN NULLIF(BTRIM(COALESCE(v_application.professional_photo_url, '')), '') ELSE avatar_url END,
        updated_at = now()
    WHERE user_id = v_application.user_id;
  END IF;

END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_review_company_application(p_application_id uuid, p_status text, p_comment text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_app public.company_applications%ROWTYPE;
  v_company_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado: el usuario no es administrador.';
  END IF;
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Estado no válido: %', p_status;
  END IF;

  SELECT * INTO v_app FROM public.company_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada.';
  END IF;
  IF v_app.status <> 'submitted' THEN
    RAISE EXCEPTION 'La solicitud no está enviada (estado: %).', v_app.status;
  END IF;

  IF p_status = 'approved' THEN
    IF (SELECT role FROM public.profiles WHERE user_id = v_app.user_id) IS DISTINCT FROM 'company' THEN
      RAISE EXCEPTION 'La cuenta que pidió el alta ya no es una cuenta de empresa.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.gardener_profiles WHERE user_id = v_app.user_id) THEN
      RAISE EXCEPTION 'Esta cuenta ya tiene una ficha de profesional.';
    END IF;

    INSERT INTO public.gardener_profiles (user_id, full_name, phone, address, city_zone, description, provider_kind)
    VALUES (v_app.user_id, v_app.commercial_name, v_app.phone, v_app.address, v_app.city_zone,
            NULLIF(BTRIM(v_app.answers ->> 'description'), ''), 'company');

    INSERT INTO public.companies (provider_user_id, legal_name, tax_id, logo_url)
    VALUES (v_app.user_id, v_app.legal_name, v_app.tax_id, v_app.logo_url)
    RETURNING id INTO v_company_id;

    INSERT INTO public.company_members (company_id, user_id, role, counts_as_labour)
    VALUES (v_company_id, v_app.user_id, 'owner', v_app.owner_works);

    -- QA-014: el logo y el nombre comercial del alta pasan al perfil (lo que ya tuviera puesto, no se pisa).
    UPDATE public.gardener_profiles
    SET avatar_url = v_app.logo_url, updated_at = now()
    WHERE user_id = v_app.user_id
      AND NULLIF(BTRIM(COALESCE(avatar_url, '')), '') IS NULL
      AND NULLIF(BTRIM(COALESCE(v_app.logo_url, '')), '') IS NOT NULL;
    UPDATE public.profiles
    SET full_name = CASE WHEN NULLIF(BTRIM(COALESCE(full_name, '')), '') IS NULL THEN NULLIF(BTRIM(v_app.commercial_name), '') ELSE full_name END,
        avatar_url = CASE WHEN NULLIF(BTRIM(COALESCE(avatar_url, '')), '') IS NULL
                          THEN NULLIF(BTRIM(COALESCE(v_app.logo_url, '')), '') ELSE avatar_url END,
        updated_at = now()
    WHERE user_id = v_app.user_id;
  END IF;

  UPDATE public.company_applications
  SET status = p_status, review_comment = p_comment, reviewed_at = now(), reviewer_id = auth.uid(), updated_at = now()
  WHERE id = p_application_id;

  RETURN jsonb_build_object('application_id', p_application_id, 'status', p_status, 'company_id', v_company_id);
END;
$function$;


-- ── Relleno de los ya aprobados (solo huecos) ────────────────────────────────────────────────────────
UPDATE public.gardener_profiles gp
SET avatar_url = gp.professional_photo_url, updated_at = now()
WHERE NULLIF(BTRIM(COALESCE(gp.avatar_url, '')), '') IS NULL
  AND NULLIF(BTRIM(COALESCE(gp.professional_photo_url, '')), '') IS NOT NULL;

UPDATE public.gardener_profiles gp
SET avatar_url = c.logo_url, updated_at = now()
FROM public.companies c
WHERE c.provider_user_id = gp.user_id
  AND NULLIF(BTRIM(COALESCE(gp.avatar_url, '')), '') IS NULL
  AND NULLIF(BTRIM(COALESCE(c.logo_url, '')), '') IS NOT NULL;

UPDATE public.profiles p
SET avatar_url = gp.avatar_url, updated_at = now()
FROM public.gardener_profiles gp
WHERE gp.user_id = p.user_id
  AND NULLIF(BTRIM(COALESCE(p.avatar_url, '')), '') IS NULL
  AND NULLIF(BTRIM(COALESCE(gp.avatar_url, '')), '') IS NOT NULL;

UPDATE public.profiles p
SET full_name = gp.full_name, updated_at = now()
FROM public.gardener_profiles gp
WHERE gp.user_id = p.user_id
  AND NULLIF(BTRIM(COALESCE(p.full_name, '')), '') IS NULL
  AND NULLIF(BTRIM(COALESCE(gp.full_name, '')), '') IS NOT NULL;
