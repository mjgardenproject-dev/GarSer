-- Comisiones configurables (2026-11), parte 3/3: lo que guarda cada reserva y los planes de mantenimiento.
--
-- Qué resuelve
--   1. Cada reserva nueva guarda, congelado, por qué se le cobró lo que se le cobró: regla aplicada,
--      porcentaje, base sobre la que se calculó, versión de la configuración y fecha. El administrador
--      puede cambiar los porcentajes cuando quiera: ninguna reserva ya creada cambia (trigger).
--      El importe cobrado sigue siendo management_fee (columna inmutable de siempre) y una restricción
--      obliga a que cuadre con base × porcentaje.
--   2. Al crearse la primera reserva con un profesional se guarda el origen del cliente.
--   3. Los planes de mantenimiento: cada visita se firma con la regla de visita de plan y la
--      configuración vigente en el momento de proponerla.
--
-- Reservas anteriores: sus columnas commission_* quedan en NULL («anterior a las comisiones
-- configurables»). No se reescribe ni una.

-- ── 1) Columnas ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS commission_rule text,
  ADD COLUMN IF NOT EXISTS commission_rate_bps integer,
  ADD COLUMN IF NOT EXISTS commission_base_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS commission_config_version bigint,
  ADD COLUMN IF NOT EXISTS commission_fixed_at timestamptz;

COMMENT ON COLUMN public.bookings.commission_rule IS
  'Regla de comisión aplicada (garser_first | link_first | garser_repeat | maintenance_visit | link_repeat). NULL = reserva anterior a las comisiones configurables. Inmutable.';
COMMENT ON COLUMN public.bookings.commission_rate_bps IS
  'Porcentaje aplicado en puntos básicos (1250 = 12,5 %). Inmutable.';
COMMENT ON COLUMN public.bookings.commission_base_amount IS
  'Precio del servicio con IVA sobre el que se calculó la comisión al firmar el presupuesto. total_price puede cambiar después (cambio de precio aceptado); esta base no. Inmutable.';
COMMENT ON COLUMN public.bookings.commission_config_version IS
  'Versión de commission_settings_history con la que se calculó. Inmutable.';
COMMENT ON COLUMN public.bookings.commission_fixed_at IS
  'Momento en que la comisión quedó fijada en la reserva (al crearse). Inmutable.';

-- Todo o nada: una reserva con instantánea la tiene completa y con valores posibles.
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_commission_snapshot_complete,
  ADD CONSTRAINT bookings_commission_snapshot_complete CHECK (
    (commission_rule IS NULL
      AND commission_rate_bps IS NULL
      AND commission_base_amount IS NULL
      AND commission_config_version IS NULL
      AND commission_fixed_at IS NULL)
    OR
    (commission_rule = ANY (public.commission_rule_codes())
      AND commission_rate_bps BETWEEN 0 AND 10000
      AND commission_base_amount >= 0
      AND commission_config_version >= 1
      AND commission_fixed_at IS NOT NULL)
  );

-- La comisión cobrada es EXACTAMENTE la que dicen la base y el porcentaje: 0 si el porcentaje es 0;
-- si no, base × porcentaje al céntimo, con el mínimo de 0,50 € de Stripe. Si algún día los dos
-- discrepan, la reserva no se crea (y el cobro queda a conciliar): mejor eso que un importe sin
-- explicación.
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_commission_fee_coherent,
  ADD CONSTRAINT bookings_commission_fee_coherent CHECK (
    commission_rule IS NULL
    OR management_fee = CASE
      WHEN commission_rate_bps = 0 OR commission_base_amount <= 0 THEN 0
      ELSE GREATEST(
        round(commission_base_amount * commission_rate_bps / 10000.0, 2),
        public.commission_minimum_charge_cents() / 100.0
      )
    END
  );

-- Las exenciones ahora incluyen la regla configurada al 0 % que no es de enlace, cliente que repite
-- ni plan (la primera reserva captada por GarSer, si el administrador la pone a 0).
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_management_fee_source_check,
  ADD CONSTRAINT bookings_management_fee_source_check CHECK (
    management_fee_source IN (
      'payment_attempt',
      'pricing_context_cents',
      'quote_snapshot_payable_now',
      'quote_snapshot_management_fee',
      'unknown',
      'waived_provider_link',
      'waived_returning_client',
      'waived_maintenance_plan',
      'waived_zero_commission'
    )
  );

-- ── 2) Trigger de la reserva: rellena la instantánea al crear y la congela ───────────────
-- Copia de 20260803120000 (bookings_management_fee_guard) con dos añadidos: al INSERTAR, la
-- instantánea sale de la economía FIRMADA que viaja en pricing_context (nadie del navegador puede
-- escribir ahí: las reservas solo las crea el servidor); al ACTUALIZAR, las columnas commission_*
-- se congelan igual que management_fee.
CREATE OR REPLACE FUNCTION public.bookings_management_fee_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fee numeric;
  v_source text;
  v_commission jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Se deriva aqui, y no dentro de confirm_booking_payment_attempt, para que valga para
    -- CUALQUIER via de insercion (presente o futura) sin duplicar la cascada.
    IF NEW.management_fee IS NULL OR NEW.management_fee_source IS NULL THEN
      SELECT r.fee, r.source INTO v_fee, v_source
      FROM public.resolve_booking_management_fee(COALESCE(NEW.pricing_context, '{}'::jsonb), NEW.id) AS r;

      NEW.management_fee := COALESCE(NEW.management_fee, v_fee, 0);
      NEW.management_fee_source := COALESCE(NEW.management_fee_source, v_source, 'unknown');
    END IF;

    -- Instantánea de la comisión (solo si el presupuesto firmado traía comisión configurable).
    IF NEW.commission_rule IS NULL THEN
      v_commission := NEW.pricing_context #> '{quote_economic_snapshot,commission}';
      IF jsonb_typeof(v_commission) = 'object' THEN
        NEW.commission_rule := v_commission ->> 'rule';
        NEW.commission_rate_bps := (v_commission ->> 'rateBps')::integer;
        NEW.commission_base_amount := (v_commission ->> 'baseAmount')::numeric;
        NEW.commission_config_version := (v_commission ->> 'configVersion')::bigint;
        NEW.commission_fixed_at := now();
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- La comision cobrada es un hecho pasado. Congelarla es lo que garantiza que el desglose
  -- siga cuadrando cuando total_price cambia por un cambio de precio aceptado.
  IF NEW.management_fee IS DISTINCT FROM OLD.management_fee
     OR NEW.management_fee_source IS DISTINCT FROM OLD.management_fee_source THEN
    RAISE EXCEPTION 'Los gastos de gestion de una reserva son inmutables (reserva %).', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.commission_rule IS DISTINCT FROM OLD.commission_rule
     OR NEW.commission_rate_bps IS DISTINCT FROM OLD.commission_rate_bps
     OR NEW.commission_base_amount IS DISTINCT FROM OLD.commission_base_amount
     OR NEW.commission_config_version IS DISTINCT FROM OLD.commission_config_version
     OR NEW.commission_fixed_at IS DISTINCT FROM OLD.commission_fixed_at THEN
    RAISE EXCEPTION 'La comisión aplicada a una reserva es inmutable (reserva %).', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- ── 3) Origen del cliente: se guarda con la primera reserva ──────────────────────────────
CREATE OR REPLACE FUNCTION public.bookings_register_client_provider_relationship()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_origin text;
BEGIN
  IF NEW.client_id IS NULL OR NEW.gardener_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- El origen lo decidió el servidor al firmar el presupuesto (viaja en la economía firmada). Las
  -- reservas creadas por un servidor anterior no lo traen: entonces solo cuenta si salió exenta por
  -- el enlace del profesional.
  v_origin := COALESCE(
    NULLIF(NEW.pricing_context #>> '{quote_economic_snapshot,commission,origin}', ''),
    CASE WHEN NEW.management_fee_source = 'waived_provider_link' THEN 'provider_link' ELSE 'garser' END
  );
  IF v_origin NOT IN ('garser', 'provider_link') THEN
    v_origin := 'garser';
  END IF;

  -- La primera reserva fija el origen; las siguientes no lo cambian (DO NOTHING).
  INSERT INTO public.client_provider_relationships (client_id, provider_id, origin, first_booking_id)
  VALUES (NEW.client_id, NEW.gardener_id, v_origin, NEW.id)
  ON CONFLICT (client_id, provider_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_register_relationship ON public.bookings;
CREATE TRIGGER trg_bookings_register_relationship
  AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_register_client_provider_relationship();

-- ── 4) Comisión de cada reserva: paso 0 = exención (copia de 20261019120000, lista única) ─
CREATE OR REPLACE FUNCTION public.resolve_booking_management_fee(
  p_pricing_context jsonb,
  p_booking_id uuid DEFAULT NULL
)
RETURNS TABLE (fee numeric, source text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt_id uuid;
  v_cents integer;
  v_value numeric;
  v_waiver text;
BEGIN
  -- 1. El intento de pago es la fuente MAS autoritativa: es el importe que realmente se
  --    autorizo en Stripe, tipado como integer NOT NULL CHECK (> 0). Lo que hay en
  --    pricing_context es una copia suya.
  v_attempt_id := NULLIF(BTRIM(COALESCE(p_pricing_context ->> 'payment_attempt_id', '')), '')::uuid;

  IF v_attempt_id IS NOT NULL THEN
    SELECT a.payable_now_amount_cents INTO v_cents
    FROM public.booking_payment_attempts a
    WHERE a.id = v_attempt_id;
  END IF;

  IF v_cents IS NULL AND p_booking_id IS NOT NULL THEN
    SELECT a.payable_now_amount_cents INTO v_cents
    FROM public.booking_payment_attempts a
    WHERE a.booking_id = p_booking_id
    ORDER BY a.confirmed_at DESC NULLS LAST, a.created_at DESC
    LIMIT 1;
  END IF;

  -- 0. Exención de gastos de gestión. Solo cuenta si el presupuesto firmado la lleva Y el intento se
  --    preparó de verdad por 0 €: así una exención nunca puede tapar un cobro real, ni un 0 sin
  --    motivo pasar por exención. Los motivos válidos salen de la lista única fee_waiver_reasons().
  v_waiver := p_pricing_context #>> '{quote_economic_snapshot,feeWaiver,reason}';
  IF v_waiver = ANY (public.fee_waiver_reasons())
     AND COALESCE(v_cents, public.safe_numeric(p_pricing_context ->> 'payable_now_amount_cents'), -1) = 0 THEN
    RETURN QUERY SELECT 0::numeric, ('waived_' || v_waiver)::text;
    RETURN;
  END IF;

  IF v_cents IS NOT NULL AND v_cents > 0 THEN
    RETURN QUERY SELECT ROUND(v_cents::numeric / 100, 2), 'payment_attempt'::text;
    RETURN;
  END IF;

  -- 2. Copia en el contexto de precios (centimos).
  v_value := public.safe_numeric(p_pricing_context ->> 'payable_now_amount_cents');
  IF v_value IS NOT NULL AND v_value > 0 THEN
    RETURN QUERY SELECT ROUND(v_value / 100, 2), 'pricing_context_cents'::text;
    RETURN;
  END IF;

  -- 3/4. Snapshot economico de la cotizacion firmada (euros).
  v_value := public.safe_numeric(p_pricing_context #>> '{quote_economic_snapshot,payableNow}');
  IF v_value IS NOT NULL AND v_value > 0 THEN
    RETURN QUERY SELECT ROUND(v_value, 2), 'quote_snapshot_payable_now'::text;
    RETURN;
  END IF;

  v_value := public.safe_numeric(p_pricing_context #>> '{quote_economic_snapshot,managementFee}');
  IF v_value IS NOT NULL AND v_value > 0 THEN
    RETURN QUERY SELECT ROUND(v_value, 2), 'quote_snapshot_management_fee'::text;
    RETURN;
  END IF;

  -- Sin dato fiable. NO se usa total_price * 0,125 como ultimo recurso: es justo el calculo
  -- que miente en reservas con cambio de precio aceptado. Preferimos degradar honestamente.
  RETURN QUERY SELECT 0::numeric, 'unknown'::text;
END;
$$;

-- ── 5) Planes de mantenimiento ───────────────────────────────────────────────────────────
-- El precio de un plan es fijo (D19). Lo que cambia con la configuración es la comisión de CADA
-- visita, que se fija al proponerla (con la configuración vigente en ese momento) y no se vuelve a
-- tocar aunque el administrador cambie los porcentajes durante las 72 h que el cliente tiene para
-- confirmarla.

-- El plan guarda la economía con la regla de visita aplicada al crearlo (de cara a lo que se enseña);
-- cada visita la recalcula desde el servicio, así que lo que lleve el plan no la condiciona.
-- Copia de 20261019120000 con ese único cambio.
CREATE OR REPLACE FUNCTION public.create_maintenance_plan(p_booking_id uuid, p_frequency text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_quote public.booking_quotes%ROWTYPE;
  v_next date;
  v_plan_id uuid;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR v_booking.client_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Esta reserva no es tuya.';
  END IF;
  IF p_frequency NOT IN ('weekly', 'biweekly', 'monthly') THEN
    RAISE EXCEPTION 'Elige cada semana, cada 2 semanas o cada mes.';
  END IF;
  IF v_booking.status NOT IN ('confirmed', 'completed') THEN
    RAISE EXCEPTION 'Solo se puede hacer un plan a partir de una reserva confirmada o terminada.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.maintenance_plans p WHERE p.source_booking_id = p_booking_id AND p.status = 'active') THEN
    RAISE EXCEPTION 'Ya tienes un plan a partir de esta reserva.';
  END IF;
  SELECT * INTO v_quote FROM public.booking_quotes
  WHERE id::text = v_booking.pricing_context ->> 'quote_id';
  IF NOT FOUND OR v_quote.total_price IS NULL OR v_quote.total_price <= 0 THEN
    RAISE EXCEPTION 'Esta reserva no se puede convertir en plan: no tiene un presupuesto de GarSer.';
  END IF;

  v_next := public.maintenance_next_date(v_booking.date, p_frequency);
  WHILE v_next <= current_date LOOP
    v_next := public.maintenance_next_date(v_next, p_frequency);
  END LOOP;

  INSERT INTO public.maintenance_plans (
    client_id, provider_id, source_booking_id, source_quote_id, frequency, start_hour, anchor_date, next_visit_date,
    service_id, input_payload, items, pricing_snapshot, economic_snapshot, total_price, estimated_hours,
    pricing_version, provider_config_version, client_latitude, client_longitude, provider_latitude, provider_longitude
  ) VALUES (
    v_booking.client_id, v_booking.gardener_id, v_booking.id, v_quote.id, p_frequency,
    EXTRACT(HOUR FROM v_booking.start_time)::integer, v_booking.date, v_next,
    v_quote.service_id, v_quote.input_payload, v_quote.items, v_quote.pricing_snapshot,
    -- Sea cual fuese la comisión de la reserva de origen (12,5 %, la del enlace, ninguna), el plan
    -- guarda la economía con la regla de visita de plan. Cada visita la vuelve a calcular.
    public.apply_commission_to_economics(
      v_quote.economic_snapshot,
      public.resolve_booking_commission(v_booking.client_id, v_booking.gardener_id, NULL, true)
    ),
    v_quote.total_price, v_quote.estimated_hours, v_quote.pricing_version, v_quote.provider_config_version,
    v_quote.client_latitude, v_quote.client_longitude, v_quote.provider_latitude, v_quote.provider_longitude
  ) RETURNING id INTO v_plan_id;

  RETURN jsonb_build_object('planId', v_plan_id, 'frequency', p_frequency, 'nextVisitDate', v_next, 'totalPrice', v_quote.total_price);
END;
$$;

-- Propuestas de visita: la economía de cada una lleva la comisión de visita de plan con la
-- configuración vigente. Copia de 20261019120000 con ese único cambio (el CASE del interruptor).
CREATE OR REPLACE FUNCTION public.generate_maintenance_proposals()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.maintenance_plans%ROWTYPE;
  v_slot record;
  v_visit_id uuid;
  v_quote_id uuid;
  v_start timestamptz;
  v_selected jsonb;
  v_proposed integer := 0;
  v_unavailable integer := 0;
  v_skipped integer := 0;
BEGIN
  -- Propuestas que el cliente no confirmó a tiempo: se saltan (D17).
  WITH gone AS (
    UPDATE public.maintenance_visits v SET status = 'skipped'
    FROM public.booking_quotes q
    WHERE v.status = 'proposed' AND q.id = v.quote_id AND q.booking_id IS NULL
      AND (q.status <> 'active' OR q.expires_at <= now())
    RETURNING v.id
  )
  SELECT count(*) INTO v_skipped FROM gone;

  FOR v_plan IN
    SELECT * FROM public.maintenance_plans
    WHERE status = 'active' AND next_visit_date <= current_date + 7
    ORDER BY next_visit_date
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Una propuesta abierta cada vez por plan.
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.maintenance_visits v WHERE v.plan_id = v_plan.id AND v.status = 'proposed');
    -- Fechas ya pasadas (el reloj estuvo parado): se avanza sin proponer.
    WHILE v_plan.next_visit_date <= current_date LOOP
      v_plan.next_visit_date := public.maintenance_next_date(v_plan.next_visit_date, v_plan.frequency);
    END LOOP;
    CONTINUE WHEN v_plan.next_visit_date > current_date + 7;

    SELECT * INTO v_slot FROM public.maintenance_find_slot(v_plan.id, v_plan.next_visit_date);
    IF v_slot.slot_date IS NULL THEN
      INSERT INTO public.maintenance_visits (plan_id, planned_date, status)
      VALUES (v_plan.id, v_plan.next_visit_date, 'no_availability')
      ON CONFLICT (plan_id, planned_date) DO NOTHING;
      v_unavailable := v_unavailable + 1;
    ELSE
      v_visit_id := NULL;
      INSERT INTO public.maintenance_visits (plan_id, planned_date, date, start_hour, status)
      VALUES (v_plan.id, v_plan.next_visit_date, v_slot.slot_date, v_slot.slot_hour, 'proposed')
      ON CONFLICT (plan_id, planned_date) DO NOTHING
      RETURNING id INTO v_visit_id;
      IF v_visit_id IS NOT NULL THEN
        v_start := (v_slot.slot_date + make_time(v_slot.slot_hour, 0, 0)) AT TIME ZONE 'Europe/Madrid';
        v_selected := jsonb_build_object(
          'date', v_slot.slot_date,
          'startHour', v_slot.slot_hour,
          'startTime', to_char(make_time(v_slot.slot_hour, 0, 0), 'HH24:MI:SS'),
          'endTime', to_char(make_time(LEAST(v_slot.slot_hour + v_slot.first_day_hours, 23), 0, 0), 'HH24:MI:SS'),
          'durationHours', v_slot.first_day_hours,
          'endDate', v_slot.end_date,
          'labourHours', GREATEST(1, CEIL(v_plan.estimated_hours)::integer)
        );
        INSERT INTO public.booking_quotes (
          client_id, gardener_id, service_id, signature, pricing_version, provider_config_version,
          input_payload, pricing_snapshot, total_price, estimated_hours, status, generated_at, expires_at,
          selected_date, selected_start_time, availability_snapshot, economic_snapshot, items,
          client_latitude, client_longitude, provider_latitude, provider_longitude, maintenance_visit_id
        ) VALUES (
          v_plan.client_id, v_plan.provider_id, v_plan.service_id, 'maintenance:' || v_visit_id::text,
          v_plan.pricing_version, v_plan.provider_config_version,
          v_plan.input_payload,
          v_plan.pricing_snapshot || jsonb_build_object('availability', jsonb_build_object('selectedSlot', v_selected), 'maintenancePlanId', v_plan.id),
          v_plan.total_price, v_plan.estimated_hours, 'active', now(),
          -- 72 h para confirmar, y como muy tarde un día antes de la visita.
          LEAST(now() + interval '72 hours', v_start - interval '24 hours'),
          v_slot.slot_date, make_time(v_slot.slot_hour, 0, 0),
          jsonb_build_object('selectedSlot', v_selected, 'requestedDate', v_slot.slot_date),
          -- Comisión de visita de plan, con la configuración de ESTE momento: queda fijada en la
          -- propuesta y es la que se cobra si el cliente la confirma.
          public.apply_commission_to_economics(
            v_plan.economic_snapshot,
            public.resolve_booking_commission(v_plan.client_id, v_plan.provider_id, NULL, true)
          ),
          v_plan.items,
          v_plan.client_latitude, v_plan.client_longitude, v_plan.provider_latitude, v_plan.provider_longitude, v_visit_id
        ) RETURNING id INTO v_quote_id;
        UPDATE public.maintenance_visits SET quote_id = v_quote_id WHERE id = v_visit_id;
        v_proposed := v_proposed + 1;
      END IF;
    END IF;
    UPDATE public.maintenance_plans
    SET next_visit_date = public.maintenance_next_date(v_plan.next_visit_date, v_plan.frequency)
    WHERE id = v_plan.id;
  END LOOP;

  RETURN jsonb_build_object('proposed', v_proposed, 'no_availability', v_unavailable, 'skipped', v_skipped);
END;
$$;

-- La visita que se va a pagar es exactamente la que generó el plan. Copia de 20261019120000 con la
-- comparación de la economía cambiada: ahora la visita lleva la comisión de visita de plan, válida
-- contra el historial, y su economía es la del plan con esa decisión. Las propuestas anteriores a
-- esta serie (sin comisión configurable) siguen valiendo hasta que caducan.
CREATE OR REPLACE FUNCTION public.maintenance_quote_is_intact(p_quote_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.booking_quotes q
    JOIN public.maintenance_visits v ON v.id = q.maintenance_visit_id AND v.quote_id = q.id
    JOIN public.maintenance_plans p ON p.id = v.plan_id
    WHERE q.id = p_quote_id
      AND p.status = 'active'
      AND v.status = 'proposed'
      AND q.client_id = p.client_id
      AND q.gardener_id = p.provider_id
      AND q.service_id = p.service_id
      AND q.total_price = p.total_price
      AND q.estimated_hours = p.estimated_hours
      AND (
        (
          (q.economic_snapshot ? 'commission')
          AND (q.economic_snapshot #>> '{commission,rule}') = 'maintenance_visit'
          AND public.commission_snapshot_problem(q.economic_snapshot) IS NULL
          AND q.economic_snapshot = public.apply_commission_to_economics(p.economic_snapshot, q.economic_snapshot -> 'commission')
        )
        OR (
          NOT (q.economic_snapshot ? 'commission')
          AND (q.economic_snapshot = p.economic_snapshot
               OR q.economic_snapshot = public.waive_quote_economics(p.economic_snapshot, 'maintenance_plan'))
        )
      )
      AND q.items IS NOT DISTINCT FROM p.items
      AND q.input_payload = p.input_payload
      AND (q.pricing_snapshot ->> 'requiresPhytosanitaryLicense') IS NOT DISTINCT FROM (p.pricing_snapshot ->> 'requiresPhytosanitaryLicense')
      AND q.selected_date = v.date
      AND EXTRACT(HOUR FROM q.selected_start_time)::integer = v.start_hour
  );
$$;
