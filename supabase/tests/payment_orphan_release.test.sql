-- Pruebas de las retenciones de tarjeta sin reserva (QA-139 / PH-37) y del rechazo de tarjeta
-- con el hueco aún vigente (migración 20261117120000).
--
-- Todo corre dentro de una transacción que se revierte al final: se puede lanzar contra una base
-- con datos sin ensuciarla:
--
--   docker exec -i <contenedor_db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/payment_orphan_release.test.sql
--
-- Cualquier comprobación que falle aborta con excepción. Si termina con
-- "TODAS LAS COMPROBACIONES OK", todo lo de abajo se cumple.
--
-- Qué se protege:
--   1. Si el cliente paga cuando su hueco ya caducó, no hay reserva, y esa retención de tarjeta
--      tiene que aparecer en la lista que el servidor libera en Stripe (antes se quedaba retenida).
--   2. La lista nunca incluye un pago que sí tiene reserva, uno ya liberado, uno cuyo PaymentIntent
--      no cuadra con el intento (eso lo revisa una persona) ni uno de hace más de 8 días.
--   3. Una tarjeta rechazada con el hueco aún vigente NO suelta el hueco: el cliente puede probar
--      otra tarjeta en el mismo formulario y la reserva se crea.
--   4. Desde el navegador no se pueden liberar ni listar intentos de pago.

BEGIN;

SET client_min_messages = WARNING;

DO $prueba$
DECLARE
  v_cliente   uuid := '00000000-0b1a-4bee-8fff-000000000001';
  v_jardinero uuid := '00000000-0b1a-4bee-8fff-000000000002';
  v_servicio  uuid;
  v_quote     uuid;
  v_econ      jsonb := '{"currency":"EUR","taxRate":0.21,"serviceGrossTotal":100,"serviceNetSubtotal":82.64,"serviceTaxAmount":17.36,"managementFee":12.5,"payableNow":12.5,"payableLater":100,"lines":[],"stripeLineItems":[{"code":"management_fee","label":"Gastos de gestión","unitAmount":12.5,"quantity":1}]}';
  v_tarde     uuid;  -- paga con el hueco caducado
  v_rechazo   uuid;  -- tarjeta rechazada con el hueco vigente
  v_rechazo2  uuid;  -- tarjeta rechazada con el hueco ya caducado
  v_conreserva uuid;
  v_mismatch  uuid;
  v_viejo     uuid;
  v_reciente  uuid;
  v_summary   jsonb;
  v_ids       uuid[];
  v_hold_status text;
  v_status    text;
  v_dia       date := current_date + 15;
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
    (v_cliente, 'orphan.cliente@test.local'),
    (v_jardinero, 'orphan.jardinero@test.local')
  ) AS u(id, email);
  UPDATE public.profiles SET role = 'gardener', full_name = 'Jardinero Pruebas' WHERE user_id = v_jardinero;

  INSERT INTO public.booking_quotes (client_id, gardener_id, service_id, signature, pricing_version,
    provider_config_version, input_payload, pricing_snapshot, total_price, estimated_hours, status,
    generated_at, expires_at, selected_date, selected_start_time, economic_snapshot)
  VALUES (v_cliente, v_jardinero, v_servicio, 'orphan-test-' || gen_random_uuid(), 'booking_quote_v1',
    'cfg', '{"address":"Calle Prueba 1"}'::jsonb, '{}'::jsonb, 100, 2, 'active', now(), now() + interval '2 hours',
    v_dia, '09:00', v_econ)
  RETURNING id INTO v_quote;

  -- Disponibilidad del profesional ese día (8:00 a 21:00), para que una reserva se pueda crear.
  INSERT INTO public.availability (gardener_id, date, start_time, end_time, is_available)
  SELECT v_jardinero, v_dia, make_time(h, 0, 0), make_time(h + 1, 0, 0), true
  FROM generate_series(8, 20) AS h;

  -- Los intentos, cada uno con su PaymentIntent y su hueco.
  INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
    selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
    stripe_idempotency_key, economic_snapshot, status, stripe_payment_intent_id, payment_expires_at)
  VALUES (v_cliente, v_jardinero, v_servicio, v_quote, 'sig', v_dia, '09:00', 2, 10000, 1250,
    gen_random_uuid()::text, v_econ, 'payment_pending', 'pi_orphan_tarde', now() - interval '1 minute')
  RETURNING id INTO v_tarde;
  INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
    selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
    stripe_idempotency_key, economic_snapshot, status, stripe_payment_intent_id, payment_expires_at)
  VALUES (v_cliente, v_jardinero, v_servicio, v_quote, 'sig', v_dia, '12:00', 2, 10000, 1250,
    gen_random_uuid()::text, v_econ, 'payment_pending', 'pi_orphan_rechazo', now() + interval '20 minutes')
  RETURNING id INTO v_rechazo;
  INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
    selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
    stripe_idempotency_key, economic_snapshot, status, stripe_payment_intent_id, payment_expires_at)
  VALUES (v_cliente, v_jardinero, v_servicio, v_quote, 'sig', v_dia, '15:00', 2, 10000, 1250,
    gen_random_uuid()::text, v_econ, 'payment_pending', 'pi_orphan_rechazo2', now() - interval '1 minute')
  RETURNING id INTO v_rechazo2;

  INSERT INTO public.booking_schedule_holds (payment_attempt_id, client_id, gardener_id, service_id, quote_id,
    selected_date, selected_start_time, duration_hours, status, expires_at)
  VALUES
    (v_tarde,    v_cliente, v_jardinero, v_servicio, v_quote, v_dia, '09:00', 2, 'active', now() - interval '1 minute'),
    (v_rechazo,  v_cliente, v_jardinero, v_servicio, v_quote, v_dia, '12:00', 2, 'active', now() + interval '20 minutes'),
    (v_rechazo2, v_cliente, v_jardinero, v_servicio, v_quote, v_dia, '15:00', 2, 'active', now() - interval '1 minute');

  -- ---------------------------------------------------------------------------
  -- 1. QA-139: pagar con el hueco caducado no crea reserva y deja la retención en la lista
  -- ---------------------------------------------------------------------------
  v_summary := public.confirm_booking_payment_attempt(v_tarde, 'evt_orphan_tarde', 'pi_orphan_tarde', 1250, 'eur', '{}'::jsonb);
  IF v_summary ->> 'status' <> 'reconciliation_required' OR v_summary ->> 'bookingId' IS NOT NULL THEN
    RAISE EXCEPTION 'FALLO 1a: pagar con el hueco caducado debería quedar sin reserva (es: %)', v_summary;
  END IF;
  IF v_summary ->> 'lastErrorCode' <> 'hold_unavailable_after_payment' THEN
    RAISE EXCEPTION 'FALLO 1b: el motivo debería ser hold_unavailable_after_payment (es: %)', v_summary ->> 'lastErrorCode';
  END IF;

  -- Recién marcado: aún no (el propio pago lo libera al momento; la lista es el respaldo).
  SELECT array_agg(attempt_id) INTO v_ids FROM public.list_orphan_payment_authorizations(200);
  IF v_tarde = ANY(COALESCE(v_ids, '{}')) THEN
    RAISE EXCEPTION 'FALLO 1c: un intento recién marcado no debe entrar en la lista hasta pasados 2 minutos';
  END IF;

  -- «Pasan 5 minutos»: el trigger de updated_at pondría la hora actual, así que se apaga solo aquí
  -- (la transacción se revierte al final).
  ALTER TABLE public.booking_payment_attempts DISABLE TRIGGER trg_booking_payment_attempts_updated_at;
  UPDATE public.booking_payment_attempts SET updated_at = now() - interval '5 minutes' WHERE id = v_tarde;
  ALTER TABLE public.booking_payment_attempts ENABLE TRIGGER trg_booking_payment_attempts_updated_at;
  SELECT array_agg(attempt_id) INTO v_ids FROM public.list_orphan_payment_authorizations(200);
  IF NOT (v_tarde = ANY(COALESCE(v_ids, '{}'))) THEN
    RAISE EXCEPTION 'FALLO 1d: la retención de un pago sin reserva no aparece para liberarla';
  END IF;

  PERFORM public.mark_booking_payment_settled(v_tarde, 'released_orphan');
  -- «Pasan 5 minutos»: el trigger de updated_at pondría la hora actual, así que se apaga solo aquí
  -- (la transacción se revierte al final).
  ALTER TABLE public.booking_payment_attempts DISABLE TRIGGER trg_booking_payment_attempts_updated_at;
  UPDATE public.booking_payment_attempts SET updated_at = now() - interval '5 minutes' WHERE id = v_tarde;
  ALTER TABLE public.booking_payment_attempts ENABLE TRIGGER trg_booking_payment_attempts_updated_at;
  SELECT array_agg(attempt_id) INTO v_ids FROM public.list_orphan_payment_authorizations(200);
  IF v_tarde = ANY(COALESCE(v_ids, '{}')) THEN
    RAISE EXCEPTION 'FALLO 1e: una retención ya liberada vuelve a la lista';
  END IF;

  -- 1f. Tras anular la retención, Stripe avisa «PaymentIntent cancelado»: el intento sigue «sin
  --     reserva» con su motivo (antes se rebajaba a «cancelado» y la web invitaba a volver a pagar).
  v_summary := public.release_booking_payment_attempt(v_tarde, 'cancelled', 'stripe_payment_intent_canceled',
    'pi_orphan_tarde', '{}'::jsonb);
  IF v_summary ->> 'status' <> 'reconciliation_required' OR v_summary ->> 'lastErrorCode' <> 'hold_unavailable_after_payment' THEN
    RAISE EXCEPTION 'FALLO 1f: el aviso de cancelación de Stripe ha pisado el estado sin reserva (es: %/%)',
      v_summary ->> 'status', v_summary ->> 'lastErrorCode';
  END IF;

  -- 1g. Igual con un intento caducado: el aviso «cancelado» de Stripe no lo convierte en «cancelado».
  v_summary := public.release_booking_payment_attempt(v_rechazo2, 'expired', 'payment_expired', NULL, '{}'::jsonb);
  v_summary := public.release_booking_payment_attempt(v_rechazo2, 'cancelled', 'stripe_payment_intent_canceled',
    'pi_orphan_rechazo2', '{}'::jsonb);
  IF v_summary ->> 'status' <> 'expired' THEN
    RAISE EXCEPTION 'FALLO 1g: un intento caducado se ha reescrito como % por el aviso de Stripe', v_summary ->> 'status';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 2. Lo que NUNCA se libera solo
  -- ---------------------------------------------------------------------------
  -- 2a. Un intento con reserva (aunque alguien lo marcase después para revisión).
  INSERT INTO public.bookings (id, client_id, gardener_id, service_id, date, start_time,
    duration_hours, status, total_price, client_address, management_fee, management_fee_source)
  VALUES ('00000000-0b1a-4bee-8fff-0000000000b1', v_cliente, v_jardinero, v_servicio, v_dia, '17:00', 2,
    'pending', 100, 'Calle Prueba 1', 12.50, 'payment_attempt');
  INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
    selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
    stripe_idempotency_key, economic_snapshot, status, stripe_payment_intent_id, booking_id, updated_at)
  VALUES (v_cliente, v_jardinero, v_servicio, v_quote, 'sig', v_dia, '17:00', 2, 10000, 1250,
    gen_random_uuid()::text, v_econ, 'reconciliation_required', 'pi_orphan_conreserva',
    '00000000-0b1a-4bee-8fff-0000000000b1', now() - interval '1 hour')
  RETURNING id INTO v_conreserva;

  -- 2b. PaymentIntent que no cuadra con el intento: lo revisa una persona.
  INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
    selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
    stripe_idempotency_key, economic_snapshot, status, stripe_payment_intent_id, last_error_code, updated_at)
  VALUES (v_cliente, v_jardinero, v_servicio, v_quote, 'sig', v_dia, '18:00', 2, 10000, 1250,
    gen_random_uuid()::text, v_econ, 'reconciliation_required', 'pi_orphan_mismatch', 'stripe_metadata_mismatch',
    now() - interval '1 hour')
  RETURNING id INTO v_mismatch;

  -- 2c. De hace más de 8 días (Stripe ya anuló la autorización sola).
  INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
    selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
    stripe_idempotency_key, economic_snapshot, status, stripe_payment_intent_id, created_at, updated_at)
  VALUES (v_cliente, v_jardinero, v_servicio, v_quote, 'sig', v_dia, '19:00', 2, 10000, 1250,
    gen_random_uuid()::text, v_econ, 'expired', 'pi_orphan_viejo', now() - interval '9 days', now() - interval '9 days')
  RETURNING id INTO v_viejo;

  -- 2d. Uno caducado normal de hace 1 hora: SÍ entra (puede tener una autorización viva).
  INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
    selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
    stripe_idempotency_key, economic_snapshot, status, stripe_payment_intent_id, created_at, updated_at)
  VALUES (v_cliente, v_jardinero, v_servicio, v_quote, 'sig', v_dia, '20:00', 2, 10000, 1250,
    gen_random_uuid()::text, v_econ, 'expired', 'pi_orphan_reciente', now() - interval '2 hours', now() - interval '1 hour')
  RETURNING id INTO v_reciente;

  SELECT array_agg(attempt_id) INTO v_ids FROM public.list_orphan_payment_authorizations(200);
  IF v_conreserva = ANY(COALESCE(v_ids, '{}')) THEN
    RAISE EXCEPTION 'FALLO 2a: un intento con reserva aparece para liberar su PaymentIntent';
  END IF;
  IF v_mismatch = ANY(COALESCE(v_ids, '{}')) THEN
    RAISE EXCEPTION 'FALLO 2b: un PaymentIntent que no cuadra con su intento se liberaría sin revisión';
  END IF;
  IF v_viejo = ANY(COALESCE(v_ids, '{}')) THEN
    RAISE EXCEPTION 'FALLO 2c: un intento de hace más de 8 días entra en la lista';
  END IF;
  IF NOT (v_reciente = ANY(COALESCE(v_ids, '{}'))) THEN
    RAISE EXCEPTION 'FALLO 2d: un intento caducado reciente con PaymentIntent no entra en la lista';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 3. Tarjeta rechazada: con el hueco vigente se conserva; con el hueco caducado, se suelta
  -- ---------------------------------------------------------------------------
  v_summary := public.mark_booking_payment_attempt_declined(v_rechazo, 'pi_orphan_rechazo', 'card_declined',
    'Tu tarjeta ha sido rechazada.', '{"webhookType":"payment_intent.payment_failed"}'::jsonb);
  SELECT status INTO v_hold_status FROM public.booking_schedule_holds WHERE payment_attempt_id = v_rechazo;
  IF v_summary ->> 'status' <> 'payment_pending' OR v_hold_status <> 'active' THEN
    RAISE EXCEPTION 'FALLO 3a: una tarjeta rechazada con el hueco vigente ha soltado el hueco (intento %, hueco %)',
      v_summary ->> 'status', v_hold_status;
  END IF;
  IF v_summary ->> 'lastErrorCode' <> 'card_declined' THEN
    RAISE EXCEPTION 'FALLO 3b: el rechazo no queda anotado (es: %)', v_summary ->> 'lastErrorCode';
  END IF;

  -- El cliente prueba otra tarjeta y Stripe la autoriza: la reserva se crea.
  v_summary := public.confirm_booking_payment_attempt(v_rechazo, 'evt_orphan_rechazo_ok', 'pi_orphan_rechazo', 1250, 'eur', '{}'::jsonb);
  IF v_summary ->> 'status' <> 'booking_created' OR v_summary ->> 'bookingId' IS NULL THEN
    RAISE EXCEPTION 'FALLO 3c: tras un rechazo, pagar con otra tarjeta no crea la reserva (es: %)', v_summary;
  END IF;

  v_summary := public.mark_booking_payment_attempt_declined(v_rechazo2, 'pi_orphan_rechazo2', 'card_declined',
    'Tu tarjeta ha sido rechazada.', '{}'::jsonb);
  SELECT status INTO v_hold_status FROM public.booking_schedule_holds WHERE payment_attempt_id = v_rechazo2;
  -- (puede llegar ya «caducado» si otra operación limpió antes los huecos vencidos de ese día)
  IF v_summary ->> 'status' NOT IN ('failed', 'expired') OR v_hold_status = 'active' THEN
    RAISE EXCEPTION 'FALLO 3d: un rechazo con el hueco caducado debería cerrar el intento (intento %, hueco %)',
      v_summary ->> 'status', v_hold_status;
  END IF;

  -- Un rechazo sobre un intento ya cerrado no lo reabre.
  v_summary := public.mark_booking_payment_attempt_declined(v_rechazo, 'pi_orphan_rechazo', 'card_declined', 'x', '{}'::jsonb);
  SELECT status INTO v_status FROM public.booking_payment_attempts WHERE id = v_rechazo;
  IF v_status <> 'booking_created' THEN
    RAISE EXCEPTION 'FALLO 3e: un rechazo tardío ha cambiado un intento con reserva (es: %)', v_status;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 4. Nada de esto se puede llamar desde el navegador
  -- ---------------------------------------------------------------------------
  IF has_function_privilege('authenticated', 'public.release_booking_payment_attempt(uuid, text, text, text, jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.release_booking_payment_attempt(uuid, text, text, text, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALLO 4a: cualquier usuario con sesión puede liberar intentos de pago ajenos';
  END IF;
  IF has_function_privilege('authenticated', 'public.list_orphan_payment_authorizations(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.list_orphan_payment_authorizations(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALLO 4b: la lista de retenciones se puede consultar desde el navegador';
  END IF;
  IF has_function_privilege('authenticated', 'public.mark_booking_payment_attempt_declined(uuid, text, text, text, jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.mark_booking_payment_attempt_declined(uuid, text, text, text, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALLO 4c: el rechazo de tarjeta se puede anotar desde el navegador';
  END IF;

  RAISE WARNING 'TODAS LAS COMPROBACIONES OK';
END;
$prueba$;

ROLLBACK;
