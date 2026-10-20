-- Pruebas del carnet fitosanitario de los equipos (migración 20261020140000). En una transacción que
-- se revierte; si termina con "TODAS LAS COMPROBACIONES OK", todo se cumple.
--
--   docker exec -i <contenedor_db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/phyto_licenses_for_teams.test.sql

BEGIN;

SET client_min_messages = WARNING;

-- Quién llama (como la web: rol authenticated y su JWT) y vuelta a postgres.
CREATE FUNCTION pg_temp.as_user(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION pg_temp.as_postgres() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;
-- Un archivo en el almacén como si lo hubiera subido `p_uploader`.
CREATE FUNCTION pg_temp.upload(p_uploader uuid, p_holder uuid, p_ext text DEFAULT 'pdf') RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_name text := format('%s/%s.%s', p_holder, replace(gen_random_uuid()::text, '-', ''), p_ext);
BEGIN
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
  VALUES ('private_licenses', v_name, p_uploader, p_uploader::text, '{"mimetype":"application/pdf","size":1000}'::jsonb);
  RETURN v_name;
END $$;
CREATE FUNCTION pg_temp.outbox(p_key text) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.notification_outbox WHERE dedupe_key LIKE p_key;
$$;

DO $prueba$
DECLARE
  v_solo     uuid := '00000000-1ce5-4bee-8aaa-000000000001';
  v_empresa  uuid := '00000000-1ce5-4bee-8aaa-000000000002';
  v_ana      uuid := '00000000-1ce5-4bee-8aaa-000000000003';
  v_cliente  uuid := '00000000-1ce5-4bee-8aaa-000000000004';
  v_admin    uuid := '00000000-1ce5-4bee-8aaa-000000000005';
  v_otra     uuid := '00000000-1ce5-4bee-8aaa-000000000006';
  v_phyto    uuid;
  v_lawn     uuid;
  v_company  uuid;
  v_company2 uuid;
  v_ana_member uuid;
  v_path     text;
  v_lic      uuid;
  v_lic2     uuid;
  v_res      jsonb;
  v_ok       boolean;
  v_n        integer;
BEGIN
  SELECT id INTO v_phyto FROM public.services WHERE name = 'Servicios fitosanitarios';
  SELECT id INTO v_lawn FROM public.services WHERE name = 'Corte de césped';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  SELECT u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    u.email, 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', ''
  FROM (VALUES
    (v_solo, 'lic.solo@test.local'), (v_empresa, 'lic.empresa@test.local'), (v_ana, 'lic.ana@test.local'),
    (v_cliente, 'lic.cliente@test.local'), (v_admin, 'lic.admin@test.local'), (v_otra, 'lic.otra@test.local')
  ) AS u(id, email);
  UPDATE public.profiles SET role = 'gardener' WHERE user_id = v_solo;
  UPDATE public.profiles SET role = 'company' WHERE user_id IN (v_empresa, v_otra);
  UPDATE public.profiles SET role = 'employee', full_name = 'Ana Pruebas' WHERE user_id = v_ana;
  UPDATE public.profiles SET role = 'admin' WHERE user_id = v_admin;
  INSERT INTO public.gardener_profiles (user_id, full_name, phone, address) VALUES (v_solo, 'Solo Carnet', '600000000', 'Marbella');
  INSERT INTO public.gardener_profiles (user_id, full_name, phone, address, provider_kind)
  VALUES (v_empresa, 'Jardines Carnet', '611111111', 'Málaga', 'company'), (v_otra, 'Otra Empresa', '622222222', 'Málaga', 'company');
  INSERT INTO public.companies (provider_user_id, legal_name, tax_id) VALUES (v_empresa, 'Jardines Carnet SL', 'B10000000') RETURNING id INTO v_company;
  INSERT INTO public.companies (provider_user_id, legal_name, tax_id) VALUES (v_otra, 'Otra SL', 'B20000000') RETURNING id INTO v_company2;
  INSERT INTO public.company_members (company_id, user_id, role) VALUES (v_company, v_empresa, 'owner'), (v_company2, v_otra, 'owner');
  INSERT INTO public.company_members (company_id, user_id, role) VALUES (v_company, v_ana, 'employee') RETURNING id INTO v_ana_member;
  INSERT INTO public.gardener_service_prices (gardener_id, service_id, unit_type, price_per_unit, active, additional_config)
  VALUES (v_empresa, v_phyto, 'area', 1, true, '{}'::jsonb), (v_empresa, v_lawn, 'area', 1, true, '{}'::jsonb);

  -- ---------------------------------------------------------------------------
  -- 1. La web ya no escribe la tabla
  -- ---------------------------------------------------------------------------
  PERFORM pg_temp.as_user(v_solo);
  v_ok := false;
  BEGIN
    INSERT INTO public.gardener_licenses (gardener_id, document_url, status, terms_accepted) VALUES (v_solo, 'x', 'pending', true);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALLO 1a: se puede insertar un carnet directamente'; END IF;
  v_ok := false;
  BEGIN
    UPDATE public.gardener_licenses SET license_number = 'x' WHERE gardener_id = v_solo;
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALLO 1b: se puede modificar un carnet directamente'; END IF;
  PERFORM pg_temp.as_postgres();
  IF has_table_privilege('anon', 'public.gardener_licenses', 'SELECT')
     OR has_function_privilege('anon', 'public.submit_phyto_license(text, boolean, text, text, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.review_gardener_license(uuid, text, timestamptz, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.expire_due_phytosanitary_licenses()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALLO 1c: permisos abiertos a quien no toca';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 2. Quién puede subir al almacén (política) y enviar
  -- ---------------------------------------------------------------------------
  PERFORM pg_temp.as_user(v_cliente);
  IF public.can_upload_phyto_license_to(v_cliente::text) THEN RAISE EXCEPTION 'FALLO 2a: un cliente puede subir carnets'; END IF;
  v_ok := false;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('private_licenses', v_cliente || '/a.pdf', v_cliente::text);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALLO 2b: la política del almacén deja subir a un cliente'; END IF;
  v_ok := false;
  BEGIN
    PERFORM public.submit_phyto_license(v_cliente || '/a.pdf', true);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALLO 2c: un cliente envía un carnet'; END IF;
  PERFORM pg_temp.as_user(v_empresa);
  IF NOT public.can_upload_phyto_license_to(v_ana::text) OR NOT public.can_upload_phyto_license_to(v_empresa::text) THEN
    RAISE EXCEPTION 'FALLO 2d: el dueño no puede subir el suyo o el de su empleada';
  END IF;
  PERFORM pg_temp.as_user(v_otra);
  IF public.can_upload_phyto_license_to(v_ana::text) THEN RAISE EXCEPTION 'FALLO 2e: otra empresa puede subir el carnet de Ana'; END IF;
  PERFORM pg_temp.as_user(v_ana);
  IF public.can_upload_phyto_license_to(v_empresa::text) OR NOT public.can_upload_phyto_license_to(v_ana::text) THEN
    RAISE EXCEPTION 'FALLO 2f: la empleada sube donde no debe o no puede subir el suyo';
  END IF;
  PERFORM pg_temp.as_postgres();

  -- ---------------------------------------------------------------------------
  -- 3. El archivo tiene que ser suyo, existir y estar en su carpeta
  -- ---------------------------------------------------------------------------
  v_path := pg_temp.upload(v_empresa, v_empresa);              -- subido por otro, en otra carpeta
  PERFORM pg_temp.as_user(v_solo);
  FOR v_res IN SELECT to_jsonb(x) FROM (VALUES
    (v_path, true),                                            -- carpeta ajena
    (v_solo || '/noexiste.pdf', true),                          -- no existe
    (v_solo || '/../x.pdf', true),                              -- ruta rara
    (v_solo || '/a.exe', true)                                  -- extensión
  ) AS x(path, decl)
  LOOP
    v_ok := false;
    BEGIN
      PERFORM public.submit_phyto_license(v_res ->> 'path', (v_res ->> 'decl')::boolean);
    EXCEPTION WHEN invalid_parameter_value THEN v_ok := true;
    END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FALLO 3a: se acepta el documento %', v_res ->> 'path'; END IF;
  END LOOP;
  PERFORM pg_temp.as_postgres();
  v_path := pg_temp.upload(v_empresa, v_solo);                 -- en su carpeta, pero lo subió otro
  PERFORM pg_temp.as_user(v_solo);
  v_ok := false;
  BEGIN PERFORM public.submit_phyto_license(v_path, true);
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALLO 3b: se acepta un archivo que subió otra persona'; END IF;
  PERFORM pg_temp.as_postgres();
  v_path := pg_temp.upload(v_solo, v_solo);
  PERFORM pg_temp.as_user(v_solo);
  v_ok := false;
  BEGIN PERFORM public.submit_phyto_license(v_path, false);
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALLO 3c: se envía sin la declaración responsable'; END IF;

  -- ---------------------------------------------------------------------------
  -- 4. Autónomo: enviar, rechazar con motivo, reenviar, aprobar
  -- ---------------------------------------------------------------------------
  v_res := public.submit_phyto_license(v_path, true, '  ES-123  ', repeat('a', 64));
  v_lic := (v_res ->> 'licenseId')::uuid;
  v_ok := false;
  BEGIN PERFORM public.submit_phyto_license(v_path, true);
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALLO 4a: el mismo documento se envía dos veces'; END IF;
  PERFORM pg_temp.as_postgres();
  IF (SELECT license_number || '|' || submitted_by::text || '|' || status FROM public.gardener_licenses WHERE id = v_lic) <> 'ES-123|' || v_solo || '|pending'
     OR (SELECT license_verification_status FROM public.gardener_profiles WHERE user_id = v_solo) <> 'pending' THEN
    RAISE EXCEPTION 'FALLO 4b: el envío no queda en revisión';
  END IF;

  PERFORM pg_temp.as_user(v_solo);
  v_ok := false;
  BEGIN PERFORM public.review_gardener_license(v_lic, 'approved', now() + interval '1 year');
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALLO 4c: el titular se aprueba su carnet'; END IF;

  PERFORM pg_temp.as_user(v_admin);
  v_ok := false;
  BEGIN PERFORM public.review_gardener_license(v_lic, 'rejected', NULL, ' ');
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALLO 4d: se rechaza sin motivo'; END IF;
  v_ok := false;
  BEGIN PERFORM public.review_gardener_license(v_lic, 'approved', now() + interval '20 years');
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALLO 4e: se aprueba con una caducidad de 20 años'; END IF;
  PERFORM public.review_gardener_license(v_lic, 'rejected', NULL, 'El documento no se lee');
  v_ok := false;
  BEGIN PERFORM public.review_gardener_license(v_lic, 'approved', now() + interval '1 year');
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALLO 4f: se revisa un carnet que ya no está pendiente'; END IF;
  PERFORM pg_temp.as_postgres();
  v_res := private.phyto_license_summary(v_solo);
  IF v_res ->> 'status' <> 'rejected' OR v_res ->> 'rejection_reason' <> 'El documento no se lee'
     OR (SELECT license_verification_status FROM public.gardener_profiles WHERE user_id = v_solo) <> 'rejected'
     OR pg_temp.outbox('phyto_license_update:' || v_lic || ':rejected') <> 1 THEN
    RAISE EXCEPTION 'FALLO 4g: el rechazo no se refleja o no se avisa: %', v_res;
  END IF;

  v_path := pg_temp.upload(v_solo, v_solo, 'jpg');
  PERFORM pg_temp.as_user(v_solo);
  v_lic2 := (public.submit_phyto_license(v_path, true) ->> 'licenseId')::uuid;
  PERFORM pg_temp.as_user(v_admin);
  PERFORM public.review_gardener_license(v_lic2, 'approved', now() + interval '2 years');
  PERFORM pg_temp.as_postgres();
  IF (SELECT status FROM public.gardener_licenses WHERE id = v_lic) <> 'replaced'
     OR NOT (SELECT has_phytosanitary_license AND license_verification_status = 'approved' AND license_expires_at > now() + interval '23 months'
             FROM public.gardener_profiles WHERE user_id = v_solo)
     OR pg_temp.outbox('phyto_license_update:' || v_lic2 || ':approved') <> 1
     OR pg_temp.outbox('member_phyto_license_update:' || v_lic2 || '%') <> 0 THEN
    RAISE EXCEPTION 'FALLO 4h: la aprobación no deja la ficha al día';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 5. Renovar no quita el carnet vigente (el fallo grave de antes)
  -- ---------------------------------------------------------------------------
  v_path := pg_temp.upload(v_solo, v_solo);
  PERFORM pg_temp.as_user(v_solo);
  v_lic := (public.submit_phyto_license(v_path, true) ->> 'licenseId')::uuid;
  PERFORM pg_temp.as_postgres();
  v_res := private.phyto_license_summary(v_solo);
  IF (SELECT status FROM public.gardener_licenses WHERE id = v_lic2) <> 'approved'
     OR NOT (SELECT has_phytosanitary_license AND license_verification_status = 'approved' FROM public.gardener_profiles WHERE user_id = v_solo)
     OR v_res ->> 'status' <> 'approved' OR v_res #>> '{renewal,status}' <> 'pending'
     OR public.latest_phyto_license_status(v_solo) <> 'approved' THEN
    RAISE EXCEPTION 'FALLO 5a: al enviar la renovación se pierde el carnet vigente: %', v_res;
  END IF;
  PERFORM pg_temp.as_user(v_admin);
  PERFORM public.review_gardener_license(v_lic, 'rejected', NULL, 'Es el mismo carnet de antes');
  PERFORM pg_temp.as_postgres();
  v_res := private.phyto_license_summary(v_solo);
  IF NOT (SELECT has_phytosanitary_license AND license_verification_status = 'approved' FROM public.gardener_profiles WHERE user_id = v_solo)
     OR v_res ->> 'status' <> 'approved' OR v_res #>> '{renewal,status}' <> 'rejected'
     OR v_res #>> '{renewal,rejection_reason}' <> 'Es el mismo carnet de antes' THEN
    RAISE EXCEPTION 'FALLO 5b: rechazar la renovación quita el carnet vigente: %', v_res;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 6. Empresa: el dueño envía el de su empleada; otra empresa no puede
  -- ---------------------------------------------------------------------------
  v_path := pg_temp.upload(v_empresa, v_ana);
  PERFORM pg_temp.as_user(v_otra);
  v_ok := false;
  BEGIN PERFORM public.submit_phyto_license(v_path, true, NULL, NULL, v_ana_member);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALLO 6a: otra empresa envía el carnet de Ana'; END IF;
  PERFORM pg_temp.as_user(v_empresa);
  v_res := public.submit_phyto_license(v_path, true, NULL, NULL, v_ana_member);
  v_lic := (v_res ->> 'licenseId')::uuid;
  -- El dueño no puede leer el documento después (es de Ana).
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id = 'private_licenses' AND name = v_path) <> 0 THEN
    RAISE EXCEPTION 'FALLO 6b: la empresa puede abrir el documento de su empleada';
  END IF;
  v_res := public.company_team_overview();
  SELECT x INTO v_res FROM jsonb_array_elements(v_res -> 'members') x WHERE x ->> 'member_id' = v_ana_member::text;
  IF v_res ->> 'license_status' <> 'pending' OR (v_res ->> 'has_valid_phyto_license')::boolean
     OR v_res #>> '{license_renewal}' IS NOT NULL OR v_res ? 'license_number' THEN
    RAISE EXCEPTION 'FALLO 6c: la empresa no ve bien el carnet de Ana: %', v_res;
  END IF;
  PERFORM pg_temp.as_user(v_ana);
  v_res := public.my_company_membership();
  IF v_res #>> '{license,status}' <> 'pending' OR NOT (v_res #>> '{license,submitted_by_company}')::boolean
     OR NOT (v_res ->> 'license_needed')::boolean THEN
    RAISE EXCEPTION 'FALLO 6d: Ana no ve su carnet enviado por la empresa: %', v_res;
  END IF;
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id = 'private_licenses' AND name = v_path) <> 1 THEN
    RAISE EXCEPTION 'FALLO 6e: Ana no puede leer su documento';
  END IF;
  PERFORM pg_temp.as_postgres();
  IF (SELECT submitted_by FROM public.gardener_licenses WHERE id = v_lic) <> v_empresa
     OR pg_temp.outbox('phyto_license_update:' || v_lic || ':submitted_for_you') <> 1 THEN
    RAISE EXCEPTION 'FALLO 6f: no queda quién lo envió o no se avisa a Ana';
  END IF;

  -- El admin ve de quién es.
  PERFORM pg_temp.as_user(v_admin);
  SELECT x INTO v_res FROM jsonb_array_elements(public.admin_phyto_license_queue()) x WHERE x ->> 'id' = v_lic::text;
  IF v_res ->> 'holder_kind' <> 'employee' OR v_res ->> 'company_name' <> 'Jardines Carnet'
     OR NOT (v_res ->> 'submitted_by_company')::boolean OR v_res ->> 'holder_name' <> 'Ana Pruebas' THEN
    RAISE EXCEPTION 'FALLO 6g: la cola del admin no dice de quién es: %', v_res;
  END IF;
  PERFORM pg_temp.as_user(v_ana);
  v_ok := false;
  BEGIN PERFORM public.admin_phyto_license_queue();
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALLO 6h: alguien que no es admin ve la cola'; END IF;

  -- Antes de aprobarlo, la empresa no le puede asignar fitosanitarios.
  PERFORM pg_temp.as_user(v_empresa);
  v_ok := false;
  BEGIN PERFORM public.set_company_member_services(v_ana_member, ARRAY[v_phyto]);
  EXCEPTION WHEN raise_exception THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALLO 6i: fitosanitarios asignados sin carnet aprobado'; END IF;

  PERFORM pg_temp.as_user(v_admin);
  PERFORM public.review_gardener_license(v_lic, 'approved', now() + interval '5 years');
  PERFORM pg_temp.as_user(v_empresa);
  PERFORM public.set_company_member_services(v_ana_member, ARRAY[v_phyto, v_lawn]);
  PERFORM pg_temp.as_postgres();
  IF pg_temp.outbox('phyto_license_update:' || v_lic || ':approved') <> 1
     OR pg_temp.outbox('member_phyto_license_update:' || v_lic || ':approved') <> 1 THEN
    RAISE EXCEPTION 'FALLO 6j: la aprobación no avisa a Ana y a su empresa';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 7. Pedir el carnet
  -- ---------------------------------------------------------------------------
  PERFORM pg_temp.as_user(v_empresa);
  v_ok := false;
  BEGIN PERFORM public.request_member_phyto_license(v_ana_member);
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALLO 7a: se pide el carnet a quien ya lo tiene aprobado'; END IF;

  -- ---------------------------------------------------------------------------
  -- 8. Caducidad: aviso 30 días antes (una sola vez) y al caducar
  -- ---------------------------------------------------------------------------
  PERFORM pg_temp.as_postgres();
  UPDATE public.gardener_licenses SET expires_at = now() + interval '10 days' WHERE id = v_lic;
  PERFORM public.expire_due_phytosanitary_licenses();
  PERFORM public.expire_due_phytosanitary_licenses();
  IF pg_temp.outbox('phyto_license_update:' || v_lic || ':expiring') <> 1
     OR pg_temp.outbox('member_phyto_license_update:' || v_lic || ':expiring') <> 1 THEN
    RAISE EXCEPTION 'FALLO 8a: el aviso de caducidad no sale una vez a Ana y a la empresa';
  END IF;
  -- Caduca en 10 días: ya se le puede pedir el renovado (una vez al día); otra empresa, no.
  PERFORM pg_temp.as_user(v_otra);
  v_ok := false;
  BEGIN PERFORM public.request_member_phyto_license(v_ana_member);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALLO 8c: otra empresa pide el carnet a Ana'; END IF;
  PERFORM pg_temp.as_user(v_empresa);
  PERFORM public.request_member_phyto_license(v_ana_member);
  v_ok := false;
  BEGIN PERFORM public.request_member_phyto_license(v_ana_member);
  EXCEPTION WHEN invalid_parameter_value THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALLO 8d: se puede pedir el carnet varias veces el mismo día'; END IF;
  PERFORM pg_temp.as_postgres();
  UPDATE public.gardener_licenses SET expires_at = now() - interval '1 minute' WHERE id = v_lic;
  v_n := public.expire_due_phytosanitary_licenses();
  IF v_n < 1 OR (SELECT status FROM public.gardener_licenses WHERE id = v_lic) <> 'expired'
     OR EXISTS (SELECT 1 FROM public.company_member_services WHERE member_id = v_ana_member AND service_id = v_phyto)
     OR NOT EXISTS (SELECT 1 FROM public.company_member_services WHERE member_id = v_ana_member AND service_id = v_lawn)
     OR pg_temp.outbox('phyto_license_update:' || v_lic || ':expired') <> 1
     OR pg_temp.outbox('member_phyto_license_update:' || v_lic || ':expired') <> 1 THEN
    RAISE EXCEPTION 'FALLO 8b: al caducar no se retiran los fitosanitarios o no se avisa';
  END IF;

  -- Caducado: Ana ve que caducó y que se lo han pedido.
  PERFORM pg_temp.as_user(v_ana);
  v_res := public.my_company_membership();
  IF v_res #>> '{license,status}' <> 'expired' OR v_res ->> 'license_requested_at' IS NULL THEN
    RAISE EXCEPTION 'FALLO 8e: Ana no ve que caducó y que se lo piden: %', v_res;
  END IF;
  PERFORM pg_temp.as_postgres();
  IF pg_temp.outbox('phyto_license_requested:' || v_ana_member || ':%') <> 1 THEN
    RAISE EXCEPTION 'FALLO 8f: no se avisa a Ana de que la empresa le pide el carnet';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 9. Límite de envíos: 5 al día por persona
  -- ---------------------------------------------------------------------------
  v_n := (SELECT count(*) FROM public.gardener_licenses WHERE gardener_id = v_solo AND created_at > now() - interval '24 hours');
  FOR i IN 1..(5 - v_n) LOOP
    v_path := pg_temp.upload(v_solo, v_solo);
    PERFORM pg_temp.as_user(v_solo);
    PERFORM public.submit_phyto_license(v_path, true);
    PERFORM pg_temp.as_postgres();
  END LOOP;
  v_path := pg_temp.upload(v_solo, v_solo);
  PERFORM pg_temp.as_user(v_solo);
  v_ok := false;
  BEGIN PERFORM public.submit_phyto_license(v_path, true);
  EXCEPTION WHEN program_limit_exceeded THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALLO 9: no hay límite de envíos'; END IF;
  PERFORM pg_temp.as_postgres();
  -- Y con todo eso, el carnet vigente del autónomo sigue.
  IF NOT (SELECT has_phytosanitary_license FROM public.gardener_profiles WHERE user_id = v_solo) THEN
    RAISE EXCEPTION 'FALLO 9b: los reenvíos quitan el carnet vigente';
  END IF;

  RAISE WARNING 'TODAS LAS COMPROBACIONES OK';
END
$prueba$;

ROLLBACK;
