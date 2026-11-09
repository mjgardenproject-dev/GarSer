-- Pruebas de la cuenta de profesional única y dinámica (migración 20261108120000).
--
-- Todo corre dentro de una transacción que se revierte al final: se puede lanzar contra una base
-- con datos sin ensuciarla:
--
--   docker exec -i <contenedor_db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/professional_mode.test.sql
--
-- Cualquier comprobación que falle aborta con excepción. Si termina con
-- "TODAS LAS COMPROBACIONES OK", todo lo de abajo se cumple.
--
-- Va en SQL porque el modo lo decide la base de datos (un disparador sobre company_members) y lo
-- leen las funciones del motor de reserva (provider_workers_all, provider_max_crew…): un doble en
-- TypeScript no probaría lo que de verdad se ejecuta.

BEGIN;

SET client_min_messages = WARNING;

-- Ayudantes (viven solo en esta sesión).
CREATE FUNCTION pg_temp.check_that(p_ok boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FALLO %', p_msg; END IF;
END $$;

-- Actúa como esa persona (auth.uid() lee las claims); NULL = sin sesión.
CREATE FUNCTION pg_temp.as_user(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN NULL ELSE json_build_object('sub', p_uid)::text END, true);
END $$;

-- Ejecuta una sentencia y devuelve el mensaje del error, o NULL si no falló. Cada llamada hace un
-- savepoint implícito: lo que haya hecho la sentencia se deshace si falla.
CREATE FUNCTION pg_temp.error_of(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;

CREATE FUNCTION pg_temp.new_user(p_id uuid, p_email text, p_meta jsonb DEFAULT '{}'::jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  VALUES (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    p_email, 'x', now(), now(), now(), '{}'::jsonb, p_meta, '', '', '', '', '', '', '', '');
END $$;

DO $prueba$
DECLARE
  v_pro      uuid := '00000000-6d0d-4e11-8bbb-000000000001';
  v_ana      uuid := '00000000-6d0d-4e11-8bbb-000000000002';
  v_luis     uuid := '00000000-6d0d-4e11-8bbb-000000000003';
  v_otro     uuid := '00000000-6d0d-4e11-8bbb-000000000004';  -- otro profesional (con ficha)
  v_cliente  uuid := '00000000-6d0d-4e11-8bbb-000000000005';  -- cliente con una reserva
  v_susp     uuid := '00000000-6d0d-4e11-8bbb-000000000006';  -- profesional suspendido
  v_antiguo  uuid := '00000000-6d0d-4e11-8bbb-000000000007';  -- empresa del camino antiguo
  v_nuevo    uuid := '00000000-6d0d-4e11-8bbb-000000000008';  -- cliente sin actividad
  v_m1       uuid := '00000000-6d0d-4e11-8bbb-000000000011';
  v_m2       uuid := '00000000-6d0d-4e11-8bbb-000000000012';
  v_m3       uuid := '00000000-6d0d-4e11-8bbb-000000000013';
  v_m4       uuid := '00000000-6d0d-4e11-8bbb-000000000014';
  v_lawn     uuid;
  v_hedge    uuid;
  v_phyto    uuid;
  v_company  uuid;
  v_company_again uuid;
  v_owner_member uuid;
  v_ana_member   uuid;
  v_luis_member  uuid;
  v_inv      jsonb;
  v_inv_luis jsonb;
  v_inv_otro jsonb;
  v_booking  uuid := gen_random_uuid();
  s          jsonb;
  v_err      text;
  v_services uuid[];
BEGIN
  SELECT id INTO v_lawn FROM public.services WHERE name = 'Corte de césped';
  SELECT id INTO v_hedge FROM public.services WHERE name = 'Poda de setos';
  SELECT id INTO v_phyto FROM public.services WHERE name = 'Servicios fitosanitarios';
  IF v_lawn IS NULL OR v_hedge IS NULL OR v_phyto IS NULL THEN
    RAISE EXCEPTION 'Faltan servicios: ejecuta `supabase db reset` antes de estas pruebas';
  END IF;

  PERFORM pg_temp.new_user(v_pro, 'modo.pro@test.local');
  PERFORM pg_temp.new_user(v_ana, 'modo.ana@test.local');
  PERFORM pg_temp.new_user(v_luis, 'modo.luis@test.local');
  PERFORM pg_temp.new_user(v_otro, 'modo.otro@test.local');
  PERFORM pg_temp.new_user(v_cliente, 'modo.cliente@test.local');
  PERFORM pg_temp.new_user(v_susp, 'modo.susp@test.local');
  PERFORM pg_temp.new_user(v_antiguo, 'modo.antiguo@test.local');
  PERFORM pg_temp.new_user(v_nuevo, 'modo.nuevo@test.local');
  -- Altas con distintos metadatos: el perfil lo crea el trigger de auth.users.
  PERFORM pg_temp.new_user(v_m1, 'modo.m1@test.local', '{"requested_role": "company"}');
  PERFORM pg_temp.new_user(v_m2, 'modo.m2@test.local', '{"role": "gardener"}');
  PERFORM pg_temp.new_user(v_m3, 'modo.m3@test.local', '{"requested_role": "admin"}');
  PERFORM pg_temp.new_user(v_m4, 'modo.m4@test.local');

  UPDATE public.profiles SET role = 'gardener', full_name = 'Pro Pruebas' WHERE user_id = v_pro;
  UPDATE public.profiles SET role = 'gardener', full_name = 'Otro Pro' WHERE user_id = v_otro;
  UPDATE public.profiles SET role = 'gardener', full_name = 'Pro Suspendido' WHERE user_id = v_susp;
  UPDATE public.profiles SET role = 'gardener', full_name = 'Empresa Antigua' WHERE user_id = v_antiguo;

  INSERT INTO public.gardener_profiles (user_id, full_name, phone, address)
  VALUES (v_pro, 'Pro Pruebas', '600000001', 'Marbella'),
         (v_otro, 'Otro Pro', '600000004', 'Marbella'),
         (v_susp, 'Pro Suspendido', '600000006', 'Marbella'),
         (v_antiguo, 'Empresa Antigua', '600000007', 'Marbella');
  UPDATE public.gardener_profiles SET suspended_at = now() WHERE user_id = v_susp;
  INSERT INTO public.gardener_service_prices (gardener_id, service_id, unit_type, price_per_unit, active, additional_config)
  VALUES (v_pro, v_lawn, 'area', 0, true, '{}'::jsonb),
         (v_pro, v_hedge, 'area', 0, false, '{}'::jsonb),
         (v_pro, v_phyto, 'area', 0, true, '{}'::jsonb);

  -- ---------------------------------------------------------------------------
  -- 1. Registro: un solo tipo de profesional
  -- ---------------------------------------------------------------------------
  PERFORM pg_temp.check_that(public.signup_role_from_metadata('{"requested_role":"company"}') = 'gardener',
    '1a: pedir «company» al registrarse tiene que dar gardener');
  PERFORM pg_temp.check_that(public.signup_role_from_metadata('{"role":"company"}') = 'gardener',
    '1b: role=company en los metadatos tiene que dar gardener');
  PERFORM pg_temp.check_that(public.signup_role_from_metadata('{"requested_role":"gardener"}') = 'gardener',
    '1c: gardener sigue dando gardener');
  PERFORM pg_temp.check_that(public.signup_role_from_metadata('{"requested_role":"admin"}') = 'client'
    AND public.signup_role_from_metadata('{"requested_role":"employee"}') = 'client'
    AND public.signup_role_from_metadata('{}') = 'client'
    AND public.signup_role_from_metadata(NULL) = 'client',
    '1d: admin, employee, vacío y NULL dan client');
  PERFORM pg_temp.check_that(
    (SELECT role FROM public.profiles WHERE user_id = v_m1) = 'gardener'
    AND (SELECT role FROM public.profiles WHERE user_id = v_m2) = 'gardener'
    AND (SELECT role FROM public.profiles WHERE user_id = v_m3) = 'client'
    AND (SELECT role FROM public.profiles WHERE user_id = v_m4) = 'client',
    '1e: el perfil que crea el alta no sigue la regla de roles');

  PERFORM pg_temp.as_user(v_nuevo);
  v_err := public.self_declare_signup_role('company');
  PERFORM pg_temp.check_that(v_err = 'declared', '1f: declararse «company» tiene que devolver declared (devolvió ' || COALESCE(v_err, 'NULL') || ')');
  PERFORM pg_temp.check_that((SELECT role FROM public.profiles WHERE user_id = v_nuevo) = 'gardener',
    '1f2: declararse «company» tiene que dejar la cuenta como gardener');
  PERFORM pg_temp.check_that(public.self_declare_signup_role('company') = 'unchanged'
    AND public.self_declare_signup_role('gardener') = 'unchanged',
    '1g: repetirlo (company o gardener) no cambia nada');
  v_err := pg_temp.error_of($q$SELECT public.self_declare_signup_role('admin')$q$);
  PERFORM pg_temp.check_that(v_err IS NOT NULL, '1h: admin se puede autodeclarar');
  PERFORM pg_temp.as_user(NULL);

  -- ---------------------------------------------------------------------------
  -- 2. Un profesional recién aprobado está en modo individual, sin rastro de equipo
  -- ---------------------------------------------------------------------------
  PERFORM pg_temp.as_user(v_pro);
  s := public.my_provider_mode();
  PERFORM pg_temp.check_that(
    (s ->> 'is_professional')::boolean AND s ->> 'mode' = 'individual'
    AND NOT (s ->> 'has_team_structure')::boolean AND (s ->> 'active_employees')::int = 0
    AND (s ->> 'pending_invitations')::int = 0 AND (s ->> 'owner_works')::boolean
    AND NOT (s ->> 'suspended')::boolean AND NOT (s ->> 'liability_declared')::boolean,
    '2a: un profesional nuevo no sale individual y limpio: ' || s::text);

  PERFORM pg_temp.as_user(v_cliente);
  s := public.my_provider_mode();
  PERFORM pg_temp.check_that(NOT (s ->> 'is_professional')::boolean AND NOT (s ? 'mode'),
    '2b: un cliente no es profesional ni tiene modo: ' || s::text);
  PERFORM pg_temp.as_user(NULL);
  PERFORM pg_temp.check_that(NOT (public.my_provider_mode() ->> 'is_professional')::boolean,
    '2c: sin sesión no hay profesional');

  -- ---------------------------------------------------------------------------
  -- 3. Invitar al primer compañero: validaciones y atomicidad (nada queda a medias)
  -- ---------------------------------------------------------------------------
  PERFORM pg_temp.as_user(v_cliente);
  PERFORM pg_temp.check_that(
    pg_temp.error_of($q$SELECT public.create_company_invitation('modo.ana@test.local', true)$q$) IS NOT NULL,
    '3a: un cliente (sin ficha) puede invitar');
  PERFORM pg_temp.as_user(v_susp);
  PERFORM pg_temp.check_that(
    pg_temp.error_of($q$SELECT public.create_company_invitation('modo.ana@test.local', true)$q$) IS NOT NULL,
    '3b: un profesional suspendido puede invitar');
  PERFORM pg_temp.as_user(NULL);
  PERFORM pg_temp.check_that(
    pg_temp.error_of($q$SELECT public.create_company_invitation('modo.ana@test.local', true)$q$) IS NOT NULL,
    '3c: sin sesión se puede invitar');

  PERFORM pg_temp.as_user(v_pro);
  PERFORM pg_temp.check_that(
    pg_temp.error_of($q$SELECT public.create_company_invitation('esto-no-es-un-correo', true)$q$) IS NOT NULL,
    '3d: un correo inválido se acepta');
  v_err := pg_temp.error_of($q$SELECT public.create_company_invitation('modo.ana@test.local')$q$);
  PERFORM pg_temp.check_that(v_err ILIKE '%seguro%',
    '3e: la primera invitación sin declarar el seguro tiene que pedirlo (error: ' || COALESCE(v_err, 'ninguno') || ')');
  v_err := pg_temp.error_of($q$SELECT public.create_company_invitation('modo.ana@test.local', false)$q$);
  PERFORM pg_temp.check_that(v_err ILIKE '%seguro%',
    '3f: declarar false tampoco vale (error: ' || COALESCE(v_err, 'ninguno') || ')');
  PERFORM pg_temp.check_that(
    NOT EXISTS (SELECT 1 FROM public.companies WHERE provider_user_id = v_pro)
    AND NOT EXISTS (SELECT 1 FROM public.company_members WHERE user_id = v_pro),
    '3g: una invitación fallida deja una empresa a medias');

  -- ---------------------------------------------------------------------------
  -- 4. Primera invitación: promoción en sitio, y la app NO cambia hasta que acepten
  -- ---------------------------------------------------------------------------
  v_inv := public.create_company_invitation('Modo.Ana@test.local', true);
  PERFORM pg_temp.check_that(v_inv ->> 'token' IS NOT NULL AND v_inv ->> 'email' = 'modo.ana@test.local',
    '4a: la invitación no devuelve token ni correo normalizado: ' || v_inv::text);
  SELECT id INTO v_company FROM public.companies WHERE provider_user_id = v_pro;
  PERFORM pg_temp.check_that(v_company IS NOT NULL, '4b: no se creó la empresa al invitar');
  SELECT id INTO v_owner_member FROM public.company_members
  WHERE company_id = v_company AND user_id = v_pro AND role = 'owner' AND status = 'active' AND counts_as_labour;
  PERFORM pg_temp.check_that(v_owner_member IS NOT NULL, '4c: el titular no es el miembro dueño que trabaja');
  PERFORM pg_temp.check_that((SELECT liability_declared_at FROM public.companies WHERE id = v_company) IS NOT NULL,
    '4d: la declaración de seguro no se guarda con fecha');
  PERFORM pg_temp.check_that((SELECT provider_kind FROM public.gardener_profiles WHERE user_id = v_pro) = 'solo',
    '4e: una invitación pendiente cambia el modo');
  s := public.my_provider_mode();
  PERFORM pg_temp.check_that(
    s ->> 'mode' = 'individual' AND (s ->> 'has_team_structure')::boolean
    AND (s ->> 'pending_invitations')::int = 1 AND (s ->> 'active_employees')::int = 0
    AND (s ->> 'liability_declared')::boolean,
    '4f: con una invitación pendiente sigue siendo individual con 1 pendiente: ' || s::text);

  -- La segunda invitación ya no pide la declaración; la firma antigua (solo correo) sigue valiendo.
  v_inv_luis := public.create_company_invitation('modo.luis@test.local');
  PERFORM pg_temp.check_that(v_inv_luis ->> 'token' IS NOT NULL, '4g: la segunda invitación pide otra declaración');
  PERFORM pg_temp.check_that((SELECT count(*) FROM public.companies WHERE provider_user_id = v_pro) = 1,
    '4h: invitar dos veces crea dos empresas');
  PERFORM pg_temp.check_that((public.my_provider_mode() ->> 'pending_invitations')::int = 2,
    '4i: no cuenta las dos invitaciones pendientes');
  PERFORM pg_temp.check_that(
    pg_temp.error_of($q$SELECT public.create_company_invitation('modo.pro@test.local')$q$) IS NOT NULL,
    '4j: el titular puede invitarse a sí mismo');

  -- Un profesional con ficha puede recibir la invitación, pero no aceptarla (A-03 / D36).
  v_inv_otro := public.create_company_invitation('modo.otro@test.local');
  PERFORM pg_temp.as_user(NULL);
  v_err := pg_temp.error_of(format($q$SELECT private.accept_company_invitation_for(%L, %L)$q$, v_otro, v_inv_otro ->> 'token'));
  PERFORM pg_temp.check_that(v_err ILIKE '%profesional%',
    '4k: un profesional con ficha acepta ser empleado de otro (error: ' || COALESCE(v_err, 'ninguno') || ')');
  PERFORM pg_temp.check_that((SELECT provider_kind FROM public.gardener_profiles WHERE user_id = v_pro) = 'solo',
    '4l: un intento de aceptar fallido cambia el modo');

  -- ---------------------------------------------------------------------------
  -- 5. Aceptar el primer empleado: modo equipo y el titular conserva lo que vendía
  -- ---------------------------------------------------------------------------
  PERFORM private.accept_company_invitation_for(v_ana, v_inv ->> 'token');
  SELECT id INTO v_ana_member FROM public.company_members WHERE company_id = v_company AND user_id = v_ana AND status = 'active';
  PERFORM pg_temp.check_that(v_ana_member IS NOT NULL, '5a: Ana no quedó en el equipo');
  PERFORM pg_temp.check_that((SELECT provider_kind FROM public.gardener_profiles WHERE user_id = v_pro) = 'company',
    '5b: con un empleado activo la cuenta no pasa a modo equipo');
  PERFORM pg_temp.as_user(v_pro);
  s := public.my_provider_mode();
  PERFORM pg_temp.check_that(
    s ->> 'mode' = 'team' AND (s ->> 'active_employees')::int = 1 AND (s ->> 'pending_invitations')::int = 2
    AND (s ->> 'owner_works')::boolean,
    '5c: my_provider_mode no refleja el equipo: ' || s::text);
  PERFORM pg_temp.as_user(NULL);

  SELECT COALESCE(array_agg(service_id), '{}') INTO v_services
  FROM public.company_member_services WHERE member_id = v_owner_member;
  PERFORM pg_temp.check_that(v_services = ARRAY[v_lawn],
    '5d: los servicios del titular al entrar en equipo tienen que ser solo los activos y sin carnet (ni setos inactivo ni fitosanitarios sin carnet): ' || v_services::text);
  PERFORM pg_temp.check_that(
    EXISTS (SELECT 1 FROM public.provider_workers_all(v_pro, ARRAY[v_lawn], false) w WHERE w = v_pro),
    '5e: en modo equipo el titular (que trabaja) deja de poder hacer el césped');
  PERFORM pg_temp.check_that(
    NOT EXISTS (SELECT 1 FROM public.provider_workers_all(v_pro, ARRAY[v_lawn], false) w WHERE w = v_ana),
    '5f: un empleado sin servicios asignados ya cuenta como mano de obra');
  PERFORM pg_temp.check_that((SELECT role FROM public.profiles WHERE user_id = v_ana) = 'employee',
    '5g: el empleado no tiene rol employee');

  -- El segundo empleado no cambia el modo (ya era equipo): los servicios del titular no se reescriben.
  DELETE FROM public.company_member_services WHERE member_id = v_owner_member;
  PERFORM private.accept_company_invitation_for(v_luis, v_inv_luis ->> 'token');
  SELECT id INTO v_luis_member FROM public.company_members WHERE company_id = v_company AND user_id = v_luis AND status = 'active';
  PERFORM pg_temp.check_that(v_luis_member IS NOT NULL, '5h: Luis no quedó en el equipo');
  PERFORM pg_temp.check_that(NOT EXISTS (SELECT 1 FROM public.company_member_services WHERE member_id = v_owner_member),
    '5i: el segundo empleado reescribe los servicios del titular (solo debe hacerlo la transición)');

  -- ---------------------------------------------------------------------------
  -- 6. Invariantes de F2 intactos
  -- ---------------------------------------------------------------------------
  v_err := pg_temp.error_of(format($q$INSERT INTO public.gardener_profiles (user_id, full_name, phone, address) VALUES (%L, 'X', '1', 'X')$q$, v_ana));
  PERFORM pg_temp.check_that(v_err IS NOT NULL, '6a: un empleado activo puede tener ficha de proveedor');
  PERFORM pg_temp.check_that(NOT has_column_privilege('authenticated', 'public.gardener_profiles', 'provider_kind', 'UPDATE')
    AND NOT has_column_privilege('anon', 'public.gardener_profiles', 'provider_kind', 'UPDATE'),
    '6b: alguien puede cambiar provider_kind por API');
  PERFORM pg_temp.check_that(
    NOT has_function_privilege('authenticated', 'private.ensure_provider_team(uuid, boolean)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'private.sync_provider_mode(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.my_provider_mode()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.create_company_invitation(text, boolean)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.my_provider_mode()', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.create_company_invitation(text, boolean)', 'EXECUTE'),
    '6c: permisos de las funciones nuevas');
  PERFORM pg_temp.check_that(
    (SELECT count(*) FROM pg_proc WHERE proname = 'create_company_invitation' AND pronamespace = 'public'::regnamespace) = 1,
    '6d: hay dos sobrecargas de create_company_invitation (la llamada por nombre sería ambigua)');
  v_err := pg_temp.error_of(format($q$INSERT INTO public.companies (provider_user_id) VALUES (%L)$q$, v_cliente));
  PERFORM pg_temp.check_that(v_err IS NOT NULL, '6e: una empresa puede colgar de quien no tiene ficha');

  -- ---------------------------------------------------------------------------
  -- 7. Vuelta a individual: nada se pierde y los ajustes de equipo vuelven a fábrica
  -- ---------------------------------------------------------------------------
  -- El titular configura su equipo como lo haría con el panel de empresa.
  PERFORM pg_temp.as_user(v_pro);
  PERFORM public.set_company_owner_works(false);
  PERFORM public.set_company_max_crew(3);
  PERFORM public.set_company_allow_split_jobs(true);
  PERFORM public.set_company_assignment_mode('manual');
  PERFORM pg_temp.as_user(NULL);
  INSERT INTO public.bookings (id, client_id, gardener_id, service_id, date, start_time, duration_hours,
    status, total_price, client_address, management_fee, management_fee_source, assignment_pending)
  VALUES (v_booking, v_cliente, v_pro, v_lawn, current_date + 10, '09:00', 2,
    'confirmed', 100, 'Calle Prueba 1', 12.50, 'payment_attempt', true);
  PERFORM pg_temp.check_that(
    public.provider_max_crew(v_pro) = 3 AND public.provider_allows_split_jobs(v_pro)
    AND NOT (SELECT counts_as_labour FROM public.company_members WHERE id = v_owner_member),
    '7a: el equipo no se configura como esperaba la prueba');

  -- Se va Luis: sigue habiendo equipo (queda Ana), no se resetea nada.
  PERFORM pg_temp.as_user(v_pro);
  PERFORM public.deactivate_company_member(v_luis_member);
  PERFORM pg_temp.as_user(NULL);
  PERFORM pg_temp.check_that((SELECT provider_kind FROM public.gardener_profiles WHERE user_id = v_pro) = 'company'
    AND public.provider_max_crew(v_pro) = 3
    AND (SELECT assignment_pending FROM public.bookings WHERE id = v_booking),
    '7b: se va uno de dos y el equipo se reinicia');

  -- Se va Ana: el último. Vuelve el modo individual.
  PERFORM pg_temp.as_user(v_pro);
  PERFORM public.deactivate_company_member(v_ana_member);
  s := public.my_provider_mode();
  PERFORM pg_temp.as_user(NULL);
  PERFORM pg_temp.check_that((SELECT provider_kind FROM public.gardener_profiles WHERE user_id = v_pro) = 'solo',
    '7c: al irse el último empleado no vuelve a modo individual');
  PERFORM pg_temp.check_that(
    s ->> 'mode' = 'individual' AND (s ->> 'has_team_structure')::boolean AND (s ->> 'active_employees')::int = 0
    AND (s ->> 'owner_works')::boolean AND (s ->> 'pending_invitations')::int = 1,
    '7d: my_provider_mode tras volver: individual, con empresa latente, el titular trabaja: ' || s::text);
  PERFORM pg_temp.check_that(
    (SELECT counts_as_labour FROM public.company_members WHERE id = v_owner_member)
    AND (SELECT max_crew FROM public.companies WHERE id = v_company) = 1
    AND NOT (SELECT allow_split_jobs FROM public.companies WHERE id = v_company)
    AND (SELECT assignment_mode FROM public.companies WHERE id = v_company) = 'auto',
    '7e: los ajustes de equipo no vuelven a valores de fábrica');
  PERFORM pg_temp.check_that(
    public.provider_max_crew(v_pro) = 1 AND NOT public.provider_allows_split_jobs(v_pro),
    '7f: el motor sigue viendo equipo (capacidad o reparto) tras volver a individual');
  PERFORM pg_temp.check_that(NOT (SELECT assignment_pending FROM public.bookings WHERE id = v_booking),
    '7g: una reserva esperando asignación se queda esperando algo que el modo individual no ofrece');
  PERFORM pg_temp.check_that(
    ARRAY(SELECT w FROM public.provider_workers_all(v_pro, ARRAY[v_lawn], false) w) = ARRAY[v_pro],
    '7h: en modo individual el único que trabaja es el titular');
  PERFORM pg_temp.check_that(
    EXISTS (SELECT 1 FROM public.bookings WHERE id = v_booking AND gardener_id = v_pro AND status = 'confirmed')
    AND EXISTS (SELECT 1 FROM public.company_members WHERE id = v_owner_member AND status = 'active')
    AND EXISTS (SELECT 1 FROM public.gardener_service_prices WHERE gardener_id = v_pro AND service_id = v_lawn AND active),
    '7i: la reserva, el titular o sus precios cambiaron al volver');
  PERFORM pg_temp.check_that(
    (SELECT role FROM public.profiles WHERE user_id = v_ana) = 'client'
    AND (SELECT role FROM public.profiles WHERE user_id = v_luis) = 'client',
    '7j: quien se fue no queda como cliente');

  -- ---------------------------------------------------------------------------
  -- 8. Ida otra vez: se reutiliza la empresa latente y los servicios se rehacen
  -- ---------------------------------------------------------------------------
  UPDATE public.gardener_service_prices SET active = true WHERE gardener_id = v_pro AND service_id = v_hedge;
  PERFORM pg_temp.as_user(v_pro);
  v_inv := public.create_company_invitation('modo.ana@test.local');   -- sin declarar: la empresa ya existe
  PERFORM pg_temp.as_user(NULL);
  PERFORM private.accept_company_invitation_for(v_ana, v_inv ->> 'token');
  SELECT id INTO v_company_again FROM public.companies WHERE provider_user_id = v_pro;
  PERFORM pg_temp.check_that(v_company_again = v_company, '8a: se crea otra empresa en vez de reutilizar la latente');
  PERFORM pg_temp.check_that((SELECT provider_kind FROM public.gardener_profiles WHERE user_id = v_pro) = 'company',
    '8b: volver a tener equipo no pasa a modo equipo');
  SELECT COALESCE(array_agg(service_id ORDER BY service_id), '{}') INTO v_services
  FROM public.company_member_services WHERE member_id = v_owner_member;
  PERFORM pg_temp.check_that(v_services = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[v_lawn, v_hedge]) x),
    '8c: al volver a equipo los servicios del titular no son los activos de ahora: ' || v_services::text);
  PERFORM pg_temp.check_that((SELECT max_crew FROM public.companies WHERE id = v_company) = 1
    AND (SELECT assignment_mode FROM public.companies WHERE id = v_company) = 'auto',
    '8d: la empresa latente no conservó los valores de fábrica');

  -- Un cierre de cuenta del empleado BORRA su fila (private.execute_account_closure, modo delete):
  -- el disparador también escucha DELETE.
  SELECT id INTO v_ana_member FROM public.company_members WHERE company_id = v_company AND user_id = v_ana AND status = 'active';
  DELETE FROM public.company_member_services WHERE member_id = v_ana_member;
  DELETE FROM public.company_members WHERE id = v_ana_member;
  PERFORM pg_temp.check_that((SELECT provider_kind FROM public.gardener_profiles WHERE user_id = v_pro) = 'solo',
    '8e: borrar la fila del último empleado no devuelve el modo individual');

  -- Empresa suspendida: no se puede invitar y el aviso lo refleja.
  UPDATE public.companies SET status = 'suspended' WHERE id = v_company;
  PERFORM pg_temp.as_user(v_pro);
  PERFORM pg_temp.check_that(
    pg_temp.error_of($q$SELECT public.create_company_invitation('modo.luis@test.local')$q$) IS NOT NULL,
    '8f: una cuenta suspendida puede invitar');
  PERFORM pg_temp.check_that((public.my_provider_mode() ->> 'suspended')::boolean,
    '8g: my_provider_mode no marca la suspensión');
  PERFORM pg_temp.as_user(NULL);
  UPDATE public.companies SET status = 'active' WHERE id = v_company;

  -- ---------------------------------------------------------------------------
  -- 9. Empresas del camino antiguo: el dueño sin empleados no se mueve por su propia fila
  -- ---------------------------------------------------------------------------
  UPDATE public.gardener_profiles SET provider_kind = 'company' WHERE user_id = v_antiguo;
  INSERT INTO public.companies (provider_user_id) VALUES (v_antiguo) RETURNING id INTO v_company;
  INSERT INTO public.company_members (company_id, user_id, role) VALUES (v_company, v_antiguo, 'owner');
  PERFORM pg_temp.check_that((SELECT provider_kind FROM public.gardener_profiles WHERE user_id = v_antiguo) = 'company',
    '9a: insertar la fila del dueño de una empresa antigua cambia su modo');
  PERFORM pg_temp.as_user(v_antiguo);
  PERFORM pg_temp.check_that(public.my_provider_mode() ->> 'mode' = 'team',
    '9b: una empresa antigua sin empleados debería seguir leyéndose como equipo hasta que cambie su plantilla');
  PERFORM pg_temp.as_user(NULL);

  RAISE WARNING 'TODAS LAS COMPROBACIONES OK';
END
$prueba$;

ROLLBACK;
