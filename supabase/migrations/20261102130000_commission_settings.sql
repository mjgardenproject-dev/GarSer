-- Comisiones configurables (2026-11), parte 1/3: la configuración, su historial y su auditoría.
--
-- Qué resuelve
--   Hasta hoy la comisión de GarSer («gastos de gestión» en el código y en la web) era la constante
--   0,125 de src/shared/bookingAmounts.ts. Esta migración crea el sitio donde el administrador decide
--   cuánto cobra la plataforma en cada tipo de reserva. Las otras dos migraciones de la serie
--   (20261102140000 y 20261102150000) son el motor que la aplica y lo que se guarda en cada reserva.
--
-- Las cinco reglas (una columna cada una; un porcentaje sobre el precio del servicio con IVA):
--   garser_first       primera reserva de un cliente captado por GarSer              12,5 %
--   link_first         primera reserva de un cliente del enlace personal del profesional  0 %
--   garser_repeat      reservas posteriores con el mismo profesional (relación GarSer)     3 %
--   maintenance_visit  cada visita de un plan de mantenimiento                             3 %
--   link_repeat        reservas posteriores con el mismo profesional (relación por enlace) 0 %
--
-- Diseño
--   · commission_settings es UNA fila (id = 1). Todas las columnas son NOT NULL con CHECK 0–100 y dos
--     decimales: no puede existir una configuración incompleta ni inválida. No hay DEFAULT en los
--     porcentajes a propósito: los valores iniciales los pone esta migración, de forma controlada, y
--     nunca el código en tiempo de ejecución.
--   · Cada cambio sube `version` y guarda una copia INMUTABLE en commission_settings_history. Una
--     reserva guarda la versión con la que se calculó su comisión, así que siempre se puede explicar
--     por qué costó lo que costó, aunque el administrador cambie los porcentajes después.
--   · El versionado y la auditoría los hace un trigger, no la RPC: cualquier camino que modifique la
--     fila (la RPC del panel, el editor SQL o un script) deja la misma huella.
--   · La tabla NO se lee desde el navegador (a diferencia de app_settings, que es de lectura pública):
--     solo el administrador, mediante RPC con is_admin() comprobado en SQL, y el servidor.
--   · Esta migración no toca ninguna reserva ni ningún cobro: hasta que se desplieguen las funciones
--     de las otras dos migraciones, el sistema sigue cobrando como hasta ahora.

-- ── 1) Utilidades ────────────────────────────────────────────────────────────────────────
-- Los cinco porcentajes como jsonb, con las claves de las reglas. Una sola definición para la RPC,
-- el historial y la auditoría.
CREATE OR REPLACE FUNCTION public.commission_rates_json(
  p_garser_first numeric,
  p_link_first numeric,
  p_garser_repeat numeric,
  p_maintenance_visit numeric,
  p_link_repeat numeric
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'garser_first', p_garser_first,
    'link_first', p_link_first,
    'garser_repeat', p_garser_repeat,
    'maintenance_visit', p_maintenance_visit,
    'link_repeat', p_link_repeat
  );
$$;

-- ── 2) Tablas ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.commission_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version bigint NOT NULL CHECK (version >= 1),
  rate_garser_first numeric(5,2) NOT NULL CHECK (rate_garser_first >= 0 AND rate_garser_first <= 100),
  rate_link_first numeric(5,2) NOT NULL CHECK (rate_link_first >= 0 AND rate_link_first <= 100),
  rate_garser_repeat numeric(5,2) NOT NULL CHECK (rate_garser_repeat >= 0 AND rate_garser_repeat <= 100),
  rate_maintenance_visit numeric(5,2) NOT NULL CHECK (rate_maintenance_visit >= 0 AND rate_maintenance_visit <= 100),
  rate_link_repeat numeric(5,2) NOT NULL CHECK (rate_link_repeat >= 0 AND rate_link_repeat <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Sin FK a auth.users: borrar una cuenta de administrador no debe tocar la configuración.
  updated_by uuid
);

COMMENT ON TABLE public.commission_settings IS
  'Comisión de GarSer por tipo de reserva (una sola fila). Solo se lee y escribe por RPC de administrador y desde el servidor; el versionado y la auditoría los hace un trigger.';
COMMENT ON COLUMN public.commission_settings.version IS
  'Sube en uno con cada cambio de porcentajes (lo hace el trigger). Cada reserva guarda la versión con la que se calculó su comisión.';

CREATE TABLE IF NOT EXISTS public.commission_settings_history (
  version bigint PRIMARY KEY CHECK (version >= 1),
  rate_garser_first numeric(5,2) NOT NULL CHECK (rate_garser_first >= 0 AND rate_garser_first <= 100),
  rate_link_first numeric(5,2) NOT NULL CHECK (rate_link_first >= 0 AND rate_link_first <= 100),
  rate_garser_repeat numeric(5,2) NOT NULL CHECK (rate_garser_repeat >= 0 AND rate_garser_repeat <= 100),
  rate_maintenance_visit numeric(5,2) NOT NULL CHECK (rate_maintenance_visit >= 0 AND rate_maintenance_visit <= 100),
  rate_link_repeat numeric(5,2) NOT NULL CHECK (rate_link_repeat >= 0 AND rate_link_repeat <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

COMMENT ON TABLE public.commission_settings_history IS
  'Cada versión de la configuración de comisiones, para siempre. Es contra lo que se verifican los presupuestos firmados y las reservas: append-only.';

CREATE TABLE IF NOT EXISTS public.commission_settings_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  source text NOT NULL CHECK (source IN ('admin_rpc', 'direct_sql', 'migration')),
  outcome text NOT NULL CHECK (outcome IN ('saved', 'no_change', 'rejected', 'stale')),
  previous_version bigint,
  new_version bigint,
  previous_rates jsonb,
  requested_rates jsonb,
  saved_rates jsonb,
  error_code text,
  error_detail jsonb
);

COMMENT ON TABLE public.commission_settings_audit IS
  'Quién cambió las comisiones, cuándo, de qué valores a cuáles y cómo terminó (guardado, sin cambios, rechazado o versión desfasada). Append-only.';

CREATE INDEX IF NOT EXISTS idx_commission_settings_audit_occurred
  ON public.commission_settings_audit (occurred_at DESC);

-- ── 3) Protecciones de las tablas ───────────────────────────────────────────────────────
-- La configuración no se borra ni se vacía: si faltara la fila, las operaciones con comisión se
-- bloquearían (a propósito), y eso no debe poder ocurrir por un DELETE accidental.
CREATE OR REPLACE FUNCTION public.commission_settings_no_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'La configuración de comisiones no se puede borrar: solo se modifica.'
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_commission_settings_no_delete ON public.commission_settings;
CREATE TRIGGER trg_commission_settings_no_delete
  BEFORE DELETE ON public.commission_settings
  FOR EACH ROW EXECUTE FUNCTION public.commission_settings_no_delete();
DROP TRIGGER IF EXISTS trg_commission_settings_no_truncate ON public.commission_settings;
CREATE TRIGGER trg_commission_settings_no_truncate
  BEFORE TRUNCATE ON public.commission_settings
  FOR EACH STATEMENT EXECUTE FUNCTION public.commission_settings_no_delete();

-- Historial y auditoría: solo se añaden filas.
CREATE OR REPLACE FUNCTION public.commission_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'El historial y la auditoría de comisiones solo admiten altas (% en %).', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_commission_history_append_only ON public.commission_settings_history;
CREATE TRIGGER trg_commission_history_append_only
  BEFORE UPDATE OR DELETE ON public.commission_settings_history
  FOR EACH ROW EXECUTE FUNCTION public.commission_append_only();
DROP TRIGGER IF EXISTS trg_commission_history_no_truncate ON public.commission_settings_history;
CREATE TRIGGER trg_commission_history_no_truncate
  BEFORE TRUNCATE ON public.commission_settings_history
  FOR EACH STATEMENT EXECUTE FUNCTION public.commission_append_only();
DROP TRIGGER IF EXISTS trg_commission_audit_append_only ON public.commission_settings_audit;
CREATE TRIGGER trg_commission_audit_append_only
  BEFORE UPDATE OR DELETE ON public.commission_settings_audit
  FOR EACH ROW EXECUTE FUNCTION public.commission_append_only();
DROP TRIGGER IF EXISTS trg_commission_audit_no_truncate ON public.commission_settings_audit;
CREATE TRIGGER trg_commission_audit_no_truncate
  BEFORE TRUNCATE ON public.commission_settings_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.commission_append_only();

-- ── 4) Versionado y auditoría: lo hace la base de datos, sea cual sea el camino ──────────
CREATE OR REPLACE FUNCTION public.commission_settings_versioning()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source text := CASE WHEN current_setting('garser.commission_source', true) = 'admin_rpc' THEN 'admin_rpc' ELSE 'direct_sql' END;
  v_actor uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Migración repetida: el trigger BEFORE salta aunque el INSERT acabe en ON CONFLICT DO NOTHING.
    -- Con la fila ya creada no se escribe ni historial ni auditoría de más.
    IF EXISTS (SELECT 1 FROM public.commission_settings s WHERE s.id = NEW.id) THEN
      RETURN NEW;
    END IF;
    -- La fila inicial es siempre la versión 1.
    NEW.version := 1;
    INSERT INTO public.commission_settings_history (
      version, rate_garser_first, rate_link_first, rate_garser_repeat, rate_maintenance_visit, rate_link_repeat,
      created_by
    ) VALUES (
      NEW.version, NEW.rate_garser_first, NEW.rate_link_first, NEW.rate_garser_repeat,
      NEW.rate_maintenance_visit, NEW.rate_link_repeat, NEW.updated_by
    );
    INSERT INTO public.commission_settings_audit (source, outcome, new_version, saved_rates, actor_id)
    VALUES (
      'migration', 'saved', NEW.version,
      public.commission_rates_json(NEW.rate_garser_first, NEW.rate_link_first, NEW.rate_garser_repeat,
        NEW.rate_maintenance_visit, NEW.rate_link_repeat),
      NEW.updated_by
    );
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'La configuración de comisiones es una sola fila.' USING ERRCODE = 'check_violation';
  END IF;

  IF (NEW.rate_garser_first, NEW.rate_link_first, NEW.rate_garser_repeat, NEW.rate_maintenance_visit, NEW.rate_link_repeat)
     IS DISTINCT FROM
     (OLD.rate_garser_first, OLD.rate_link_first, OLD.rate_garser_repeat, OLD.rate_maintenance_visit, OLD.rate_link_repeat) THEN
    -- Por la RPC del panel, quien guarda va en updated_by. Por cualquier otro camino (editor SQL,
    -- script) updated_by conserva al último administrador, que NO es quien está cambiando ahora:
    -- se atribuye a la sesión actual (o a nadie, si no la hay).
    v_actor := CASE WHEN v_source = 'admin_rpc' THEN NEW.updated_by ELSE auth.uid() END;
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
    NEW.updated_by := v_actor;
    INSERT INTO public.commission_settings_history (
      version, rate_garser_first, rate_link_first, rate_garser_repeat, rate_maintenance_visit, rate_link_repeat,
      created_by
    ) VALUES (
      NEW.version, NEW.rate_garser_first, NEW.rate_link_first, NEW.rate_garser_repeat,
      NEW.rate_maintenance_visit, NEW.rate_link_repeat, v_actor
    );
    INSERT INTO public.commission_settings_audit (
      source, outcome, actor_id, previous_version, new_version, previous_rates, requested_rates, saved_rates
    ) VALUES (
      v_source, 'saved', v_actor, OLD.version, NEW.version,
      public.commission_rates_json(OLD.rate_garser_first, OLD.rate_link_first, OLD.rate_garser_repeat,
        OLD.rate_maintenance_visit, OLD.rate_link_repeat),
      public.commission_rates_json(NEW.rate_garser_first, NEW.rate_link_first, NEW.rate_garser_repeat,
        NEW.rate_maintenance_visit, NEW.rate_link_repeat),
      public.commission_rates_json(NEW.rate_garser_first, NEW.rate_link_first, NEW.rate_garser_repeat,
        NEW.rate_maintenance_visit, NEW.rate_link_repeat)
    );
  ELSE
    -- Sin cambio de porcentajes la versión no se puede mover.
    NEW.version := OLD.version;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_commission_settings_versioning ON public.commission_settings;
CREATE TRIGGER trg_commission_settings_versioning
  BEFORE INSERT OR UPDATE ON public.commission_settings
  FOR EACH ROW EXECUTE FUNCTION public.commission_settings_versioning();

-- ── 5) Valores iniciales (controlados, una sola vez) ─────────────────────────────────────
-- Si la fila ya existe (migración repetida) no se toca: nunca se pisa una configuración del admin.
INSERT INTO public.commission_settings (
  id, version, rate_garser_first, rate_link_first, rate_garser_repeat, rate_maintenance_visit, rate_link_repeat
) VALUES (1, 1, 12.50, 0, 3, 3, 0)
ON CONFLICT (id) DO NOTHING;

-- ── 6) Acceso: nada directo desde el navegador ───────────────────────────────────────────
ALTER TABLE public.commission_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_settings_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_settings_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.commission_settings, public.commission_settings_history, public.commission_settings_audit
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.commission_settings, public.commission_settings_history, public.commission_settings_audit
  TO service_role;

-- ── 7) RPC de administrador ──────────────────────────────────────────────────────────────
-- Las tres comprueban is_admin() EN SQL con la identidad de la sesión: que el panel enseñe o no el
-- menú no cuenta. Un usuario que no sea administrador recibe 42501 sin enterarse de nada más.

-- Lo que ve el panel: valores, versión y si el motor nuevo está firmando de verdad.
-- `engine.lastQuoteUsesCommissions` evita el fallo silencioso «guardé las comisiones pero las
-- funciones no se redesplegaron»: false = el último presupuesto firmado desde esta migración NO lleva
-- comisión configurable (null = aún no se ha firmado ninguno).
CREATE OR REPLACE FUNCTION public.commission_settings_payload()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'version', s.version,
    'rates', public.commission_rates_json(
      s.rate_garser_first, s.rate_link_first, s.rate_garser_repeat, s.rate_maintenance_visit, s.rate_link_repeat),
    'updatedAt', s.updated_at,
    'updatedBy', s.updated_by,
    'engine', jsonb_build_object(
      'lastQuoteUsesCommissions', (
        SELECT (q.economic_snapshot ? 'commission')
        FROM public.booking_quotes q
        WHERE q.generated_at >= s.created_at
        ORDER BY q.generated_at DESC
        LIMIT 1
      )
    )
  )
  FROM public.commission_settings s
  WHERE s.id = 1;
$$;
REVOKE ALL ON FUNCTION public.commission_settings_payload() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commission_settings_payload() TO service_role;

CREATE OR REPLACE FUNCTION public.get_commission_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado: solo un administrador puede consultar las comisiones.'
      USING ERRCODE = '42501';
  END IF;
  v_payload := public.commission_settings_payload();
  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'commission_config_unavailable'
      USING ERRCODE = 'P0001', DETAIL = 'No existe la fila de configuración de comisiones.';
  END IF;
  RETURN v_payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_commission_settings(p_expected_version bigint, p_rates jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_current public.commission_settings%ROWTYPE;
  v_rules constant text[] := ARRAY['garser_first', 'link_first', 'garser_repeat', 'maintenance_visit', 'link_repeat'];
  v_rule text;
  v_key text;
  v_value jsonb;
  v_number numeric;
  v_errors jsonb := '[]'::jsonb;
  v_clean jsonb := '{}'::jsonb;
  v_current_rates jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado: solo un administrador puede modificar las comisiones.'
      USING ERRCODE = '42501';
  END IF;

  -- Una sola escritura a la vez: dos administradores guardando a la vez se serializan aquí.
  SELECT * INTO v_current FROM public.commission_settings WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'commission_config_unavailable'
      USING ERRCODE = 'P0001', DETAIL = 'No existe la fila de configuración de comisiones.';
  END IF;
  v_current_rates := public.commission_rates_json(
    v_current.rate_garser_first, v_current.rate_link_first, v_current.rate_garser_repeat,
    v_current.rate_maintenance_visit, v_current.rate_link_repeat);

  -- ── Validación: nada de «convertir lo raro en 0 %» ──
  IF p_rates IS NULL OR jsonb_typeof(p_rates) <> 'object' THEN
    v_errors := jsonb_build_array(jsonb_build_object('field', NULL, 'code', 'invalid_payload',
      'message', 'Faltan los porcentajes.'));
  ELSE
    FOR v_key IN SELECT jsonb_object_keys(p_rates) LOOP
      IF NOT (v_key = ANY (v_rules)) THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('field', v_key, 'code', 'unknown_field',
          'message', 'Campo desconocido.'));
      END IF;
    END LOOP;
    FOREACH v_rule IN ARRAY v_rules LOOP
      v_value := p_rates -> v_rule;
      IF v_value IS NULL OR jsonb_typeof(v_value) = 'null' THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('field', v_rule, 'code', 'required',
          'message', 'Indica un porcentaje.'));
      ELSIF jsonb_typeof(v_value) <> 'number' THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('field', v_rule, 'code', 'not_a_number',
          'message', 'Debe ser un número.'));
      ELSE
        v_number := (v_value #>> '{}')::numeric;
        IF v_number < 0 THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('field', v_rule, 'code', 'negative',
            'message', 'No puede ser negativo.'));
        ELSIF v_number > 100 THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('field', v_rule, 'code', 'above_100',
            'message', 'No puede superar el 100 %.'));
        ELSIF v_number <> round(v_number, 2) THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('field', v_rule, 'code', 'too_many_decimals',
            'message', 'Admite como mucho dos decimales.'));
        ELSE
          v_clean := v_clean || jsonb_build_object(v_rule, round(v_number, 2));
        END IF;
      END IF;
    END LOOP;
  END IF;

  IF jsonb_array_length(v_errors) > 0 THEN
    INSERT INTO public.commission_settings_audit (
      source, outcome, actor_id, previous_version, previous_rates, requested_rates, error_code, error_detail
    ) VALUES (
      'admin_rpc', 'rejected', v_actor, v_current.version, v_current_rates,
      CASE WHEN jsonb_typeof(p_rates) = 'object' THEN p_rates ELSE NULL END,
      'invalid_rates', v_errors
    );
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_rates', 'errors', v_errors,
      'settings', public.commission_settings_payload());
  END IF;

  -- ── Sin cambios: idempotente, aunque la versión que trae la web esté desfasada ──
  -- (un doble clic o un reintento tras un corte no debe verse como un conflicto).
  IF v_clean = v_current_rates THEN
    INSERT INTO public.commission_settings_audit (
      source, outcome, actor_id, previous_version, new_version, previous_rates, requested_rates, saved_rates
    ) VALUES (
      'admin_rpc', 'no_change', v_actor, v_current.version, v_current.version, v_current_rates, v_clean, v_current_rates
    );
    RETURN jsonb_build_object('ok', true, 'changed', false, 'settings', public.commission_settings_payload());
  END IF;

  -- ── Versión desfasada: otro administrador cambió algo mientras éste editaba ──
  IF p_expected_version IS NULL OR p_expected_version <> v_current.version THEN
    INSERT INTO public.commission_settings_audit (
      source, outcome, actor_id, previous_version, previous_rates, requested_rates, error_code,
      error_detail
    ) VALUES (
      'admin_rpc', 'stale', v_actor, v_current.version, v_current_rates, v_clean, 'stale_version',
      jsonb_build_object('expectedVersion', p_expected_version, 'currentVersion', v_current.version)
    );
    RETURN jsonb_build_object('ok', false, 'code', 'stale_version',
      'message', 'La configuración ha cambiado mientras la editabas. Revisa los valores actuales.',
      'settings', public.commission_settings_payload());
  END IF;

  -- ── Guardado atómico: las cinco reglas en un solo UPDATE (el trigger versiona y audita) ──
  PERFORM set_config('garser.commission_source', 'admin_rpc', true);
  UPDATE public.commission_settings
  SET rate_garser_first = (v_clean ->> 'garser_first')::numeric,
      rate_link_first = (v_clean ->> 'link_first')::numeric,
      rate_garser_repeat = (v_clean ->> 'garser_repeat')::numeric,
      rate_maintenance_visit = (v_clean ->> 'maintenance_visit')::numeric,
      rate_link_repeat = (v_clean ->> 'link_repeat')::numeric,
      updated_by = v_actor
  WHERE id = 1;
  PERFORM set_config('garser.commission_source', '', true);

  -- Lo que se devuelve es lo que quedó en la tabla, no lo que se pidió.
  RETURN jsonb_build_object('ok', true, 'changed', true, 'settings', public.commission_settings_payload());
END;
$$;

CREATE OR REPLACE FUNCTION public.list_commission_audit(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado: solo un administrador puede consultar la auditoría de comisiones.'
      USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_json ORDER BY occurred_at DESC, id DESC)
    FROM (
      SELECT a.id, a.occurred_at, jsonb_build_object(
        'id', a.id,
        'occurredAt', a.occurred_at,
        'actorId', a.actor_id,
        'actorName', p.full_name,
        'source', a.source,
        'outcome', a.outcome,
        'previousVersion', a.previous_version,
        'newVersion', a.new_version,
        'previousRates', a.previous_rates,
        'requestedRates', a.requested_rates,
        'savedRates', a.saved_rates,
        'errorCode', a.error_code,
        'errorDetail', a.error_detail
      ) AS row_json
      FROM public.commission_settings_audit a
      LEFT JOIN public.profiles p ON p.user_id = a.actor_id
      ORDER BY a.occurred_at DESC, a.id DESC
      LIMIT v_limit
    ) latest
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_commission_settings() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_commission_settings(bigint, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_commission_audit(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commission_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_commission_settings(bigint, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_commission_audit(integer) TO authenticated;
