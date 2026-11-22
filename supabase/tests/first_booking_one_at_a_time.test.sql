-- QA-100 (decisión del dueño, 2026-11-17): la tarifa de «primera reserva» vale para UNA sola reserva a la
-- vez por cliente y profesional. Si esa reserva no se completa (cancelada, rechazada o caducada) vuelve a
-- estar disponible; nunca dos reservas vivas a la vez con tarifa de primera. Una reserva con varios
-- servicios es una sola fila de bookings, así que cuenta como una.
--
-- Migración que lo implementa: 20261117150000_first_booking_one_at_a_time.sql
--
--   docker exec -i <contenedor_db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/first_booking_one_at_a_time.test.sql
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

CREATE FUNCTION pg_temp.base_econ(p_gross numeric) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'currency', 'EUR', 'taxRate', 0.21,
    'serviceGrossTotal', p_gross,
    'serviceNetSubtotal', round(p_gross / 1.21, 2),
    'serviceTaxAmount', round(p_gross - p_gross / 1.21, 2),
    'managementFee', 0, 'payableNow', 0, 'payableLater', p_gross,
    'lines', jsonb_build_array(
      jsonb_build_object('code', 'service_line_1', 'label', 'Corte de césped', 'amount', p_gross, 'kind', 'service'),
      jsonb_build_object('code', 'service_subtotal', 'label', 'Subtotal del servicio', 'amount', round(p_gross / 1.21, 2), 'kind', 'service'),
      jsonb_build_object('code', 'service_tax', 'label', 'IVA del servicio', 'amount', round(p_gross - p_gross / 1.21, 2), 'kind', 'tax')
    ),
    'stripeLineItems', '[]'::jsonb
  )
$$;

-- Crea una reserva con la economía firmada `e` (como la crea el servidor tras el pago).
CREATE FUNCTION pg_temp.book(p_client uuid, p_pro uuid, p_service uuid, p_day integer, p_status text, e jsonb)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.bookings (id, client_id, gardener_id, service_id, date, start_time, duration_hours, status,
    total_price, client_address, pricing_context)
  VALUES (v_id, p_client, p_pro, p_service, current_date + p_day, '09:00', 2, p_status,
    (e ->> 'serviceGrossTotal')::numeric, 'Calle 1',
    jsonb_build_object('payable_now_amount_cents', round((e ->> 'payableNow')::numeric * 100)::integer,
                       'quote_economic_snapshot', e));
  RETURN v_id;
END $$;

-- Cambia el estado sin pasar por la máquina de estados (solo hace falta el dato).
CREATE FUNCTION pg_temp.set_status(p_booking uuid, p_status text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  UPDATE public.bookings SET status = p_status WHERE id = p_booking;
  SET LOCAL session_replication_role = origin;
END $$;

DO $prueba$
DECLARE
  v_cli   uuid := '00000000-0f17-4c01-8fff-000000000001';
  v_cli2  uuid := '00000000-0f17-4c01-8fff-000000000002';
  v_pro   uuid := '00000000-0f17-4c01-8fff-000000000003';
  v_pro2  uuid := '00000000-0f17-4c01-8fff-000000000004';
  v_code  text := '00112233445566778899aabbccddeeff';
  v_servicio uuid;
  r jsonb;
  e jsonb;
  e2 jsonb;
  v_b1 uuid;
  v_b2 uuid;
  v_quote uuid;
  v_status text;
BEGIN
  SELECT id INTO v_servicio FROM public.services ORDER BY name LIMIT 1;
  IF v_servicio IS NULL THEN
    RAISE EXCEPTION 'Faltan servicios: ejecuta `supabase db reset` antes de estas pruebas';
  END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  SELECT u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    u.email, 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', ''
  FROM (VALUES
    (v_cli, 'first1.cli@test.local'),
    (v_cli2, 'first1.cli2@test.local'),
    (v_pro, 'first1.pro@test.local'),
    (v_pro2, 'first1.pro2@test.local')
  ) AS u(id, email);
  UPDATE public.profiles SET role = 'gardener', full_name = 'Antonio Pruebas' WHERE user_id IN (v_pro, v_pro2);
  INSERT INTO public.provider_booking_links (provider_id, code) VALUES (v_pro, v_code);

  -- ── Cliente de GarSer ───────────────────────────────────────────────────────────
  r := public.resolve_booking_commission(v_cli, v_pro, NULL);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'garser_first' AND (r ->> 'isFirstBooking')::boolean
    AND COALESCE((r ->> 'firstRateInUse')::boolean, false) = false,
    'F1: sin reservas no es primera reserva: ' || r::text);

  e := public.quote_commission_economics(pg_temp.base_econ(100), v_cli, v_pro, NULL);
  v_b1 := pg_temp.book(v_cli, v_pro, v_servicio, 30, 'pending', e);

  -- Con la primera aún pendiente, la segunda NO lleva tarifa de primera, y se dice por qué.
  FOREACH v_status IN ARRAY ARRAY['pending', 'confirmed', 'disputed'] LOOP
    PERFORM pg_temp.set_status(v_b1, v_status);
    r := public.resolve_booking_commission(v_cli, v_pro, NULL);
    PERFORM pg_temp.check_that(r ->> 'rule' = 'garser_repeat'
      AND NOT (r ->> 'isFirstBooking')::boolean
      AND (r ->> 'firstRateInUse')::boolean,
      format('F2: con la primera «%s», la segunda sigue llevando tarifa de primera: %s', v_status, r));
  END LOOP;

  -- La economía firmada lleva el motivo y sigue siendo coherente (no la rechaza el cinturón de los pagos).
  e2 := public.quote_commission_economics(pg_temp.base_econ(80), v_cli, v_pro, NULL);
  PERFORM pg_temp.check_that((e2 #>> '{commission,firstRateInUse}')::boolean
    AND public.commission_snapshot_problem(e2) IS NULL,
    'F3: la economía de la segunda no lleva el motivo o no es coherente: ' || e2::text);

  -- El intento de pago de la segunda (tarifa de «posterior» sin ninguna completada) se acepta…
  INSERT INTO public.booking_quotes (client_id, gardener_id, service_id, signature, pricing_version,
    provider_config_version, input_payload, pricing_snapshot, total_price, estimated_hours, status,
    generated_at, expires_at, selected_date, selected_start_time, economic_snapshot)
  VALUES (v_cli, v_pro, v_servicio, 'first-test-' || gen_random_uuid(), 'booking_quote_v1',
    'cfg', '{}'::jsonb, '{}'::jsonb, 80, 2, 'active', now(), now() + interval '2 hours',
    current_date + 31, '09:00', e2)
  RETURNING id INTO v_quote;
  BEGIN
    INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
      selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
      stripe_idempotency_key, economic_snapshot)
    VALUES (v_cli, v_pro, v_servicio, v_quote, 'sig', current_date + 31, '09:00', 2, 8000,
      round((e2 ->> 'payableNow')::numeric * 100)::integer, gen_random_uuid()::text, e2);
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'FALLO F4: el pago de la segunda reserva (tarifa de posterior) se rechaza: %', SQLERRM;
  END;
  -- …y el de una segunda con tarifa de PRIMERA (presupuesto viejo o escritura directa) no.
  BEGIN
    INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
      selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
      stripe_idempotency_key, economic_snapshot)
    VALUES (v_cli, v_pro, v_servicio, v_quote, 'sig', current_date + 32, '09:00', 2, 10000,
      round((e ->> 'payableNow')::numeric * 100)::integer, gen_random_uuid()::text, e);
    RAISE EXCEPTION 'FALLO F5: se ha creado un pago con tarifa de primera teniendo otra en curso';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Dos reservas vivas con tarifa de primera NO pueden existir (dos pagos simultáneos).
  PERFORM pg_temp.set_status(v_b1, 'pending');
  BEGIN
    PERFORM pg_temp.book(v_cli, v_pro, v_servicio, 33, 'pending', e);
    RAISE EXCEPTION 'FALLO F6: se han guardado dos reservas vivas con tarifa de primera';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  -- La de «posterior» sí convive con la primera.
  v_b2 := pg_temp.book(v_cli, v_pro, v_servicio, 34, 'pending', e2);
  PERFORM pg_temp.check_that((SELECT commission_rule FROM public.bookings WHERE id = v_b2) = 'garser_repeat',
    'F7: la segunda reserva no queda con la tarifa de posterior');

  -- Si la primera no se completa, la tarifa de primera vuelve a estar disponible.
  FOREACH v_status IN ARRAY ARRAY['cancelled', 'expired', 'no_show_gardener'] LOOP
    PERFORM pg_temp.set_status(v_b1, v_status);
    r := public.resolve_booking_commission(v_cli, v_pro, NULL);
    PERFORM pg_temp.check_that(r ->> 'rule' = 'garser_first' AND (r ->> 'isFirstBooking')::boolean
      AND NOT COALESCE((r ->> 'firstRateInUse')::boolean, false),
      format('F8: con la primera «%s», la tarifa de primera no vuelve: %s', v_status, r));
  END LOOP;
  -- Y con la primera cancelada se puede guardar otra de primera (el índice solo mira las vivas).
  PERFORM pg_temp.book(v_cli, v_pro, v_servicio, 35, 'pending', e);

  -- Completada: ya es cliente que repite, sin el aviso de «en curso».
  PERFORM pg_temp.set_status(v_b1, 'completed');
  -- (la de primera recién creada sigue viva, pero hay una completada: manda «posterior»)
  r := public.resolve_booking_commission(v_cli, v_pro, NULL);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'garser_repeat' AND NOT COALESCE((r ->> 'firstRateInUse')::boolean, false),
    'F9: con una completada la regla no es «posterior» o dice «en curso»: ' || r::text);

  -- Otro profesional no se ve afectado.
  r := public.resolve_booking_commission(v_cli, v_pro2, NULL);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'garser_first', 'F10: la reserva con otro profesional se ve afectada: ' || r::text);

  -- La visita de un plan sigue con su regla.
  r := public.resolve_booking_commission(v_cli2, v_pro, NULL, true);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'maintenance_visit', 'F11: la visita de plan cambia de regla: ' || r::text);

  -- ── Cliente del enlace (con la clave buena) ────────────────────────────────────
  r := public.resolve_booking_commission(v_cli2, v_pro, 'provider_link', p_link_code => v_code);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'link_first', 'F12: la primera por enlace no es link_first: ' || r::text);
  e := public.quote_commission_economics(pg_temp.base_econ(180), v_cli2, v_pro, 'provider_link', p_link_code => v_code);
  v_b1 := pg_temp.book(v_cli2, v_pro, v_servicio, 40, 'pending', e);
  -- La segunda, desde cualquier dispositivo y SIN clave: sigue siendo cliente del enlace (relación fijada),
  -- pero no de primera mientras la primera esté en curso.
  r := public.resolve_booking_commission(v_cli2, v_pro, NULL);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'link_repeat' AND r ->> 'origin' = 'provider_link'
    AND (r ->> 'firstRateInUse')::boolean,
    'F13: la segunda del cliente del enlace no es link_repeat con el motivo: ' || r::text);
  e2 := public.quote_commission_economics(pg_temp.base_econ(60), v_cli2, v_pro, NULL);
  PERFORM pg_temp.check_that(public.commission_snapshot_problem(e2) IS NULL,
    'F14: la economía de la segunda del enlace no es coherente: ' || e2::text);
  BEGIN
    PERFORM pg_temp.book(v_cli2, v_pro, v_servicio, 41, 'confirmed', e);
    RAISE EXCEPTION 'FALLO F15: dos reservas vivas con link_first';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  PERFORM pg_temp.set_status(v_b1, 'cancelled');
  r := public.resolve_booking_commission(v_cli2, v_pro, NULL);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'link_first', 'F16: tras cancelar, el enlace no vuelve a primera: ' || r::text);

  RAISE NOTICE 'TODAS LAS COMPROBACIONES OK (primera reserva, una a la vez)';
END
$prueba$;

ROLLBACK;
