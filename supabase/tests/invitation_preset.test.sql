-- Pruebas de la invitación preconfigurada (migración 20261111120000).
--
--   docker exec -i <contenedor_db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/invitation_preset.test.sql
--
-- Todo en una transacción que se revierte. Si termina con "TODAS LAS COMPROBACIONES OK", se cumple todo.

BEGIN;

SET client_min_messages = WARNING;

CREATE FUNCTION pg_temp.check_that(p_ok boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FALLO %', p_msg; END IF;
END $$;

CREATE FUNCTION pg_temp.as_user(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN NULL ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END, true);
END $$;

CREATE FUNCTION pg_temp.error_of(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
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

DO $prueba$
DECLARE
  v_pro    uuid := '00000000-1a7e-4e11-8bbb-000000000001';
  v_ana    uuid := '00000000-1a7e-4e11-8bbb-000000000002';  -- con preconfiguración «horario propio»
  v_luis   uuid := '00000000-1a7e-4e11-8bbb-000000000003';  -- con «mismo horario que la empresa»
  v_eva    uuid := '00000000-1a7e-4e11-8bbb-000000000004';  -- sin preconfiguración
  v_otro   uuid := '00000000-1a7e-4e11-8bbb-000000000005';  -- otro profesional
  v_lawn uuid; v_hedge uuid; v_phyto uuid; v_shrub uuid;
  v_inv_ana jsonb; v_inv_luis jsonb; v_inv_eva jsonb;
  v_norm jsonb;
  v_err text;
  v_member uuid;
BEGIN
  SELECT id INTO v_lawn FROM public.services WHERE name = 'Corte de césped';
  SELECT id INTO v_hedge FROM public.services WHERE name = 'Poda de setos';
  SELECT id INTO v_phyto FROM public.services WHERE name = 'Servicios fitosanitarios';
  SELECT id INTO v_shrub FROM public.services WHERE name = 'Poda de plantas y arbustos';
  IF v_lawn IS NULL OR v_hedge IS NULL OR v_phyto IS NULL OR v_shrub IS NULL THEN
    RAISE EXCEPTION 'Faltan servicios: ejecuta `supabase db reset` antes de estas pruebas';
  END IF;

  PERFORM pg_temp.new_user(v_pro, 'preset.pro@test.local');
  PERFORM pg_temp.new_user(v_ana, 'preset.ana@test.local');
  PERFORM pg_temp.new_user(v_luis, 'preset.luis@test.local');
  PERFORM pg_temp.new_user(v_eva, 'preset.eva@test.local');
  PERFORM pg_temp.new_user(v_otro, 'preset.otro@test.local');
  UPDATE public.profiles SET role = 'gardener', full_name = 'Pro Preset' WHERE user_id IN (v_pro, v_otro);
  UPDATE public.profiles SET full_name = 'Luis Real' WHERE user_id = v_luis;  -- Luis ya tiene nombre
  UPDATE public.profiles SET full_name = NULL WHERE user_id = v_ana;          -- Ana no
  INSERT INTO public.gardener_profiles (user_id, full_name, phone, address)
  VALUES (v_pro, 'Pro Preset', '600000001', 'Marbella'), (v_otro, 'Otro', '600000002', 'Marbella');
  -- Césped activo; setos configurado pero aún sin activar; fitosanitarios activo; arbustos sin configurar.
  INSERT INTO public.gardener_service_prices (gardener_id, service_id, unit_type, price_per_unit, active, additional_config)
  VALUES (v_pro, v_lawn, 'area', 0, true, '{}'), (v_pro, v_hedge, 'area', 0, false, '{}'), (v_pro, v_phyto, 'area', 0, true, '{}');
  -- Horario fijo del titular: lunes 8-14
  INSERT INTO public.recurring_availability_settings (gardener_id, weeks_to_maintain, min_notice_hours) VALUES (v_pro, 3, 24);
  INSERT INTO public.recurring_schedules (gardener_id, day_of_week, start_time, end_time) VALUES (v_pro, 1, '08:00', '14:00');

  PERFORM pg_temp.as_user(v_pro);
  v_inv_ana := public.create_company_invitation('preset.ana@test.local', true);
  v_inv_luis := public.create_company_invitation('preset.luis@test.local', true);
  v_inv_eva := public.create_company_invitation('preset.eva@test.local', true);

  -- ── 1. Validación al guardar ──────────────────────────────────────────────────────────────────
  v_err := pg_temp.error_of(format($q$SELECT public.set_company_invitation_preset(%L, %L)$q$, v_inv_ana ->> 'invitation_id',
    jsonb_build_object('service_ids', jsonb_build_array(v_phyto))));
  PERFORM pg_temp.check_that(v_err LIKE '%fitosanitarios%carnet%', '1a: fitosanitarios no se preasigna (' || COALESCE(v_err, 'sin error') || ')');
  v_err := pg_temp.error_of(format($q$SELECT public.set_company_invitation_preset(%L, %L)$q$, v_inv_ana ->> 'invitation_id',
    jsonb_build_object('service_ids', jsonb_build_array(v_shrub))));
  PERFORM pg_temp.check_that(v_err LIKE '%no lo tiene configurado%', '1b: un servicio sin configurar se rechaza');
  v_err := pg_temp.error_of(format($q$SELECT public.set_company_invitation_preset(%L, %L)$q$, v_inv_ana ->> 'invitation_id',
    '{"schedule":{"mode":"custom","rules":[{"day_of_week":1,"start_time":"14:00:00","end_time":"09:00:00"}]}}'));
  PERFORM pg_temp.check_that(v_err LIKE 'Horario no válido%', '1c: fin antes que el inicio se rechaza');
  v_err := pg_temp.error_of(format($q$SELECT public.set_company_invitation_preset(%L, %L)$q$, v_inv_ana ->> 'invitation_id',
    '{"schedule":{"mode":"custom","rules":[{"day_of_week":9,"start_time":"08:00","end_time":"10:00"}]}}'));
  PERFORM pg_temp.check_that(v_err LIKE 'Horario no válido%', '1d: día imposible se rechaza');
  v_err := pg_temp.error_of(format($q$SELECT public.set_company_invitation_preset(%L, %L)$q$, v_inv_ana ->> 'invitation_id',
    '{"schedule":{"mode":"custom","rules":[{"day_of_week":2,"start_time":"06:00","end_time":"10:00"}]}}'));
  PERFORM pg_temp.check_that(v_err LIKE 'Horario no válido%', '1e: antes de las 7:00 se rechaza');
  v_err := pg_temp.error_of(format($q$SELECT public.set_company_invitation_preset(%L, %L)$q$, v_inv_ana ->> 'invitation_id',
    '{"schedule":{"mode":"otro"}}'));
  PERFORM pg_temp.check_that(v_err LIKE 'Horario no válido%', '1f: un modo desconocido se rechaza');

  -- ── 2. Solo el dueño, y solo pendientes ───────────────────────────────────────────────────────
  PERFORM pg_temp.as_user(v_otro);
  v_err := pg_temp.error_of(format($q$SELECT public.set_company_invitation_preset(%L, '{}')$q$, v_inv_ana ->> 'invitation_id'));
  PERFORM pg_temp.check_that(v_err LIKE 'Solo quien invita%', '2a: otro profesional no puede tocar la invitación');
  PERFORM pg_temp.as_user(NULL);
  v_err := pg_temp.error_of(format($q$SELECT public.set_company_invitation_preset(%L, '{}')$q$, v_inv_ana ->> 'invitation_id'));
  PERFORM pg_temp.check_that(v_err LIKE 'Inicia sesión%', '2b: sin sesión no');
  PERFORM pg_temp.check_that(NOT has_function_privilege('anon', 'public.set_company_invitation_preset(uuid, jsonb)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.set_company_invitation_preset(uuid, jsonb)', 'EXECUTE'),
    '2c: anon no puede ejecutarla; authenticated sí');

  -- ── 3. Guardar y aceptar: horario propio, servicios activos, nombre si no tiene ───────────────
  PERFORM pg_temp.as_user(v_pro);
  v_norm := public.set_company_invitation_preset((v_inv_ana ->> 'invitation_id')::uuid, jsonb_build_object(
    'display_name', '  Ana Jardinera ',
    'service_ids', jsonb_build_array(v_lawn, v_hedge, v_lawn),
    'schedule', jsonb_build_object('mode', 'custom', 'weeks', 2, 'rules', jsonb_build_array(
      jsonb_build_object('day_of_week', 2, 'start_time', '09:00', 'end_time', '13:00'))),
    'request_license', true));
  PERFORM pg_temp.check_that(v_norm ->> 'display_name' = 'Ana Jardinera'
    AND jsonb_array_length(v_norm -> 'service_ids') = 2
    AND v_norm #>> '{schedule,rules,0,start_time}' = '09:00:00',
    '3a: se normaliza (nombre recortado, servicios sin repetir, horas HH:MM:SS): ' || v_norm::text);

  PERFORM pg_temp.as_user(v_ana);
  PERFORM public.accept_company_invitation(v_inv_ana ->> 'token');
  SELECT id INTO v_member FROM public.company_members WHERE user_id = v_ana AND status = 'active';
  PERFORM pg_temp.check_that(v_member IS NOT NULL, '3b: Ana entra en el equipo');
  PERFORM pg_temp.check_that(
    (SELECT array_agg(service_id ORDER BY service_id) FROM public.company_member_services WHERE member_id = v_member) = ARRAY[v_lawn],
    '3c: solo se le asigna lo que la empresa tiene ACTIVO (césped sí; setos aún no)');
  PERFORM pg_temp.check_that(
    (SELECT count(*) FROM public.recurring_schedules WHERE gardener_id = v_ana AND day_of_week = 2 AND start_time = '09:00' AND end_time = '13:00') = 1
    AND (SELECT weeks_to_maintain FROM public.recurring_availability_settings WHERE gardener_id = v_ana) = 2,
    '3d: su horario propio y sus semanas quedan puestos');
  PERFORM pg_temp.check_that((SELECT full_name FROM public.profiles WHERE user_id = v_ana) = 'Ana Jardinera',
    '3e: sin nombre propio, se usa el que puso el titular');
  PERFORM pg_temp.check_that((SELECT phyto_license_requested_at IS NOT NULL FROM public.company_members WHERE id = v_member),
    '3f: se le pide el carnet');

  -- ── 4. «Mismo horario que la empresa» copia el del titular; un nombre propio no se pisa ───────
  PERFORM pg_temp.as_user(v_pro);
  PERFORM public.set_company_invitation_preset((v_inv_luis ->> 'invitation_id')::uuid,
    '{"display_name":"Otro Nombre","schedule":{"mode":"company"}}');
  PERFORM pg_temp.as_user(v_luis);
  PERFORM public.accept_company_invitation(v_inv_luis ->> 'token');
  PERFORM pg_temp.check_that(
    (SELECT count(*) FROM public.recurring_schedules WHERE gardener_id = v_luis AND day_of_week = 1 AND start_time = '08:00' AND end_time = '14:00') = 1
    AND (SELECT weeks_to_maintain FROM public.recurring_availability_settings WHERE gardener_id = v_luis) = 3,
    '4a: copia el horario fijo y las semanas del titular');
  PERFORM pg_temp.check_that((SELECT full_name FROM public.profiles WHERE user_id = v_luis) = 'Luis Real',
    '4b: su propio nombre no se pisa');

  -- ── 5. Sin preconfiguración, aceptar es lo de siempre ─────────────────────────────────────────
  PERFORM pg_temp.as_user(v_eva);
  PERFORM public.accept_company_invitation(v_inv_eva ->> 'token');
  PERFORM pg_temp.check_that(EXISTS (SELECT 1 FROM public.company_members WHERE user_id = v_eva AND status = 'active')
    AND NOT EXISTS (SELECT 1 FROM public.recurring_schedules WHERE gardener_id = v_eva),
    '5a: entra sin horario ni servicios, como antes');

  -- ── 6. Una invitación ya usada no se puede reconfigurar ───────────────────────────────────────
  PERFORM pg_temp.as_user(v_pro);
  v_err := pg_temp.error_of(format($q$SELECT public.set_company_invitation_preset(%L, '{}')$q$, v_inv_ana ->> 'invitation_id'));
  PERFORM pg_temp.check_that(v_err LIKE '%ya no está pendiente%', '6a: aceptada → no se toca');

  RAISE WARNING 'TODAS LAS COMPROBACIONES OK';
END
$prueba$;

ROLLBACK;
