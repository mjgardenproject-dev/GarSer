-- QA-014: la foto y el nombre dados en el alta pasan al perfil al APROBAR (antes el profesional aprobado
-- figuraba «sin foto», sin nombre en «Mi cuenta», y los clientes no veían su foto).
--
-- Migración: 20261119120000_approval_photo_name.sql
--
--   docker exec -i <contenedor_db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/approval_photo_name.test.sql
--
-- Todo dentro de una transacción que se revierte. «FALLO <id>» = la regla no se cumple.

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

CREATE FUNCTION pg_temp.new_user(p_id uuid, p_email text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  VALUES (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    p_email, 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
END $$;

DO $prueba$
DECLARE
  v_admin uuid := '00000000-0a14-4d01-8aaa-000000000001';
  v_con   uuid := '00000000-0a14-4d01-8aaa-000000000002';  -- con foto en el alta
  v_sin   uuid := '00000000-0a14-4d01-8aaa-000000000003';  -- sin foto en el alta
  v_prev  uuid := '00000000-0a14-4d01-8aaa-000000000004';  -- ya tenía foto y nombre propios
  v_emp   uuid := '00000000-0a14-4d01-8aaa-000000000005';  -- empresa con logo
  v_a1 uuid; v_a2 uuid; v_a3 uuid; v_a4 uuid;
BEGIN
  PERFORM pg_temp.new_user(v_admin, 'foto-admin@test.local');
  PERFORM pg_temp.new_user(v_con,   'foto-con@test.local');
  PERFORM pg_temp.new_user(v_sin,   'foto-sin@test.local');
  PERFORM pg_temp.new_user(v_prev,  'foto-prev@test.local');
  PERFORM pg_temp.new_user(v_emp,   'foto-emp@test.local');
  UPDATE public.profiles SET role = 'admin' WHERE user_id = v_admin;
  UPDATE public.profiles SET role = 'gardener' WHERE user_id IN (v_con, v_sin, v_prev);
  UPDATE public.profiles SET role = 'company' WHERE user_id = v_emp;
  -- v_prev: la persona ya puso su foto y su nombre en «Mi cuenta» antes de la aprobación.
  UPDATE public.profiles SET full_name = 'Nombre Propio', avatar_url = 'https://example.com/propia.jpg' WHERE user_id = v_prev;

  INSERT INTO public.gardener_applications (user_id, status, full_name, phone, city_zone, professional_photo_url,
    services, tools_available, experience_years, experience_description, declaration_truth, accept_terms)
  VALUES (v_con, 'submitted', 'Rosa Con Foto', '600000001', 'Marbella', 'https://example.com/alta-rosa.jpg',
    ARRAY['Corte de césped'], ARRAY['Cortacésped'], 4, 'x', true, true) RETURNING id INTO v_a1;
  INSERT INTO public.gardener_applications (user_id, status, full_name, phone, city_zone, professional_photo_url,
    services, tools_available, experience_years, experience_description, declaration_truth, accept_terms)
  VALUES (v_sin, 'submitted', 'Pepe Sin Foto', '600000002', 'Marbella', NULL,
    ARRAY['Corte de césped'], ARRAY['Cortacésped'], 4, 'x', true, true) RETURNING id INTO v_a2;
  INSERT INTO public.gardener_applications (user_id, status, full_name, phone, city_zone, professional_photo_url,
    services, tools_available, experience_years, experience_description, declaration_truth, accept_terms)
  VALUES (v_prev, 'submitted', 'Nombre Del Alta', '600000003', 'Marbella', 'https://example.com/alta-prev.jpg',
    ARRAY['Corte de césped'], ARRAY['Cortacésped'], 4, 'x', true, true) RETURNING id INTO v_a3;
  INSERT INTO public.company_applications (user_id, status, commercial_name, legal_name, tax_id, logo_url, phone, address, city_zone, owner_works)
  VALUES (v_emp, 'submitted', 'Jardines Sol', 'Jardines Sol SL', 'B12345678', 'https://example.com/logo.png', '600000004', 'Calle 1', 'Marbella', true)
  RETURNING id INTO v_a4;

  PERFORM pg_temp.as_user(v_admin);
  PERFORM public.admin_review_gardener_application(v_a1, 'approved', NULL);
  PERFORM public.admin_review_gardener_application(v_a2, 'approved', NULL);
  PERFORM public.admin_review_gardener_application(v_a3, 'approved', NULL);
  PERFORM public.admin_review_company_application(v_a4, 'approved', NULL);

  -- 1. Con foto en el alta: la ven los clientes y cuenta como «tiene foto»; el nombre llega a «Mi cuenta».
  PERFORM pg_temp.check_that((SELECT avatar_url FROM public.gardener_profiles WHERE user_id = v_con) = 'https://example.com/alta-rosa.jpg',
    '1a: la foto del alta es la foto de perfil que ven los clientes (gardener_profiles.avatar_url)');
  PERFORM pg_temp.check_that((SELECT avatar_url FROM public.profiles WHERE user_id = v_con) = 'https://example.com/alta-rosa.jpg',
    '1b: y la de «Mi cuenta» (profiles.avatar_url)');
  PERFORM pg_temp.check_that((SELECT full_name FROM public.profiles WHERE user_id = v_con) = 'Rosa Con Foto',
    '1c: el nombre del alta llega a profiles.full_name');
  PERFORM pg_temp.check_that((SELECT (public.provider_setup_status(v_con) -> 'profile' ->> 'has_photo')::boolean),
    '1d: el estado «Completa tu cuenta» ya no dice «sin foto»');

  -- 2. Sin foto en el alta: no se inventa ninguna.
  PERFORM pg_temp.check_that((SELECT NULLIF(avatar_url, '') FROM public.gardener_profiles WHERE user_id = v_sin) IS NULL,
    '2a: sin foto en el alta, sigue sin foto');
  PERFORM pg_temp.check_that((SELECT full_name FROM public.profiles WHERE user_id = v_sin) = 'Pepe Sin Foto',
    '2b: pero el nombre sí llega');

  -- 3. Lo que la persona ya tenía en «Mi cuenta» NO se pisa.
  PERFORM pg_temp.check_that((SELECT avatar_url FROM public.profiles WHERE user_id = v_prev) = 'https://example.com/propia.jpg',
    '3a: su foto propia de «Mi cuenta» se respeta');
  PERFORM pg_temp.check_that((SELECT full_name FROM public.profiles WHERE user_id = v_prev) = 'Nombre Propio',
    '3b: su nombre propio se respeta');

  -- 4. Empresa: el logo del alta es su foto.
  PERFORM pg_temp.check_that((SELECT avatar_url FROM public.gardener_profiles WHERE user_id = v_emp) = 'https://example.com/logo.png',
    '4a: el logo del alta es la foto de la empresa para los clientes');
  PERFORM pg_temp.check_that((SELECT full_name FROM public.profiles WHERE user_id = v_emp) = 'Jardines Sol',
    '4b: el nombre comercial llega a «Mi cuenta»');

  RAISE NOTICE 'TODAS LAS COMPROBACIONES OK';
END
$prueba$;

ROLLBACK;
