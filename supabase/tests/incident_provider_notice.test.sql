-- QA-192: cuando un cliente abre una incidencia, el PROFESIONAL también recibe aviso (correo y push).
-- Antes solo se avisaba al cliente («hemos recibido tu incidencia») y al admin; el profesional no
-- se enteraba hasta abrir «Reservas», y su versión es lo que el admin necesita para decidir.
--
--   docker exec -i <contenedor_db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/incident_provider_notice.test.sql
--
-- Corre en una transacción que se revierte. Termina con "TODAS LAS COMPROBACIONES OK".

BEGIN;
SET client_min_messages = WARNING;

DO $prueba$
DECLARE
  v_cliente   uuid := '00000000-1c1d-4bee-8fff-000000000001';
  v_jardinero uuid := '00000000-1c1d-4bee-8fff-000000000002';
  v_servicio  uuid;
  v_reserva   uuid := gen_random_uuid();
  v_incidencia uuid;
  v_n integer;
BEGIN
  SELECT id INTO v_servicio FROM public.services ORDER BY name LIMIT 1;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  SELECT u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    u.email, 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', ''
  FROM (VALUES (v_cliente, 'inc.cliente@test.local'), (v_jardinero, 'inc.jardinero@test.local')) AS u(id, email);
  UPDATE public.profiles SET role = 'gardener', full_name = 'Jardinero Incidencias' WHERE user_id = v_jardinero;

  INSERT INTO public.bookings (id, client_id, gardener_id, service_id, date, start_time,
    duration_hours, status, total_price, client_address, management_fee, management_fee_source)
  VALUES (v_reserva, v_cliente, v_jardinero, v_servicio, current_date - 1, '09:00', 2,
    'confirmed', 100, 'Calle Prueba 1', 12.50, 'payment_attempt');

  INSERT INTO public.booking_incidents (booking_id, reported_by, reporter_role, kind, description)
  VALUES (v_reserva, v_cliente, 'client', 'service_incomplete', 'Dejaron la mitad del césped sin cortar.')
  RETURNING id INTO v_incidencia;

  SELECT count(*) INTO v_n FROM public.notification_outbox
  WHERE type = 'booking_incident_received' AND booking_id = v_reserva;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FALLO 1: el aviso al cliente debería seguir saliendo una vez (salen %)', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.notification_outbox
  WHERE type = 'booking_incident_opened' AND booking_id = v_reserva;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FALLO 2: al profesional no se le avisa de la incidencia (avisos: %)', v_n;
  END IF;

  -- Una segunda inserción del mismo aviso (reintento) no lo duplica.
  PERFORM private.enqueue_notification('booking_incident_opened',
    format('booking_incident_opened:%s', v_incidencia), v_reserva, jsonb_build_object('bookingId', v_reserva));
  SELECT count(*) INTO v_n FROM public.notification_outbox
  WHERE type = 'booking_incident_opened' AND booking_id = v_reserva;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FALLO 3: el aviso al profesional se duplica (avisos: %)', v_n;
  END IF;

  RAISE WARNING 'TODAS LAS COMPROBACIONES OK';
END;
$prueba$;

ROLLBACK;
