-- Pruebas del ciclo de confirmacion e incidencias.
--
-- Todo el fichero corre dentro de una transaccion que se revierte al final, asi que puede
-- lanzarse contra una base con datos sin ensuciarla:
--
--   docker exec -i <contenedor_db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/incidents_lifecycle.test.sql
--
-- Cualquier comprobacion que falle aborta con excepcion. Si el fichero termina imprimiendo
-- "TODAS LAS COMPROBACIONES OK", todo lo de abajo se cumple.
--
-- Se cubre aqui y no en vitest porque esta logica vive entera en PL/pgSQL: son las reglas que
-- deciden si se devuelve dinero y si una reserva se cobra sola, y probarlas contra un doble en
-- TypeScript no demostraria nada sobre lo que de verdad ejecuta la base de datos.

BEGIN;

SET client_min_messages = WARNING;

DO $prueba$
DECLARE
  v_cliente   uuid;
  v_jardinero uuid;
  v_admin     uuid := '00000000-dead-4bee-8fff-000000000001';
  v_servicio  uuid;
  v_reserva   uuid;
  v_otra      uuid;
  v_incidente uuid;
  v_resultado jsonb;
  v_estado    text;
  v_n         integer;
BEGIN
  -- ---------------------------------------------------------------------------
  -- Preparacion: dos usuarios reales de la semilla y un administrador de usar y tirar.
  -- ---------------------------------------------------------------------------
  SELECT id INTO v_cliente   FROM auth.users WHERE email = 'cliente.local@test.local';
  SELECT id INTO v_jardinero FROM auth.users WHERE email = 'jardinero.local@test.local';
  SELECT id INTO v_servicio  FROM public.services ORDER BY name LIMIT 1;

  IF v_cliente IS NULL OR v_jardinero IS NULL THEN
    RAISE EXCEPTION 'Faltan las cuentas sembradas: ejecuta `supabase db reset` antes de estas pruebas';
  END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  VALUES (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'admin.pruebas@test.local', 'x', now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  INSERT INTO public.profiles (user_id, full_name, role) VALUES (v_admin, 'Admin Pruebas', 'admin');

  -- Reserva confirmada cuyo servicio termino hace dos horas.
  v_reserva := gen_random_uuid();
  INSERT INTO public.bookings (id, client_id, gardener_id, service_id, date, start_time,
    duration_hours, status, total_price, client_address, management_fee, management_fee_source)
  VALUES (v_reserva, v_cliente, v_jardinero, v_servicio,
    (now() AT TIME ZONE 'Europe/Madrid')::date,
    ((now() AT TIME ZONE 'Europe/Madrid') - interval '4 hours')::time,
    2, 'confirmed', 100, 'Calle de Prueba 1', 12.50, 'payment_attempt');

  -- ---------------------------------------------------------------------------
  -- 1. La ventana de confirmacion se calcula sola al confirmar
  -- ---------------------------------------------------------------------------
  PERFORM 1 FROM public.bookings
  WHERE id = v_reserva AND confirmation_deadline_at IS NOT NULL AND confirmation_prompt_due_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FALLO 1: confirmar una reserva no fijo su ventana de confirmacion';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 2. El reloj reclama la reserva UNA sola vez (nadie recibe el correo dos veces)
  -- ---------------------------------------------------------------------------
  SELECT count(*) INTO v_n FROM public.claim_due_confirmation_prompts(50) AS t(id) WHERE t.id = v_reserva;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FALLO 2a: el reloj deberia reclamar la reserva vencida (reclamadas: %)', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.claim_due_confirmation_prompts(50) AS t(id) WHERE t.id = v_reserva;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FALLO 2b: la reserva se reclamo dos veces; se enviarian correos duplicados';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 3. Un envio fallido vuelve a la cola; uno confirmado no
  -- ---------------------------------------------------------------------------
  PERFORM public.mark_confirmation_prompt_failed(v_reserva, 'prueba');
  SELECT count(*) INTO v_n FROM public.claim_due_confirmation_prompts(50) AS t(id) WHERE t.id = v_reserva;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FALLO 3a: un envio fallido debe reintentarse, y no se reintento';
  END IF;

  PERFORM public.mark_confirmation_prompt_sent(v_reserva);
  SELECT count(*) INTO v_n FROM public.claim_due_confirmation_prompts(50) AS t(id) WHERE t.id = v_reserva;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FALLO 3b: una reserva ya avisada volvio a la cola de envio';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 4. El cliente abre una incidencia bloqueante y la reserva pasa a disputa
  -- ---------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cliente)::text, true);

  v_resultado := public.report_booking_incident(v_reserva, 'gardener_no_show',
    'El profesional no acudio al domicilio y no dio ningun aviso.');
  v_incidente := (v_resultado ->> 'incidentId')::uuid;

  IF (v_resultado ->> 'blocksCompletion')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FALLO 4a: "no vino" tiene que bloquear el cierre de la reserva';
  END IF;

  SELECT status INTO v_estado FROM public.bookings WHERE id = v_reserva;
  IF v_estado <> 'disputed' THEN
    RAISE EXCEPTION 'FALLO 4b: la reserva deberia estar en disputa, y esta en %', v_estado;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 5. Una incidencia bloqueante impide que el reloj cobre la reserva
  -- ---------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', NULL, true);
  UPDATE public.bookings SET confirmation_deadline_at = now() - interval '1 hour' WHERE id = v_reserva;

  PERFORM public.auto_complete_due_bookings();
  SELECT status INTO v_estado FROM public.bookings WHERE id = v_reserva;
  IF v_estado = 'completed' THEN
    RAISE EXCEPTION 'FALLO 5: el reloj cerro y cobro una reserva con una incidencia abierta';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 6. Una incidencia NO bloqueante es un ticket de soporte: ni congela ni cobra de mas
  -- ---------------------------------------------------------------------------
  v_otra := gen_random_uuid();
  INSERT INTO public.bookings (id, client_id, gardener_id, service_id, date, start_time,
    duration_hours, status, total_price, client_address, management_fee, management_fee_source)
  VALUES (v_otra, v_cliente, v_jardinero, v_servicio,
    (now() AT TIME ZONE 'Europe/Madrid')::date,
    ((now() AT TIME ZONE 'Europe/Madrid') - interval '4 hours')::time,
    2, 'confirmed', 100, 'Calle de Prueba 2', 12.50, 'payment_attempt');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cliente)::text, true);
  PERFORM public.report_booking_incident(v_otra, 'billing', 'Creo que me habeis cobrado de mas.');
  PERFORM set_config('request.jwt.claims', NULL, true);

  SELECT status INTO v_estado FROM public.bookings WHERE id = v_otra;
  IF v_estado <> 'confirmed' THEN
    RAISE EXCEPTION 'FALLO 6: una queja de cobro no debe congelar la reserva (estado: %)', v_estado;
  END IF;

  UPDATE public.bookings SET confirmation_deadline_at = now() - interval '1 hour' WHERE id = v_otra;
  PERFORM public.auto_complete_due_bookings();
  SELECT status INTO v_estado FROM public.bookings WHERE id = v_otra;
  IF v_estado <> 'completed' THEN
    RAISE EXCEPTION 'FALLO 6b: la reserva con queja no bloqueante deberia haberse completado sola';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 7. Solo un administrador resuelve
  -- ---------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cliente)::text, true);
  BEGIN
    PERFORM public.resolve_booking_incident(v_incidente, 'refund', NULL);
    RAISE EXCEPTION 'FALLO 7: un cliente ha podido resolverse su propia incidencia';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  -- ---------------------------------------------------------------------------
  -- 8. El administrador devuelve: reserva cancelada, penalizacion y dinero pendiente
  -- ---------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  v_resultado := public.resolve_booking_incident(v_incidente, 'refund', 'Verificado con el cliente.');

  IF v_resultado ->> 'money_action' <> 'refund' THEN
    RAISE EXCEPTION 'FALLO 8a: resolver a favor del cliente tiene que ordenar el reembolso';
  END IF;

  SELECT status INTO v_estado FROM public.bookings WHERE id = v_reserva;
  IF v_estado <> 'cancelled' THEN
    RAISE EXCEPTION 'FALLO 8b: la reserva deberia quedar cancelada, y esta en %', v_estado;
  END IF;

  SELECT count(*) INTO v_n FROM public.reviews
  WHERE booking_id = v_reserva AND is_system_penalty AND rating = 1;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FALLO 8c: falta la penalizacion de 1 estrella por no acudir';
  END IF;

  SELECT money_status INTO v_estado FROM public.booking_incidents WHERE id = v_incidente;
  IF v_estado <> 'pending' THEN
    RAISE EXCEPTION 'FALLO 8d: el dinero debe quedar como pendiente ANTES de llamar a Stripe (es: %)', v_estado;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 9. Idempotencia: mientras el dinero no haya salido, reintentar vuelve a pedirlo
  -- ---------------------------------------------------------------------------
  v_resultado := public.resolve_booking_incident(v_incidente, 'refund', NULL);
  IF v_resultado ->> 'money_action' <> 'refund' THEN
    RAISE EXCEPTION 'FALLO 9a: con el reembolso a medias, reintentar debe volver a ordenarlo';
  END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  PERFORM public.record_incident_money_result(v_incidente, 'refunded', 'pi_prueba');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);

  v_resultado := public.resolve_booking_incident(v_incidente, 'refund', NULL);
  IF v_resultado ->> 'money_action' <> 'none' THEN
    RAISE EXCEPTION 'FALLO 9b: con el reembolso ya hecho, reintentar NO puede volver a pagar';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 10. Una incidencia resuelta no admite mas transiciones
  -- ---------------------------------------------------------------------------
  BEGIN
    UPDATE public.booking_incidents SET status = 'open' WHERE id = v_incidente;
    RAISE EXCEPTION 'FALLO 10: una incidencia resuelta ha podido reabrirse saltandose la maquina de estados';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALLO 10%' THEN RAISE; END IF;
  END;

  RAISE WARNING 'TODAS LAS COMPROBACIONES OK';
END;
$prueba$;

ROLLBACK;
