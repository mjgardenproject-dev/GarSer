-- QA-044: en una cuenta con equipo, activar un servicio lo dejaba INVISIBLE (nadie lo tenía asignado)
-- mientras la web decía «los clientes pueden reservarlo» y el perfil público lo listaba.
--
--   docker exec -i <contenedor_db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/team_service_activation.test.sql
--
-- Transacción que se revierte. Termina con "TODAS LAS COMPROBACIONES OK".

BEGIN;
SET client_min_messages = WARNING;

DO $prueba$
DECLARE
  v_trabaja   uuid := '00000000-0441-4bee-8aaa-000000000001';  -- dueño que también trabaja
  v_notrabaja uuid := '00000000-0441-4bee-8aaa-000000000002';  -- dueño que no trabaja
  v_ana       uuid := '00000000-0441-4bee-8aaa-000000000003';  -- empleada de la primera empresa
  v_solo      uuid := '00000000-0441-4bee-8aaa-000000000004';  -- autónomo
  v_c1 uuid; v_c2 uuid;
  v_owner1 uuid; v_ana_member uuid;
  v_lawn uuid; v_palm uuid; v_hedge uuid; v_phyto uuid;
  v_n integer;
  v_services text[];
BEGIN
  SELECT id INTO v_lawn FROM public.services WHERE name = 'Corte de césped';
  SELECT id INTO v_palm FROM public.services WHERE name = 'Poda de palmeras';
  SELECT id INTO v_hedge FROM public.services WHERE name = 'Poda de setos';
  SELECT id INTO v_phyto FROM public.services WHERE name = 'Servicios fitosanitarios';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  SELECT u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    u.email, 'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', ''
  FROM (VALUES (v_trabaja, 'eq.trabaja@test.local'), (v_notrabaja, 'eq.notrabaja@test.local'),
               (v_ana, 'eq.ana@test.local'), (v_solo, 'eq.solo@test.local')) AS u(id, email);
  UPDATE public.profiles SET role = 'gardener' WHERE user_id IN (v_trabaja, v_notrabaja, v_solo);
  UPDATE public.profiles SET role = 'employee' WHERE user_id = v_ana;

  INSERT INTO public.gardener_profiles (user_id, full_name, phone, address) VALUES (v_solo, 'Solo', '600000001', 'Marbella');
  INSERT INTO public.gardener_profiles (user_id, full_name, phone, address, provider_kind) VALUES
    (v_trabaja, 'Equipo Trabaja', '600000002', 'Marbella', 'company'),
    (v_notrabaja, 'Equipo No Trabaja', '600000003', 'Marbella', 'company');
  INSERT INTO public.companies (provider_user_id, legal_name, tax_id) VALUES (v_trabaja, 'Trabaja SL', 'B30000001') RETURNING id INTO v_c1;
  INSERT INTO public.companies (provider_user_id, legal_name, tax_id) VALUES (v_notrabaja, 'NoTrabaja SL', 'B30000002') RETURNING id INTO v_c2;
  UPDATE public.companies SET status = 'active' WHERE id IN (v_c1, v_c2);
  INSERT INTO public.company_members (company_id, user_id, role, counts_as_labour) VALUES (v_c1, v_trabaja, 'owner', true) RETURNING id INTO v_owner1;
  INSERT INTO public.company_members (company_id, user_id, role, counts_as_labour) VALUES (v_c2, v_notrabaja, 'owner', false);
  INSERT INTO public.company_members (company_id, user_id, role, counts_as_labour) VALUES (v_c1, v_ana, 'employee', true) RETURNING id INTO v_ana_member;
  -- La empleada ya hace setos.
  INSERT INTO public.company_member_services (member_id, service_id) VALUES (v_ana_member, v_hedge);

  -- 1. El dueño que trabaja activa palmeras (nadie la hace): se le asigna a él.
  INSERT INTO public.gardener_service_prices (gardener_id, service_id, unit_type, price_per_unit, active)
  VALUES (v_trabaja, v_palm, 'count', 30, true);
  SELECT count(*) INTO v_n FROM public.company_member_services WHERE member_id = v_owner1 AND service_id = v_palm;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FALLO 1: al activar un servicio que nadie hace, no se asigna al dueño que trabaja';
  END IF;

  -- 2. Activa setos, que ya hace la empleada: NO se le asigna a él (no se toca el reparto que hay).
  INSERT INTO public.gardener_service_prices (gardener_id, service_id, unit_type, price_per_unit, active)
  VALUES (v_trabaja, v_hedge, 'count', 30, true);
  SELECT count(*) INTO v_n FROM public.company_member_services WHERE member_id = v_owner1 AND service_id = v_hedge;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FALLO 2: se ha cambiado el reparto de un servicio que ya hacía alguien';
  END IF;

  -- 3. Desactivar y volver a activar no duplica ni falla.
  UPDATE public.gardener_service_prices SET active = false WHERE gardener_id = v_trabaja AND service_id = v_palm;
  UPDATE public.gardener_service_prices SET active = true WHERE gardener_id = v_trabaja AND service_id = v_palm;
  SELECT count(*) INTO v_n FROM public.company_member_services WHERE member_id = v_owner1 AND service_id = v_palm;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FALLO 3: reactivar ha duplicado o perdido la asignación (filas: %)', v_n;
  END IF;

  -- 4. Fitosanitarios sin carnet: no se asigna (no podría hacerlo).
  INSERT INTO public.gardener_service_prices (gardener_id, service_id, unit_type, price_per_unit, active)
  VALUES (v_trabaja, v_phyto, 'area', 1, true);
  SELECT count(*) INTO v_n FROM public.company_member_services WHERE member_id = v_owner1 AND service_id = v_phyto;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FALLO 4: se ha asignado fitosanitarios a quien no tiene carnet';
  END IF;

  -- 5. Dueño que no trabaja: no se asigna nada (la web le dirá que falta asignarlo).
  INSERT INTO public.gardener_service_prices (gardener_id, service_id, unit_type, price_per_unit, active)
  VALUES (v_notrabaja, v_lawn, 'count', 30, true);
  SELECT count(*) INTO v_n FROM public.company_member_services cms
    JOIN public.company_members m ON m.id = cms.member_id WHERE m.company_id = v_c2;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FALLO 5: se ha asignado un servicio a un dueño que no trabaja';
  END IF;

  -- 6. El perfil público solo lista lo que alguien del equipo puede hacer.
  UPDATE public.gardener_profiles SET services = ARRAY[v_palm::text, v_hedge::text, v_phyto::text] WHERE user_id = v_trabaja;
  UPDATE public.gardener_profiles SET services = ARRAY[v_lawn::text] WHERE user_id = v_notrabaja;
  UPDATE public.gardener_profiles SET services = ARRAY[v_lawn::text] WHERE user_id = v_solo;
  SELECT services INTO v_services FROM public.public_gardener_directory WHERE user_id = v_trabaja;
  IF NOT (v_palm::text = ANY(v_services) AND v_hedge::text = ANY(v_services)) OR v_phyto::text = ANY(v_services) THEN
    RAISE EXCEPTION 'FALLO 6a: el perfil público del equipo no cuadra con quién hace qué (%)', v_services;
  END IF;
  SELECT services INTO v_services FROM public.public_gardener_directory WHERE user_id = v_notrabaja;
  IF cardinality(COALESCE(v_services, '{}')) <> 0 THEN
    RAISE EXCEPTION 'FALLO 6b: el perfil público lista un servicio que nadie del equipo hace (%)', v_services;
  END IF;
  SELECT services INTO v_services FROM public.public_gardener_directory WHERE user_id = v_solo;
  IF NOT (v_lawn::text = ANY(v_services)) THEN
    RAISE EXCEPTION 'FALLO 6c: el autónomo ha perdido su servicio en el perfil público';
  END IF;

  -- 7. QA-215: las vistas públicas son de solo lectura para la web.
  IF has_table_privilege('authenticated', 'public.public_gardener_directory', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.public_gardener_directory', 'INSERT')
     OR has_table_privilege('authenticated', 'public.public_gardener_directory', 'DELETE')
     OR has_table_privilege('anon', 'public.public_gardener_directory', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.public_gardener_reviews', 'UPDATE') THEN
    RAISE EXCEPTION 'FALLO 7a: la web puede escribir en una vista pública (perfiles o reseñas)';
  END IF;
  IF NOT has_table_privilege('anon', 'public.public_gardener_directory', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.public_gardener_reviews', 'SELECT') THEN
    RAISE EXCEPTION 'FALLO 7b: las vistas públicas han dejado de poder leerse';
  END IF;

  RAISE WARNING 'TODAS LAS COMPROBACIONES OK';
END;
$prueba$;

ROLLBACK;
