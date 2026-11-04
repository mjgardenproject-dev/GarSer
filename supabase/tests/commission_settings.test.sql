-- Pruebas de las comisiones configurables (migraciones 20261102130000, 20261102140000, 20261102150000,
-- 20261104130000 y 20261104140000).
--
-- Todo corre dentro de una transacción que se revierte al final: se puede lanzar contra una base con
-- datos sin ensuciarla.
--
--   docker exec -i <contenedor_db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/commission_settings.test.sql
--
-- Sin Docker: node scripts/commissions/pglite-sql-tests.mjs (monta un esquema mínimo y ejecuta
-- esto mismo).
--
-- Cualquier comprobación que falle aborta con "FALLO <id>: ...". Si termina con
-- "TODAS LAS COMPROBACIONES OK", todo lo de abajo se cumple.
--
-- Va en SQL y no en vitest porque estas reglas deciden cuánto cobra GarSer, y viven en PL/pgSQL,
-- triggers y restricciones de tabla: un doble en TypeScript no probaría lo que ejecuta la base de datos.

BEGIN;

SET client_min_messages = WARNING;

CREATE FUNCTION pg_temp.check_that(p_ok boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FALLO %', p_msg;
  END IF;
END $$;

-- Simula la sesión de un usuario (lo que hace auth.uid()). NULL = sin sesión.
CREATE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN NULL ELSE json_build_object('sub', p_user)::text END, true);
END $$;

-- Economía tal y como la entrega el motor de precios: solo servicio, sin comisión.
CREATE FUNCTION pg_temp.base_econ(p_gross numeric) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'currency', 'EUR', 'taxRate', 0.21,
    'serviceGrossTotal', p_gross,
    'serviceNetSubtotal', round(p_gross / 1.21, 2),
    'serviceTaxAmount', round(p_gross - p_gross / 1.21, 2),
    'managementFee', 0, 'payableNow', 0, 'payableLater', p_gross,
    'lines', jsonb_build_array(
      jsonb_build_object('code', 'service_line_1', 'label', 'Corte de césped', 'amount', p_gross, 'kind', 'service'),
      jsonb_build_object('code', 'service_subtotal', 'label', 'Subtotal del servicio', 'amount', round(p_gross / 1.21, 2), 'kind', 'service'),
      jsonb_build_object('code', 'service_tax', 'label', 'IVA del servicio', 'amount', round(p_gross - p_gross / 1.21, 2), 'kind', 'tax')
    ),
    'stripeLineItems', '[]'::jsonb
  )
$$;

DO $prueba$
DECLARE
  v_admin   uuid := '00000000-0c01-4c01-8fff-000000000001';
  v_user    uuid := '00000000-0c01-4c01-8fff-000000000002';
  v_cli     uuid := '00000000-0c01-4c01-8fff-000000000003';
  v_cli2    uuid := '00000000-0c01-4c01-8fff-000000000004';
  v_cli3    uuid := '00000000-0c01-4c01-8fff-000000000005';
  v_pro     uuid := '00000000-0c01-4c01-8fff-000000000006';
  v_pro2    uuid := '00000000-0c01-4c01-8fff-000000000007';
  v_cli4    uuid := '00000000-0c01-4c01-8fff-000000000008';
  v_cli5    uuid := '00000000-0c01-4c01-8fff-000000000009';
  -- Claves de enlace de los dos profesionales (la clave real son 32 hex aleatorios).
  v_code_pro  text := '0123456789abcdef0123456789abcdef';
  v_code_pro2 text := 'fedcba9876543210fedcba9876543210';
  v_link_pro uuid;
  v_code_a text;
  v_code_b text;
  f jsonb;
  v_servicio uuid;
  v_v0 bigint;
  v_vnow bigint;
  v_n integer;
  v_n2 integer;
  r jsonb;
  s jsonb;
  d jsonb;
  e jsonb;
  e2 jsonb;
  c jsonb;
  v_rates jsonb;
  v_row public.commission_settings%ROWTYPE;
  v_text text;
  v_fee numeric;
  v_source text;
  v_rule text;
  v_booking uuid;
  v_booking2 uuid;
  v_attempt uuid;
  v_quote uuid;
  v_plan uuid;
  v_visit uuid;
  v_ctx jsonb;
  v_cents integer;
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
    u.email, 'x', now(), now(), now(),
    -- «v_user» lleva «role: admin» en su app_metadata a propósito: no debe valer de nada.
    CASE WHEN u.email = 'com.user@test.local' THEN '{"role":"admin"}'::jsonb ELSE '{}'::jsonb END,
    '{}'::jsonb, '', '', '', '', '', '', '', ''
  FROM (VALUES
    (v_admin, 'com.admin@test.local'),
    (v_user, 'com.user@test.local'),
    (v_cli, 'com.cli@test.local'),
    (v_cli2, 'com.cli2@test.local'),
    (v_cli3, 'com.cli3@test.local'),
    (v_pro, 'com.pro@test.local'),
    (v_pro2, 'com.pro2@test.local'),
    (v_cli4, 'com.cli4@test.local'),
    (v_cli5, 'com.cli5@test.local')
  ) AS u(id, email);
  -- El perfil lo crea el trigger de auth.users; solo se le pone el rol.
  UPDATE public.profiles SET role = 'admin', full_name = 'Admin Pruebas' WHERE user_id = v_admin;
  UPDATE public.profiles SET role = 'gardener', full_name = 'Jardinero Pruebas' WHERE user_id = v_pro;
  UPDATE public.profiles SET role = 'gardener', full_name = 'Jardinero Dos' WHERE user_id = v_pro2;
  INSERT INTO public.provider_booking_links (provider_id, code) VALUES (v_pro, v_code_pro), (v_pro2, v_code_pro2);

  -- ===========================================================================
  -- A. Estado inicial y acceso a las tablas
  -- ===========================================================================
  SELECT * INTO v_row FROM public.commission_settings WHERE id = 1;
  PERFORM pg_temp.check_that(FOUND, 'A0: no existe la fila de configuración de comisiones');
  IF v_row.version = 1 THEN
    PERFORM pg_temp.check_that(
      v_row.rate_garser_first = 12.5 AND v_row.rate_link_first = 0 AND v_row.rate_garser_repeat = 3
      AND v_row.rate_maintenance_visit = 3 AND v_row.rate_link_repeat = 0,
      format('A1: los valores iniciales no son 12,5 / 0 / 3 / 3 / 0 (son %s / %s / %s / %s / %s)',
        v_row.rate_garser_first, v_row.rate_link_first, v_row.rate_garser_repeat,
        v_row.rate_maintenance_visit, v_row.rate_link_repeat));
  END IF;
  PERFORM pg_temp.check_that(
    EXISTS (SELECT 1 FROM public.commission_settings_history WHERE version = 1),
    'A2: la versión 1 no está en el historial');
  PERFORM pg_temp.check_that(
    EXISTS (SELECT 1 FROM public.commission_settings_audit WHERE source = 'migration' AND outcome = 'saved'),
    'A3: la creación inicial no está en la auditoría');

  PERFORM pg_temp.check_that(
    NOT has_table_privilege('anon', 'public.commission_settings', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.commission_settings', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.commission_settings', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.commission_settings_history', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.commission_settings_audit', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.client_provider_relationships', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.client_provider_relationships', 'SELECT'),
    'A4: el navegador puede leer o escribir las tablas de comisiones');
  PERFORM pg_temp.check_that(
    has_table_privilege('service_role', 'public.commission_settings', 'SELECT')
    AND has_table_privilege('service_role', 'public.commission_settings_history', 'SELECT'),
    'A5: el servidor no puede leer la configuración');

  PERFORM pg_temp.check_that(
    NOT has_function_privilege('anon', 'public.get_commission_settings()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.save_commission_settings(bigint, jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.list_commission_audit(integer)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.save_commission_settings(bigint, jsonb)', 'EXECUTE'),
    'A6: permisos de ejecución de las RPC de administrador');
  PERFORM pg_temp.check_that(
    NOT has_function_privilege('authenticated', 'public.resolve_booking_commission(uuid, uuid, text, boolean, bigint, text, boolean)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.resolve_booking_commission(uuid, uuid, text, boolean, bigint, text, boolean)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.quote_commission_economics(jsonb, uuid, uuid, text, boolean, bigint, text, boolean)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.commission_snapshot_problem(jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.commission_settings_payload()', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.resolve_booking_commission(uuid, uuid, text, boolean, bigint, text, boolean)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.quote_commission_economics(jsonb, uuid, uuid, text, boolean, bigint, text, boolean)', 'EXECUTE'),
    'A7: las funciones que deciden el dinero se pueden llamar desde el navegador');

  -- Punto de partida conocido para el resto (dentro de la transacción: se revierte).
  UPDATE public.commission_settings
  SET rate_garser_first = 12.5, rate_link_first = 0, rate_garser_repeat = 3,
      rate_maintenance_visit = 3, rate_link_repeat = 0
  WHERE id = 1;
  SELECT version INTO v_v0 FROM public.commission_settings WHERE id = 1;

  -- ===========================================================================
  -- B. Quién puede consultar y guardar (la comprobación de administrador es de SQL)
  -- ===========================================================================
  PERFORM pg_temp.act_as(v_admin);
  r := public.get_commission_settings();
  PERFORM pg_temp.check_that((r ->> 'version')::bigint = v_v0 AND (r #>> '{rates,garser_first}')::numeric = 12.5
    AND (r #>> '{rates,maintenance_visit}')::numeric = 3, 'B1: el administrador no ve los valores guardados');
  PERFORM pg_temp.check_that(jsonb_typeof(public.list_commission_audit(5)) = 'array', 'B2: la auditoría no se puede consultar');

  -- Sin sesión, y un usuario autenticado que NO es administrador (aunque su app_metadata diga lo contrario).
  FOREACH c IN ARRAY ARRAY[NULL::jsonb, to_jsonb(v_user)] LOOP
    PERFORM pg_temp.act_as(CASE WHEN c IS NULL THEN NULL ELSE v_user END);
    BEGIN
      PERFORM public.get_commission_settings();
      RAISE EXCEPTION 'FALLO B3: un no administrador ha podido consultar las comisiones';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      PERFORM public.save_commission_settings(v_v0,
        '{"garser_first":0,"link_first":0,"garser_repeat":0,"maintenance_visit":0,"link_repeat":0}'::jsonb);
      RAISE EXCEPTION 'FALLO B4: un no administrador ha podido guardar las comisiones';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      PERFORM public.list_commission_audit(5);
      RAISE EXCEPTION 'FALLO B5: un no administrador ha podido leer la auditoría';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  SELECT * INTO v_row FROM public.commission_settings WHERE id = 1;
  PERFORM pg_temp.check_that(v_row.version = v_v0 AND v_row.rate_garser_first = 12.5,
    'B6: un intento no autorizado ha tocado la configuración');

  -- ===========================================================================
  -- C. Guardar: atómico, validado y con rastro
  -- ===========================================================================
  PERFORM pg_temp.act_as(v_admin);
  r := public.save_commission_settings(v_v0,
    '{"garser_first":14,"link_first":0,"garser_repeat":3.5,"maintenance_visit":2,"link_repeat":0.25}'::jsonb);
  PERFORM pg_temp.check_that((r ->> 'ok')::boolean AND (r ->> 'changed')::boolean, 'C1: guardado válido rechazado: ' || r::text);
  SELECT * INTO v_row FROM public.commission_settings WHERE id = 1;
  PERFORM pg_temp.check_that(
    v_row.version = v_v0 + 1 AND v_row.rate_garser_first = 14 AND v_row.rate_link_first = 0
    AND v_row.rate_garser_repeat = 3.5 AND v_row.rate_maintenance_visit = 2 AND v_row.rate_link_repeat = 0.25
    AND v_row.updated_by = v_admin,
    'C2: lo persistido no es lo pedido (o no sube la versión / no consta quién)');
  PERFORM pg_temp.check_that(
    (r #>> '{settings,version}')::bigint = v_row.version
    AND (r #>> '{settings,rates,garser_repeat}')::numeric = 3.5
    AND (r #>> '{settings,rates,link_repeat}')::numeric = 0.25,
    'C3: la respuesta no devuelve los valores realmente persistidos');
  PERFORM pg_temp.check_that(
    EXISTS (SELECT 1 FROM public.commission_settings_history h
            WHERE h.version = v_row.version AND h.rate_garser_first = 14 AND h.created_by = v_admin)
    AND EXISTS (SELECT 1 FROM public.commission_settings_history WHERE version = v_v0 AND rate_garser_first = 12.5),
    'C4: el historial no conserva la versión anterior y la nueva');
  PERFORM pg_temp.check_that(
    EXISTS (SELECT 1 FROM public.commission_settings_audit a
            WHERE a.outcome = 'saved' AND a.source = 'admin_rpc' AND a.actor_id = v_admin
              AND a.previous_version = v_v0 AND a.new_version = v_row.version
              AND (a.previous_rates ->> 'garser_first')::numeric = 12.5
              AND (a.saved_rates ->> 'garser_first')::numeric = 14),
    'C5: la auditoría no dice quién, cuándo, de qué a qué');
  v_vnow := v_row.version;

  -- Valores no válidos: ninguno se guarda, ninguno se «arregla» a 0, todos quedan auditados.
  SELECT count(*) INTO v_n FROM public.commission_settings_audit WHERE outcome = 'rejected';
  v_n2 := 0;
  FOREACH s IN ARRAY ARRAY[
    '{"garser_first":-0.01,"link_first":0,"garser_repeat":3,"maintenance_visit":3,"link_repeat":0}'::jsonb,
    '{"garser_first":100.01,"link_first":0,"garser_repeat":3,"maintenance_visit":3,"link_repeat":0}'::jsonb,
    '{"garser_first":"12,5","link_first":0,"garser_repeat":3,"maintenance_visit":3,"link_repeat":0}'::jsonb,
    '{"garser_first":"abc","link_first":0,"garser_repeat":3,"maintenance_visit":3,"link_repeat":0}'::jsonb,
    '{"garser_first":"NaN","link_first":0,"garser_repeat":3,"maintenance_visit":3,"link_repeat":0}'::jsonb,
    '{"garser_first":"Infinity","link_first":0,"garser_repeat":3,"maintenance_visit":3,"link_repeat":0}'::jsonb,
    '{"garser_first":null,"link_first":0,"garser_repeat":3,"maintenance_visit":3,"link_repeat":0}'::jsonb,
    '{"garser_first":true,"link_first":0,"garser_repeat":3,"maintenance_visit":3,"link_repeat":0}'::jsonb,
    '{"garser_first":[],"link_first":0,"garser_repeat":3,"maintenance_visit":3,"link_repeat":0}'::jsonb,
    '{"garser_first":1.005,"link_first":0,"garser_repeat":3,"maintenance_visit":3,"link_repeat":0}'::jsonb,
    '{"link_first":0,"garser_repeat":3,"maintenance_visit":3,"link_repeat":0}'::jsonb,
    '{"garser_first":1,"link_first":0,"garser_repeat":3,"maintenance_visit":3,"link_repeat":0,"extra":5}'::jsonb,
    '{"garser_first":1e400,"link_first":0,"garser_repeat":3,"maintenance_visit":3,"link_repeat":0}'::jsonb,
    '[]'::jsonb,
    '"hola"'::jsonb,
    -- Una regla válida y otra no: no se guarda NI la válida (todo o nada).
    '{"garser_first":50,"link_first":0,"garser_repeat":3,"maintenance_visit":3,"link_repeat":-1}'::jsonb
  ] LOOP
    r := public.save_commission_settings(v_vnow, s);
    PERFORM pg_temp.check_that(NOT (r ->> 'ok')::boolean AND r ->> 'code' = 'invalid_rates',
      'C6: valor inválido aceptado: ' || s::text || ' → ' || r::text);
    v_n2 := v_n2 + 1;
  END LOOP;
  -- NULL y SQL NULL como carga completa.
  r := public.save_commission_settings(v_vnow, NULL);
  PERFORM pg_temp.check_that(NOT (r ->> 'ok')::boolean, 'C7: una carga vacía se ha aceptado');
  v_n2 := v_n2 + 1;
  SELECT * INTO v_row FROM public.commission_settings WHERE id = 1;
  PERFORM pg_temp.check_that(
    v_row.version = v_vnow AND v_row.rate_garser_first = 14 AND v_row.rate_garser_repeat = 3.5
    AND v_row.rate_maintenance_visit = 2 AND v_row.rate_link_repeat = 0.25,
    'C8: un guardado rechazado ha dejado la configuración parcialmente cambiada');
  SELECT count(*) INTO v_n FROM public.commission_settings_audit WHERE outcome = 'rejected' AND actor_id = v_admin;
  PERFORM pg_temp.check_that(v_n >= v_n2, format('C9: los rechazos no quedan auditados (%s de %s)', v_n, v_n2));

  -- Los límites valen: 0, 100, 0,01.
  r := public.save_commission_settings(v_vnow,
    '{"garser_first":100,"link_first":0,"garser_repeat":0.01,"maintenance_visit":0,"link_repeat":99.99}'::jsonb);
  PERFORM pg_temp.check_that((r ->> 'ok')::boolean, 'C10: los límites 0 / 100 / 0,01 / 99,99 se rechazan: ' || r::text);
  v_vnow := (r #>> '{settings,version}')::bigint;

  -- Versión desfasada: otro administrador cambió algo mientras éste editaba.
  r := public.save_commission_settings(v_v0,
    '{"garser_first":5,"link_first":5,"garser_repeat":5,"maintenance_visit":5,"link_repeat":5}'::jsonb);
  PERFORM pg_temp.check_that(NOT (r ->> 'ok')::boolean AND r ->> 'code' = 'stale_version', 'C11: no avisa de una versión desfasada: ' || r::text);
  r := public.save_commission_settings(NULL,
    '{"garser_first":5,"link_first":5,"garser_repeat":5,"maintenance_visit":5,"link_repeat":5}'::jsonb);
  PERFORM pg_temp.check_that(NOT (r ->> 'ok')::boolean AND r ->> 'code' = 'stale_version', 'C12: acepta guardar sin versión');
  PERFORM pg_temp.check_that((SELECT rate_garser_first FROM public.commission_settings WHERE id = 1) = 100,
    'C13: una versión desfasada ha escrito');
  PERFORM pg_temp.check_that(EXISTS (SELECT 1 FROM public.commission_settings_audit WHERE outcome = 'stale'), 'C14: lo desfasado no queda auditado');

  -- Idempotencia: repetir lo ya guardado (doble clic, reintento) no es error ni sube la versión,
  -- aunque la versión que trae la web esté vieja.
  r := public.save_commission_settings(v_v0,
    '{"garser_first":100,"link_first":0,"garser_repeat":0.01,"maintenance_visit":0,"link_repeat":99.99}'::jsonb);
  PERFORM pg_temp.check_that((r ->> 'ok')::boolean AND NOT (r ->> 'changed')::boolean
    AND (r #>> '{settings,version}')::bigint = v_vnow, 'C15: repetir un guardado no es idempotente: ' || r::text);

  -- Vuelta al punto de partida por la vía normal.
  r := public.save_commission_settings(v_vnow,
    '{"garser_first":12.5,"link_first":0,"garser_repeat":3,"maintenance_visit":3,"link_repeat":0}'::jsonb);
  PERFORM pg_temp.check_that((r ->> 'ok')::boolean, 'C16: no se puede volver a los valores iniciales');
  v_vnow := (r #>> '{settings,version}')::bigint;

  -- ===========================================================================
  -- D. Por cualquier camino: versión, historial y auditoría los lleva la base de datos
  -- ===========================================================================
  PERFORM pg_temp.act_as(NULL);
  UPDATE public.commission_settings SET rate_link_first = 1 WHERE id = 1;
  SELECT * INTO v_row FROM public.commission_settings WHERE id = 1;
  PERFORM pg_temp.check_that(v_row.version = v_vnow + 1, 'D1: una modificación directa no sube la versión');
  PERFORM pg_temp.check_that(
    EXISTS (SELECT 1 FROM public.commission_settings_audit WHERE source = 'direct_sql' AND new_version = v_row.version)
    AND EXISTS (SELECT 1 FROM public.commission_settings_history WHERE version = v_row.version AND rate_link_first = 1),
    'D2: una modificación directa no deja rastro');
  UPDATE public.commission_settings SET rate_link_first = 0, version = 999 WHERE id = 1;
  SELECT * INTO v_row FROM public.commission_settings WHERE id = 1;
  PERFORM pg_temp.check_that(v_row.version = v_vnow + 2, 'D3: se puede escribir la versión a mano');
  v_vnow := v_row.version;
  UPDATE public.commission_settings SET version = 1234 WHERE id = 1;
  PERFORM pg_temp.check_that((SELECT version FROM public.commission_settings WHERE id = 1) = v_vnow,
    'D4: cambiar solo la versión la mueve');

  BEGIN
    UPDATE public.commission_settings SET rate_garser_first = 100.5 WHERE id = 1;
    RAISE EXCEPTION 'FALLO D5: la base acepta un porcentaje superior a 100';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.commission_settings SET rate_garser_first = -1 WHERE id = 1;
    RAISE EXCEPTION 'FALLO D6: la base acepta un porcentaje negativo';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.commission_settings SET rate_link_repeat = NULL WHERE id = 1;
    RAISE EXCEPTION 'FALLO D7: la base acepta un porcentaje vacío';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.commission_settings;
    RAISE EXCEPTION 'FALLO D8: se puede borrar la configuración';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    TRUNCATE public.commission_settings;
    RAISE EXCEPTION 'FALLO D9: se puede vaciar la configuración';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.commission_settings_history SET rate_garser_first = 0 WHERE version = 1;
    RAISE EXCEPTION 'FALLO D10: se puede reescribir el historial';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.commission_settings_audit;
    RAISE EXCEPTION 'FALLO D11: se puede borrar la auditoría';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.commission_settings (id, version, rate_garser_first, rate_link_first, rate_garser_repeat,
      rate_maintenance_visit, rate_link_repeat) VALUES (2, 1, 1, 1, 1, 1, 1);
    RAISE EXCEPTION 'FALLO D12: puede haber dos configuraciones';
  EXCEPTION WHEN check_violation OR unique_violation THEN NULL;
  END;

  -- ===========================================================================
  -- E. Qué regla toca (valores de partida 12,5 / 0 / 3 / 3 / 0)
  -- ===========================================================================
  r := public.resolve_booking_commission(v_cli, v_pro, NULL);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'garser_first' AND (r ->> 'rateBps')::int = 1250 AND r ->> 'origin' = 'garser'
    AND (r ->> 'isFirstBooking')::boolean AND (r ->> 'configVersion')::bigint = v_vnow, 'E1: cliente nuevo de GarSer: ' || r::text);
  r := public.resolve_booking_commission(v_cli, v_pro, 'provider_link', p_link_code => v_code_pro);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'link_first' AND (r ->> 'rateBps')::int = 0 AND r ->> 'origin' = 'provider_link'
    AND r ->> 'linkClaim' = 'verified', 'E2: primera reserva por el enlace (con su clave): ' || r::text);
  r := public.resolve_booking_commission(v_cli, v_pro, 'otra_cosa');
  PERFORM pg_temp.check_that(r ->> 'rule' = 'garser_first' AND r -> 'claimedOrigin' = 'null'::jsonb,
    'E3: un origen declarado desconocido cuenta como enlace: ' || r::text);
  r := public.resolve_booking_commission(NULL, v_pro, 'provider_link', p_link_code => v_code_pro);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'link_first', 'E4: sin sesión, el enlace no cuenta');
  r := public.resolve_booking_commission(NULL, v_pro, NULL);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'garser_first', 'E5: sin sesión ni enlace debería ser GarSer');
  r := public.resolve_booking_commission(v_cli, v_pro, NULL, true);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'maintenance_visit' AND (r ->> 'rateBps')::int = 300
    AND NOT (r ->> 'isFirstBooking')::boolean, 'E6: visita de plan: ' || r::text);

  -- Primera reserva de v_cli con v_pro (por GarSer), aún sin completar: se guarda el origen.
  v_booking := gen_random_uuid();
  e := public.quote_commission_economics(pg_temp.base_econ(100), v_cli, v_pro, NULL);
  INSERT INTO public.bookings (id, client_id, gardener_id, service_id, date, start_time, duration_hours, status,
    total_price, client_address, pricing_context)
  VALUES (v_booking, v_cli, v_pro, v_servicio, current_date + 30, '09:00', 2, 'pending', 100, 'Calle 1',
    jsonb_build_object('payable_now_amount_cents', 1250, 'quote_economic_snapshot', e));
  PERFORM pg_temp.check_that(
    EXISTS (SELECT 1 FROM public.client_provider_relationships WHERE client_id = v_cli AND provider_id = v_pro
            AND origin = 'garser' AND first_booking_id = v_booking AND source = 'booking'),
    'E7: la primera reserva no guarda el origen del cliente');

  -- Vuelve por el enlace de v_pro: NO cambia su origen (decisión 2) ni concede el 0 %.
  r := public.resolve_booking_commission(v_cli, v_pro, 'provider_link', p_link_code => v_code_pro);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'garser_first' AND r ->> 'origin' = 'garser',
    'E8: volver por el enlace (con su clave) cambia el origen o concede el 0 %: ' || r::text);
  -- Una reserva solo aceptada NO es «ya contrató antes».
  UPDATE public.bookings SET status = 'confirmed' WHERE id = v_booking;
  r := public.resolve_booking_commission(v_cli, v_pro, NULL);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'garser_first', 'E9: una reserva solo aceptada cuenta como contratación');
  UPDATE public.bookings SET status = 'cancelled' WHERE id = v_booking;
  r := public.resolve_booking_commission(v_cli, v_pro, NULL);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'garser_first', 'E10: una reserva cancelada cuenta como contratación');
  -- Completada: ahora sí, y con relación GarSer → 3 %.
  UPDATE public.bookings SET status = 'completed' WHERE id = v_booking;
  r := public.resolve_booking_commission(v_cli, v_pro, NULL);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'garser_repeat' AND (r ->> 'rateBps')::int = 300
    AND NOT (r ->> 'isFirstBooking')::boolean, 'E11: cliente de GarSer que repite: ' || r::text);
  r := public.resolve_booking_commission(v_cli, v_pro, 'provider_link', p_link_code => v_code_pro);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'garser_repeat', 'E12: un cliente de GarSer que repite se hace pasar por el enlace');
  -- Con otro profesional se decide de nuevo.
  r := public.resolve_booking_commission(v_cli, v_pro2, NULL);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'garser_first', 'E13: repetir con uno no afecta a otro profesional');
  r := public.resolve_booking_commission(v_cli, v_pro2, 'provider_link', p_link_code => v_code_pro2);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'link_first', 'E14: el enlace de otro profesional sí cuenta con él');

  -- Cliente del enlace de v_pro: su primera reserva fija «enlace»; al completarla, repite con 0 %.
  e2 := public.quote_commission_economics(pg_temp.base_econ(100), v_cli2, v_pro, 'provider_link', p_link_code => v_code_pro);
  v_booking2 := gen_random_uuid();
  INSERT INTO public.bookings (id, client_id, gardener_id, service_id, date, start_time, duration_hours, status,
    total_price, client_address, pricing_context)
  VALUES (v_booking2, v_cli2, v_pro, v_servicio, current_date + 31, '09:00', 2, 'completed', 100, 'Calle 2',
    jsonb_build_object('payable_now_amount_cents', 0, 'quote_economic_snapshot', e2));
  PERFORM pg_temp.check_that(
    EXISTS (SELECT 1 FROM public.client_provider_relationships WHERE client_id = v_cli2 AND provider_id = v_pro AND origin = 'provider_link'),
    'E15: la reserva por el enlace no guarda el origen «enlace»');
  r := public.resolve_booking_commission(v_cli2, v_pro, NULL);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'link_repeat' AND (r ->> 'rateBps')::int = 0 AND r ->> 'origin' = 'provider_link',
    'E16: cliente del enlace que repite: ' || r::text);
  -- La visita de un plan SIEMPRE paga la regla del plan (decisión 1), también si el cliente es del enlace.
  r := public.resolve_booking_commission(v_cli2, v_pro, NULL, true);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'maintenance_visit' AND (r ->> 'rateBps')::int = 300,
    'E17: visita de plan de un cliente del enlace: ' || r::text);
  r := public.resolve_booking_commission(v_cli, v_pro, NULL, true);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'maintenance_visit', 'E18: visita de plan de un cliente que repite');

  -- Una segunda reserva no cambia el origen ya guardado.
  INSERT INTO public.bookings (id, client_id, gardener_id, service_id, date, start_time, duration_hours, status,
    total_price, client_address, pricing_context)
  VALUES (gen_random_uuid(), v_cli2, v_pro, v_servicio, current_date + 32, '09:00', 2, 'pending', 100, 'Calle 2b',
    jsonb_build_object('payable_now_amount_cents', 1250,
      'quote_economic_snapshot', public.apply_commission_to_economics(pg_temp.base_econ(100),
        public.resolve_booking_commission(NULL, v_pro, NULL))));
  PERFORM pg_temp.check_that(
    (SELECT origin FROM public.client_provider_relationships WHERE client_id = v_cli2 AND provider_id = v_pro) = 'provider_link',
    'E19: una segunda reserva ha cambiado el origen guardado');
  BEGIN
    UPDATE public.client_provider_relationships SET origin = 'garser' WHERE client_id = v_cli2 AND provider_id = v_pro;
    RAISE EXCEPTION 'FALLO E20: se puede reescribir el origen de un cliente';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Cambiar la configuración cambia las reservas NUEVAS, y la versión antigua sigue siendo consultable.
  PERFORM pg_temp.act_as(v_admin);
  r := public.save_commission_settings(v_vnow,
    '{"garser_first":20,"link_first":0,"garser_repeat":4,"maintenance_visit":3,"link_repeat":0}'::jsonb);
  PERFORM pg_temp.check_that((r ->> 'ok')::boolean, 'E21: no se puede guardar un cambio: ' || r::text);
  s := public.resolve_booking_commission(v_cli3, v_pro, NULL);
  PERFORM pg_temp.check_that((s ->> 'rateBps')::int = 2000 AND (s ->> 'configVersion')::bigint = v_vnow + 1,
    'E22: un cambio en el panel no cambia el cálculo de las reservas nuevas: ' || s::text);
  s := public.resolve_booking_commission(v_cli3, v_pro, NULL, false, v_vnow);
  PERFORM pg_temp.check_that((s ->> 'rateBps')::int = 1250 AND (s ->> 'configVersion')::bigint = v_vnow,
    'E23: no se puede consultar la configuración con la que se firmó un presupuesto: ' || s::text);
  BEGIN
    PERFORM public.resolve_booking_commission(v_cli3, v_pro, NULL, false, 987654);
    RAISE EXCEPTION 'FALLO E24: una versión inexistente se acepta';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'commission_config_unavailable' THEN RAISE; END IF;
  END;
  v_vnow := v_vnow + 1;
  -- La reserva de v_cli sigue como estaba (aquí aún no hay instantánea: se prueba en G).

  -- ===========================================================================
  -- F. La cuenta: céntimos, redondeo y forma de la economía
  -- ===========================================================================
  PERFORM pg_temp.act_as(v_admin);
  r := public.save_commission_settings(v_vnow,
    '{"garser_first":12.5,"link_first":0,"garser_repeat":3,"maintenance_visit":3,"link_repeat":0}'::jsonb);
  v_vnow := (r #>> '{settings,version}')::bigint;

  e := public.quote_commission_economics(pg_temp.base_econ(158), v_cli3, v_pro, NULL);
  PERFORM pg_temp.check_that(
    (e ->> 'managementFee')::numeric = 19.75 AND (e ->> 'payableNow')::numeric = 19.75
    AND (e ->> 'serviceGrossTotal')::numeric = 158 AND (e ->> 'payableLater')::numeric = 158
    AND NOT (e ? 'feeWaiver')
    AND (e #>> '{commission,rule}') = 'garser_first' AND (e #>> '{commission,rateBps}')::int = 1250
    AND (e #>> '{commission,baseAmount}')::numeric = 158 AND (e #>> '{commission,amount}')::numeric = 19.75
    AND (e #>> '{commission,calculatedAmount}')::numeric = 19.75 AND e #> '{commission,adjustment}' = 'null'::jsonb
    AND (e #>> '{commission,configVersion}')::bigint = v_vnow
    AND jsonb_array_length(e -> 'stripeLineItems') = 1
    AND (e #>> '{stripeLineItems,0,unitAmount}')::numeric = 19.75
    AND (e -> 'lines' -> -1 ->> 'code') = 'management_fee' AND (e -> 'lines' -> -1 ->> 'amount')::numeric = 19.75
    AND jsonb_array_length(e -> 'lines') = 4,
    'F1: la economía con comisión no tiene la forma esperada: ' || e::text);
  -- Lo que paga el cliente = servicio + comisión, al céntimo; lo que cobra el jardinero no cambia.
  PERFORM pg_temp.check_that((e ->> 'serviceGrossTotal')::numeric + (e ->> 'managementFee')::numeric = 177.75,
    'F2: servicio + comisión no suman el total del cliente');

  -- Redondeo (a la mitad, hacia arriba) y suelo de 0,50 €.
  FOR r IN SELECT x FROM jsonb_array_elements('[
      {"g": 41,     "bps": 1250, "fee": 5.13, "adj": false},
      {"g": 100.04, "bps": 1250, "fee": 12.51, "adj": false},
      {"g": 33.33,  "bps": 300,  "fee": 1.00, "adj": false},
      {"g": 158,    "bps": 300,  "fee": 4.74, "adj": false},
      {"g": 16.67,  "bps": 300,  "fee": 0.50, "adj": false},
      {"g": 16.66,  "bps": 300,  "fee": 0.50, "adj": false},
      {"g": 16,     "bps": 300,  "fee": 0.50, "adj": true},
      {"g": 10,     "bps": 300,  "fee": 0.50, "adj": true},
      {"g": 0.10,   "bps": 300,  "fee": 0.50, "adj": true},
      {"g": 1000,   "bps": 10000,"fee": 1000, "adj": false},
      {"g": 59,     "bps": 1,    "fee": 0.50, "adj": true}
    ]'::jsonb) AS x
  LOOP
    c := public.apply_commission_to_economics(pg_temp.base_econ((r ->> 'g')::numeric),
      jsonb_build_object('rule', 'garser_first', 'rateBps', (r ->> 'bps')::int, 'configVersion', v_vnow, 'origin', 'garser'));
    PERFORM pg_temp.check_that(
      (c ->> 'managementFee')::numeric = (r ->> 'fee')::numeric
      AND ((c #>> '{commission,adjustment}') IS NOT NULL) = (r ->> 'adj')::boolean,
      format('F3: %s € al %s bps salió %s (adjustment %s) y se esperaba %s', r ->> 'g', r ->> 'bps',
        c ->> 'managementFee', c #>> '{commission,adjustment}', r ->> 'fee'));
  END LOOP;

  -- Al 0 %: sin gastos, con el motivo de la regla, y la base de datos lo reconoce como exención válida.
  FOREACH v_rule IN ARRAY ARRAY['garser_first', 'link_first', 'garser_repeat', 'maintenance_visit', 'link_repeat'] LOOP
    c := public.apply_commission_to_economics(pg_temp.base_econ(100),
      jsonb_build_object('rule', v_rule, 'rateBps', 0, 'configVersion', v_vnow, 'origin', 'garser'));
    v_text := CASE v_rule WHEN 'garser_first' THEN 'zero_commission' WHEN 'link_first' THEN 'provider_link'
      WHEN 'garser_repeat' THEN 'returning_client' WHEN 'maintenance_visit' THEN 'maintenance_plan' ELSE 'returning_client' END;
    PERFORM pg_temp.check_that(
      (c ->> 'managementFee')::numeric = 0 AND (c ->> 'payableNow')::numeric = 0
      AND c #>> '{feeWaiver,reason}' = v_text AND jsonb_array_length(c -> 'stripeLineItems') = 0
      AND jsonb_array_length(c -> 'lines') = 3 AND public.quote_economics_fee_waived(c),
      format('F4: regla %s al 0 %% no sale exenta con motivo %s: %s', v_rule, v_text, c));
  END LOOP;
  -- Una economía a 0 sin exención NO es una exención (no se puede colar un 0 sin motivo).
  PERFORM pg_temp.check_that(NOT public.quote_economics_fee_waived(pg_temp.base_econ(100)), 'F5: un 0 sin motivo cuenta como exención');
  PERFORM pg_temp.check_that(NOT public.quote_economics_fee_waived(jsonb_set(
    public.apply_commission_to_economics(pg_temp.base_econ(100),
      jsonb_build_object('rule', 'link_first', 'rateBps', 0, 'configVersion', v_vnow, 'origin', 'garser')),
    '{feeWaiver,reason}', '"por_la_cara"')), 'F6: un motivo inventado cuenta como exención');

  -- Idempotente: aplicar encima de una economía que ya traía comisión (o el 12,5 % antiguo) da lo mismo.
  d := jsonb_build_object('rule', 'garser_repeat', 'rateBps', 300, 'configVersion', v_vnow, 'origin', 'garser');
  PERFORM pg_temp.check_that(
    public.apply_commission_to_economics(e, d) = public.apply_commission_to_economics(pg_temp.base_econ(158), d),
    'F7: aplicar la comisión dos veces da otra cosa');
  PERFORM pg_temp.check_that(
    public.strip_commission_from_economics(e) = pg_temp.base_econ(158)
    OR public.strip_commission_from_economics(e) @> pg_temp.base_econ(158),
    'F8: quitar la comisión no deja el servicio como estaba');
  PERFORM pg_temp.check_that(
    public.apply_commission_to_economics(public.waive_quote_economics(e, 'provider_link'), d)
    = public.apply_commission_to_economics(pg_temp.base_econ(158), d),
    'F9: una economía exenta con el sistema antiguo no se recalcula bien');

  -- Entradas rotas: se rechazan, no se convierten en 0.
  FOREACH s IN ARRAY ARRAY[
    '{"rule":"inventada","rateBps":300,"configVersion":1,"origin":"garser"}'::jsonb,
    '{"rule":"garser_first","rateBps":-1,"configVersion":1,"origin":"garser"}'::jsonb,
    '{"rule":"garser_first","rateBps":10001,"configVersion":1,"origin":"garser"}'::jsonb,
    '{"rule":"garser_first","rateBps":12.5,"configVersion":1,"origin":"garser"}'::jsonb,
    '{"rule":"garser_first","rateBps":"300","configVersion":1,"origin":"garser"}'::jsonb,
    '{"rule":"garser_first","configVersion":1,"origin":"garser"}'::jsonb,
    '{"rule":"garser_first","rateBps":300,"origin":"garser"}'::jsonb,
    '{"rule":"garser_first","rateBps":300,"configVersion":1,"origin":"marciano"}'::jsonb,
    '{"rule":"garser_first","rateBps":300,"configVersion":1,"origin":"garser","claimedOrigin":"otro"}'::jsonb
  ] LOOP
    BEGIN
      PERFORM public.apply_commission_to_economics(pg_temp.base_econ(100), s);
      RAISE EXCEPTION 'FALLO F10: se ha aceptado una decisión rota: %', s;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM LIKE 'FALLO%' THEN RAISE; END IF;
    END;
  END LOOP;
  BEGIN
    PERFORM public.apply_commission_to_economics('{"currency":"EUR"}'::jsonb, d);
    RAISE EXCEPTION 'FALLO F11: se ha calculado una comisión sin precio del servicio';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALLO%' THEN RAISE; END IF;
  END;
  -- Un servicio sin precio no puede salir «exento»: su intento de pago se rechazaría.
  c := public.apply_commission_to_economics(pg_temp.base_econ(0), d);
  PERFORM pg_temp.check_that(NOT public.quote_economics_fee_waived(c) AND (c ->> 'payableNow')::numeric = 0,
    'F12: un servicio sin precio sale como exento');

  -- ===========================================================================
  -- G. Un presupuesto firmado se verifica contra el historial, no contra sí mismo
  -- ===========================================================================
  e := public.quote_commission_economics(pg_temp.base_econ(158), v_cli3, v_pro, NULL);
  PERFORM pg_temp.check_that(public.commission_snapshot_problem(e) IS NULL, 'G1: un presupuesto válido se rechaza');
  PERFORM pg_temp.check_that(public.commission_snapshot_problem(pg_temp.base_econ(158)) IS NULL, 'G2: un presupuesto anterior a las comisiones configurables se rechaza');
  PERFORM pg_temp.check_that(public.commission_snapshot_problem(jsonb_set(e, '{commission,rateBps}', '0')) IS NOT NULL, 'G3: un porcentaje rebajado pasa');
  PERFORM pg_temp.check_that(public.commission_snapshot_problem(jsonb_set(e, '{managementFee}', '1')) IS NOT NULL, 'G4: un importe rebajado pasa');
  PERFORM pg_temp.check_that(public.commission_snapshot_problem(jsonb_set(e, '{payableNow}', '1')) IS NOT NULL, 'G5: un «pagar ahora» rebajado pasa');
  PERFORM pg_temp.check_that(public.commission_snapshot_problem(jsonb_set(e, '{commission,configVersion}', '987654')) IS NOT NULL, 'G6: una versión inexistente pasa');
  PERFORM pg_temp.check_that(public.commission_snapshot_problem(jsonb_set(e, '{commission,rule}', '"link_first"')) IS NOT NULL, 'G7: cambiar la regla sin cambiar el importe pasa');
  PERFORM pg_temp.check_that(public.commission_snapshot_problem(jsonb_set(e, '{commission,rule}', '"inventada"')) IS NOT NULL, 'G8: una regla inventada pasa');
  PERFORM pg_temp.check_that(public.commission_snapshot_problem(jsonb_set(e, '{serviceGrossTotal}', '10')) IS NOT NULL, 'G9: cambiar el precio sin recalcular la comisión pasa');
  PERFORM pg_temp.check_that(public.commission_snapshot_problem(jsonb_set(e, '{commission}', '"x"')) IS NOT NULL, 'G10: una comisión mal formada pasa');
  -- Con otra versión del historial y su porcentaje de entonces SÍ es válido (presupuestos en curso).
  s := public.quote_commission_economics(pg_temp.base_econ(158), v_cli3, v_pro, NULL, false, v_vnow - 1);
  PERFORM pg_temp.check_that((s #>> '{commission,rateBps}')::int = 2000 AND public.commission_snapshot_problem(s) IS NULL,
    'G11: un presupuesto firmado con la versión anterior deja de ser válido al cambiar la configuración: ' || s::text);

  -- ===========================================================================
  -- H. Intentos de pago: no hay cobro posible con una comisión inválida
  -- ===========================================================================
  INSERT INTO public.booking_quotes (client_id, gardener_id, service_id, signature, pricing_version,
    provider_config_version, input_payload, pricing_snapshot, total_price, estimated_hours, status,
    generated_at, expires_at, selected_date, selected_start_time, economic_snapshot)
  VALUES (v_cli3, v_pro, v_servicio, 'commission-test-' || gen_random_uuid(), 'booking_quote_v1',
    'cfg', '{}'::jsonb, '{}'::jsonb, 158, 2, 'active', now(), now() + interval '2 hours',
    current_date + 40, '09:00', e)
  RETURNING id INTO v_quote;
  -- Válido: el importe a cobrar es la comisión firmada.
  INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
    selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
    stripe_idempotency_key, economic_snapshot)
  VALUES (v_cli3, v_pro, v_servicio, v_quote, 'sig', current_date + 40, '09:00', 2, 15800, 1975,
    gen_random_uuid()::text, e);
  -- El importe no coincide con la comisión firmada.
  BEGIN
    INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
      selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
      stripe_idempotency_key, economic_snapshot)
    VALUES (v_cli3, v_pro, v_servicio, v_quote, 'sig', current_date + 40, '09:00', 2, 15800, 100,
      gen_random_uuid()::text, e);
    RAISE EXCEPTION 'FALLO H1: se ha creado un intento por un importe distinto de la comisión';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- Presupuesto adulterado (porcentaje rebajado a mano, importes coherentes entre sí).
  BEGIN
    INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
      selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
      stripe_idempotency_key, economic_snapshot)
    VALUES (v_cli3, v_pro, v_servicio, v_quote, 'sig', current_date + 40, '09:00', 2, 15800, 1975,
      gen_random_uuid()::text, jsonb_set(e, '{commission,rateBps}', '300'));
    RAISE EXCEPTION 'FALLO H2: se ha creado un intento con el porcentaje adulterado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- Un presupuesto anterior a las comisiones configurables sigue pudiendo pagar (durante el despliegue).
  INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
    selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
    stripe_idempotency_key, economic_snapshot)
  VALUES (v_cli3, v_pro, v_servicio, v_quote, 'sig', current_date + 41, '09:00', 2, 10000, 1250,
    gen_random_uuid()::text, pg_temp.base_econ(100) || '{"managementFee":12.5,"payableNow":12.5}'::jsonb);
  -- 0 € solo con exención válida, también con el motivo nuevo.
  c := public.quote_commission_economics(pg_temp.base_econ(100), v_cli3, v_pro, 'provider_link', p_link_code => v_code_pro);
  PERFORM pg_temp.check_that(c #>> '{feeWaiver,reason}' = 'provider_link', 'H3: el enlace no sale exento: ' || c::text);
  INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
    selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
    stripe_idempotency_key, economic_snapshot)
  VALUES (v_cli3, v_pro, v_servicio, v_quote, 'sig', current_date + 42, '09:00', 2, 10000, 0, gen_random_uuid()::text, c);
  BEGIN
    INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
      selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
      stripe_idempotency_key, economic_snapshot)
    VALUES (v_cli3, v_pro, v_servicio, v_quote, 'sig', current_date + 42, '09:00', 2, 10000, 0, gen_random_uuid()::text, pg_temp.base_econ(100));
    RAISE EXCEPTION 'FALLO H4: un intento de 0 € sin exención se ha guardado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- Un presupuesto de pago por 0 con la comisión de cobro (no exento) no vale.
  BEGIN
    INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
      selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
      stripe_idempotency_key, economic_snapshot)
    VALUES (v_cli3, v_pro, v_servicio, v_quote, 'sig', current_date + 42, '09:00', 2, 15800, 0, gen_random_uuid()::text, e);
    RAISE EXCEPTION 'FALLO H5: un intento de 0 € con comisión > 0 se ha guardado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ===========================================================================
  -- I. Reservas: la comisión queda fijada y no se puede tocar
  -- ===========================================================================
  v_attempt := gen_random_uuid();
  INSERT INTO public.booking_payment_attempts (id, client_id, gardener_id, service_id, quote_id, quote_signature,
    selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
    stripe_idempotency_key, economic_snapshot)
  VALUES (v_attempt, v_cli3, v_pro, v_servicio, v_quote, 'sig', current_date + 50, '09:00', 2, 15800, 1975,
    gen_random_uuid()::text, e);
  v_booking := gen_random_uuid();
  INSERT INTO public.bookings (id, client_id, gardener_id, service_id, date, start_time, duration_hours, status,
    total_price, client_address, pricing_context)
  VALUES (v_booking, v_cli3, v_pro, v_servicio, current_date + 50, '09:00', 2, 'pending', 158, 'Calle 3',
    jsonb_build_object('payment_attempt_id', v_attempt, 'payable_now_amount_cents', 1975, 'quote_economic_snapshot', e));
  SELECT management_fee, management_fee_source, commission_rule INTO v_fee, v_source, v_rule FROM public.bookings WHERE id = v_booking;
  PERFORM pg_temp.check_that(v_fee = 19.75 AND v_source = 'payment_attempt' AND v_rule = 'garser_first',
    format('I1: la reserva quedó con %s / %s / %s', v_fee, v_source, v_rule));
  PERFORM pg_temp.check_that(
    EXISTS (SELECT 1 FROM public.bookings WHERE id = v_booking AND commission_rate_bps = 1250
      AND commission_base_amount = 158 AND commission_config_version = v_vnow AND commission_fixed_at IS NOT NULL),
    'I2: la reserva no guarda porcentaje, base, versión y fecha');
  PERFORM pg_temp.check_that((SELECT client_total_price FROM public.bookings WHERE id = v_booking) = 177.75,
    'I3: el total del cliente no es servicio + comisión');
  -- Inmutable.
  BEGIN
    UPDATE public.bookings SET commission_rate_bps = 0 WHERE id = v_booking;
    RAISE EXCEPTION 'FALLO I4: se ha podido rebajar el porcentaje de una reserva';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.bookings SET commission_rule = 'link_first' WHERE id = v_booking;
    RAISE EXCEPTION 'FALLO I5: se ha podido cambiar la regla de una reserva';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.bookings SET management_fee = 0, management_fee_source = 'waived_provider_link' WHERE id = v_booking;
    RAISE EXCEPTION 'FALLO I6: se ha podido eximir una reserva ya creada';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.bookings SET commission_config_version = 1 WHERE id = v_booking;
    RAISE EXCEPTION 'FALLO I7: se ha podido cambiar la versión de una reserva';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.bookings SET commission_rule = NULL, commission_rate_bps = NULL, commission_base_amount = NULL,
      commission_config_version = NULL, commission_fixed_at = NULL WHERE id = v_booking;
    RAISE EXCEPTION 'FALLO I8: se ha podido borrar la instantánea de una reserva';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- Un cambio de precio aceptado SÍ cambia el precio del servicio, pero no la comisión ya cobrada.
  UPDATE public.bookings SET total_price = 200 WHERE id = v_booking;
  PERFORM pg_temp.check_that(
    (SELECT management_fee FROM public.bookings WHERE id = v_booking) = 19.75
    AND (SELECT commission_base_amount FROM public.bookings WHERE id = v_booking) = 158
    AND (SELECT client_total_price FROM public.bookings WHERE id = v_booking) = 219.75,
    'I9: un cambio de precio alteró la comisión ya cobrada');
  -- Y un cambio en el panel no toca las reservas antiguas.
  PERFORM pg_temp.act_as(v_admin);
  r := public.save_commission_settings(v_vnow,
    '{"garser_first":1,"link_first":1,"garser_repeat":1,"maintenance_visit":1,"link_repeat":1}'::jsonb);
  PERFORM pg_temp.check_that((r ->> 'ok')::boolean, 'I10: no se puede guardar: ' || r::text);
  PERFORM pg_temp.check_that(
    EXISTS (SELECT 1 FROM public.bookings WHERE id = v_booking AND management_fee = 19.75
      AND commission_rate_bps = 1250 AND commission_config_version = v_vnow),
    'I11: cambiar las comisiones en el panel alteró una reserva ya creada');
  v_vnow := (r #>> '{settings,version}')::bigint;
  r := public.save_commission_settings(v_vnow,
    '{"garser_first":12.5,"link_first":0,"garser_repeat":3,"maintenance_visit":3,"link_repeat":0}'::jsonb);
  v_vnow := (r #>> '{settings,version}')::bigint;
  PERFORM pg_temp.act_as(NULL);

  -- El importe cobrado tiene que ser el que dicen la base y el porcentaje.
  BEGIN
    INSERT INTO public.bookings (id, client_id, gardener_id, service_id, date, start_time, duration_hours, status,
      total_price, client_address, pricing_context)
    VALUES (gen_random_uuid(), v_cli3, v_pro, v_servicio, current_date + 51, '09:00', 2, 'pending', 158, 'Calle 3b',
      jsonb_build_object('payable_now_amount_cents', 1000, 'quote_economic_snapshot', e));
    RAISE EXCEPTION 'FALLO I12: se ha creado una reserva cuyo cobro no cuadra con su comisión';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- Exenta por regla al 0 %: sin cobro, con su motivo, y se reconoce como tal.
  v_booking2 := gen_random_uuid();
  INSERT INTO public.bookings (id, client_id, gardener_id, service_id, date, start_time, duration_hours, status,
    total_price, client_address, pricing_context)
  VALUES (v_booking2, v_cli3, v_pro2, v_servicio, current_date + 52, '09:00', 2, 'pending', 100, 'Calle 4',
    jsonb_build_object('payable_now_amount_cents', 0, 'quote_economic_snapshot',
      public.quote_commission_economics(pg_temp.base_econ(100), v_cli3, v_pro2, 'provider_link', p_link_code => v_code_pro2)));
  SELECT management_fee, management_fee_source, commission_rule INTO v_fee, v_source, v_rule FROM public.bookings WHERE id = v_booking2;
  PERFORM pg_temp.check_that(v_fee = 0 AND v_source = 'waived_provider_link' AND v_rule = 'link_first',
    format('I13: la reserva del enlace quedó con %s / %s / %s', v_fee, v_source, v_rule));
  PERFORM pg_temp.check_that(
    (SELECT origin FROM public.client_provider_relationships WHERE client_id = v_cli3 AND provider_id = v_pro2) = 'provider_link',
    'I14: la reserva del enlace no guarda el origen');
  -- Regla del 0 % que no es de enlace, cliente que repite ni plan: motivo propio.
  v_booking2 := gen_random_uuid();
  INSERT INTO public.bookings (id, client_id, gardener_id, service_id, date, start_time, duration_hours, status,
    total_price, client_address, pricing_context)
  VALUES (v_booking2, v_cli, v_pro2, v_servicio, current_date + 53, '09:00', 2, 'pending', 100, 'Calle 5',
    jsonb_build_object('payable_now_amount_cents', 0, 'quote_economic_snapshot',
      public.apply_commission_to_economics(pg_temp.base_econ(100),
        jsonb_build_object('rule', 'garser_first', 'rateBps', 0, 'configVersion', 1, 'origin', 'garser'))));
  SELECT management_fee, management_fee_source INTO v_fee, v_source FROM public.bookings WHERE id = v_booking2;
  PERFORM pg_temp.check_that(v_fee = 0 AND v_source = 'waived_zero_commission', format('I15: quedó con %s / %s', v_fee, v_source));
  -- Con el suelo de Stripe: 10 € al 3 % → 0,50 €, y la reserva lo reconoce como coherente.
  c := public.apply_commission_to_economics(pg_temp.base_econ(10),
    jsonb_build_object('rule', 'garser_repeat', 'rateBps', 300, 'configVersion', v_vnow, 'origin', 'garser'));
  INSERT INTO public.bookings (id, client_id, gardener_id, service_id, date, start_time, duration_hours, status,
    total_price, client_address, pricing_context)
  VALUES (gen_random_uuid(), v_cli2, v_pro2, v_servicio, current_date + 54, '09:00', 1, 'pending', 10, 'Calle 6',
    jsonb_build_object('payable_now_amount_cents', 50, 'quote_economic_snapshot', c));
  PERFORM pg_temp.check_that(
    EXISTS (SELECT 1 FROM public.bookings WHERE client_address = 'Calle 6' AND management_fee = 0.5 AND commission_rate_bps = 300),
    'I16: el suelo de 0,50 € no se guarda como comisión coherente');
  -- Una reserva anterior a las comisiones configurables (sin instantánea) no se rompe.
  v_booking2 := gen_random_uuid();
  INSERT INTO public.bookings (id, client_id, gardener_id, service_id, date, start_time, duration_hours, status,
    total_price, client_address, management_fee, management_fee_source)
  VALUES (v_booking2, v_cli3, v_pro, v_servicio, current_date + 55, '09:00', 2, 'completed', 100, 'Calle 7', 12.5, 'payment_attempt');
  PERFORM pg_temp.check_that(
    EXISTS (SELECT 1 FROM public.bookings WHERE id = v_booking2 AND commission_rule IS NULL AND commission_fixed_at IS NULL),
    'I17: una reserva sin instantánea debería quedar con las columnas vacías');

  -- La instantánea es todo o nada y coherente (restricciones de tabla).
  BEGIN
    UPDATE public.bookings SET commission_rule = 'garser_first' WHERE id = v_booking2;
    RAISE EXCEPTION 'FALLO I18: una instantánea a medias se ha guardado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ===========================================================================
  -- J. Planes de mantenimiento
  -- ===========================================================================
  -- Reserva de origen confirmada, con su presupuesto (como lo guarda booking-authority).
  v_quote := gen_random_uuid();
  e := public.quote_commission_economics(pg_temp.base_econ(100), v_cli2, v_pro, NULL);
  INSERT INTO public.booking_quotes (id, client_id, gardener_id, service_id, signature, pricing_version,
    provider_config_version, input_payload, pricing_snapshot, total_price, estimated_hours, status,
    generated_at, expires_at, selected_date, selected_start_time, economic_snapshot)
  VALUES (v_quote, v_cli2, v_pro, v_servicio, 'plan-test-' || gen_random_uuid(), 'booking_quote_v1',
    'cfg', '{"x":1}'::jsonb, '{}'::jsonb, 100, 2, 'consumed', now(), now() + interval '2 hours',
    current_date - 3, '09:00', e);
  v_booking := gen_random_uuid();
  INSERT INTO public.bookings (id, client_id, gardener_id, service_id, date, start_time, duration_hours, status,
    total_price, client_address, pricing_context, management_fee, management_fee_source)
  VALUES (v_booking, v_cli2, v_pro, v_servicio, current_date - 3, '09:00', 2, 'completed', 100, 'Calle 8',
    jsonb_build_object('quote_id', v_quote), 12.5, 'payment_attempt');
  PERFORM pg_temp.act_as(v_cli2);
  r := public.create_maintenance_plan(v_booking, 'weekly');
  v_plan := (r ->> 'planId')::uuid;
  PERFORM pg_temp.act_as(NULL);
  SELECT economic_snapshot INTO c FROM public.maintenance_plans WHERE id = v_plan;
  PERFORM pg_temp.check_that(
    (c #>> '{commission,rule}') = 'maintenance_visit' AND (c ->> 'managementFee')::numeric = 3
    AND (c ->> 'serviceGrossTotal')::numeric = 100,
    'J1: el plan no guarda la economía con la regla de visita: ' || c::text);

  -- La visita que propone el reloj: misma economía que sale de aplicar la regla de visita.
  v_visit := gen_random_uuid();
  INSERT INTO public.maintenance_visits (id, plan_id, planned_date, date, start_hour, status)
  VALUES (v_visit, v_plan, current_date + 4, current_date + 4, 10, 'proposed');
  v_quote := gen_random_uuid();
  INSERT INTO public.booking_quotes (id, client_id, gardener_id, service_id, signature, pricing_version,
    provider_config_version, input_payload, pricing_snapshot, total_price, estimated_hours, status,
    generated_at, expires_at, selected_date, selected_start_time, economic_snapshot, items, maintenance_visit_id)
  SELECT v_quote, p.client_id, p.provider_id, p.service_id, 'maintenance:' || v_visit, p.pricing_version,
    p.provider_config_version, p.input_payload, p.pricing_snapshot, p.total_price, p.estimated_hours, 'active',
    now(), now() + interval '72 hours', current_date + 4, '10:00',
    public.apply_commission_to_economics(p.economic_snapshot, public.resolve_booking_commission(p.client_id, p.provider_id, NULL, true)),
    p.items, v_visit
  FROM public.maintenance_plans p WHERE p.id = v_plan;
  UPDATE public.maintenance_visits SET quote_id = v_quote WHERE id = v_visit;
  PERFORM pg_temp.check_that(public.maintenance_quote_is_intact(v_quote), 'J2: la visita generada por el plan no se reconoce como íntegra');
  SELECT economic_snapshot INTO c FROM public.booking_quotes WHERE id = v_quote;
  -- v_cli2 es cliente del ENLACE de v_pro: aun así su visita de plan paga la regla del plan (decisión del dueño).
  PERFORM pg_temp.check_that((c #>> '{commission,rule}') = 'maintenance_visit' AND (c ->> 'payableNow')::numeric = 3
    AND (c #>> '{commission,origin}') = 'provider_link', 'J3: la visita no lleva la comisión de visita de plan: ' || c::text);

  -- Adulteraciones de la propuesta: ninguna pasa.
  UPDATE public.booking_quotes SET economic_snapshot = jsonb_set(c, '{commission,rateBps}', '0') WHERE id = v_quote;
  PERFORM pg_temp.check_that(NOT public.maintenance_quote_is_intact(v_quote), 'J4: una visita con el porcentaje rebajado se da por íntegra');
  UPDATE public.booking_quotes SET economic_snapshot = jsonb_set(jsonb_set(c, '{managementFee}', '0.5'), '{payableNow}', '0.5') WHERE id = v_quote;
  PERFORM pg_temp.check_that(NOT public.maintenance_quote_is_intact(v_quote), 'J5: una visita con el importe rebajado se da por íntegra');
  UPDATE public.booking_quotes SET economic_snapshot = jsonb_set(c, '{commission,rule}', '"link_repeat"') WHERE id = v_quote;
  PERFORM pg_temp.check_that(NOT public.maintenance_quote_is_intact(v_quote), 'J6: una visita con otra regla se da por íntegra');
  UPDATE public.booking_quotes SET economic_snapshot = public.apply_commission_to_economics(c,
    jsonb_build_object('rule', 'garser_first', 'rateBps', 1250, 'configVersion', v_vnow, 'origin', 'garser')) WHERE id = v_quote;
  PERFORM pg_temp.check_that(NOT public.maintenance_quote_is_intact(v_quote), 'J7: una visita que cobra la regla de GarSer se da por íntegra');
  UPDATE public.booking_quotes SET economic_snapshot = c WHERE id = v_quote;
  PERFORM pg_temp.check_that(public.maintenance_quote_is_intact(v_quote), 'J8: restaurada, la visita deja de ser íntegra');

  -- Cambiar la configuración después de proponer NO cambia la propuesta en curso.
  PERFORM pg_temp.act_as(v_admin);
  r := public.save_commission_settings(v_vnow,
    '{"garser_first":12.5,"link_first":0,"garser_repeat":3,"maintenance_visit":10,"link_repeat":0}'::jsonb);
  PERFORM pg_temp.act_as(NULL);
  PERFORM pg_temp.check_that((r ->> 'ok')::boolean, 'J9: no se puede guardar');
  PERFORM pg_temp.check_that(public.maintenance_quote_is_intact(v_quote), 'J10: un cambio de comisiones invalida las propuestas en curso');
  s := public.apply_commission_to_economics(
    (SELECT economic_snapshot FROM public.maintenance_plans WHERE id = v_plan),
    public.resolve_booking_commission(v_cli2, v_pro, NULL, true));
  PERFORM pg_temp.check_that((s ->> 'managementFee')::numeric = 10, 'J11: las visitas nuevas no usan el porcentaje nuevo: ' || s::text);

  -- Propuestas anteriores a esta serie (sin comisión configurable): siguen valiendo hasta caducar.
  INSERT INTO public.maintenance_plans (id, client_id, provider_id, frequency, start_hour, anchor_date, next_visit_date,
    service_id, input_payload, pricing_snapshot, economic_snapshot, total_price, estimated_hours, pricing_version,
    provider_config_version)
  VALUES (gen_random_uuid(), v_cli3, v_pro, 'weekly', 10, current_date, current_date + 7, v_servicio, '{"x":2}'::jsonb, '{}'::jsonb,
    -- Plan anterior a esta serie: guardaba la economía completa de entonces (12,5 %).
    pg_temp.base_econ(100) || '{"managementFee":12.5,"payableNow":12.5}'::jsonb, 100, 2, 'booking_quote_v1', 'cfg')
  RETURNING id INTO v_plan;
  v_visit := gen_random_uuid();
  INSERT INTO public.maintenance_visits (id, plan_id, planned_date, date, start_hour, status)
  VALUES (v_visit, v_plan, current_date + 7, current_date + 7, 10, 'proposed');
  v_quote := gen_random_uuid();
  INSERT INTO public.booking_quotes (id, client_id, gardener_id, service_id, signature, pricing_version,
    provider_config_version, input_payload, pricing_snapshot, total_price, estimated_hours, status,
    generated_at, expires_at, selected_date, selected_start_time, economic_snapshot, maintenance_visit_id)
  SELECT v_quote, p.client_id, p.provider_id, p.service_id, 'maintenance:' || v_visit, p.pricing_version,
    p.provider_config_version, p.input_payload, p.pricing_snapshot, p.total_price, p.estimated_hours, 'active',
    now(), now() + interval '72 hours', current_date + 7, '10:00', p.economic_snapshot, v_visit
  FROM public.maintenance_plans p WHERE p.id = v_plan;
  UPDATE public.maintenance_visits SET quote_id = v_quote WHERE id = v_visit;
  PERFORM pg_temp.check_that(public.maintenance_quote_is_intact(v_quote), 'J12: una propuesta anterior a las comisiones configurables deja de valer');
  UPDATE public.booking_quotes SET economic_snapshot = jsonb_set(jsonb_set(economic_snapshot, '{managementFee}', '0.5'), '{payableNow}', '0.5') WHERE id = v_quote;
  PERFORM pg_temp.check_that(NOT public.maintenance_quote_is_intact(v_quote), 'J13: una propuesta antigua adulterada se da por íntegra');

  -- ===========================================================================
  -- K. Lo que sigue funcionando como antes (despliegue y vuelta atrás)
  -- ===========================================================================
  -- El «sin gastos para clientes propios» que ven el asistente de alta y el marketing sale de las reglas.
  PERFORM pg_temp.act_as(v_admin);
  r := public.save_commission_settings((SELECT version FROM public.commission_settings WHERE id = 1),
    '{"garser_first":12.5,"link_first":0,"garser_repeat":3,"maintenance_visit":3,"link_repeat":0}'::jsonb);
  PERFORM pg_temp.act_as(NULL);
  PERFORM pg_temp.check_that((r ->> 'ok')::boolean, 'K0: no se puede volver a guardar: ' || r::text);
  PERFORM pg_temp.check_that(public.own_clients_fee_waiver_enabled(), 'K1: con las dos reglas de enlace a 0 debería decir que no pagan');
  UPDATE public.commission_settings SET rate_link_first = 1 WHERE id = 1;
  PERFORM pg_temp.check_that(NOT public.own_clients_fee_waiver_enabled(), 'K2: con el enlace al 1 % no puede prometerse «sin gastos»');
  UPDATE public.commission_settings SET rate_link_first = 0, rate_link_repeat = 0.5 WHERE id = 1;
  PERFORM pg_temp.check_that(NOT public.own_clients_fee_waiver_enabled(), 'K3: con el enlace al 0,5 % en reservas posteriores no puede prometerse «sin gastos»');
  UPDATE public.commission_settings SET rate_link_repeat = 0 WHERE id = 1;

  -- La regla del servidor anterior sigue exactamente como era: manda el interruptor antiguo, no la configuración.
  UPDATE public.app_settings SET own_clients_fee_waiver_enabled = false WHERE id = 1;
  PERFORM pg_temp.check_that(public.management_fee_waiver_reason(v_cli, v_pro, 'provider_link') IS NULL,
    'K4: la regla antigua exime con el interruptor apagado');
  UPDATE public.app_settings SET own_clients_fee_waiver_enabled = true WHERE id = 1;
  PERFORM pg_temp.check_that(public.management_fee_waiver_reason(v_cli, v_pro, 'provider_link') = 'provider_link',
    'K5: la regla antigua ya no exime con el interruptor encendido');
  PERFORM pg_temp.check_that(public.management_fee_waiver_reason(v_cli, v_pro, NULL) = 'returning_client',
    'K6: la regla antigua ya no reconoce al cliente que repite');
  PERFORM pg_temp.check_that(
    NOT has_function_privilege('authenticated', 'public.management_fee_waiver_reason(uuid, uuid, text)', 'EXECUTE'),
    'K7: la regla antigua se puede llamar desde el navegador');

  -- ===========================================================================
  -- M. La clave del enlace: sin ella, el enlace del profesional no exime
  -- ===========================================================================
  PERFORM pg_temp.act_as(NULL);
  UPDATE public.commission_settings SET rate_garser_first = 12.5, rate_link_first = 0, rate_garser_repeat = 3,
    rate_maintenance_visit = 3, rate_link_repeat = 0 WHERE id = 1;
  SELECT version INTO v_vnow FROM public.commission_settings WHERE id = 1;

  -- v_cli4 y v_cli5 no tienen relación ni reservas con nadie.
  r := public.resolve_booking_commission(v_cli4, v_pro, 'provider_link');
  PERFORM pg_temp.check_that(r ->> 'rule' = 'garser_first' AND r ->> 'origin' = 'garser' AND (r ->> 'rateBps')::int = 1250
    AND r ->> 'claimedOrigin' = 'provider_link' AND r ->> 'linkClaim' = 'rejected',
    'M1: el enlace SIN clave exime o no se anota como rechazado: ' || r::text);
  r := public.resolve_booking_commission(v_cli4, v_pro, 'provider_link', p_link_code => repeat('0', 32));
  PERFORM pg_temp.check_that(r ->> 'rule' = 'garser_first' AND r ->> 'linkClaim' = 'rejected', 'M2: una clave inventada exime: ' || r::text);
  r := public.resolve_booking_commission(v_cli4, v_pro, 'provider_link', p_link_code => v_code_pro2);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'garser_first' AND r ->> 'linkClaim' = 'rejected', 'M3: la clave de OTRO profesional exime: ' || r::text);
  r := public.resolve_booking_commission(v_cli4, v_pro, 'provider_link', p_link_code => v_code_pro);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'link_first' AND r ->> 'origin' = 'provider_link' AND r ->> 'linkClaim' = 'verified'
    AND (r ->> 'rateBps')::int = 0, 'M4: la clave buena no exime: ' || r::text);
  r := public.resolve_booking_commission(v_cli4, v_pro, 'provider_link', p_link_code => '  ' || upper(v_code_pro) || ' ');
  PERFORM pg_temp.check_that(r ->> 'linkClaim' = 'verified', 'M5: mayúsculas y espacios alrededor de la clave no deberían importar');
  r := public.resolve_booking_commission(v_cli4, v_user, 'provider_link', p_link_code => v_code_pro);
  PERFORM pg_temp.check_that(r ->> 'linkClaim' = 'rejected' AND r ->> 'rule' = 'garser_first', 'M6: un profesional sin clave puede eximir');
  r := public.resolve_booking_commission(v_cli4, NULL, 'provider_link', p_link_code => v_code_pro);
  PERFORM pg_temp.check_that(r ->> 'linkClaim' = 'rejected', 'M7: sin profesional, la clave exime');
  r := public.resolve_booking_commission(v_cli4, v_pro, 'provider_link', p_claim_verified => true);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'link_first' AND r ->> 'linkClaim' = 'verified', 'M8: el pago no puede revalidar un enlace ya verificado');
  r := public.resolve_booking_commission(v_cli4, v_pro, NULL, p_link_code => v_code_pro);
  PERFORM pg_temp.check_that(r ->> 'rule' = 'garser_first' AND r -> 'linkClaim' = 'null'::jsonb AND r -> 'claimedOrigin' = 'null'::jsonb,
    'M9: una clave sin declarar «enlace» cuenta como enlace: ' || r::text);

  -- La economía firmada recuerda el resultado.
  e := public.quote_commission_economics(pg_temp.base_econ(158), v_cli4, v_pro, 'provider_link');
  PERFORM pg_temp.check_that((e ->> 'managementFee')::numeric = 19.75 AND e #>> '{commission,linkClaim}' = 'rejected'
    AND e #>> '{commission,claimedOrigin}' = 'provider_link' AND e #>> '{commission,rule}' = 'garser_first'
    AND public.commission_snapshot_problem(e) IS NULL, 'M10: un enlace rechazado debe pagar el 12,5 % y quedar anotado: ' || e::text);
  e2 := public.quote_commission_economics(pg_temp.base_econ(158), v_cli4, v_pro, 'provider_link', p_link_code => v_code_pro);
  PERFORM pg_temp.check_that((e2 ->> 'managementFee')::numeric = 0 AND e2 #>> '{commission,linkClaim}' = 'verified'
    AND e2 #>> '{feeWaiver,reason}' = 'provider_link' AND public.commission_snapshot_problem(e2) IS NULL,
    'M11: un enlace con su clave debe ir sin gastos y quedar anotado: ' || e2::text);
  -- Un presupuesto anterior a esta migración (sin la anotación) sigue siendo válido.
  PERFORM pg_temp.check_that(public.commission_snapshot_problem(e #- '{commission,linkClaim}') IS NULL,
    'M12: un presupuesto sin la anotación del enlace deja de ser válido');
  FOREACH s IN ARRAY ARRAY[
    '{"rule":"garser_first","rateBps":1250,"configVersion":1,"origin":"garser","claimedOrigin":"provider_link","linkClaim":"quizas"}'::jsonb,
    '{"rule":"garser_first","rateBps":1250,"configVersion":1,"origin":"garser","claimedOrigin":null,"linkClaim":"verified"}'::jsonb,
    '{"rule":"garser_first","rateBps":1250,"configVersion":1,"origin":"garser","linkClaim":"rejected"}'::jsonb
  ] LOOP
    BEGIN
      PERFORM public.apply_commission_to_economics(pg_temp.base_econ(100), s);
      RAISE EXCEPTION 'FALLO M13: se ha aceptado una decisión con un resultado de enlace roto: %', s;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM LIKE 'FALLO%' THEN RAISE; END IF;
    END;
  END LOOP;

  -- Cinturón del intento de pago: una comisión de enlace o de «reserva posterior» sin justificar no pasa,
  -- aunque la economía sea coherente consigo misma.
  v_quote := gen_random_uuid();
  INSERT INTO public.booking_quotes (id, client_id, gardener_id, service_id, signature, pricing_version,
    provider_config_version, input_payload, pricing_snapshot, total_price, estimated_hours, status,
    generated_at, expires_at, selected_date, selected_start_time, economic_snapshot)
  VALUES (v_quote, v_cli4, v_pro, v_servicio, 'clave-test-' || gen_random_uuid(), 'booking_quote_v1',
    'cfg', '{}'::jsonb, '{}'::jsonb, 158, 2, 'active', now(), now() + interval '2 hours',
    current_date + 60, '09:00', e);
  -- a) un presupuesto de enlace SIN clave verificada ni origen guardado
  f := public.apply_commission_to_economics(pg_temp.base_econ(158), jsonb_build_object('rule', 'link_first', 'rateBps', 0,
    'configVersion', v_vnow, 'origin', 'provider_link', 'claimedOrigin', 'provider_link', 'linkClaim', 'rejected', 'isFirstBooking', true));
  BEGIN
    INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
      selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
      stripe_idempotency_key, economic_snapshot)
    VALUES (v_cli4, v_pro, v_servicio, v_quote, 'sig', current_date + 60, '09:00', 2, 15800, 0, gen_random_uuid()::text, f);
    RAISE EXCEPTION 'FALLO M14: se ha creado un intento a 0 € con el enlace RECHAZADO';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- b) lo mismo sin declaración alguna (como si nadie hubiera mirado el enlace)
  f := public.apply_commission_to_economics(pg_temp.base_econ(158), jsonb_build_object('rule', 'link_first', 'rateBps', 0,
    'configVersion', v_vnow, 'origin', 'provider_link', 'claimedOrigin', NULL, 'isFirstBooking', true));
  BEGIN
    INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
      selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
      stripe_idempotency_key, economic_snapshot)
    VALUES (v_cli4, v_pro, v_servicio, v_quote, 'sig', current_date + 60, '09:00', 2, 15800, 0, gen_random_uuid()::text, f);
    RAISE EXCEPTION 'FALLO M15: se ha creado un intento a 0 € con origen «enlace» sin justificar';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- c) con la clave verificada, sí
  INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
    selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
    stripe_idempotency_key, economic_snapshot)
  VALUES (v_cli4, v_pro, v_servicio, v_quote, 'sig', current_date + 60, '09:00', 2, 15800, 0, gen_random_uuid()::text, e2);
  -- d) una «reserva posterior» sin ninguna reserva completada no puede pagar el 3 %
  f := public.apply_commission_to_economics(pg_temp.base_econ(158), jsonb_build_object('rule', 'garser_repeat', 'rateBps', 300,
    'configVersion', v_vnow, 'origin', 'garser', 'isFirstBooking', false));
  BEGIN
    INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
      selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
      stripe_idempotency_key, economic_snapshot)
    VALUES (v_cli5, v_pro, v_servicio, v_quote, 'sig', current_date + 61, '09:00', 2, 15800, 474, gen_random_uuid()::text, f);
    RAISE EXCEPTION 'FALLO M16: se ha creado un intento de «reserva posterior» sin ninguna reserva completada';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- e) y con una reserva completada (v_cli la tiene con v_pro desde la sección E), sí
  INSERT INTO public.booking_payment_attempts (client_id, gardener_id, service_id, quote_id, quote_signature,
    selected_date, selected_start_time, duration_hours, service_total_amount_cents, payable_now_amount_cents,
    stripe_idempotency_key, economic_snapshot)
  VALUES (v_cli, v_pro, v_servicio, v_quote, 'sig', current_date + 62, '09:00', 2, 15800, 474, gen_random_uuid()::text, f);

  -- Quién ve y cambia la clave.
  PERFORM pg_temp.check_that(
    NOT has_table_privilege('anon', 'public.provider_booking_links', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.provider_booking_links', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.provider_booking_links', 'UPDATE')
    AND NOT has_table_privilege('service_role', 'public.provider_booking_links', 'SELECT'),
    'M17: las claves de enlace se pueden leer fuera de la propia función del profesional');
  PERFORM pg_temp.check_that(
    NOT has_function_privilege('anon', 'public.provider_link_code_matches(uuid, text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.provider_link_code_matches(uuid, text)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.provider_link_code_matches(uuid, text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.my_booking_link()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.rotate_my_booking_link()', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.my_booking_link()', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.rotate_my_booking_link()', 'EXECUTE'),
    'M18: permisos de ejecución de las funciones de la clave');
  -- Un cliente no tiene enlace.
  PERFORM pg_temp.act_as(v_cli4);
  BEGIN
    PERFORM public.my_booking_link();
    RAISE EXCEPTION 'FALLO M19: un cliente ha obtenido un enlace de profesional';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.rotate_my_booking_link();
    RAISE EXCEPTION 'FALLO M20: un cliente ha podido cambiar una clave de enlace';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM pg_temp.act_as(NULL);
  BEGIN
    PERFORM public.my_booking_link();
    RAISE EXCEPTION 'FALLO M21: sin sesión se obtiene un enlace';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Un profesional con ficha (en la base real puede exigir más columnas: si no se puede crear, se usa uno que exista).
  BEGIN
    INSERT INTO public.gardener_profiles (user_id) VALUES (v_pro2);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  SELECT g.user_id INTO v_link_pro FROM public.gardener_profiles g WHERE g.user_id = v_pro2;
  IF v_link_pro IS NULL THEN
    SELECT g.user_id INTO v_link_pro FROM public.gardener_profiles g LIMIT 1;
  END IF;
  IF v_link_pro IS NULL THEN
    RAISE WARNING 'SALTADO M22-M27: no hay ningún profesional con ficha para probar my_booking_link()';
  ELSE
    PERFORM pg_temp.act_as(v_link_pro);
    r := public.my_booking_link();
    v_code_a := r ->> 'code';
    PERFORM pg_temp.check_that((r ->> 'providerId')::uuid = v_link_pro AND v_code_a ~ '^[0-9a-f]{32}$', 'M22: el enlace del profesional no trae su clave: ' || r::text);
    PERFORM pg_temp.check_that(public.my_booking_link() ->> 'code' = v_code_a, 'M23: pedir el enlace dos veces da claves distintas');
    PERFORM pg_temp.check_that(public.provider_link_code_matches(v_link_pro, v_code_a), 'M24: la clave que se le da no es la que comprueba el servidor');
    r := public.rotate_my_booking_link();
    v_code_b := r ->> 'code';
    PERFORM pg_temp.check_that(v_code_b ~ '^[0-9a-f]{32}$' AND v_code_b <> v_code_a, 'M25: cambiar la clave no da una nueva');
    PERFORM pg_temp.check_that(NOT public.provider_link_code_matches(v_link_pro, v_code_a) AND public.provider_link_code_matches(v_link_pro, v_code_b),
      'M26: tras cambiarla, la clave anterior sigue valiendo (o la nueva no)');
    PERFORM pg_temp.check_that((SELECT rotations FROM public.provider_booking_links WHERE provider_id = v_link_pro) >= 1
      AND public.my_booking_link() ->> 'code' = v_code_b, 'M27: lo que se guarda no es la clave nueva');
    -- Con la clave anterior, el enlace ya no exime.
    r := public.resolve_booking_commission(v_cli5, v_link_pro, 'provider_link', p_link_code => v_code_a);
    PERFORM pg_temp.check_that(r ->> 'linkClaim' = 'rejected', 'M28: la clave antigua sigue eximiendo');
    r := public.resolve_booking_commission(v_cli5, v_link_pro, 'provider_link', p_link_code => v_code_b);
    PERFORM pg_temp.check_that(r ->> 'linkClaim' = 'verified', 'M29: la clave nueva no exime');
  END IF;
  PERFORM pg_temp.act_as(NULL);

  -- ===========================================================================
  -- N. Términos públicos de facturación (migración 20261104140000): lo que la web puede decir
  -- ===========================================================================
  -- Configuración de partida de esta sección: la de fábrica (12,5 / 0 / 3 / 3 / 0).
  UPDATE public.commission_settings
     SET rate_garser_first = 12.5, rate_link_first = 0, rate_garser_repeat = 3, rate_maintenance_visit = 3, rate_link_repeat = 0
   WHERE id = 1;
  r := public.get_public_billing_terms();
  PERFORM pg_temp.check_that(
    r ->> 'garserFirst' = 'standard' AND r ->> 'linkFirst' = 'none' AND r ->> 'garserRepeat' = 'reduced'
    AND r ->> 'linkRepeat' = 'none' AND r ->> 'maintenanceVisit' = 'reduced',
    'N1: los niveles de la configuración de fábrica no son los esperados: ' || r::text);
  -- Solo niveles: ningún porcentaje ni importe sale a la web pública.
  PERFORM pg_temp.check_that(
    (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(r) k)
      = ARRAY['garserFirst', 'garserRepeat', 'linkFirst', 'linkRepeat', 'maintenanceVisit', 'version'],
    'N2: la respuesta pública lleva campos que no debería: ' || r::text);
  PERFORM pg_temp.check_that(r::text !~ '[0-9]+\.[0-9]' AND r::text !~ '%',
    'N3: la respuesta pública deja ver un porcentaje: ' || r::text);
  PERFORM pg_temp.check_that((r ->> 'version')::bigint = (SELECT version FROM public.commission_settings WHERE id = 1),
    'N4: la versión no es la vigente');

  -- Cualquier combinación se traduce a su nivel (una por cada caso del esquema).
  UPDATE public.commission_settings SET rate_link_first = 5, rate_link_repeat = 12.5, rate_garser_repeat = 20, rate_maintenance_visit = 0.01 WHERE id = 1;
  r := public.get_public_billing_terms();
  PERFORM pg_temp.check_that(
    r ->> 'linkFirst' = 'reduced' AND r ->> 'linkRepeat' = 'standard' AND r ->> 'garserRepeat' = 'higher' AND r ->> 'maintenanceVisit' = 'reduced',
    'N5: reduced/standard/higher mal derivados: ' || r::text);
  -- Sin comisión para los clientes de GarSer: cualquier otra regla con porcentaje es «más» que la línea base.
  UPDATE public.commission_settings SET rate_garser_first = 0, rate_link_first = 5, rate_garser_repeat = 0, rate_maintenance_visit = 3, rate_link_repeat = 0 WHERE id = 1;
  r := public.get_public_billing_terms();
  PERFORM pg_temp.check_that(
    r ->> 'garserFirst' = 'none' AND r ->> 'linkFirst' = 'higher' AND r ->> 'garserRepeat' = 'none' AND r ->> 'maintenanceVisit' = 'higher',
    'N6: con la línea base a 0 %, un porcentaje positivo debe ser «higher»: ' || r::text);
  -- Todo a 0 %: ninguna regla cobra.
  UPDATE public.commission_settings SET rate_garser_first = 0, rate_link_first = 0, rate_garser_repeat = 0, rate_maintenance_visit = 0, rate_link_repeat = 0 WHERE id = 1;
  r := public.get_public_billing_terms();
  PERFORM pg_temp.check_that(
    r ->> 'garserFirst' = 'none' AND r ->> 'linkFirst' = 'none' AND r ->> 'garserRepeat' = 'none'
    AND r ->> 'linkRepeat' = 'none' AND r ->> 'maintenanceVisit' = 'none',
    'N7: todo a 0 % debe ser «none» en todo: ' || r::text);
  -- Todo al 100 %: cobra siempre y es la misma línea base.
  UPDATE public.commission_settings SET rate_garser_first = 100, rate_link_first = 100, rate_garser_repeat = 100, rate_maintenance_visit = 100, rate_link_repeat = 100 WHERE id = 1;
  r := public.get_public_billing_terms();
  PERFORM pg_temp.check_that(
    r ->> 'garserFirst' = 'standard' AND r ->> 'linkFirst' = 'standard' AND r ->> 'garserRepeat' = 'standard'
    AND r ->> 'linkRepeat' = 'standard' AND r ->> 'maintenanceVisit' = 'standard',
    'N8: todo al 100 % debe ser «standard» en todo: ' || r::text);

  -- Coherencia con el motor: «none» es exactamente lo que el motor cobra 0 €, «>0» lo que cobra algo.
  UPDATE public.commission_settings
     SET rate_garser_first = 12.5, rate_link_first = 0, rate_garser_repeat = 3, rate_maintenance_visit = 3, rate_link_repeat = 0
   WHERE id = 1;
  PERFORM pg_temp.check_that(
    public.own_clients_fee_waiver_enabled()
      = (public.get_public_billing_terms() ->> 'linkFirst' = 'none' AND public.get_public_billing_terms() ->> 'linkRepeat' = 'none'),
    'N9: el «sin gastos» del asistente de alta no coincide con los términos públicos');

  -- Permisos: la web (sin sesión) la puede leer; la función auxiliar es interna.
  PERFORM pg_temp.check_that(
    has_function_privilege('anon', 'public.get_public_billing_terms()', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.get_public_billing_terms()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.commission_term_level(numeric, numeric)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.commission_term_level(numeric, numeric)', 'EXECUTE'),
    'N10: permisos de los términos públicos');
  -- Y no abre la tabla de configuración a nadie más.
  PERFORM pg_temp.check_that(
    NOT has_table_privilege('anon', 'public.commission_settings', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.commission_settings', 'SELECT'),
    'N11: la tabla de comisiones quedó legible');

  -- ===========================================================================
  -- L. Sin configuración válida, ninguna operación económica sigue adelante
  -- ===========================================================================
  ALTER TABLE public.commission_settings DISABLE TRIGGER trg_commission_settings_no_delete;
  DELETE FROM public.commission_settings;
  ALTER TABLE public.commission_settings ENABLE TRIGGER trg_commission_settings_no_delete;
  BEGIN
    PERFORM public.resolve_booking_commission(v_cli, v_pro, NULL);
    RAISE EXCEPTION 'FALLO L1: se calcula una comisión sin configuración';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'commission_config_unavailable' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.quote_commission_economics(pg_temp.base_econ(100), v_cli, v_pro, NULL);
    RAISE EXCEPTION 'FALLO L2: se firma un presupuesto sin configuración';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'commission_config_unavailable' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.act_as(v_admin);
  BEGIN
    PERFORM public.get_commission_settings();
    RAISE EXCEPTION 'FALLO L3: el panel enseña valores que no existen';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'commission_config_unavailable' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.check_that(NOT public.own_clients_fee_waiver_enabled(), 'L4: sin configuración no se promete «sin gastos»');
  PERFORM pg_temp.act_as(NULL);

  RAISE WARNING 'TODAS LAS COMPROBACIONES OK';
END;
$prueba$;

ROLLBACK;
