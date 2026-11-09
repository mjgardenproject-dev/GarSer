-- Pruebas del alta de jardinero con «¿cuántas personas trabajarán desde tu perfil?» (migración 20261109120000).
--
-- Todo corre dentro de una transacción que se revierte al final:
--
--   docker exec -i <contenedor_db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/gardener_application_team_size.test.sql
--
-- Cualquier comprobación que falle aborta con excepción. Si termina con
-- "TODAS LAS COMPROBACIONES OK", todo lo de abajo se cumple.

BEGIN;

SET client_min_messages = WARNING;

CREATE FUNCTION pg_temp.check_that(p_ok boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FALLO %', p_msg; END IF;
END $$;

CREATE FUNCTION pg_temp.as_user(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN NULL ELSE json_build_object('sub', p_uid)::text END, true);
END $$;

-- Ejecuta una sentencia y devuelve el mensaje del error, o NULL si no falló (lo que hiciera se deshace si falla).
CREATE FUNCTION pg_temp.error_of(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;

CREATE FUNCTION pg_temp.new_user(p_id uuid, p_email text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  VALUES (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    p_email, 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
END $$;

-- Un borrador COMPLETO salvo (a propósito) el nº de personas.
CREATE FUNCTION pg_temp.draft_without_team(p_uid uuid, p_name text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.gardener_applications (user_id, status, full_name, phone, city_zone, professional_photo_url,
    services, tools_available, experience_years, experience_description, declaration_truth, accept_terms)
  VALUES (p_uid, 'draft', p_name, '600123456', 'Marbella', 'https://example.com/foto.jpg',
    ARRAY['Corte de césped'], ARRAY['Cortacésped'], 4, 'Comunidades y chalets', true, true)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

DO $prueba$
DECLARE
  v_solo   uuid := '00000000-7a1e-4e11-8bbb-000000000001';  -- autónomo, trabaja solo
  v_equipo uuid := '00000000-7a1e-4e11-8bbb-000000000002';  -- con equipo de 5
  v_mala   uuid := '00000000-7a1e-4e11-8bbb-000000000003';  -- valores imposibles
  v_vieja  uuid := '00000000-7a1e-4e11-8bbb-000000000004';  -- solicitud anterior, sin el dato
  v_app_solo uuid; v_app_equipo uuid; v_app_mala uuid; v_app_vieja uuid;
  v_err text;
  v_res jsonb;
BEGIN
  PERFORM pg_temp.new_user(v_solo,   'team-solo@test.local');
  PERFORM pg_temp.new_user(v_equipo, 'team-equipo@test.local');
  PERFORM pg_temp.new_user(v_mala,   'team-mala@test.local');
  PERFORM pg_temp.new_user(v_vieja,  'team-vieja@test.local');

  -- ── 1. Sin el nº de personas no se puede enviar, y el aviso lo dice ───────────────────────────
  v_app_solo := pg_temp.draft_without_team(v_solo, 'Autónomo Solo');
  PERFORM pg_temp.as_user(v_solo);
  v_err := pg_temp.error_of('SELECT public.submit_gardener_application()');
  PERFORM pg_temp.check_that(v_err LIKE 'Falta:%cuántas personas trabajarán en tu perfil%',
    '1a: sin nº de personas el envío falla diciendo qué falta (' || coalesce(v_err, 'sin error') || ')');
  PERFORM pg_temp.check_that((SELECT status FROM public.gardener_applications WHERE id = v_app_solo) = 'draft',
    '1b: tras el fallo sigue siendo borrador');
  PERFORM pg_temp.check_that((SELECT estimated_team_size FROM public.gardener_applications WHERE id = v_app_solo) IS NULL,
    '1c: el borrador nuevo no inventa un valor (nulo)');

  -- ── 2. La base de datos rechaza valores imposibles (no solo el formulario) ────────────────────
  PERFORM pg_temp.as_user(NULL);
  v_app_mala := pg_temp.draft_without_team(v_mala, 'Valores Imposibles');
  FOREACH v_err IN ARRAY ARRAY['0', '-3', '201', '1000'] LOOP
    PERFORM pg_temp.check_that(
      pg_temp.error_of(format('UPDATE public.gardener_applications SET estimated_team_size = %s WHERE id = %L', v_err, v_app_mala))
        LIKE '%gardener_applications_estimated_team_size_range%',
      '2a: ' || v_err || ' personas se rechaza con la restricción');
  END LOOP;
  PERFORM pg_temp.check_that((SELECT estimated_team_size FROM public.gardener_applications WHERE id = v_app_mala) IS NULL,
    '2b: tras los rechazos no se guardó nada');
  PERFORM pg_temp.check_that(
    pg_temp.error_of(format('UPDATE public.gardener_applications SET estimated_team_size = 1 WHERE id = %L', v_app_mala)) IS NULL
    AND pg_temp.error_of(format('UPDATE public.gardener_applications SET estimated_team_size = 200 WHERE id = %L', v_app_mala)) IS NULL,
    '2c: los extremos 1 y 200 se aceptan');

  -- ── 3. Un autónomo que trabaja solo (1) puede enviar ──────────────────────────────────────────
  UPDATE public.gardener_applications SET estimated_team_size = 1 WHERE id = v_app_solo;
  PERFORM pg_temp.as_user(v_solo);
  v_res := public.submit_gardener_application();
  PERFORM pg_temp.check_that(v_res ->> 'status' = 'submitted', '3a: con 1 persona se envía');
  PERFORM pg_temp.check_that((SELECT status FROM public.gardener_applications WHERE id = v_app_solo) = 'submitted',
    '3b: queda enviada');
  PERFORM pg_temp.check_that((SELECT estimated_team_size FROM public.gardener_applications WHERE id = v_app_solo) = 1,
    '3c: el dato llega a la solicitud que ve el administrador');

  -- ── 4. Una empresa con equipo (5) puede enviar, y el dato se conserva ─────────────────────────
  PERFORM pg_temp.as_user(NULL);
  v_app_equipo := pg_temp.draft_without_team(v_equipo, 'Empresa Con Equipo');
  UPDATE public.gardener_applications SET estimated_team_size = 5 WHERE id = v_app_equipo;
  PERFORM pg_temp.as_user(v_equipo);
  v_res := public.submit_gardener_application();
  PERFORM pg_temp.check_that(v_res ->> 'status' = 'submitted'
    AND (SELECT estimated_team_size FROM public.gardener_applications WHERE id = v_app_equipo) = 5,
    '4a: con 5 personas se envía y se guarda el 5');

  -- Enviar dos veces no es un error (doble clic) y no cambia el dato.
  v_res := public.submit_gardener_application();
  PERFORM pg_temp.check_that(v_res ->> 'status' = 'submitted'
    AND (SELECT estimated_team_size FROM public.gardener_applications WHERE id = v_app_equipo) = 5,
    '4b: reenviar es idempotente');

  -- ── 5. Enviar el alta NO crea equipo ni cambia el modo de la cuenta ───────────────────────────
  PERFORM pg_temp.check_that(NOT EXISTS (SELECT 1 FROM public.companies WHERE provider_user_id IN (v_solo, v_equipo)),
    '5a: declarar 5 personas no crea empresa');
  PERFORM pg_temp.check_that(NOT EXISTS (SELECT 1 FROM public.company_members m JOIN public.companies c ON c.id = m.company_id
    WHERE c.provider_user_id IN (v_solo, v_equipo)),
    '5b: ni miembros');

  -- ── 6. Un rechazo que se corrige conserva el dato ─────────────────────────────────────────────
  PERFORM pg_temp.as_user(NULL);
  UPDATE public.gardener_applications SET status = 'rejected', reviewed_at = now(), review_comment = 'Falta zona' WHERE id = v_app_equipo;
  PERFORM pg_temp.as_user(v_equipo);
  PERFORM public.restart_gardener_application();
  PERFORM pg_temp.check_that((SELECT status FROM public.gardener_applications WHERE id = v_app_equipo) = 'draft'
    AND (SELECT estimated_team_size FROM public.gardener_applications WHERE id = v_app_equipo) = 5,
    '6a: al reabrir tras un rechazo se conserva el nº de personas');

  -- ── 7. Una solicitud anterior (sin el dato) tiene que responderlo para reenviarse ─────────────
  PERFORM pg_temp.as_user(NULL);
  v_app_vieja := pg_temp.draft_without_team(v_vieja, 'Solicitud Anterior');
  PERFORM pg_temp.as_user(v_vieja);
  v_err := pg_temp.error_of('SELECT public.submit_gardener_application()');
  PERFORM pg_temp.check_that(v_err LIKE 'Falta:%cuántas personas%', '7a: una solicitud sin el dato no se envía');

  -- ── 8. El resto de comprobaciones del envío siguen funcionando ────────────────────────────────
  PERFORM pg_temp.as_user(NULL);
  UPDATE public.gardener_applications SET estimated_team_size = 2, phone = '123' WHERE id = v_app_vieja;
  PERFORM pg_temp.as_user(v_vieja);
  v_err := pg_temp.error_of('SELECT public.submit_gardener_application()');
  PERFORM pg_temp.check_that(v_err LIKE 'Falta:%un teléfono válido%' AND v_err NOT LIKE '%cuántas personas%',
    '8a: con el nº de personas bien, lo que falta es solo el teléfono (' || coalesce(v_err, 'sin error') || ')');

  -- ── 9. Permisos intactos: sin sesión no se puede enviar ───────────────────────────────────────
  PERFORM pg_temp.as_user(NULL);
  PERFORM pg_temp.check_that(NOT has_function_privilege('anon', 'public.submit_gardener_application()', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.submit_gardener_application()', 'EXECUTE'),
    '9a: anon no puede enviar, authenticated sí');
  PERFORM pg_temp.check_that(pg_temp.error_of('SELECT public.submit_gardener_application()') LIKE '%Inicia sesión%',
    '9b: sin sesión pide iniciar sesión');

  RAISE WARNING 'TODAS LAS COMPROBACIONES OK';
END
$prueba$;

ROLLBACK;
