-- Comisiones configurables (2026-11), parte 2/3: el motor que decide qué regla toca y cuánto se cobra.
--
-- Qué resuelve
--   1. De dónde vino cada cliente con cada profesional (client_provider_relationships). Hasta hoy el
--      origen «enlace» solo se usaba al firmar el presupuesto y se perdía: no había forma de distinguir
--      después a un cliente propio del profesional de uno captado por GarSer.
--   2. Qué regla de las cinco corresponde a una reserva (resolve_booking_commission), con una
--      prioridad explícita y determinista, calculada SIEMPRE aquí, con datos de la base de datos.
--   3. Cuánto cuesta en céntimos (apply_commission_to_economics): aritmética entera, un solo sitio.
--      La versión TypeScript de esta cuenta deja de existir: el servidor llama a estas funciones.
--
-- Prioridad de las reglas (la primera que se cumple):
--   1. Visita de un plan de mantenimiento      → maintenance_visit  (decisión del dueño: gana siempre)
--   2. Origen «enlace» y aún sin reserva completada → link_first
--   3. Origen «enlace» con una reserva completada   → link_repeat
--   4. Origen GarSer y aún sin reserva completada   → garser_first
--   5. Origen GarSer con una reserva completada     → garser_repeat
--
-- Qué cuenta (decisiones del dueño, 2026-11-02):
--   · «Ya contrató antes» = al menos una reserva COMPLETADA con ese profesional. Una cancelada o solo
--     aceptada no cuenta.
--   · El origen se fija en la PRIMERA reserva creada con ese profesional y no cambia nunca, aunque el
--     cliente vuelva por otro enlace. Con otro profesional se decide de nuevo.
--   · Los clientes que ya existían se clasifican con lo que consta: «enlace» si su primera reserva con
--     el profesional fue por enlace (waived_provider_link); «GarSer» en el resto.
--   · Si el cálculo sale por debajo de 0,50 € (el mínimo de Stripe), se cobra 0,50 €.
--
-- Qué NO se toca: el motor de precios, las reservas existentes ni los cobros ya hechos. El servidor
-- actual (que usa management_fee_waiver_reason y la constante 12,5 %) sigue funcionando con esta
-- migración puesta: quedan sus funciones, fijadas a su comportamiento de hoy, para el despliegue y
-- para volver atrás.

-- ── 1) Relación cliente ↔ profesional ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_provider_relationships (
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  origin text NOT NULL CHECK (origin IN ('garser', 'provider_link')),
  first_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  established_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'booking' CHECK (source IN ('booking', 'backfill')),
  PRIMARY KEY (client_id, provider_id)
);

COMMENT ON TABLE public.client_provider_relationships IS
  'De dónde vino cada cliente con cada profesional (garser | provider_link). Se fija con la primera reserva creada y no cambia nunca. En una empresa, el profesional es la cuenta de la empresa.';
COMMENT ON COLUMN public.client_provider_relationships.source IS
  'booking = creada al crearse la primera reserva; backfill = deducida de reservas anteriores a las comisiones configurables.';

-- El origen es un hecho histórico: ni el cliente ni el profesional ni el origen se reescriben.
-- (Lo único que puede cambiar es first_booking_id, que pasa a NULL si se borra esa reserva.)
CREATE OR REPLACE FUNCTION public.client_provider_relationships_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
     OR NEW.origin IS DISTINCT FROM OLD.origin
     OR NEW.established_at IS DISTINCT FROM OLD.established_at
     OR NEW.source IS DISTINCT FROM OLD.source THEN
    RAISE EXCEPTION 'El origen de un cliente con un profesional no se puede cambiar.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_provider_relationships_immutable ON public.client_provider_relationships;
CREATE TRIGGER trg_client_provider_relationships_immutable
  BEFORE UPDATE ON public.client_provider_relationships
  FOR EACH ROW EXECUTE FUNCTION public.client_provider_relationships_immutable();

ALTER TABLE public.client_provider_relationships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_provider_relationships FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.client_provider_relationships TO service_role;

-- Reservas que ya existen: se clasifican con lo que consta, nada más. Solo inserta (nunca modifica
-- reservas) y es repetible: lo que ya esté no se toca.
INSERT INTO public.client_provider_relationships (client_id, provider_id, origin, first_booking_id, established_at, source)
SELECT DISTINCT ON (b.client_id, b.gardener_id)
  b.client_id,
  b.gardener_id,
  CASE WHEN b.management_fee_source = 'waived_provider_link' THEN 'provider_link' ELSE 'garser' END,
  b.id,
  COALESCE(b.created_at, now()),
  'backfill'
FROM public.bookings b
WHERE b.client_id IS NOT NULL
  AND b.gardener_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = b.client_id)
  AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = b.gardener_id)
ORDER BY b.client_id, b.gardener_id, b.created_at ASC NULLS LAST, b.id
ON CONFLICT (client_id, provider_id) DO NOTHING;

-- ── 2) Constantes con nombre ─────────────────────────────────────────────────────────────
-- Stripe no autoriza cobros menores de 0,50 € en euros. Es el suelo de la comisión cuando el
-- porcentaje es mayor que 0 (decisión del dueño). Una sola definición: la usan el cálculo, la
-- validación de presupuestos y la restricción de la tabla de reservas.
CREATE OR REPLACE FUNCTION public.commission_minimum_charge_cents()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 50 $$;

-- Motivos por los que una reserva puede ir con 0 € de gastos de gestión. Los tres primeros ya
-- existían (migración 20261019120000). `zero_commission` es la regla configurada al 0 % que no es
-- ninguna de las anteriores (primera reserva captada por GarSer, si el administrador la pone a 0).
CREATE OR REPLACE FUNCTION public.fee_waiver_reasons()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$ SELECT ARRAY['provider_link', 'returning_client', 'maintenance_plan', 'zero_commission'] $$;

CREATE OR REPLACE FUNCTION public.commission_rule_codes()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$ SELECT ARRAY['garser_first', 'link_first', 'garser_repeat', 'maintenance_visit', 'link_repeat'] $$;

-- ¿Esta economía va sin gastos de gestión con un motivo válido? (la usa el CHECK de los intentos de
-- pago: una economía a 0 € solo es válida con motivo.) Misma definición que antes, ampliada con el
-- motivo nuevo mediante la lista única.
CREATE OR REPLACE FUNCTION public.quote_economics_fee_waived(p_economics jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(p_economics) = 'object'
    AND (p_economics #>> '{feeWaiver,reason}') = ANY (public.fee_waiver_reasons())
    AND COALESCE(p_economics ->> 'managementFee', '') ~ '^0+(\.0+)?$'
    AND COALESCE(p_economics ->> 'payableNow', '') ~ '^0+(\.0+)?$',
    false
  );
$$;

-- ── 3) La economía de un presupuesto: quitar y poner la comisión ─────────────────────────
-- Deja el presupuesto solo con el servicio: sin comisión, sin línea de comisión, sin cargo de Stripe
-- y sin exención. Es el punto de partida de apply_commission_to_economics, así que aplicarla dos
-- veces (o sobre una economía que ya traía el 12,5 % antiguo) da siempre el mismo resultado.
CREATE OR REPLACE FUNCTION public.strip_commission_from_economics(p_economics jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_economics IS NULL OR jsonb_typeof(p_economics) <> 'object' THEN p_economics
    ELSE (p_economics - 'commission' - 'feeWaiver') || jsonb_build_object(
      'managementFee', 0,
      'payableNow', 0,
      'stripeLineItems', '[]'::jsonb,
      'lines', COALESCE((
        SELECT jsonb_agg(l ORDER BY o)
        FROM jsonb_array_elements(COALESCE(p_economics -> 'lines', '[]'::jsonb)) WITH ORDINALITY AS t(l, o)
        WHERE (l ->> 'code') IS DISTINCT FROM 'management_fee'
      ), '[]'::jsonb)
    )
  END;
$$;

-- Aplica una decisión de comisión (la que devuelve resolve_booking_commission) a una economía:
--   comisión = porcentaje × precio del servicio con IVA, en céntimos y redondeada al céntimo más
--   cercano (a la mitad, hacia arriba). Con porcentaje > 0 nunca baja de 0,50 €. Con porcentaje 0 la
--   reserva va sin gastos, con el motivo que corresponde a la regla.
-- No lee la base de datos: mismos datos de entrada, mismo resultado (por eso sirve para comprobar,
-- más tarde, que un presupuesto guardado es exactamente el que salía de su decisión).
CREATE OR REPLACE FUNCTION public.apply_commission_to_economics(p_economics jsonb, p_decision jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_rules constant text[] := ARRAY['garser_first', 'link_first', 'garser_repeat', 'maintenance_visit', 'link_repeat'];
  v_rule text;
  v_origin text;
  v_claimed jsonb;
  v_version numeric;
  v_bps_raw numeric;
  v_bps integer;
  v_base numeric;
  v_base_cents bigint;
  v_calc_cents bigint;
  v_fee_cents bigint := 0;
  v_fee numeric;
  v_adjustment text;
  v_reason text;
  v_stripped jsonb;
  v_out jsonb;
BEGIN
  -- IS DISTINCT FROM y no <>: con una clave ausente jsonb_typeof es NULL, y NULL <> 'number' no
  -- lanza nada. Una decisión incompleta nunca debe convertirse en una comisión de 0.
  IF p_economics IS NULL OR jsonb_typeof(p_economics) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_economics -> 'serviceGrossTotal') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'La economía del presupuesto no permite calcular la comisión.' USING ERRCODE = 'P0001';
  END IF;
  IF p_decision IS NULL OR jsonb_typeof(p_decision) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Falta la decisión de comisión.' USING ERRCODE = 'P0001';
  END IF;

  v_rule := p_decision ->> 'rule';
  IF v_rule IS NULL OR NOT (v_rule = ANY (v_rules)) THEN
    RAISE EXCEPTION 'Regla de comisión desconocida: %.', COALESCE(v_rule, '(vacía)') USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_decision -> 'rateBps') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'La decisión de comisión no trae porcentaje.' USING ERRCODE = 'P0001';
  END IF;
  v_bps_raw := (p_decision ->> 'rateBps')::numeric;
  IF v_bps_raw < 0 OR v_bps_raw > 10000 OR v_bps_raw <> trunc(v_bps_raw) THEN
    RAISE EXCEPTION 'Porcentaje de comisión fuera de rango (%).', v_bps_raw USING ERRCODE = 'P0001';
  END IF;
  v_bps := v_bps_raw::integer;

  IF jsonb_typeof(p_decision -> 'configVersion') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'La decisión de comisión no trae versión de configuración.' USING ERRCODE = 'P0001';
  END IF;
  v_version := (p_decision ->> 'configVersion')::numeric;
  IF v_version < 1 OR v_version <> trunc(v_version) THEN
    RAISE EXCEPTION 'Versión de configuración de comisiones no válida (%).', v_version USING ERRCODE = 'P0001';
  END IF;

  v_origin := COALESCE(p_decision ->> 'origin', 'garser');
  IF v_origin NOT IN ('garser', 'provider_link') THEN
    RAISE EXCEPTION 'Origen de cliente desconocido: %.', v_origin USING ERRCODE = 'P0001';
  END IF;
  v_claimed := p_decision -> 'claimedOrigin';
  IF v_claimed IS NOT NULL AND jsonb_typeof(v_claimed) <> 'null' AND v_claimed <> '"provider_link"'::jsonb THEN
    RAISE EXCEPTION 'Origen declarado no válido.' USING ERRCODE = 'P0001';
  END IF;

  -- ── La cuenta, en céntimos enteros ──
  v_base := round((p_economics ->> 'serviceGrossTotal')::numeric, 2);
  v_base_cents := (v_base * 100)::bigint;
  v_calc_cents := round(v_base_cents::numeric * v_bps / 10000)::bigint;

  IF v_base_cents <= 0 THEN
    v_fee_cents := 0;
  ELSIF v_bps = 0 THEN
    v_fee_cents := 0;
    v_reason := CASE v_rule
      WHEN 'link_first' THEN 'provider_link'
      WHEN 'garser_repeat' THEN 'returning_client'
      WHEN 'link_repeat' THEN 'returning_client'
      WHEN 'maintenance_visit' THEN 'maintenance_plan'
      ELSE 'zero_commission'
    END;
  ELSIF v_calc_cents < public.commission_minimum_charge_cents() THEN
    v_fee_cents := public.commission_minimum_charge_cents();
    v_adjustment := 'minimum_charge';
  ELSE
    v_fee_cents := v_calc_cents;
  END IF;
  v_fee := round(v_fee_cents::numeric / 100, 2);

  v_stripped := public.strip_commission_from_economics(p_economics);
  v_out := v_stripped || jsonb_build_object(
    'managementFee', v_fee,
    'payableNow', v_fee,
    'commission', jsonb_build_object(
      'rule', v_rule,
      'rateBps', v_bps,
      'ratePercent', round(v_bps::numeric / 100, 2),
      'configVersion', v_version::bigint,
      'origin', v_origin,
      'claimedOrigin', CASE WHEN v_claimed IS NULL OR jsonb_typeof(v_claimed) = 'null' THEN NULL ELSE v_claimed #>> '{}' END,
      'isFirstBooking', COALESCE((p_decision ->> 'isFirstBooking')::boolean, false),
      'baseAmount', v_base,
      'calculatedAmount', round(v_calc_cents::numeric / 100, 2),
      'amount', v_fee,
      'adjustment', v_adjustment
    )
  );

  IF v_fee_cents > 0 THEN
    v_out := v_out || jsonb_build_object(
      'lines', (v_stripped -> 'lines') || jsonb_build_array(jsonb_build_object(
        'code', 'management_fee', 'label', 'Gastos de gestión', 'amount', v_fee, 'kind', 'fee')),
      'stripeLineItems', jsonb_build_array(jsonb_build_object(
        'code', 'management_fee', 'label', 'Gastos de gestión', 'unitAmount', v_fee, 'quantity', 1))
    );
  ELSIF v_reason IS NOT NULL THEN
    v_out := v_out || jsonb_build_object(
      'feeWaiver', jsonb_build_object('reason', v_reason, 'waivedFee', 0)
    );
  END IF;

  RETURN v_out;
END;
$$;

-- ── 4) Qué regla toca ────────────────────────────────────────────────────────────────────
-- p_claimed_origin: lo que declara la web ('provider_link' si la reserva empezó en /reservar/<id> de
-- ESTE profesional; el servidor ya lo ha contrastado con el profesional del presupuesto). Es lo único
-- que viene del navegador, y solo cuenta mientras no haya una relación guardada: la primera reserva
-- la fija y después ya no se puede cambiar. Es una declaración, no una prueba: el enlace es público.
-- p_config_version: NULL = la configuración vigente; un número = esa versión del historial (así el
-- pago revalida con la misma configuración con la que se firmó el presupuesto).
CREATE OR REPLACE FUNCTION public.resolve_booking_commission(
  p_client_id uuid,
  p_provider_id uuid,
  p_claimed_origin text,
  p_maintenance_visit boolean DEFAULT false,
  p_config_version bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version bigint;
  v_rates public.commission_settings_history%ROWTYPE;
  v_origin text;
  v_first boolean := true;
  v_rule text;
  v_percent numeric;
BEGIN
  v_version := COALESCE(p_config_version, (SELECT s.version FROM public.commission_settings s WHERE s.id = 1));
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'commission_config_unavailable'
      USING ERRCODE = 'P0001', DETAIL = 'No existe la fila de configuración de comisiones.';
  END IF;
  SELECT * INTO v_rates FROM public.commission_settings_history h WHERE h.version = v_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'commission_config_unavailable'
      USING ERRCODE = 'P0001', DETAIL = format('La versión %s de la configuración de comisiones no existe.', v_version);
  END IF;

  IF p_client_id IS NOT NULL AND p_provider_id IS NOT NULL THEN
    SELECT r.origin INTO v_origin
    FROM public.client_provider_relationships r
    WHERE r.client_id = p_client_id AND r.provider_id = p_provider_id;

    v_first := NOT EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.client_id = p_client_id
        AND b.gardener_id = p_provider_id
        AND b.status = 'completed'
    );
  END IF;

  -- Sin relación guardada, vale la declaración del enlace; con relación, manda la guardada.
  IF v_origin IS NULL THEN
    v_origin := CASE WHEN p_claimed_origin = 'provider_link' THEN 'provider_link' ELSE 'garser' END;
  END IF;

  v_rule := CASE
    WHEN COALESCE(p_maintenance_visit, false) THEN 'maintenance_visit'
    WHEN v_origin = 'provider_link' AND v_first THEN 'link_first'
    WHEN v_origin = 'provider_link' THEN 'link_repeat'
    WHEN v_first THEN 'garser_first'
    ELSE 'garser_repeat'
  END;

  v_percent := CASE v_rule
    WHEN 'garser_first' THEN v_rates.rate_garser_first
    WHEN 'link_first' THEN v_rates.rate_link_first
    WHEN 'garser_repeat' THEN v_rates.rate_garser_repeat
    WHEN 'maintenance_visit' THEN v_rates.rate_maintenance_visit
    ELSE v_rates.rate_link_repeat
  END;

  RETURN jsonb_build_object(
    'rule', v_rule,
    'rateBps', (v_percent * 100)::integer,
    'ratePercent', v_percent,
    'configVersion', v_version,
    'origin', v_origin,
    'claimedOrigin', CASE WHEN p_claimed_origin = 'provider_link' THEN 'provider_link' ELSE NULL END,
    'isFirstBooking', v_first AND NOT COALESCE(p_maintenance_visit, false)
  );
END;
$$;

-- Lo que llama el servidor: economía del motor de precios (solo servicio) → economía con comisión.
CREATE OR REPLACE FUNCTION public.quote_commission_economics(
  p_economics jsonb,
  p_client_id uuid,
  p_provider_id uuid,
  p_claimed_origin text,
  p_maintenance_visit boolean DEFAULT false,
  p_config_version bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.apply_commission_to_economics(
    p_economics,
    public.resolve_booking_commission(p_client_id, p_provider_id, p_claimed_origin, p_maintenance_visit, p_config_version)
  );
$$;

-- ── 5) Verificación de una comisión ya firmada ───────────────────────────────────────────
-- NULL = correcta (o el presupuesto no lleva comisión configurable: es anterior a esta serie).
-- Texto = qué falla. Comprueba contra el HISTORIAL (no contra lo que el propio presupuesto dice):
-- la regla existe, el porcentaje es el de esa versión y la economía es, al céntimo, la que sale de
-- aplicar esa decisión. Un importe o un porcentaje adulterado no pasa.
CREATE OR REPLACE FUNCTION public.commission_snapshot_problem(p_economics jsonb)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c jsonb;
  h public.commission_settings_history%ROWTYPE;
  v_percent numeric;
BEGIN
  IF p_economics IS NULL OR jsonb_typeof(p_economics) <> 'object' OR NOT (p_economics ? 'commission') THEN
    RETURN NULL;
  END IF;
  c := p_economics -> 'commission';
  IF jsonb_typeof(c) IS DISTINCT FROM 'object' THEN
    RETURN 'la comisión está mal formada';
  END IF;
  IF (c ->> 'rule') IS NULL OR NOT ((c ->> 'rule') = ANY (public.commission_rule_codes())) THEN
    RETURN 'la regla de comisión no existe';
  END IF;
  IF jsonb_typeof(c -> 'configVersion') IS DISTINCT FROM 'number'
     OR jsonb_typeof(c -> 'rateBps') IS DISTINCT FROM 'number' THEN
    RETURN 'faltan la versión o el porcentaje';
  END IF;

  SELECT * INTO h FROM public.commission_settings_history x WHERE x.version = (c ->> 'configVersion')::bigint;
  IF NOT FOUND THEN
    RETURN 'la versión de la configuración no existe';
  END IF;
  v_percent := CASE c ->> 'rule'
    WHEN 'garser_first' THEN h.rate_garser_first
    WHEN 'link_first' THEN h.rate_link_first
    WHEN 'garser_repeat' THEN h.rate_garser_repeat
    WHEN 'maintenance_visit' THEN h.rate_maintenance_visit
    ELSE h.rate_link_repeat
  END;
  IF (c ->> 'rateBps')::numeric <> round(v_percent * 100) THEN
    RETURN 'el porcentaje no es el de esa versión de la configuración';
  END IF;

  IF public.apply_commission_to_economics(p_economics, c) IS DISTINCT FROM p_economics THEN
    RETURN 'los importes no coinciden con la comisión';
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN 'la comisión no se puede leer';
END;
$$;

-- ── 6) Cinturón en la tabla de intentos de pago ──────────────────────────────────────────
-- Antes de que exista un intento (y por tanto un cobro en Stripe) se comprueba que la comisión del
-- presupuesto es válida y que lo que se va a cobrar es exactamente esa comisión. Vale para cualquier
-- camino que cree intentos. Los presupuestos sin comisión configurable (anteriores a esta serie) no
-- se tocan: los frena, si procede, la edge function.
CREATE OR REPLACE FUNCTION public.booking_payment_attempts_commission_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_problem text;
BEGIN
  IF jsonb_typeof(NEW.economic_snapshot) = 'object' AND NEW.economic_snapshot ? 'commission' THEN
    v_problem := public.commission_snapshot_problem(NEW.economic_snapshot);
    IF v_problem IS NULL
       AND NEW.payable_now_amount_cents IS DISTINCT FROM
           round((NEW.economic_snapshot ->> 'payableNow')::numeric * 100)::integer THEN
      v_problem := 'el importe a pagar no coincide con la comisión';
    END IF;
    IF v_problem IS NOT NULL THEN
      RAISE EXCEPTION 'El presupuesto no tiene una comisión válida (%). Vuelve a seleccionar el profesional.', v_problem
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_booking_payment_attempts_commission_guard ON public.booking_payment_attempts;
CREATE TRIGGER trg_booking_payment_attempts_commission_guard
  BEFORE INSERT OR UPDATE OF economic_snapshot, payable_now_amount_cents ON public.booking_payment_attempts
  FOR EACH ROW EXECUTE FUNCTION public.booking_payment_attempts_commission_guard();

-- ── 7) El interruptor antiguo deja de mandar ─────────────────────────────────────────────
-- «Sin gastos de gestión para los clientes propios» ya no es un interruptor: son las dos reglas de
-- enlace. Esta función conserva el nombre porque la leen el asistente de alta del profesional
-- (provider_setup_status) y el material de marketing, para no prometerle al profesional «tus clientes
-- reservan sin gastos de gestión» cuando la configuración dice otra cosa.
CREATE OR REPLACE FUNCTION public.own_clients_fee_waiver_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT s.rate_link_first = 0 AND s.rate_link_repeat = 0 FROM public.commission_settings s WHERE s.id = 1),
    false
  );
$$;

COMMENT ON FUNCTION public.own_clients_fee_waiver_enabled() IS
  'true si los clientes del enlace del profesional (primera reserva y siguientes) tienen la comisión configurada al 0 %. Derivado de commission_settings; ya no hay interruptor.';

COMMENT ON COLUMN public.app_settings.own_clients_fee_waiver_enabled IS
  'OBSOLETO desde 20261102: el panel ya no lo escribe y el servidor nuevo no lo lee. Solo lo consulta management_fee_waiver_reason, que se conserva para las funciones antiguas durante el despliegue y para volver atrás.';

-- La regla del servidor antiguo (booking-authority anterior a esta serie), FIJADA a su
-- comportamiento de hoy: lee el interruptor antiguo directamente. Mientras no se redespliegue el
-- servidor, sigue exento lo mismo que hasta ahora. Cuerpo idéntico al de 20261019120000, con ese
-- único cambio.
CREATE OR REPLACE FUNCTION public.management_fee_waiver_reason(
  p_client_id uuid,
  p_provider_id uuid,
  p_claimed_origin text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_provider_id IS NULL
     OR NOT COALESCE((SELECT s.own_clients_fee_waiver_enabled FROM public.app_settings s WHERE s.id = 1), false) THEN
    RETURN NULL;
  END IF;
  IF p_claimed_origin = 'provider_link' THEN
    RETURN 'provider_link';
  END IF;
  IF p_client_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.client_id = p_client_id
      AND b.gardener_id = p_provider_id
      AND b.status = 'completed'
  ) THEN
    RETURN 'returning_client';
  END IF;
  RETURN NULL;
END;
$$;

-- ── 8) Quién puede ejecutar qué ──────────────────────────────────────────────────────────
-- Las que deciden dinero: solo el servidor (service_role) y las funciones de la base de datos que
-- las llaman como propietarias. Ni el navegador ni un usuario autenticado.
REVOKE ALL ON FUNCTION public.resolve_booking_commission(uuid, uuid, text, boolean, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.quote_commission_economics(jsonb, uuid, uuid, text, boolean, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commission_snapshot_problem(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.management_fee_waiver_reason(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_booking_commission(uuid, uuid, text, boolean, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.quote_commission_economics(jsonb, uuid, uuid, text, boolean, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.commission_snapshot_problem(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.management_fee_waiver_reason(uuid, uuid, text) TO service_role;
