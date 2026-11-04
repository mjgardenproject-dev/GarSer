-- Pruebas de los avisos al administrador (migración 20261104150000). Todo dentro de una transacción
-- que se revierte: se puede lanzar contra una base con datos sin ensuciarla.
--
--   docker exec -i <contenedor_db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/admin_review_notifications.test.sql
--
-- Si termina con «TODAS LAS COMPROBACIONES OK», todo lo de abajo se cumple.

BEGIN;
SET client_min_messages = WARNING;

CREATE FUNCTION pg_temp.check_that(p_ok boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FALLO %', p_msg;
  END IF;
END $$;

CREATE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN NULL ELSE json_build_object('sub', p_user)::text END, true);
END $$;

CREATE FUNCTION pg_temp.admin_notices(p_kind text, p_item uuid) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.notification_outbox
  WHERE type = 'admin_review_needed' AND payload ->> 'kind' = p_kind AND payload ->> 'itemId' = p_item::text
$$;

DO $prueba$
DECLARE
  v_admin uuid := gen_random_uuid();
  v_pro uuid := gen_random_uuid();
  v_cli uuid := gen_random_uuid();
  v_empleado uuid := gen_random_uuid();
  v_app uuid := gen_random_uuid();
  v_company uuid := gen_random_uuid();
  v_lic uuid := gen_random_uuid();
  v_lic2 uuid := gen_random_uuid();
  v_servicio uuid;
  v_booking uuid;
  v_inc uuid;
  v_inc2 uuid;
  v_before int;
  r jsonb;
  v_row public.notification_outbox%ROWTYPE;
BEGIN
  SELECT id INTO v_servicio FROM public.services ORDER BY name LIMIT 1;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  SELECT u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    u.email, 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', ''
  FROM (VALUES
    (v_admin, 'adm.admin@test.local'), (v_pro, 'adm.pro@test.local'),
    (v_cli, 'adm.cli@test.local'), (v_empleado, 'adm.emp@test.local')
  ) AS u(id, email);
  UPDATE public.profiles SET role = 'admin', full_name = 'Admin Pruebas' WHERE user_id = v_admin;
  UPDATE public.profiles SET role = 'gardener', full_name = 'Jardinero Pruebas' WHERE user_id = v_pro;
  UPDATE public.profiles SET role = 'client', full_name = 'Cliente Pruebas' WHERE user_id = v_cli;

  -- ===========================================================================
  -- A. Solicitud de jardinero
  -- ===========================================================================
  INSERT INTO public.gardener_applications (id, user_id, status, full_name, city_zone, services, experience_range)
  VALUES (v_app, v_pro, 'draft', 'Pablo Pruebas', 'Marbella', ARRAY['Corte de césped'], '1-3');
  PERFORM pg_temp.check_that(pg_temp.admin_notices('gardener_application', v_app) = 0,
    'A1: un borrador ya avisa al admin (todavía no es una solicitud)');

  UPDATE public.gardener_applications SET status = 'submitted', submitted_at = now() WHERE id = v_app;
  PERFORM pg_temp.check_that(pg_temp.admin_notices('gardener_application', v_app) = 1,
    'A2: enviar la solicitud no apunta el aviso al admin');
  SELECT * INTO v_row FROM public.notification_outbox
   WHERE type = 'admin_review_needed' AND payload ->> 'itemId' = v_app::text;
  PERFORM pg_temp.check_that(v_row.status = 'pending' AND v_row.booking_id IS NULL
    AND v_row.payload = jsonb_build_object('kind', 'gardener_application', 'itemId', v_app),
    'A3: el aviso no lleva solo el tipo y el id (nada de datos personales en la cola): ' || v_row.payload::text);

  -- Tocar la solicitud sin cambiar de estado no duplica el aviso.
  UPDATE public.gardener_applications SET city_zone = 'Estepona' WHERE id = v_app;
  UPDATE public.gardener_applications SET status = 'submitted' WHERE id = v_app;
  PERFORM pg_temp.check_that(pg_temp.admin_notices('gardener_application', v_app) = 1,
    'A4: un cambio que no es un envío duplica el aviso');

  -- Resuelta y reenviada tras corregirla (nueva fecha de envío): es otra novedad.
  UPDATE public.gardener_applications SET status = 'rejected', reviewed_at = now() WHERE id = v_app;
  UPDATE public.gardener_applications SET status = 'submitted', submitted_at = now() + interval '1 second' WHERE id = v_app;
  PERFORM pg_temp.check_that(pg_temp.admin_notices('gardener_application', v_app) = 2,
    'A5: reenviar una solicitud corregida no avisa de nuevo');

  -- Una solicitud que nace ya enviada también avisa.
  INSERT INTO public.gardener_applications (id, user_id, status, full_name, city_zone, services, experience_range, submitted_at)
  VALUES (gen_random_uuid(), v_cli, 'submitted', 'Otra Persona', 'Mijas', ARRAY['Poda'], '>5', now());
  PERFORM pg_temp.check_that((SELECT count(*) FROM public.notification_outbox WHERE type = 'admin_review_needed' AND payload ->> 'kind' = 'gardener_application') = 3,
    'A6: una solicitud que nace enviada no avisa');

  -- ===========================================================================
  -- B. Solicitud de empresa
  -- ===========================================================================
  INSERT INTO public.company_applications (id, user_id, status, commercial_name, city_zone, services)
  VALUES (v_company, v_empleado, 'draft', 'Jardines Prueba', 'Marbella', ARRAY['Poda']);
  PERFORM pg_temp.check_that(pg_temp.admin_notices('company_application', v_company) = 0, 'B1: un borrador de empresa avisa');
  UPDATE public.company_applications SET status = 'submitted', submitted_at = now() WHERE id = v_company;
  PERFORM pg_temp.check_that(pg_temp.admin_notices('company_application', v_company) = 1, 'B2: la solicitud de empresa no avisa');
  UPDATE public.company_applications SET status = 'approved' WHERE id = v_company;
  PERFORM pg_temp.check_that(pg_temp.admin_notices('company_application', v_company) = 1, 'B3: aprobarla avisa al admin de algo que ya hizo él');

  -- ===========================================================================
  -- C. Carnets
  -- ===========================================================================
  INSERT INTO public.gardener_licenses (id, gardener_id, document_url, status, submitted_by)
  VALUES (v_lic, v_pro, 'privado/carnet.pdf', 'pending', v_pro);
  PERFORM pg_temp.check_that(pg_temp.admin_notices('phyto_license', v_lic) = 1, 'C1: un carnet pendiente no avisa');
  INSERT INTO public.gardener_licenses (id, gardener_id, document_url, status, submitted_by)
  VALUES (v_lic2, v_empleado, 'privado/carnet-viejo.pdf', 'approved', v_empleado);
  PERFORM pg_temp.check_that(pg_temp.admin_notices('phyto_license', v_lic2) = 0, 'C2: un carnet que nace aprobado avisa');
  -- Subir un carnet nuevo sustituye al pendiente anterior: el aviso del anterior no cuenta ya como pendiente.
  INSERT INTO public.gardener_licenses (gardener_id, document_url, status, submitted_by)
  VALUES (v_pro, 'privado/carnet-corregido.pdf', 'pending', v_pro);
  PERFORM pg_temp.check_that((SELECT status FROM public.gardener_licenses WHERE id = v_lic) = 'replaced',
    'C3: el carnet anterior no queda sustituido');
  PERFORM pg_temp.check_that((SELECT count(*) FROM public.gardener_licenses WHERE gardener_id = v_pro AND status = 'pending') = 1,
    'C4: tras subir un carnet nuevo no queda exactamente uno pendiente');

  -- ===========================================================================
  -- D. Incidencias
  -- ===========================================================================
  INSERT INTO public.bookings (id, client_id, gardener_id, service_id, date, start_time, duration_hours, status, total_price, client_address, pricing_context)
  VALUES (gen_random_uuid(), v_cli, v_pro, v_servicio, current_date + 5, '09:00', 2, 'confirmed', 100, 'Calle 1', '{}'::jsonb)
  RETURNING id INTO v_booking;
  v_inc := gen_random_uuid();
  INSERT INTO public.booking_incidents (id, booking_id, reported_by, reporter_role, kind, description, status)
  VALUES (v_inc, v_booking, v_cli, 'client', 'billing', 'Me han cobrado de más y no entiendo por qué', 'open');
  PERFORM pg_temp.check_that(pg_temp.admin_notices('incident', v_inc) = 1, 'D1: una incidencia nueva no avisa');
  -- El aviso a la otra parte (el de siempre) sigue apuntándose: nada de lo anterior se ha tocado.
  PERFORM pg_temp.check_that(EXISTS (SELECT 1 FROM public.notification_outbox WHERE type = 'booking_incident_received'),
    'D2: se ha roto el aviso de incidencia que ya existía');

  -- ===========================================================================
  -- E. Un fallo al apuntar el aviso no tumba la acción
  -- ===========================================================================
  ALTER TABLE public.notification_outbox ADD CONSTRAINT zz_rompe_todo CHECK (type <> 'admin_review_needed') NOT VALID;
  v_inc2 := gen_random_uuid();
  INSERT INTO public.booking_incidents (id, booking_id, reported_by, reporter_role, kind, description, status)
  VALUES (v_inc2, v_booking, v_pro, 'gardener', 'other', 'Esto no puede fallar aunque el aviso no se apunte', 'open');
  PERFORM pg_temp.check_that(EXISTS (SELECT 1 FROM public.booking_incidents WHERE id = v_inc2),
    'E1: un fallo al apuntar el aviso impidió abrir la incidencia');
  PERFORM pg_temp.check_that(pg_temp.admin_notices('incident', v_inc2) = 0, 'E2: se apuntó un aviso que la restricción prohíbe');
  ALTER TABLE public.notification_outbox DROP CONSTRAINT zz_rompe_todo;

  -- ===========================================================================
  -- F. Contadores del menú: solo para administradores
  -- ===========================================================================
  PERFORM pg_temp.act_as(v_cli);
  BEGIN
    PERFORM public.admin_pending_review_counts();
    RAISE EXCEPTION 'FALLO F1: un cliente ve lo pendiente de revisión';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM pg_temp.act_as(NULL);
  BEGIN
    PERFORM public.admin_pending_review_counts();
    RAISE EXCEPTION 'FALLO F2: sin sesión se ve lo pendiente de revisión';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM pg_temp.act_as(v_admin);
  r := public.admin_pending_review_counts();
  PERFORM pg_temp.check_that(
    (r ->> 'gardenerApplications')::int >= 2 AND (r ->> 'companyApplications')::int >= 0
    AND (r ->> 'licenses')::int >= 1 AND (r ->> 'incidents')::int >= 2
    AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(r) k) = ARRAY['companyApplications', 'gardenerApplications', 'incidents', 'licenses'],
    'F3: los contadores no son los esperados: ' || r::text);
  PERFORM pg_temp.act_as(NULL);

  PERFORM pg_temp.check_that(
    NOT has_function_privilege('anon', 'public.admin_pending_review_counts()', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.admin_pending_review_counts()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'private.enqueue_admin_review(text, uuid, timestamptz)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'private.enqueue_admin_review(text, uuid, timestamptz)', 'EXECUTE'),
    'F4: permisos de las funciones de aviso al admin');

  RAISE WARNING 'TODAS LAS COMPROBACIONES OK';
END;
$prueba$;

ROLLBACK;
