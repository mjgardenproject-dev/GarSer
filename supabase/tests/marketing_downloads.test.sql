-- Pruebas de la medición del marketing (migración 20261020130000). En una transacción que se
-- revierte; si termina con "TODAS LAS COMPROBACIONES OK", todo se cumple.
--
--   docker exec -i <contenedor_db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/marketing_downloads.test.sql

BEGIN;

SET client_min_messages = WARNING;

DO $prueba$
DECLARE
  v_pro     uuid := '00000000-3a7e-4bee-8aaa-000000000001';
  v_cliente uuid := '00000000-3a7e-4bee-8aaa-000000000002';
  v_admin   uuid := '00000000-3a7e-4bee-8aaa-000000000003';
  v_n       integer;
  v_ok      boolean;
  v_row     jsonb;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  SELECT u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    u.email, 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', ''
  FROM (VALUES
    (v_pro, 'mk.pro@test.local'),
    (v_cliente, 'mk.cliente@test.local'),
    (v_admin, 'mk.admin@test.local')
  ) AS u(id, email);
  UPDATE public.profiles SET role = 'gardener' WHERE user_id = v_pro;
  UPDATE public.profiles SET role = 'admin' WHERE user_id = v_admin;
  INSERT INTO public.gardener_profiles (user_id, full_name, phone, address) VALUES (v_pro, 'Pro Marketing', '600000000', 'Marbella');

  -- 1. El profesional apunta lo suyo (sin repetir formatos ni vacíos).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pro)::text, true);
  v_n := public.log_marketing_download('social', ARRAY['portrait', 'story', 'portrait', ' ']);
  IF v_n <> 2 OR (SELECT count(*) FROM public.marketing_downloads WHERE provider_id = v_pro) <> 2 THEN
    RAISE EXCEPTION 'FALLO 1: no se apuntan los dos formatos distintos (%)', v_n;
  END IF;

  -- 2. Material desconocido o sin formatos: error.
  v_ok := false;
  BEGIN
    PERFORM public.log_marketing_download('valla_publicitaria', ARRAY['a3']);
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALLO 2a: un material desconocido se apunta'; END IF;
  v_ok := false;
  BEGIN
    PERFORM public.log_marketing_download('social', ARRAY[]::text[]);
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALLO 2b: sin formatos se apunta'; END IF;

  -- 3. Un cliente (sin ficha de profesional) no puede apuntar nada.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cliente)::text, true);
  v_ok := false;
  BEGIN
    PERFORM public.log_marketing_download('social', ARRAY['portrait']);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALLO 3: un cliente apunta descargas'; END IF;

  -- 4. El admin ve el resumen.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  SELECT x -> 'marketing' INTO v_row FROM jsonb_array_elements(public.admin_provider_setup_overview()) x WHERE x ->> 'user_id' = v_pro::text;
  IF (v_row ->> 'downloads')::int <> 2 OR v_row -> 'materials' <> '["social"]'::jsonb OR v_row ->> 'last_at' IS NULL THEN
    RAISE EXCEPTION 'FALLO 4: el admin no ve el resumen esperado: %', v_row;
  END IF;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- 5. Nadie lee ni escribe la tabla directamente.
  IF has_table_privilege('authenticated', 'public.marketing_downloads', 'SELECT')
     OR has_table_privilege('authenticated', 'public.marketing_downloads', 'INSERT')
     OR has_table_privilege('anon', 'public.marketing_downloads', 'SELECT')
     OR has_function_privilege('anon', 'public.log_marketing_download(text, text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALLO 5: la tabla o la función están abiertas a quien no toca';
  END IF;

  RAISE WARNING 'TODAS LAS COMPROBACIONES OK';
END
$prueba$;

ROLLBACK;
