-- QA-127: la propuesta de visita de un plan de mantenimiento no debe caer en un hueco en el que el CLIENTE ya
-- tiene otra reserva (con otro profesional) ni en uno que está pagando.
--
-- Migración: 20261119130000_maintenance_slot_client_conflicts.sql
-- Usa a «Antonio Ruiz QA» (cbb98344-…) y a «Miguel Ángel» (11111111-…) de los datos locales de prueba.
--
--   docker exec -i <contenedor_db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/maintenance_slot_client_conflict.test.sql
--
-- Todo dentro de una transacción que se revierte. «FALLO <id>» = la regla no se cumple.

BEGIN;
SET client_min_messages = WARNING;

CREATE FUNCTION pg_temp.check_that(p_ok boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FALLO %', p_msg; END IF;
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

CREATE FUNCTION pg_temp.new_booking(p_client uuid, p_pro uuid, p_service uuid, p_date date, p_hour int, p_hours int, p_status text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.bookings (client_id, gardener_id, service_id, date, start_time, end_time, duration_hours,
    status, total_price, client_address, management_fee, management_fee_source)
  VALUES (p_client, p_pro, p_service, p_date, make_time(p_hour, 0, 0), make_time(p_hour + p_hours, 0, 0), p_hours,
    p_status, 50, 'Calle de prueba 1, Marbella', 0, 'unknown')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION pg_temp.new_attempt(p_client uuid, p_pro uuid, p_service uuid, p_date date, p_hour int, p_hours int)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_quote uuid; v_att uuid;
BEGIN
  INSERT INTO public.booking_quotes (client_id, gardener_id, service_id, signature, pricing_version,
    provider_config_version, input_payload, pricing_snapshot, total_price, estimated_hours, status,
    generated_at, expires_at, selected_date, selected_start_time)
  VALUES (p_client, p_pro, p_service, 'conflicto-test-' || gen_random_uuid(), 'booking_quote_v1',
    'cfg', '{}'::jsonb, '{}'::jsonb, 50, p_hours, 'active', now(), now() + interval '2 hours',
    p_date, make_time(p_hour, 0, 0))
  RETURNING id INTO v_quote;
  INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
    selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
    stripe_idempotency_key)
  VALUES (p_client, p_pro, p_service, v_quote, 'sig', p_date, make_time(p_hour, 0, 0), p_hours, 5000, 625,
    gen_random_uuid()::text)
  RETURNING id INTO v_att;
  RETURN v_att;
END $$;

DO $prueba$
DECLARE
  v_cli  uuid := '00000000-0b27-4a01-8aaa-000000000001';
  v_cli2 uuid := '00000000-0b27-4a01-8aaa-000000000002';
  v_antonio uuid := 'cbb98344-f9a1-462c-b691-ee15067e4b99';
  v_miguel  uuid := '11111111-aaaa-4aaa-8aaa-111111111111';
  v_lawn uuid;
  v_plan uuid;
  v_day date;
  v_base record;
  v_next record;
  v_b uuid;
  v_hold uuid;
  v_att uuid;
  v_real_plan uuid;
  v_real_client uuid;
BEGIN
  SELECT id INTO v_lawn FROM public.services WHERE name = 'Corte de césped';
  PERFORM pg_temp.new_user(v_cli,  'conflicto-visita@test.local');
  PERFORM pg_temp.new_user(v_cli2, 'conflicto-visita2@test.local');

  -- Un día laborable cualquiera de la próxima semana y media, con hueco para el plan.
  INSERT INTO public.maintenance_plans (client_id, provider_id, frequency, start_hour, anchor_date, next_visit_date,
    service_id, items, total_price, estimated_hours, pricing_version, provider_config_version)
  VALUES (v_cli, v_antonio, 'weekly', 9, current_date + 4, current_date + 4, v_lawn, NULL, 90, 2, 'v', 'v')
  RETURNING id INTO v_plan;

  FOR i IN 4 .. 12 LOOP
    v_day := current_date + i;
    CONTINUE WHEN EXTRACT(ISODOW FROM v_day) > 5;
    SELECT * INTO v_base FROM public.maintenance_find_slot(v_plan, v_day);
    EXIT WHEN v_base.slot_date IS NOT NULL;
  END LOOP;
  PERFORM pg_temp.check_that(v_base.slot_date IS NOT NULL, '0: precondición: Antonio tiene hueco para el plan en los próximos días (datos locales de prueba)');
  v_day := v_base.slot_date;

  -- 1. Sin otras reservas del cliente, la propuesta cae en su hora preferida.
  PERFORM pg_temp.check_that(v_base.slot_hour = 9, '1: sin conflictos, la visita cae a la hora del plan (' || v_base.slot_hour || ')');

  -- 2. El cliente ya tiene una reserva PENDIENTE con OTRO profesional en ese hueco: se salta.
  v_b := pg_temp.new_booking(v_cli, v_miguel, v_lawn, v_base.slot_date, v_base.slot_hour, v_base.first_day_hours, 'pending');
  SELECT * INTO v_next FROM public.maintenance_find_slot(v_plan, v_day);
  PERFORM pg_temp.check_that(v_next.slot_date IS NOT NULL, '2a: sigue habiendo otro hueco');
  PERFORM pg_temp.check_that(NOT (v_next.slot_date = v_base.slot_date AND v_next.slot_hour < v_base.slot_hour + v_base.first_day_hours
                                   AND v_next.slot_hour + v_next.first_day_hours > v_base.slot_hour),
    '2b: la visita propuesta NO se solapa con la otra reserva del cliente (' || v_next.slot_date || ' ' || v_next.slot_hour || ' h)');

  -- 3. Confirmada o en disputa también cuenta; cancelada o caducada, no.
  UPDATE public.bookings SET status = 'confirmed' WHERE id = v_b;
  SELECT * INTO v_next FROM public.maintenance_find_slot(v_plan, v_day);
  PERFORM pg_temp.check_that(NOT (v_next.slot_date = v_base.slot_date AND v_next.slot_hour = v_base.slot_hour), '3a: confirmada también bloquea');
  UPDATE public.bookings SET status = 'cancelled' WHERE id = v_b;
  SELECT * INTO v_next FROM public.maintenance_find_slot(v_plan, v_day);
  PERFORM pg_temp.check_that(v_next.slot_date = v_base.slot_date AND v_next.slot_hour = v_base.slot_hour, '3b: cancelada no bloquea: vuelve el hueco de antes');
  v_b := pg_temp.new_booking(v_cli, v_miguel, v_lawn, v_base.slot_date, v_base.slot_hour, v_base.first_day_hours, 'pending');
  UPDATE public.bookings SET status = 'expired' WHERE id = v_b;
  SELECT * INTO v_next FROM public.maintenance_find_slot(v_plan, v_day);
  PERFORM pg_temp.check_that(v_next.slot_date = v_base.slot_date AND v_next.slot_hour = v_base.slot_hour, '3c: caducada no bloquea');

  -- 4. La reserva de OTRO cliente en ese hueco (con otro profesional) no afecta a este plan.
  PERFORM pg_temp.new_booking(v_cli2, v_miguel, v_lawn, v_base.slot_date, v_base.slot_hour, v_base.first_day_hours, 'pending');
  SELECT * INTO v_next FROM public.maintenance_find_slot(v_plan, v_day);
  PERFORM pg_temp.check_that(v_next.slot_date = v_base.slot_date AND v_next.slot_hour = v_base.slot_hour, '4: la reserva de otra persona no cuenta');

  -- 5. Un pago en curso del cliente (retención activa) en ese hueco también cuenta.
  v_att := pg_temp.new_attempt(v_cli, v_miguel, v_lawn, v_base.slot_date, v_base.slot_hour, v_base.first_day_hours);
  SELECT id INTO v_hold FROM public.booking_schedule_holds WHERE payment_attempt_id = v_att;
  IF v_hold IS NULL THEN
    INSERT INTO public.booking_schedule_holds (payment_attempt_id, quote_id, client_id, gardener_id, service_id, selected_date, selected_start_time, duration_hours, status, expires_at)
    VALUES (v_att, (SELECT quote_id FROM public.booking_payment_attempts WHERE id = v_att), v_cli, v_miguel, v_lawn, v_base.slot_date, make_time(v_base.slot_hour, 0, 0), v_base.first_day_hours, 'active', now() + interval '30 minutes')
    RETURNING id INTO v_hold;
  END IF;
  SELECT * INTO v_next FROM public.maintenance_find_slot(v_plan, v_day);
  PERFORM pg_temp.check_that(NOT (v_next.slot_date = v_base.slot_date AND v_next.slot_hour = v_base.slot_hour), '5a: un pago en curso del cliente bloquea el hueco');
  UPDATE public.booking_schedule_holds SET expires_at = now() - interval '1 minute' WHERE id = v_hold;
  SELECT * INTO v_next FROM public.maintenance_find_slot(v_plan, v_day);
  PERFORM pg_temp.check_that(v_next.slot_date = v_base.slot_date AND v_next.slot_hour = v_base.slot_hour, '5b: caducada la retención, el hueco vuelve');

  -- 6. De punta a punta con el generador real de propuestas (con el plan semilla de los datos locales, que
  --    tiene su economía bien formada): la visita propuesta no choca con la reserva del cliente.
  UPDATE public.maintenance_plans SET status = 'cancelled' WHERE id = v_plan;  -- el plan de pruebas de arriba no tiene economía
  SELECT id, client_id INTO v_real_plan, v_real_client FROM public.maintenance_plans WHERE id <> v_plan ORDER BY created_at LIMIT 1;
  PERFORM pg_temp.check_that(v_real_plan IS NOT NULL, '6-0: precondición: hay un plan semilla en los datos locales');
  DELETE FROM public.maintenance_visits WHERE plan_id = v_real_plan;
  UPDATE public.maintenance_plans SET status = 'active', next_visit_date = current_date + 4 WHERE id = v_real_plan;
  SELECT * INTO v_base FROM public.maintenance_find_slot(v_real_plan, current_date + 4);
  PERFORM pg_temp.check_that(v_base.slot_date IS NOT NULL, '6-1: precondición: el plan semilla tiene hueco');
  PERFORM pg_temp.new_booking(v_real_client, v_miguel, v_lawn, v_base.slot_date, v_base.slot_hour, v_base.first_day_hours, 'pending');
  PERFORM public.generate_maintenance_proposals();
  SELECT * INTO v_next FROM public.maintenance_visits WHERE plan_id = v_real_plan AND status = 'proposed';
  PERFORM pg_temp.check_that(v_next.id IS NOT NULL, '6a: el generador propone una visita');
  PERFORM pg_temp.check_that(NOT (v_next.date = v_base.slot_date AND v_next.start_hour < v_base.slot_hour + v_base.first_day_hours
                                   AND v_next.start_hour + 2 > v_base.slot_hour),
    '6b: la visita propuesta (' || v_next.date || ' ' || v_next.start_hour || ' h) no choca con la reserva del cliente (' || v_base.slot_date || ' ' || v_base.slot_hour || ' h)');

  RAISE NOTICE 'TODAS LAS COMPROBACIONES OK';
END
$prueba$;

ROLLBACK;
