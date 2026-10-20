-- Pruebas de «completar la cuenta profesional» (migración 20261020120000).
--
-- Todo corre dentro de una transacción que se revierte al final: se puede lanzar contra una base
-- con datos sin ensuciarla:
--
--   docker exec -i <contenedor_db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/provider_setup_status.test.sql
--
-- Cualquier comprobación que falle aborta con excepción. Si termina con
-- "TODAS LAS COMPROBACIONES OK", todo lo de abajo se cumple.
--
-- Va en SQL porque el estado lo calcula la base de datos con las mismas funciones que deciden quién
-- sale a los clientes (provider_workers_all, provider_free_hours): un doble en TypeScript no
-- probaría lo que de verdad se ejecuta.

BEGIN;

SET client_min_messages = WARNING;

DO $prueba$
DECLARE
  v_solo     uuid := '00000000-5e70-4bee-8aaa-000000000001';
  v_empresa  uuid := '00000000-5e70-4bee-8aaa-000000000002';
  v_ana      uuid := '00000000-5e70-4bee-8aaa-000000000003';
  v_cliente  uuid := '00000000-5e70-4bee-8aaa-000000000004';
  v_admin    uuid := '00000000-5e70-4bee-8aaa-000000000005';
  v_lawn     uuid;
  v_phyto    uuid;
  v_weeding  uuid;
  v_hedge    uuid;
  v_company  uuid;
  v_owner_member uuid;
  v_ana_member   uuid;
  v_day      date := (now() AT TIME ZONE 'Europe/Madrid')::date + 2;
  s          jsonb;
  v_svc      jsonb;
  v_ok       boolean;
BEGIN
  SELECT id INTO v_lawn FROM public.services WHERE name = 'Corte de césped';
  SELECT id INTO v_phyto FROM public.services WHERE name = 'Servicios fitosanitarios';
  SELECT id INTO v_weeding FROM public.services WHERE name = 'Desbroce de malas hierbas';
  SELECT id INTO v_hedge FROM public.services WHERE name = 'Poda de setos';
  IF v_lawn IS NULL OR v_phyto IS NULL OR v_weeding IS NULL OR v_hedge IS NULL THEN
    RAISE EXCEPTION 'Faltan servicios: ejecuta `supabase db reset` antes de estas pruebas';
  END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  SELECT u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    u.email, 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', ''
  FROM (VALUES
    (v_solo, 'setup.solo@test.local'),
    (v_empresa, 'setup.empresa@test.local'),
    (v_ana, 'setup.ana@test.local'),
    (v_cliente, 'setup.cliente@test.local'),
    (v_admin, 'setup.admin@test.local')
  ) AS u(id, email);
  -- El perfil lo crea el trigger de auth.users; solo se le pone el rol.
  UPDATE public.profiles SET role = 'gardener', full_name = 'Solo Pruebas' WHERE user_id = v_solo;
  UPDATE public.profiles SET role = 'company', full_name = 'Empresa Pruebas' WHERE user_id = v_empresa;
  UPDATE public.profiles SET role = 'employee', full_name = 'Ana Pruebas' WHERE user_id = v_ana;
  UPDATE public.profiles SET role = 'admin' WHERE user_id = v_admin;

  -- ---------------------------------------------------------------------------
  -- 1. Jardinero recién aprobado: nada configurado, nada visible
  -- ---------------------------------------------------------------------------
  INSERT INTO public.gardener_profiles (user_id, full_name, phone, address)
  VALUES (v_solo, 'Solo Pruebas', '600000000', 'Marbella');

  s := public.provider_setup_status(v_solo);
  IF s ->> 'provider_kind' <> 'solo' OR (s ->> 'suspended')::boolean
     OR jsonb_array_length(s -> 'services') <> 0
     OR (s #>> '{profile,has_coordinates}')::boolean
     OR (s #>> '{profile,has_description}')::boolean
     OR (s #>> '{profile,has_photo}')::boolean
     OR (s #>> '{schedule,has_recurring}')::boolean
     OR (s #>> '{schedule,free_hours_14d}')::int <> 0
     OR (s #>> '{license,active}')::boolean
     OR s -> 'team' <> 'null'::jsonb
     OR (s ->> 'push_enabled')::boolean THEN
    RAISE EXCEPTION 'FALLO 1: un jardinero recién aprobado no sale vacío: %', s;
  END IF;
  IF public.provider_setup_status(v_cliente) IS NOT NULL THEN
    RAISE EXCEPTION 'FALLO 1b: una cuenta sin ficha de proveedor tiene estado';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 2. Se completa paso a paso, y solo sale cuando lo tiene todo
  -- ---------------------------------------------------------------------------
  INSERT INTO public.gardener_service_prices (gardener_id, service_id, unit_type, price_per_unit, active, additional_config)
  VALUES (v_solo, v_lawn, 'area', 0, true, '{}'::jsonb),
         (v_solo, v_hedge, 'area', 0, false, '{}'::jsonb);
  s := public.provider_setup_status(v_solo);
  IF jsonb_array_length(s -> 'services') <> 1 OR s #>> '{services,0,name}' <> 'Corte de césped' THEN
    RAISE EXCEPTION 'FALLO 2a: solo cuentan las tarifas ACTIVAS: %', s -> 'services';
  END IF;
  IF (s #>> '{services,0,workers}')::int <> 1 OR (s #>> '{services,0,visible}')::boolean THEN
    RAISE EXCEPTION 'FALLO 2b: con tarifa pero sin zona ni horas no puede salir: %', s -> 'services';
  END IF;

  UPDATE public.gardener_profiles SET operational_latitude = 36.51, operational_longitude = -4.88 WHERE user_id = v_solo;
  s := public.provider_setup_status(v_solo);
  IF NOT (s #>> '{profile,has_coordinates}')::boolean OR (s #>> '{services,0,visible}')::boolean THEN
    RAISE EXCEPTION 'FALLO 2c: con zona pero sin horas libres no puede salir: %', s;
  END IF;

  INSERT INTO public.availability (gardener_id, date, start_time, end_time, is_available)
  SELECT v_solo, v_day, make_time(h, 0, 0), make_time(h + 1, 0, 0), true FROM generate_series(9, 12) AS h;
  -- Fuera de la ventana de 14 días: no cuenta.
  INSERT INTO public.availability (gardener_id, date, start_time, end_time, is_available)
  VALUES (v_solo, v_day + 20, '09:00', '10:00', true);
  s := public.provider_setup_status(v_solo);
  IF (s #>> '{schedule,free_hours_14d}')::int <> 4
     OR (s #>> '{services,0,workers_with_hours}')::int <> 1
     OR NOT (s #>> '{services,0,visible}')::boolean THEN
    RAISE EXCEPTION 'FALLO 2d: con tarifa, zona y 4 horas libres en la ventana tiene que salir: %', s;
  END IF;
  IF (s #>> '{schedule,has_recurring}')::boolean THEN
    RAISE EXCEPTION 'FALLO 2e: sin horario fijo no puede decir que lo tiene';
  END IF;

  INSERT INTO public.recurring_schedules (gardener_id, day_of_week, start_time, end_time)
  VALUES (v_solo, 1, '09:00', '13:00');
  IF NOT (public.provider_setup_status(v_solo) #>> '{schedule,has_recurring}')::boolean THEN
    RAISE EXCEPTION 'FALLO 2f: el horario fijo no se ve';
  END IF;

  -- La antelación mínima quita las horas que ya no se pueden reservar (como booking-authority).
  INSERT INTO public.recurring_availability_settings (gardener_id, weeks_to_maintain, min_notice_hours)
  VALUES (v_solo, 4, 24 * 6);
  s := public.provider_setup_status(v_solo);
  IF (s #>> '{schedule,free_hours_14d}')::int <> 0 OR (s #>> '{services,0,visible}')::boolean THEN
    RAISE EXCEPTION 'FALLO 2g: con 6 días de antelación, las horas de pasado mañana no cuentan: %', s;
  END IF;
  UPDATE public.recurring_availability_settings SET min_notice_hours = 0 WHERE gardener_id = v_solo;

  UPDATE public.gardener_profiles SET suspended_at = now() WHERE user_id = v_solo;
  s := public.provider_setup_status(v_solo);
  IF NOT (s ->> 'suspended')::boolean OR (s #>> '{services,0,visible}')::boolean THEN
    RAISE EXCEPTION 'FALLO 2h: una cuenta suspendida no sale: %', s;
  END IF;
  UPDATE public.gardener_profiles SET suspended_at = NULL WHERE user_id = v_solo;

  -- Recomendados: descripción, foto (por el trigger) y avisos.
  UPDATE public.gardener_profiles SET description = 'Diez años cuidando jardines en Marbella.' WHERE user_id = v_solo;
  UPDATE public.profiles SET avatar_url = 'https://ejemplo.test/foto.jpg' WHERE user_id = v_solo;
  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
  VALUES (v_solo, 'https://fcm.googleapis.com/fcm/send/prueba-setup', repeat('k', 87), repeat('a', 22));
  s := public.provider_setup_status(v_solo);
  IF NOT (s #>> '{profile,has_description}')::boolean
     OR NOT (s #>> '{profile,has_photo}')::boolean
     OR NOT (s ->> 'push_enabled')::boolean THEN
    RAISE EXCEPTION 'FALLO 2i: los recomendados no se ven hechos: %', s;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 3. La foto que ven los clientes sigue a la de «Mi cuenta»
  -- ---------------------------------------------------------------------------
  IF (SELECT avatar_url FROM public.gardener_profiles WHERE user_id = v_solo) IS DISTINCT FROM 'https://ejemplo.test/foto.jpg' THEN
    RAISE EXCEPTION 'FALLO 3a: la foto de «Mi cuenta» no llega a la ficha que ven los clientes';
  END IF;
  UPDATE public.profiles SET avatar_url = 'https://ejemplo.test/otra.jpg' WHERE user_id = v_solo;
  IF (SELECT avatar_url FROM public.public_gardener_directory WHERE user_id = v_solo) IS DISTINCT FROM 'https://ejemplo.test/otra.jpg' THEN
    RAISE EXCEPTION 'FALLO 3b: cambiar la foto no la cambia para los clientes';
  END IF;
  -- Un cliente o un empleado no tienen ficha: cambiar su foto no toca nada más.
  UPDATE public.profiles SET avatar_url = 'https://ejemplo.test/cliente.jpg' WHERE user_id = v_cliente;

  -- ---------------------------------------------------------------------------
  -- 4. Carnet: solo lo piden los tratamientos químicos y el herbicida
  -- ---------------------------------------------------------------------------
  INSERT INTO public.gardener_service_prices (gardener_id, service_id, unit_type, price_per_unit, active, additional_config)
  VALUES (v_solo, v_phyto, 'area', 0, true, '{}'::jsonb),
         (v_solo, v_weeding, 'area', 0, true, '{"precio_herbicida_m2": 0}'::jsonb);
  s := public.provider_setup_status(v_solo);
  SELECT x INTO v_svc FROM jsonb_array_elements(s -> 'services') x WHERE x ->> 'name' = 'Servicios fitosanitarios';
  IF NOT (v_svc ->> 'needs_license')::boolean OR NOT (v_svc ->> 'visible')::boolean OR (v_svc ->> 'visible_chemical')::boolean THEN
    RAISE EXCEPTION 'FALLO 4a: sin carnet, fitosanitarios sale para ecológicos pero no para químicos: %', v_svc;
  END IF;
  SELECT x INTO v_svc FROM jsonb_array_elements(s -> 'services') x WHERE x ->> 'name' = 'Desbroce de malas hierbas';
  IF (v_svc ->> 'needs_license')::boolean THEN
    RAISE EXCEPTION 'FALLO 4b: un desbroce sin herbicida no pide carnet';
  END IF;
  UPDATE public.gardener_service_prices SET additional_config = '{"precio_herbicida_m2": 0.4}'::jsonb
  WHERE gardener_id = v_solo AND service_id = v_weeding;
  SELECT x INTO v_svc FROM jsonb_array_elements(public.provider_setup_status(v_solo) -> 'services') x WHERE x ->> 'name' = 'Desbroce de malas hierbas';
  IF NOT (v_svc ->> 'needs_license')::boolean THEN
    RAISE EXCEPTION 'FALLO 4c: un desbroce con herbicida pide carnet';
  END IF;

  INSERT INTO public.gardener_licenses (gardener_id, license_number, document_url, status)
  VALUES (v_solo, 'L-1', 'licencias/l1.pdf', 'pending');
  IF public.provider_setup_status(v_solo) #>> '{license,status}' <> 'pending' THEN
    RAISE EXCEPTION 'FALLO 4d: el carnet en revisión no se ve';
  END IF;

  UPDATE public.gardener_licenses SET status = 'approved', expires_at = now() + interval '1 year' WHERE gardener_id = v_solo;
  UPDATE public.gardener_profiles
  SET license_verification_status = 'approved', license_expires_at = now() + interval '1 year'
  WHERE user_id = v_solo;
  s := public.provider_setup_status(v_solo);
  SELECT x INTO v_svc FROM jsonb_array_elements(s -> 'services') x WHERE x ->> 'name' = 'Servicios fitosanitarios';
  IF NOT (s #>> '{license,active}')::boolean OR NOT (v_svc ->> 'visible_chemical')::boolean THEN
    RAISE EXCEPTION 'FALLO 4e: con el carnet aprobado y vigente, sale también para químicos: %', s;
  END IF;

  UPDATE public.gardener_licenses SET expires_at = now() - interval '1 day' WHERE gardener_id = v_solo;
  UPDATE public.gardener_profiles SET license_expires_at = now() - interval '1 day' WHERE user_id = v_solo;
  s := public.provider_setup_status(v_solo);
  IF (s #>> '{license,active}')::boolean OR s #>> '{license,status}' <> 'expired' THEN
    RAISE EXCEPTION 'FALLO 4f: un carnet aprobado con la fecha pasada cuenta como caducado: %', s -> 'license';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 5. Empresa: quién trabaja, qué hace cada uno y sus horas
  -- ---------------------------------------------------------------------------
  INSERT INTO public.gardener_profiles (user_id, full_name, phone, address, provider_kind, operational_latitude, operational_longitude)
  VALUES (v_empresa, 'Empresa Pruebas', '611111111', 'Málaga', 'company', 36.72, -4.42);
  INSERT INTO public.companies (provider_user_id, legal_name, tax_id) VALUES (v_empresa, 'Empresa Pruebas SL', 'B00000000')
  RETURNING id INTO v_company;
  INSERT INTO public.company_members (company_id, user_id, role, counts_as_labour)
  VALUES (v_company, v_empresa, 'owner', false) RETURNING id INTO v_owner_member;
  INSERT INTO public.gardener_service_prices (gardener_id, service_id, unit_type, price_per_unit, active, additional_config)
  VALUES (v_empresa, v_lawn, 'area', 0, true, '{}'::jsonb);

  s := public.provider_setup_status(v_empresa);
  IF s ->> 'provider_kind' <> 'company' OR (s #>> '{team,owner_works}')::boolean
     OR jsonb_array_length(s #> '{team,members}') <> 0
     OR (s #>> '{services,0,workers}')::int <> 0
     OR (s #>> '{services,0,visible}')::boolean THEN
    RAISE EXCEPTION 'FALLO 5a: una empresa sin nadie que trabaje no puede salir: %', s;
  END IF;

  UPDATE public.company_members SET counts_as_labour = true WHERE id = v_owner_member;
  s := public.provider_setup_status(v_empresa);
  IF NOT (s #>> '{team,owner_works}')::boolean OR jsonb_array_length(s #> '{team,members}') <> 1
     OR (s #>> '{services,0,workers}')::int <> 0 THEN
    RAISE EXCEPTION 'FALLO 5b: el dueño que trabaja cuenta, pero sin servicios asignados no hace nada: %', s;
  END IF;

  INSERT INTO public.company_member_services (member_id, service_id) VALUES (v_owner_member, v_lawn);
  s := public.provider_setup_status(v_empresa);
  IF (s #>> '{services,0,workers}')::int <> 1 OR (s #>> '{services,0,workers_with_hours}')::int <> 0
     OR (s #>> '{services,0,visible}')::boolean THEN
    RAISE EXCEPTION 'FALLO 5c: con el servicio asignado pero sin horas no sale: %', s -> 'services';
  END IF;

  INSERT INTO public.company_members (company_id, user_id, role) VALUES (v_company, v_ana, 'employee')
  RETURNING id INTO v_ana_member;
  INSERT INTO public.company_member_services (member_id, service_id) VALUES (v_ana_member, v_lawn);
  INSERT INTO public.availability (gardener_id, date, start_time, end_time, is_available)
  SELECT v_ana, v_day, make_time(h, 0, 0), make_time(h + 1, 0, 0), true FROM generate_series(9, 11) AS h;
  s := public.provider_setup_status(v_empresa);
  IF (s #>> '{services,0,workers}')::int <> 2 OR (s #>> '{services,0,workers_with_hours}')::int <> 1
     OR NOT (s #>> '{services,0,visible}')::boolean THEN
    RAISE EXCEPTION 'FALLO 5d: con Ana con horas, la empresa sale en césped: %', s -> 'services';
  END IF;
  SELECT x INTO v_svc FROM jsonb_array_elements(s #> '{team,members}') x WHERE x ->> 'user_id' = v_ana::text;
  IF (v_svc ->> 'free_hours_14d')::int <> 3 OR (v_svc ->> 'has_recurring_schedule')::boolean
     OR v_svc ->> 'name' <> 'Ana Pruebas' OR v_svc -> 'service_ids' <> jsonb_build_array(v_lawn) THEN
    RAISE EXCEPTION 'FALLO 5e: los datos de Ana no son los esperados: %', v_svc;
  END IF;

  UPDATE public.companies SET status = 'suspended' WHERE id = v_company;
  s := public.provider_setup_status(v_empresa);
  IF NOT (s ->> 'suspended')::boolean OR (s #>> '{services,0,visible}')::boolean THEN
    RAISE EXCEPTION 'FALLO 5f: una empresa suspendida no sale: %', s;
  END IF;
  UPDATE public.companies SET status = 'active' WHERE id = v_company;

  INSERT INTO public.company_invitations (company_id, email, token_hash, expires_at, created_by)
  VALUES (v_company, 'nuevo@test.local', 'hash', now() + interval '7 days', v_empresa);
  IF (public.provider_setup_status(v_empresa) #>> '{team,pending_invitations}')::int <> 1 THEN
    RAISE EXCEPTION 'FALLO 5g: la invitación pendiente no se cuenta';
  END IF;

  -- Fitosanitarios en la empresa: el carnet es de cada persona.
  INSERT INTO public.gardener_service_prices (gardener_id, service_id, unit_type, price_per_unit, active, additional_config)
  VALUES (v_empresa, v_phyto, 'area', 0, true, '{}'::jsonb);
  INSERT INTO public.company_member_services (member_id, service_id) VALUES (v_ana_member, v_phyto);
  SELECT x INTO v_svc FROM jsonb_array_elements(public.provider_setup_status(v_empresa) -> 'services') x WHERE x ->> 'name' = 'Servicios fitosanitarios';
  IF NOT (v_svc ->> 'visible')::boolean OR (v_svc ->> 'visible_chemical')::boolean OR (v_svc ->> 'licensed_workers_with_hours')::int <> 0 THEN
    RAISE EXCEPTION 'FALLO 5h: sin carnet de Ana, fitosanitarios sale solo para ecológicos: %', v_svc;
  END IF;
  INSERT INTO public.gardener_licenses (gardener_id, license_number, document_url, status, expires_at)
  VALUES (v_ana, 'L-ANA', 'licencias/ana.pdf', 'approved', now() + interval '1 year');
  s := public.provider_setup_status(v_empresa);
  SELECT x INTO v_svc FROM jsonb_array_elements(s -> 'services') x WHERE x ->> 'name' = 'Servicios fitosanitarios';
  IF NOT (v_svc ->> 'visible_chemical')::boolean THEN
    RAISE EXCEPTION 'FALLO 5i: con el carnet de Ana, fitosanitarios sale también para químicos: %', v_svc;
  END IF;
  SELECT x INTO v_svc FROM jsonb_array_elements(s #> '{team,members}') x WHERE x ->> 'user_id' = v_ana::text;
  IF NOT (v_svc ->> 'has_valid_license')::boolean OR v_svc ->> 'license_status' <> 'approved' THEN
    RAISE EXCEPTION 'FALLO 5j: el carnet de Ana no se ve: %', v_svc;
  END IF;

  -- Una persona dada de baja ya no cuenta.
  UPDATE public.company_members SET status = 'inactive', left_at = now() WHERE id = v_ana_member;
  s := public.provider_setup_status(v_empresa);
  IF jsonb_array_length(s #> '{team,members}') <> 1 OR (s #>> '{services,0,visible}')::boolean THEN
    RAISE EXCEPTION 'FALLO 5k: sin Ana no queda nadie con horas: %', s;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 6. Quién puede pedir qué
  -- ---------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_solo)::text, true);
  IF public.my_provider_setup_status() ->> 'provider_id' <> v_solo::text THEN
    RAISE EXCEPTION 'FALLO 6a: el jardinero no recibe su propio estado';
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_empresa)::text, true);
  IF public.my_provider_setup_status() ->> 'provider_kind' <> 'company' THEN
    RAISE EXCEPTION 'FALLO 6b: la cuenta de la empresa no recibe su estado';
  END IF;

  FOREACH s IN ARRAY ARRAY[to_jsonb(v_ana), to_jsonb(v_cliente)] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', s #>> '{}')::text, true);
    v_ok := false;
    BEGIN
      PERFORM public.my_provider_setup_status();
    EXCEPTION WHEN insufficient_privilege THEN
      v_ok := true;
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'FALLO 6c: una cuenta sin ficha (empleado o cliente) recibe un estado: %', s;
    END IF;
  END LOOP;

  v_ok := false;
  BEGIN
    PERFORM public.admin_provider_setup_overview();
  EXCEPTION WHEN insufficient_privilege THEN
    v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'FALLO 6d: un cliente ve la lista del admin';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  s := public.admin_provider_setup_overview();
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s) x WHERE x ->> 'user_id' = v_solo::text AND x ->> 'email' = 'setup.solo@test.local' AND x #>> '{status,provider_id}' = v_solo::text)
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s) x WHERE x ->> 'user_id' = v_empresa::text AND x ->> 'provider_kind' = 'company') THEN
    RAISE EXCEPTION 'FALLO 6e: el admin no ve a los dos proveedores con su estado';
  END IF;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF has_function_privilege('anon', 'public.my_provider_setup_status()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_provider_setup_overview()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.provider_setup_status(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.worker_free_hours_count(uuid, date, date, timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.latest_phyto_license_status(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALLO 6f: alguna función interna se puede llamar desde fuera';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.my_provider_setup_status()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.admin_provider_setup_overview()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALLO 6g: las funciones del panel y del admin no se pueden llamar con sesión';
  END IF;

  RAISE WARNING 'TODAS LAS COMPROBACIONES OK';
END
$prueba$;

ROLLBACK;
