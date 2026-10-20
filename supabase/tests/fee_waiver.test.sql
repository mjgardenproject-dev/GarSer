-- Pruebas de la exención de gastos de gestión del lanzamiento (migración 20261019120000).
--
-- Todo corre dentro de una transacción que se revierte al final: se puede lanzar contra una base
-- con datos sin ensuciarla:
--
--   docker exec -i <contenedor_db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/fee_waiver.test.sql
--
-- Cualquier comprobación que falle aborta con excepción. Si termina con
-- "TODAS LAS COMPROBACIONES OK", todo lo de abajo se cumple.
--
-- Va en SQL y no en vitest porque estas reglas deciden si a un cliente se le cobra o no, y viven
-- en PL/pgSQL y en restricciones de tabla: un doble en TypeScript no probaría lo que de verdad
-- ejecuta la base de datos.

BEGIN;

SET client_min_messages = WARNING;

DO $prueba$
DECLARE
  v_cliente   uuid := '00000000-fee0-4bee-8fff-000000000001';
  v_repite    uuid := '00000000-fee0-4bee-8fff-000000000002';
  v_jardinero uuid := '00000000-fee0-4bee-8fff-000000000003';
  v_servicio  uuid;
  v_quote     uuid;
  v_reserva   uuid;
  v_econ      jsonb := '{"currency":"EUR","taxRate":0.21,"serviceGrossTotal":100,"serviceNetSubtotal":82.64,"serviceTaxAmount":17.36,"managementFee":12.5,"payableNow":12.5,"payableLater":100,"lines":[{"code":"service_line_1","label":"Corte","amount":100,"kind":"service"},{"code":"management_fee","label":"Gastos de gestión","amount":12.5,"kind":"fee"}],"stripeLineItems":[{"code":"management_fee","label":"Gastos de gestión","unitAmount":12.5,"quantity":1}]}';
  v_waived    jsonb;
  v_text      text;
  v_fee       numeric;
  v_source    text;
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
    (v_cliente, 'fee.cliente@test.local'),
    (v_repite, 'fee.repite@test.local'),
    (v_jardinero, 'fee.jardinero@test.local')
  ) AS u(id, email);
  -- El perfil lo crea el trigger de auth.users; solo se le pone el rol.
  UPDATE public.profiles SET role = 'gardener', full_name = 'Jardinero Pruebas' WHERE user_id = v_jardinero;

  -- ---------------------------------------------------------------------------
  -- 1. La exención sobre la economía: forma exacta y vuelta atrás exacta
  -- ---------------------------------------------------------------------------
  v_waived := public.waive_quote_economics(v_econ, 'provider_link');
  IF NOT public.quote_economics_fee_waived(v_waived) THEN
    RAISE EXCEPTION 'FALLO 1a: una economía exenta no se reconoce como exenta';
  END IF;
  IF public.quote_economics_fee_waived(v_econ) THEN
    RAISE EXCEPTION 'FALLO 1b: una economía con comisión se reconoce como exenta';
  END IF;
  IF (v_waived ->> 'managementFee')::numeric <> 0 OR (v_waived ->> 'payableNow')::numeric <> 0
     OR jsonb_array_length(v_waived -> 'stripeLineItems') <> 0
     OR (v_waived #>> '{feeWaiver,waivedFee}')::numeric <> 12.5
     OR (v_waived ->> 'serviceGrossTotal')::numeric <> 100 THEN
    RAISE EXCEPTION 'FALLO 1c: la economía exenta no tiene la forma esperada: %', v_waived;
  END IF;
  IF public.unwaive_quote_economics(v_waived) <> v_econ THEN
    RAISE EXCEPTION 'FALLO 1d: deshacer la exención no devuelve la economía original exacta';
  END IF;
  IF (public.waive_quote_economics(v_waived, 'maintenance_plan') #>> '{feeWaiver,waivedFee}')::numeric <> 12.5 THEN
    RAISE EXCEPTION 'FALLO 1e: eximir dos veces pierde la comisión perdonada';
  END IF;
  IF public.quote_economics_fee_waived(jsonb_set(v_waived, '{feeWaiver,reason}', '"por_la_cara"')) THEN
    RAISE EXCEPTION 'FALLO 1f: un motivo desconocido cuenta como exención';
  END IF;
  IF public.quote_economics_fee_waived(jsonb_set(v_waived, '{payableNow}', '5')) THEN
    RAISE EXCEPTION 'FALLO 1g: una «exención» con cobro pendiente cuenta como exención';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 2. La regla: interruptor apagado = nadie se libra
  -- ---------------------------------------------------------------------------
  UPDATE public.app_settings SET own_clients_fee_waiver_enabled = false WHERE id = 1;
  IF public.management_fee_waiver_reason(v_cliente, v_jardinero, 'provider_link') IS NOT NULL THEN
    RAISE EXCEPTION 'FALLO 2: con el interruptor apagado se ha eximido a un cliente';
  END IF;

  -- Una reserva COMPLETADA de «v_repite» con el jardinero, y una CANCELADA de «v_cliente».
  INSERT INTO public.bookings (id, client_id, gardener_id, service_id, date, start_time,
    duration_hours, status, total_price, client_address, management_fee, management_fee_source)
  VALUES
    (gen_random_uuid(), v_repite, v_jardinero, v_servicio, current_date - 30, '09:00', 2,
     'completed', 100, 'Calle Prueba 1', 12.50, 'payment_attempt'),
    (gen_random_uuid(), v_cliente, v_jardinero, v_servicio, current_date - 20, '09:00', 2,
     'cancelled', 100, 'Calle Prueba 2', 12.50, 'payment_attempt');

  IF public.management_fee_waiver_reason(v_repite, v_jardinero, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'FALLO 2b: con el interruptor apagado se ha eximido a un cliente que repite';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 3. La regla con el interruptor encendido
  -- ---------------------------------------------------------------------------
  UPDATE public.app_settings SET own_clients_fee_waiver_enabled = true WHERE id = 1;

  v_text := public.management_fee_waiver_reason(v_cliente, v_jardinero, 'provider_link');
  IF v_text IS DISTINCT FROM 'provider_link' THEN
    RAISE EXCEPTION 'FALLO 3a: por el enlace del profesional debería ir sin gastos (es: %)', v_text;
  END IF;
  v_text := public.management_fee_waiver_reason(NULL, v_jardinero, 'provider_link');
  IF v_text IS DISTINCT FROM 'provider_link' THEN
    RAISE EXCEPTION 'FALLO 3b: sin sesión, el enlace debería contar igual (es: %)', v_text;
  END IF;
  v_text := public.management_fee_waiver_reason(v_repite, v_jardinero, NULL);
  IF v_text IS DISTINCT FROM 'returning_client' THEN
    RAISE EXCEPTION 'FALLO 3c: un cliente con una reserva completada debería ir sin gastos (es: %)', v_text;
  END IF;
  IF public.management_fee_waiver_reason(v_cliente, v_jardinero, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'FALLO 3d: una reserva CANCELADA no hace que el cliente «repita»';
  END IF;
  IF public.management_fee_waiver_reason(v_repite, v_cliente, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'FALLO 3e: repetir con un profesional no exime con otro distinto';
  END IF;
  IF public.management_fee_waiver_reason(v_cliente, v_jardinero, 'otro_origen') IS NOT NULL THEN
    RAISE EXCEPTION 'FALLO 3f: un origen desconocido no puede eximir';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 4. Comisión de una reserva: la exención solo cuenta con importe 0
  -- ---------------------------------------------------------------------------
  SELECT r.fee, r.source INTO v_fee, v_source
  FROM public.resolve_booking_management_fee(
    jsonb_build_object('payable_now_amount_cents', 0, 'quote_economic_snapshot', v_waived)) r;
  IF v_fee <> 0 OR v_source <> 'waived_provider_link' THEN
    RAISE EXCEPTION 'FALLO 4a: reserva exenta resuelta como % / %', v_fee, v_source;
  END IF;

  SELECT r.fee, r.source INTO v_fee, v_source
  FROM public.resolve_booking_management_fee(
    jsonb_build_object('payable_now_amount_cents', 1250, 'quote_economic_snapshot', v_waived)) r;
  IF v_source LIKE 'waived_%' OR v_fee <> 12.5 THEN
    RAISE EXCEPTION 'FALLO 4b: una «exención» con cobro real se ha tragado el cobro (% / %)', v_fee, v_source;
  END IF;

  SELECT r.fee, r.source INTO v_fee, v_source
  FROM public.resolve_booking_management_fee(
    jsonb_build_object('payable_now_amount_cents', 0, 'quote_economic_snapshot', v_econ)) r;
  IF v_source <> 'quote_snapshot_payable_now' AND v_source <> 'unknown' THEN
    RAISE EXCEPTION 'FALLO 4c: un 0 sin exención no puede salir como exento (fuente: %)', v_source;
  END IF;
  IF v_source LIKE 'waived_%' THEN
    RAISE EXCEPTION 'FALLO 4d: un 0 sin motivo ha pasado por exención';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 5. Reservas: el trigger la marca exenta, la comisión exenta es 0 e inmutable
  -- ---------------------------------------------------------------------------
  v_reserva := gen_random_uuid();
  INSERT INTO public.bookings (id, client_id, gardener_id, service_id, date, start_time,
    duration_hours, status, total_price, client_address, pricing_context)
  VALUES (v_reserva, v_cliente, v_jardinero, v_servicio, current_date + 10, '09:00', 2,
    'pending', 100, 'Calle Prueba 3',
    jsonb_build_object('payable_now_amount_cents', 0, 'quote_economic_snapshot', v_waived));
  SELECT management_fee, management_fee_source INTO v_fee, v_source FROM public.bookings WHERE id = v_reserva;
  IF v_fee <> 0 OR v_source <> 'waived_provider_link' THEN
    RAISE EXCEPTION 'FALLO 5a: la reserva exenta quedó con % / %', v_fee, v_source;
  END IF;

  BEGIN
    UPDATE public.bookings SET management_fee_source = 'payment_attempt', management_fee = 12.5 WHERE id = v_reserva;
    RAISE EXCEPTION 'FALLO 5b: se ha podido cambiar la comisión de una reserva exenta';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.bookings (id, client_id, gardener_id, service_id, date, start_time,
      duration_hours, status, total_price, client_address, management_fee, management_fee_source)
    VALUES (gen_random_uuid(), v_cliente, v_jardinero, v_servicio, current_date + 11, '09:00', 2,
      'pending', 100, 'Calle Prueba 4', 5, 'waived_provider_link');
    RAISE EXCEPTION 'FALLO 5c: una reserva «exenta» con comisión distinta de 0 se ha guardado';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- ---------------------------------------------------------------------------
  -- 6. Intentos de pago: 0 € solo con una exención válida en su economía
  -- ---------------------------------------------------------------------------
  INSERT INTO public.booking_quotes (client_id, gardener_id, service_id, signature, pricing_version,
    provider_config_version, input_payload, pricing_snapshot, total_price, estimated_hours, status,
    generated_at, expires_at, selected_date, selected_start_time, economic_snapshot)
  VALUES (v_cliente, v_jardinero, v_servicio, 'fee-waiver-test-' || gen_random_uuid(), 'booking_quote_v1',
    'cfg', '{}'::jsonb, '{}'::jsonb, 100, 2, 'active', now(), now() + interval '2 hours',
    current_date + 12, '09:00', v_waived)
  RETURNING id INTO v_quote;

  BEGIN
    INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
      selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
      stripe_idempotency_key, economic_snapshot)
    VALUES (v_cliente, v_jardinero, v_servicio, v_quote, 'sig', current_date + 12, '09:00', 2, 10000, 0,
      gen_random_uuid()::text, v_econ);
    RAISE EXCEPTION 'FALLO 6a: un intento de 0 € SIN exención se ha guardado';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
    selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
    stripe_idempotency_key, economic_snapshot)
  VALUES (v_cliente, v_jardinero, v_servicio, v_quote, 'sig', current_date + 12, '09:00', 2, 10000, 0,
    gen_random_uuid()::text, v_waived);

  INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
    selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
    stripe_idempotency_key, economic_snapshot)
  VALUES (v_cliente, v_jardinero, v_servicio, v_quote, 'sig', current_date + 12, '09:00', 2, 10000, 1250,
    gen_random_uuid()::text, v_econ);

  BEGIN
    INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
      selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
      stripe_idempotency_key, economic_snapshot)
    VALUES (v_cliente, v_jardinero, v_servicio, v_quote, 'sig', current_date + 12, '09:00', 2, 10000, -1,
      gen_random_uuid()::text, v_waived);
    RAISE EXCEPTION 'FALLO 6b: un intento con importe negativo se ha guardado';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- ---------------------------------------------------------------------------
  -- 7. Solo el servidor consulta la regla (dice si un cliente ha trabajado con alguien)
  -- ---------------------------------------------------------------------------
  IF has_function_privilege('authenticated', 'public.management_fee_waiver_reason(uuid, uuid, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.management_fee_waiver_reason(uuid, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALLO 7: la regla de exención se puede llamar desde el navegador';
  END IF;

  RAISE WARNING 'TODAS LAS COMPROBACIONES OK';
END;
$prueba$;

ROLLBACK;
