-- Pruebas del progreso del cuestionario «Activa tu cuenta» (migración 20261111130000).
--   docker exec -i <contenedor_db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/activation_progress.test.sql
BEGIN;
SET client_min_messages = WARNING;

CREATE FUNCTION pg_temp.check_that(p_ok boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FALLO %', p_msg; END IF; END $$;
CREATE FUNCTION pg_temp.as_user(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN NULL ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END, true); END $$;
CREATE FUNCTION pg_temp.error_of(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

DO $prueba$
DECLARE
  v_pro uuid := '00000000-ac71-4e11-8bbb-000000000001';
  v_admin uuid;
  v_list jsonb;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  VALUES (v_pro, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'progreso.pro@test.local',
    'x', now(), now(), now(), '{}', '{}', '', '', '', '', '', '', '', '');
  UPDATE public.profiles SET role = 'gardener' WHERE user_id = v_pro;
  INSERT INTO public.gardener_profiles (user_id, full_name, phone, address) VALUES (v_pro, 'Pro Progreso', '600000009', 'Marbella');
  SELECT user_id INTO v_admin FROM public.profiles WHERE role = 'admin' LIMIT 1;

  PERFORM pg_temp.as_user(v_pro);
  PERFORM public.record_my_activation_step('service');
  PERFORM pg_temp.check_that((SELECT activation_step = 'service' AND activation_step_at IS NOT NULL FROM public.gardener_profiles WHERE user_id = v_pro),
    '1a: el profesional anota su paso');
  PERFORM pg_temp.check_that(pg_temp.error_of($q$SELECT public.record_my_activation_step('inventado')$q$) LIKE 'Paso no válido%',
    '1b: un paso inventado se rechaza');
  PERFORM pg_temp.check_that(pg_temp.error_of($q$SELECT public.admin_activation_progress()$q$) LIKE 'Solo para administradores%',
    '2a: un profesional no puede ver la lista');
  PERFORM pg_temp.as_user(NULL);
  PERFORM pg_temp.check_that(pg_temp.error_of($q$SELECT public.record_my_activation_step('zone')$q$) LIKE 'Inicia sesión%', '1c: sin sesión no');
  PERFORM pg_temp.check_that(NOT has_function_privilege('anon', 'public.record_my_activation_step(text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.admin_activation_progress()', 'EXECUTE'), '3a: anon no puede ejecutarlas');

  IF v_admin IS NOT NULL THEN
    PERFORM pg_temp.as_user(v_admin);
    v_list := public.admin_activation_progress();
    PERFORM pg_temp.check_that(EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) e WHERE e ->> 'provider_id' = v_pro::text AND e ->> 'step' = 'service'),
      '2b: el administrador ve en qué paso va');
  END IF;

  RAISE WARNING 'TODAS LAS COMPROBACIONES OK';
END
$prueba$;
ROLLBACK;
