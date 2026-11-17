-- Tramo 1 · paquete 1.4 · QA-100: la tarifa de «primera reserva» vale para UNA sola reserva a la vez.
--
-- El fallo
--   «Primera reserva» era «no hay ninguna reserva COMPLETADA con ese profesional». Un cliente que
--   reservaba dos trabajos seguidos con el mismo profesional pagaba la tarifa de primera en los dos
--   (y en cualquier número de ellos) hasta que uno se completaba.
--
-- La decisión del dueño (2026-11-17)
--   La tarifa de primera vale para una sola reserva a la vez por cliente y profesional. Si esa reserva
--   no se completa (cancelada, rechazada, caducada, profesional que no se presenta), vuelve a estar
--   disponible. Nunca dos reservas vivas a la vez con tarifa de primera. Una reserva con varios
--   servicios es UNA fila de bookings (sus partidas van en booking_items): cuenta como una.
--
-- Cómo se implementa
--   1. resolve_booking_commission: «primera» = no hay ninguna completada Y no hay otra reserva VIVA
--      (pendiente, confirmada o en revisión) que ya lleve una regla de primera (garser_first /
--      link_first). Si la hay, la reserva lleva la regla de «posterior» del mismo origen y la decisión
--      dice por qué (firstRateInUse = true), para que la web se lo explique al cliente.
--   2. apply_commission_to_economics conserva ese motivo en la economía firmada (y la comprobación de
--      coherencia, que vuelve a aplicar la decisión, lo reproduce igual).
--   3. Cinturón en los intentos de pago: una regla de «posterior» se justifica con una completada O con
--      una reserva viva de primera; una regla de primera no se acepta si ya hay otra viva de primera.
--   4. Índice único parcial en bookings: dos pagos simultáneos no pueden dejar dos reservas vivas de
--      primera. La segunda reserva no se crea (el intento queda «a conciliar» y su retención se anula,
--      paquete 1.1).
--
-- Lo que NO cambia: el origen del cliente (garser / enlace) se sigue fijando con su primera reserva y
-- ya no cambia; la visita de un plan paga la regla del plan; los porcentajes.

-- ── 1) Qué regla toca ────────────────────────────────────────────────────────────────────
-- Copia de 20261104130000 con el cambio de «primera» y el motivo nuevo.
CREATE OR REPLACE FUNCTION public.resolve_booking_commission(
  p_client_id uuid,
  p_provider_id uuid,
  p_claimed_origin text,
  p_maintenance_visit boolean DEFAULT false,
  p_config_version bigint DEFAULT NULL,
  p_link_code text DEFAULT NULL,
  p_claim_verified boolean DEFAULT false
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
  v_first_in_use boolean := false;
  v_rule text;
  v_percent numeric;
  v_claim_ok boolean := false;
  v_link_claim text := NULL;
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

  -- El enlace declarado solo cuenta si trae la clave de ese profesional.
  IF p_claimed_origin = 'provider_link' THEN
    IF COALESCE(p_claim_verified, false) THEN
      v_claim_ok := true;
    ELSIF p_provider_id IS NOT NULL AND public.provider_link_code_matches(p_provider_id, p_link_code) THEN
      v_claim_ok := true;
    END IF;
    v_link_claim := CASE WHEN v_claim_ok THEN 'verified' ELSE 'rejected' END;
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
    -- Una sola a la vez: si ya hay otra reserva viva con tarifa de primera, esta no lo es.
    IF v_first AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.client_id = p_client_id
        AND b.gardener_id = p_provider_id
        AND b.status IN ('pending', 'confirmed', 'disputed')
        AND b.commission_rule IN ('garser_first', 'link_first')
    ) THEN
      v_first := false;
      v_first_in_use := true;
    END IF;
  END IF;

  -- Sin relación guardada, vale el enlace contrastado; con relación, manda la guardada.
  IF v_origin IS NULL THEN
    v_origin := CASE WHEN v_claim_ok THEN 'provider_link' ELSE 'garser' END;
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
    'linkClaim', v_link_claim,
    'isFirstBooking', v_first AND NOT COALESCE(p_maintenance_visit, false)
  ) || CASE
    -- Solo cuando aplica (y nunca en la visita de un plan): los presupuestos de siempre quedan idénticos.
    WHEN v_first_in_use AND NOT COALESCE(p_maintenance_visit, false) THEN jsonb_build_object('firstRateInUse', true)
    ELSE '{}'::jsonb
  END;
END;
$$;

-- ── 2) La economía firmada conserva el motivo ────────────────────────────────────────────
-- Copia de 20261104130000 con firstRateInUse (opcional, solo puede ser true).
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
  v_link_claim text;
  v_link_claim_present boolean := false;
  v_first_in_use boolean := false;
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
  IF p_decision ? 'linkClaim' THEN
    v_link_claim_present := true;
    v_link_claim := p_decision ->> 'linkClaim';
    IF v_link_claim IS NOT NULL AND v_link_claim NOT IN ('verified', 'rejected') THEN
      RAISE EXCEPTION 'Resultado del enlace no válido: %.', v_link_claim USING ERRCODE = 'P0001';
    END IF;
    IF v_link_claim IS NOT NULL AND (v_claimed IS NULL OR jsonb_typeof(v_claimed) = 'null') THEN
      RAISE EXCEPTION 'Un enlace contrastado necesita un origen declarado.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  -- «Ya tienes otra reserva en curso con tarifa de primera» (QA-100). Solo true, y solo con una regla
  -- de «posterior»: con cualquier otra regla sería contradictorio.
  IF p_decision ? 'firstRateInUse' THEN
    IF p_decision -> 'firstRateInUse' IS DISTINCT FROM 'true'::jsonb
       OR v_rule NOT IN ('garser_repeat', 'link_repeat') THEN
      RAISE EXCEPTION 'Motivo de tarifa no válido.' USING ERRCODE = 'P0001';
    END IF;
    v_first_in_use := true;
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
    ) || CASE WHEN v_link_claim_present THEN jsonb_build_object('linkClaim', v_link_claim) ELSE '{}'::jsonb END
      || CASE WHEN v_first_in_use THEN jsonb_build_object('firstRateInUse', true) ELSE '{}'::jsonb END
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

-- ── 3) Cinturón en los intentos de pago ──────────────────────────────────────────────────
-- Copia de 20261104130000 con la regla «una a la vez».
CREATE OR REPLACE FUNCTION public.booking_payment_attempts_commission_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_problem text;
  v_commission jsonb;
  v_rule text;
BEGIN
  IF jsonb_typeof(NEW.economic_snapshot) = 'object' AND NEW.economic_snapshot ? 'commission' THEN
    v_problem := public.commission_snapshot_problem(NEW.economic_snapshot);
    IF v_problem IS NULL
       AND NEW.payable_now_amount_cents IS DISTINCT FROM
           round((NEW.economic_snapshot ->> 'payableNow')::numeric * 100)::integer THEN
      v_problem := 'el importe a pagar no coincide con la comisión';
    END IF;

    IF v_problem IS NULL THEN
      v_commission := NEW.economic_snapshot -> 'commission';
      v_rule := v_commission ->> 'rule';
      IF v_rule IN ('link_first', 'link_repeat')
         AND COALESCE(v_commission ->> 'linkClaim', '') <> 'verified'
         AND NOT EXISTS (
           SELECT 1 FROM public.client_provider_relationships r
           WHERE r.client_id = NEW.client_id AND r.provider_id = NEW.gardener_id AND r.origin = 'provider_link'
         ) THEN
        v_problem := 'el origen «enlace» no está justificado';
      END IF;
      -- «Posterior»: hay una completada, o hay otra reserva viva que ya lleva la tarifa de primera.
      IF v_problem IS NULL AND v_rule IN ('garser_repeat', 'link_repeat')
         AND NOT EXISTS (
           SELECT 1 FROM public.bookings b
           WHERE b.client_id = NEW.client_id AND b.gardener_id = NEW.gardener_id
             AND (b.status = 'completed'
                  OR (b.status IN ('pending', 'confirmed', 'disputed')
                      AND b.commission_rule IN ('garser_first', 'link_first')))
         ) THEN
        v_problem := 'no hay una reserva completada anterior';
      END IF;
      -- Primera: solo una a la vez (al crear el intento; su propia reserva no cuenta).
      IF v_problem IS NULL AND TG_OP = 'INSERT' AND v_rule IN ('garser_first', 'link_first')
         AND EXISTS (
           SELECT 1 FROM public.bookings b
           WHERE b.client_id = NEW.client_id AND b.gardener_id = NEW.gardener_id
             AND b.id IS DISTINCT FROM NEW.booking_id
             AND b.status IN ('pending', 'confirmed', 'disputed')
             AND b.commission_rule IN ('garser_first', 'link_first')
         ) THEN
        v_problem := 'ya hay otra reserva en curso con la tarifa de primera reserva';
      END IF;
    END IF;

    IF v_problem IS NOT NULL THEN
      RAISE EXCEPTION 'El presupuesto no tiene una comisión válida (%). Vuelve a seleccionar el profesional.', v_problem
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 4) Nunca dos reservas vivas de primera (pagos simultáneos) ───────────────────────────
-- Si en la base ya hubiera dos (reservas anteriores a esta regla), el índice no se puede crear: se
-- avisa con las reservas implicadas en vez de dejar un error genérico. La comprobación previa está en
-- docs/audit/2026-07-12/PRUEBAS-PRODUCCION.md (sección 42).
DO $$
DECLARE
  v_dupes text;
BEGIN
  SELECT string_agg(format('cliente %s con profesional %s (%s reservas)', client_id, gardener_id, n), '; ')
  INTO v_dupes
  FROM (
    SELECT client_id, gardener_id, count(*) AS n
    FROM public.bookings
    WHERE status IN ('pending', 'confirmed', 'disputed')
      AND commission_rule IN ('garser_first', 'link_first')
    GROUP BY client_id, gardener_id
    HAVING count(*) > 1
  ) d;
  IF v_dupes IS NOT NULL THEN
    RAISE EXCEPTION 'Hay clientes con dos reservas vivas con tarifa de primera: %. Revísalas antes de aplicar esta migración.', v_dupes;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_live_first_rate_per_client_provider
  ON public.bookings (client_id, gardener_id)
  WHERE status IN ('pending', 'confirmed', 'disputed')
    AND commission_rule IN ('garser_first', 'link_first');

COMMENT ON INDEX public.bookings_one_live_first_rate_per_client_provider IS
  'QA-100: la tarifa de primera reserva vale para una sola reserva viva a la vez por cliente y profesional.';
