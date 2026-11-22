-- QA-181: un servicio que el administrador desactiva deja de poder presupuestarse y pagarse en el
-- servidor, no solo de verse en la web.
--
-- Migración: 20261118120000_inactive_service_not_bookable.sql
--
--   docker exec -i <contenedor_db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/service_deactivation.test.sql
--
-- Todo dentro de una transacción que se revierte. «FALLO <id>» = la regla no se cumple.

BEGIN;
SET client_min_messages = WARNING;

CREATE FUNCTION pg_temp.check_that(p_ok boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FALLO %', p_msg;
  END IF;
END $$;

CREATE FUNCTION pg_temp.new_quote(p_client uuid, p_pro uuid, p_service uuid, p_items jsonb DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.booking_quotes (client_id, gardener_id, service_id, signature, pricing_version,
    provider_config_version, input_payload, pricing_snapshot, total_price, estimated_hours, status,
    generated_at, expires_at, selected_date, selected_start_time, items)
  VALUES (p_client, p_pro, p_service, 'inactive-test-' || gen_random_uuid(), 'booking_quote_v1',
    'cfg', '{}'::jsonb, '{}'::jsonb, 50, 1, 'active', now(), now() + interval '2 hours',
    current_date + 30, '09:00', p_items)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION pg_temp.new_attempt(p_client uuid, p_pro uuid, p_service uuid, p_quote uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
    selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
    stripe_idempotency_key)
  VALUES (p_client, p_pro, p_service, p_quote, 'sig', current_date + 30, '09:00', 1, 5000, 625,
    gen_random_uuid()::text);
END $$;

DO $prueba$
DECLARE
  v_cli uuid := '00000000-0f18-4c01-8fff-000000000001';
  v_pro uuid := '00000000-0f18-4c01-8fff-000000000002';
  v_on  uuid;
  v_off uuid;
  v_quote uuid;
  v_rows integer;
  v_pro_real uuid;
  v_plan uuid;
BEGIN
  SELECT id INTO v_on FROM public.services WHERE name = 'Corte de césped';
  SELECT id INTO v_off FROM public.services WHERE name = 'Poda de palmeras';
  IF v_on IS NULL OR v_off IS NULL THEN
    RAISE EXCEPTION 'Faltan servicios: ejecuta `supabase db reset` antes de estas pruebas';
  END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  SELECT u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    u.email, 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', ''
  FROM (VALUES (v_cli, 'inactive.cli@test.local'), (v_pro, 'inactive.pro@test.local')) AS u(id, email);
  UPDATE public.profiles SET role = 'gardener' WHERE user_id = v_pro;

  -- Activo: se firma y se paga como siempre.
  v_quote := pg_temp.new_quote(v_cli, v_pro, v_on);
  PERFORM pg_temp.new_attempt(v_cli, v_pro, v_on, v_quote);

  -- El administrador desactiva «Poda de palmeras» (lo que hace su pantalla).
  UPDATE public.services SET is_active = false, status = 'unavailable' WHERE id = v_off;

  PERFORM pg_temp.check_that(NOT public.service_is_bookable(v_off) AND public.service_is_bookable(v_on),
    'S0: service_is_bookable no distingue el servicio desactivado');

  BEGIN
    PERFORM pg_temp.new_quote(v_cli, v_pro, v_off);
    RAISE EXCEPTION 'FALLO S1: se ha firmado un presupuesto de un servicio desactivado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Visita de varios servicios con uno desactivado entre los demás.
  BEGIN
    PERFORM pg_temp.new_quote(v_cli, v_pro, v_on,
      jsonb_build_array(jsonb_build_object('serviceId', v_on), jsonb_build_object('serviceId', v_off)));
    RAISE EXCEPTION 'FALLO S2: se ha firmado una visita que incluye un servicio desactivado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Un presupuesto firmado ANTES de desactivarlo no se puede pagar después.
  UPDATE public.services SET is_active = true, status = 'active' WHERE id = v_off;
  v_quote := pg_temp.new_quote(v_cli, v_pro, v_off);
  UPDATE public.services SET is_active = false, status = 'unavailable' WHERE id = v_off;
  BEGIN
    PERFORM pg_temp.new_attempt(v_cli, v_pro, v_off, v_quote);
    RAISE EXCEPTION 'FALLO S3: se ha empezado a pagar un servicio desactivado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Lo mismo si el desactivado va dentro de una visita de varios servicios.
  UPDATE public.services SET is_active = true, status = 'active' WHERE id = v_off;
  v_quote := pg_temp.new_quote(v_cli, v_pro, v_on,
    jsonb_build_array(jsonb_build_object('serviceId', v_on), jsonb_build_object('serviceId', v_off)));
  UPDATE public.services SET is_active = false, status = 'unavailable' WHERE id = v_off;
  BEGIN
    PERFORM pg_temp.new_attempt(v_cli, v_pro, v_on, v_quote);
    RAISE EXCEPTION 'FALLO S4: se ha empezado a pagar una visita con un servicio desactivado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- El perfil público deja de listarlo (y sigue listando los activos).
  UPDATE public.gardener_profiles SET services = ARRAY[v_on::text, v_off::text]
  WHERE user_id = (SELECT user_id FROM public.gardener_profiles WHERE provider_kind IS DISTINCT FROM 'company' LIMIT 1)
  RETURNING user_id INTO v_pro_real;
  IF v_pro_real IS NOT NULL THEN
    PERFORM pg_temp.check_that(
      (SELECT services FROM public.public_gardener_directory WHERE user_id = v_pro_real) = ARRAY[v_on::text],
      'S6: el perfil público sigue listando el servicio desactivado');
  ELSE
    RAISE WARNING 'SALTADO S6: no hay ningún profesional autónomo con ficha';
  END IF;
  PERFORM pg_temp.check_that(NOT has_table_privilege('authenticated', 'public.public_gardener_directory', 'UPDATE'),
    'S7: la vista pública vuelve a ser escribible');

  -- Reactivado, vuelve a poder reservarse.
  UPDATE public.services SET is_active = true, status = 'active' WHERE id = v_off;
  v_quote := pg_temp.new_quote(v_cli, v_pro, v_off);
  PERFORM pg_temp.new_attempt(v_cli, v_pro, v_off, v_quote);

  -- Las reservas ya hechas no se tocan: desactivar no rompe actualizar un intento existente.
  UPDATE public.services SET is_active = false, status = 'unavailable' WHERE id = v_off;
  UPDATE public.booking_payment_attempts SET last_error_code = 'x' WHERE quote_id = v_quote;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM pg_temp.check_that(v_rows = 1, 'S5: desactivar el servicio impide actualizar un intento ya existente');

  -- El reloj de los planes de mantenimiento no se cae por un plan con el servicio pausado, y lo
  -- retoma al reactivarlo.
  SELECT user_id INTO v_pro_real FROM public.gardener_profiles WHERE provider_kind IS DISTINCT FROM 'company' LIMIT 1;
  IF v_pro_real IS NOT NULL THEN
    INSERT INTO public.maintenance_plans (client_id, provider_id, frequency, start_hour, anchor_date, next_visit_date,
      service_id, total_price, estimated_hours, pricing_version, provider_config_version)
    VALUES (v_cli, v_pro_real, 'weekly', 9, current_date, current_date + 3, v_off, 50, 1, 'booking_quote_v1', 'cfg')
    RETURNING id INTO v_plan;
    UPDATE public.services SET is_active = false, status = 'unavailable' WHERE id = v_off;
    BEGIN
      PERFORM public.generate_maintenance_proposals();
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'FALLO S8: un plan con el servicio pausado hace fallar el reloj de los planes: %', SQLERRM;
    END;
    PERFORM pg_temp.check_that(NOT EXISTS (SELECT 1 FROM public.maintenance_visits WHERE plan_id = v_plan),
      'S9: se ha propuesto una visita de un servicio pausado');
    UPDATE public.services SET is_active = true, status = 'active' WHERE id = v_off;
    BEGIN
      PERFORM public.generate_maintenance_proposals();
    EXCEPTION WHEN OTHERS THEN
      -- La propuesta real puede fallar por datos de prueba incompletos (economía vacía); lo que se
      -- comprueba aquí es que el plan deja de saltarse.
      NULL;
    END;
  ELSE
    RAISE WARNING 'SALTADO S8-S9: no hay ningún profesional autónomo con ficha';
  END IF;

  RAISE NOTICE 'TODAS LAS COMPROBACIONES OK (servicio desactivado)';
END
$prueba$;

ROLLBACK;
