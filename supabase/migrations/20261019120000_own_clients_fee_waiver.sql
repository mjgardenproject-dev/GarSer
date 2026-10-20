-- Lanzamiento (2026-10): sin gastos de gestión para los clientes propios del profesional.
--
-- Modelo (decisión del dueño, prometido en /para-jardineros):
--   · Sin gastos: reservas desde el enlace del profesional (/reservar/<id>), clientes con al menos
--     una reserva COMPLETADA con ese profesional y todas las visitas de los planes de mantenimiento.
--   · Con gastos (12,5 %, como hasta ahora): los clientes que trae GarSer.
--   · Un interruptor en Ajustes del admin (app_settings.own_clients_fee_waiver_enabled) lo activa.
--     Se despliega APAGADO: con él apagado nada cambia. Apagarlo es la vuelta atrás.
--
-- Dónde se decide: booking-authority, al firmar el presupuesto (create_quote), con
-- management_fee_waiver_reason(). La economía firmada (booking_quotes.economic_snapshot) lleva
-- entonces managementFee = payableNow = 0 y feeWaiver = { reason, waivedFee }. A partir de ahí todo
-- lee esa economía: el intento se prepara por 0 €, la reserva se crea sin pasar por Stripe
-- (payment_gateway_source = 'none') y su management_fee queda en 0 con fuente 'waived_<motivo>'.
--
-- Garantías:
--   · Un 0 € sin motivo de exención sigue siendo imposible: lo impiden prepare y el CHECK de la tabla
--     de intentos.
--   · Una exención solo se reconoce si el importe es realmente 0 (no puede tapar un cobro).
--   · Los presupuestos ya firmados se respetan hasta que caducan; el interruptor afecta a los nuevos.
--   · Las funciones copiadas lo son de su última definición, con el mínimo cambio marcado en cada una.

-- ── 1) Interruptor del lanzamiento ─────────────────────────────────────────────────────
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS own_clients_fee_waiver_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.app_settings.own_clients_fee_waiver_enabled IS
  'Lanzamiento: sin gastos de gestión para los clientes propios (enlace del profesional, clientes que repiten) y las visitas de los planes. Lo cambia el admin en Ajustes.';

CREATE OR REPLACE FUNCTION public.own_clients_fee_waiver_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT s.own_clients_fee_waiver_enabled FROM public.app_settings s WHERE s.id = 1), false);
$$;

-- ── 2) La exención sobre una economía de presupuesto (espejo de applyManagementFeeWaiver en
--       src/shared/bookingQuoteCore.ts: misma forma exacta) ─────────────────────────────────

-- ¿Esta economía va sin gastos de gestión con un motivo válido? (la usa también el CHECK de la
-- tabla de intentos, por eso es IMMUTABLE y no depende de nada más).
CREATE OR REPLACE FUNCTION public.quote_economics_fee_waived(p_economics jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(p_economics) = 'object'
    AND (p_economics #>> '{feeWaiver,reason}') IN ('provider_link', 'returning_client', 'maintenance_plan')
    AND COALESCE(p_economics ->> 'managementFee', '') ~ '^0+(\.0+)?$'
    AND COALESCE(p_economics ->> 'payableNow', '') ~ '^0+(\.0+)?$',
    false
  );
$$;

-- Quita los gastos de gestión de una economía: comisión y pago ahora a 0, sin línea de comisión ni
-- cargo de Stripe, y feeWaiver = { reason, waivedFee } con la comisión perdonada (para poder
-- deshacerla). Idempotente: si ya estaba exenta, conserva la comisión perdonada original.
CREATE OR REPLACE FUNCTION public.waive_quote_economics(p_economics jsonb, p_reason text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_economics IS NULL OR jsonb_typeof(p_economics) <> 'object' THEN p_economics
    ELSE p_economics || jsonb_build_object(
      'managementFee', 0,
      'payableNow', 0,
      'stripeLineItems', '[]'::jsonb,
      'lines', COALESCE((
        SELECT jsonb_agg(l ORDER BY o)
        FROM jsonb_array_elements(COALESCE(p_economics -> 'lines', '[]'::jsonb)) WITH ORDINALITY AS t(l, o)
        WHERE (l ->> 'code') IS DISTINCT FROM 'management_fee'
      ), '[]'::jsonb),
      'feeWaiver', jsonb_build_object(
        'reason', p_reason,
        'waivedFee', COALESCE(p_economics #> '{feeWaiver,waivedFee}', p_economics -> 'managementFee', '0'::jsonb)
      )
    )
  END;
$$;

-- Lo contrario: devuelve la economía completa (con la comisión perdonada). Si no estaba exenta, la
-- devuelve tal cual. La línea de comisión vuelve al final, como la construye el motor.
CREATE OR REPLACE FUNCTION public.unwaive_quote_economics(p_economics jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_economics IS NULL OR jsonb_typeof(p_economics) <> 'object' OR NOT (p_economics ? 'feeWaiver') THEN p_economics
    ELSE (p_economics - 'feeWaiver') || jsonb_build_object(
      'managementFee', p_economics #> '{feeWaiver,waivedFee}',
      'payableNow', p_economics #> '{feeWaiver,waivedFee}',
      'lines', COALESCE(p_economics -> 'lines', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'code', 'management_fee',
        'label', 'Gastos de gestión',
        'amount', p_economics #> '{feeWaiver,waivedFee}',
        'kind', 'fee'
      )),
      'stripeLineItems', CASE
        WHEN COALESCE((p_economics #>> '{feeWaiver,waivedFee}')::numeric, 0) > 0 THEN jsonb_build_array(jsonb_build_object(
          'code', 'management_fee',
          'label', 'Gastos de gestión',
          'unitAmount', p_economics #> '{feeWaiver,waivedFee}',
          'quantity', 1
        ))
        ELSE '[]'::jsonb
      END
    )
  END;
$$;

-- ── 3) La regla: ¿este cliente, con este profesional, va sin gastos? ───────────────────
-- NULL = paga gastos de gestión. La llama booking-authority (con la clave de servicio) al firmar el
-- presupuesto. El origen «enlace» lo declara la web: el enlace es público y no hay forma de
-- probarlo (decisión de modelo); solo vale para el profesional del propio presupuesto.
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
  IF p_provider_id IS NULL OR NOT public.own_clients_fee_waiver_enabled() THEN
    RETURN NULL;
  END IF;
  IF p_claimed_origin = 'provider_link' THEN
    RETURN 'provider_link';
  END IF;
  -- Cliente que repite: al menos una reserva COMPLETADA con este profesional (en una empresa, el
  -- profesional de la reserva es la cuenta de la empresa). Cancelada o solo aceptada no cuenta.
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
REVOKE ALL ON FUNCTION public.management_fee_waiver_reason(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.management_fee_waiver_reason(uuid, uuid, text) TO service_role;

-- ── 4) Restricciones ───────────────────────────────────────────────────────────────────
-- Intentos de pago: antes, > 0 siempre. Ahora 0 solo si su economía lleva una exención válida.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.booking_payment_attempts'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ~ 'payable_now_amount_cents > 0'
  LOOP
    EXECUTE format('ALTER TABLE public.booking_payment_attempts DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.booking_payment_attempts
  ADD CONSTRAINT booking_payment_attempts_payable_now_check CHECK (
    payable_now_amount_cents > 0
    OR (payable_now_amount_cents = 0 AND public.quote_economics_fee_waived(economic_snapshot))
  );

-- Reservas: tres fuentes nuevas para la comisión exenta (siempre con importe 0).
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
      'waived_maintenance_plan'
    )
  );

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_waived_fee_is_zero,
  ADD CONSTRAINT bookings_waived_fee_is_zero CHECK (
    management_fee_source NOT LIKE 'waived\_%' OR management_fee = 0
  );

-- ── 5) Comisión de cada reserva: paso 0 = exención (copia de 20260803120000 + ese paso) ──

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

  -- 0. Exención de gastos de gestión (lanzamiento, 2026-10). Solo cuenta si el presupuesto
  --    firmado la lleva Y el intento se preparó de verdad por 0 €: así una exención nunca puede
  --    tapar un cobro real, ni un 0 sin motivo pasar por exención.
  v_waiver := p_pricing_context #>> '{quote_economic_snapshot,feeWaiver,reason}';
  IF v_waiver IN ('provider_link', 'returning_client', 'maintenance_plan')
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

-- ── 6) Preparar el intento: acepta 0 € solo con exención (copia de F8 + esa comprobación) ──

CREATE OR REPLACE FUNCTION public.prepare_booking_payment_attempt_for_client(p_quote_id uuid, p_client_id uuid, p_hold_ttl_minutes integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_quote public.booking_quotes%ROWTYPE;
  v_existing_attempt public.booking_payment_attempts%ROWTYPE;
  v_new_attempt public.booking_payment_attempts%ROWTYPE;
  v_payable_now numeric;
  v_payable_now_cents integer;
  v_service_total_cents integer;
  v_duration_hours integer;
  v_start_hour integer;
  v_end_hour integer;
  v_available_count integer := 0;
  v_hold_id uuid;
  v_expires_at timestamptz;
  v_inserted_blocks integer := 0;
  v_effective_client_id uuid := p_client_id;
  v_worker uuid;
  v_workers uuid[];
  v_requires_license boolean;
  v_labour integer;
  v_end_date date;
  v_cells integer;
  v_cell_dates date[];
  v_cell_hours integer[];
  v_cell_workers uuid[];
  v_extra_services uuid[] := '{}';
BEGIN
  IF v_effective_client_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesion para iniciar el pago.';
  END IF;

  SELECT *
  INTO v_quote
  FROM public.booking_quotes
  WHERE id = p_quote_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El presupuesto seleccionado ya no esta disponible.';
  END IF;

  IF v_quote.client_id IS DISTINCT FROM v_effective_client_id THEN
    RAISE EXCEPTION 'El presupuesto no pertenece a la sesion autenticada.';
  END IF;

  IF v_quote.booking_id IS NOT NULL THEN
    SELECT *
    INTO v_existing_attempt
    FROM public.booking_payment_attempts
    WHERE quote_id = p_quote_id
      AND booking_id = v_quote.booking_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND THEN
      RETURN public.get_booking_payment_attempt_summary(v_existing_attempt.id);
    END IF;
  END IF;

  IF v_quote.status <> 'active' OR v_quote.expires_at <= now() THEN
    UPDATE public.booking_quotes
    SET status = 'expired'
    WHERE id = p_quote_id
      AND status = 'active';

    RAISE EXCEPTION 'El presupuesto ha expirado. Vuelve a seleccionar el profesional.';
  END IF;

  IF v_quote.selected_date IS NULL OR v_quote.selected_start_time IS NULL THEN
    RAISE EXCEPTION 'Debes regenerar el presupuesto antes de iniciar el checkout.';
  END IF;

  v_payable_now := ROUND(COALESCE((v_quote.economic_snapshot ->> 'payableNow')::numeric, 0), 2);
  v_payable_now_cents := ROUND(v_payable_now * 100)::integer;
  v_service_total_cents := ROUND(COALESCE(v_quote.total_price, 0)::numeric * 100)::integer;
  -- F7: las horas del presupuesto son horas de TRABAJO (L); cuánto dura cada día lo decide
  -- el planificador.
  v_labour := GREATEST(1, CEIL(COALESCE(v_quote.estimated_hours, 1))::integer);

  -- F8: varios servicios. El primero es el del presupuesto, cada uno una vez, y sus precios y
  -- horas suman el total (lo que se cobra y lo que se planifica).
  IF v_quote.items IS NOT NULL THEN
    IF jsonb_typeof(v_quote.items) <> 'array' OR jsonb_array_length(v_quote.items) < 1
       OR (v_quote.items -> 0 ->> 'serviceId')::uuid IS DISTINCT FROM v_quote.service_id
       OR (SELECT count(DISTINCT x ->> 'serviceId') FROM jsonb_array_elements(v_quote.items) x) <> jsonb_array_length(v_quote.items)
       OR ROUND((SELECT SUM((x ->> 'totalPrice')::numeric) FROM jsonb_array_elements(v_quote.items) x), 2) <> ROUND(v_quote.total_price, 2)
       OR ROUND((SELECT SUM((x ->> 'estimatedHours')::numeric) FROM jsonb_array_elements(v_quote.items) x), 2) <> ROUND(v_quote.estimated_hours, 2) THEN
      RAISE EXCEPTION 'El presupuesto de varios servicios no es coherente. Vuelve a seleccionar el profesional.';
    END IF;
    SELECT COALESCE(array_agg((x ->> 'serviceId')::uuid ORDER BY o), '{}') INTO v_extra_services
    FROM jsonb_array_elements(v_quote.items) WITH ORDINALITY AS t(x, o) WHERE o > 1;
  END IF;

  -- Exención de gastos de gestión (lanzamiento, 2026-10): 0 € SOLO si el presupuesto firmado
  -- lleva un motivo válido con comisión 0. Un 0 sin motivo sigue siendo un error, como antes.
  IF v_payable_now_cents < 0
     OR (v_payable_now_cents = 0 AND NOT public.quote_economics_fee_waived(v_quote.economic_snapshot)) THEN
    RAISE EXCEPTION 'El presupuesto no tiene un importe pendiente valido para Stripe.';
  END IF;

  PERFORM public.cleanup_expired_booking_payment_state(
    ARRAY[v_quote.gardener_id],
    v_quote.selected_date - 20,
    v_quote.selected_date + 20
  );

  SELECT *
  INTO v_existing_attempt
  FROM public.booking_payment_attempts
  WHERE quote_id = p_quote_id
    AND client_id = v_effective_client_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_attempt.booking_id IS NOT NULL OR v_existing_attempt.status = 'booking_created' THEN
      RETURN public.get_booking_payment_attempt_summary(v_existing_attempt.id);
    END IF;

    IF v_existing_attempt.status IN ('created', 'payment_pending', 'processing')
      AND COALESCE(v_existing_attempt.payment_expires_at, now() + interval '1 second') > now()
      AND EXISTS (
        SELECT 1
        FROM public.booking_schedule_holds h
        WHERE h.payment_attempt_id = v_existing_attempt.id
          AND h.status = 'active'
          AND h.expires_at > now()
      ) THEN
      RETURN public.get_booking_payment_attempt_summary(v_existing_attempt.id);
    END IF;

    IF v_existing_attempt.status IN ('created', 'payment_pending', 'processing') THEN
      PERFORM public.release_booking_payment_attempt(
        v_existing_attempt.id,
        'expired',
        'stale_attempt_replaced',
        v_existing_attempt.stripe_payment_intent_id,
        jsonb_build_object('replaced_at', now())
      );
    END IF;
  END IF;

  v_start_hour := EXTRACT(HOUR FROM v_quote.selected_start_time);
  IF v_start_hour < 0 OR v_start_hour > 19 THEN
    RAISE EXCEPTION 'La franja seleccionada queda fuera del horario permitido.';
  END IF;

  -- F7 (GarSer Empresas): quién hace cada hora de cada día lo decide el planificador, la misma
  -- regla que usa la web para ofrecer la hora: una persona (F4), un equipo (D11), por turnos
  -- (D10) o varios días (D12, D13). Sin plan, la franja ya no está disponible.
  v_requires_license := COALESCE((v_quote.pricing_snapshot ->> 'requiresPhytosanitaryLicense')::boolean, false);
  SELECT array_agg(c.date ORDER BY c.date, c.hour_block, c.worker_id),
         array_agg(c.hour_block ORDER BY c.date, c.hour_block, c.worker_id),
         array_agg(c.worker_id ORDER BY c.date, c.hour_block, c.worker_id)
  INTO v_cell_dates, v_cell_hours, v_cell_workers
  FROM public.plan_booking_cells(
    v_quote.gardener_id, v_quote.service_id, v_quote.selected_date, v_start_hour, v_labour, v_requires_license,
    NULL, v_extra_services
  ) AS c;
  IF v_cell_workers IS NULL THEN
    RAISE EXCEPTION 'La franja seleccionada ya no esta disponible para iniciar el pago.';
  END IF;
  v_cells := array_length(v_cell_workers, 1);
  v_worker := v_cell_workers[1];
  -- duration_hours = lo que dura el primer día (≤ 12). end_date = el último día, si hay más.
  SELECT MAX(c.h) + 1 - v_start_hour INTO v_duration_hours
  FROM unnest(v_cell_dates, v_cell_hours) AS c(d, h) WHERE c.d = v_quote.selected_date;
  SELECT NULLIF(MAX(d), v_quote.selected_date) INTO v_end_date FROM unnest(v_cell_dates) AS d;

  PERFORM 1
  FROM public.availability a
  JOIN unnest(v_cell_dates, v_cell_hours, v_cell_workers) AS c(d, h, w)
    ON a.gardener_id = c.w AND a.date = c.d AND EXTRACT(HOUR FROM a.start_time) = c.h
  WHERE a.is_available = true
  FOR UPDATE OF a;

  SELECT count(*)::integer INTO v_available_count
  FROM unnest(v_cell_dates, v_cell_hours, v_cell_workers) AS c(d, h, w)
  WHERE EXISTS (
    SELECT 1 FROM public.availability a
    WHERE a.gardener_id = c.w AND a.date = c.d AND a.is_available = true
      AND EXTRACT(HOUR FROM a.start_time) = c.h
  );

  IF v_available_count <> v_cells THEN
    RAISE EXCEPTION 'La franja seleccionada ya no esta disponible para iniciar el pago.';
  END IF;

  v_expires_at := now() + make_interval(mins => GREATEST(1, COALESCE(p_hold_ttl_minutes, 30)));

  INSERT INTO public.booking_payment_attempts (
    client_id,
    gardener_id,
    service_id,
    quote_id,
    quote_signature,
    selected_date,
    selected_start_time,
    duration_hours,
    labour_hours,
    end_date,
    currency,
    service_total_amount_cents,
    payable_now_amount_cents,
    status,
    stripe_idempotency_key,
    payment_expires_at,
    pricing_snapshot,
    availability_snapshot,
    economic_snapshot,
    metadata_snapshot,
    gateway_response
  ) VALUES (
    v_effective_client_id,
    v_quote.gardener_id,
    v_quote.service_id,
    v_quote.id,
    v_quote.signature,
    v_quote.selected_date,
    v_quote.selected_start_time,
    v_duration_hours,
    v_labour,
    v_end_date,
    lower(COALESCE(v_quote.economic_snapshot ->> 'currency', 'eur')),
    v_service_total_cents,
    v_payable_now_cents,
    'created',
    gen_random_uuid()::text,
    v_expires_at,
    v_quote.pricing_snapshot,
    v_quote.availability_snapshot,
    v_quote.economic_snapshot,
    jsonb_build_object(
      'pricing_version', v_quote.pricing_version,
      'provider_config_version', v_quote.provider_config_version,
      'selected_date', v_quote.selected_date,
      'selected_start_time', v_quote.selected_start_time
    ),
    '{}'::jsonb
  )
  RETURNING * INTO v_new_attempt;

  INSERT INTO public.booking_schedule_holds (
    payment_attempt_id,
    client_id,
    gardener_id,
    service_id,
    quote_id,
    selected_date,
    selected_start_time,
    duration_hours,
    status,
    expires_at,
    assignee_id
  ) VALUES (
    v_new_attempt.id,
    v_effective_client_id,
    v_quote.gardener_id,
    v_quote.service_id,
    v_quote.id,
    v_quote.selected_date,
    v_quote.selected_start_time,
    v_duration_hours,
    'active',
    v_expires_at,
    v_worker
  )
  RETURNING id INTO v_hold_id;

  INSERT INTO public.booking_schedule_hold_blocks (hold_id, gardener_id, date, hour_block)
  SELECT v_hold_id, c.w, c.d, c.h
  FROM unnest(v_cell_dates, v_cell_hours, v_cell_workers) AS c(d, h, w)
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_inserted_blocks = ROW_COUNT;

  IF v_inserted_blocks <> v_cells THEN
    DELETE FROM public.booking_schedule_hold_blocks WHERE hold_id = v_hold_id;
    UPDATE public.booking_schedule_holds
    SET status = 'released',
        release_reason = 'slot_already_held',
        released_at = now(),
        updated_at = now()
    WHERE id = v_hold_id;

    UPDATE public.booking_payment_attempts
    SET status = 'failed',
        last_error_code = 'slot_already_held',
        last_error_message = 'La franja seleccionada esta temporalmente bloqueada mientras otro cliente completa el pago.',
        failed_at = now(),
        updated_at = now()
    WHERE id = v_new_attempt.id;

    RAISE EXCEPTION 'La franja seleccionada esta temporalmente bloqueada mientras otro cliente completa el pago.';
  END IF;

  RETURN public.get_booking_payment_attempt_summary(v_new_attempt.id);
END;
$function$;

-- ── 7) Crear la reserva: sin gastos, sin pasarela (copia de F8 + payment_gateway_source) ──

CREATE OR REPLACE FUNCTION public.confirm_booking_payment_attempt(p_attempt_id uuid, p_stripe_event_id text, p_stripe_payment_intent_id text, p_amount_total_cents integer, p_currency text DEFAULT 'eur'::text, p_gateway_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_attempt public.booking_payment_attempts%ROWTYPE;
  v_hold public.booking_schedule_holds%ROWTYPE;
  v_quote public.booking_quotes%ROWTYPE;
  v_booking_id uuid := gen_random_uuid();
  v_start_hour integer;
  v_end_hour integer;
  v_available_count integer := 0;
  v_client_address text;
  v_notes text;
  v_pricing_context jsonb;
  v_confirmation_failure_code text;
  v_confirmation_failure_message text;
  v_confirmation_error_sqlstate text;
  v_confirmation_error_message text;
  v_confirmation_error_detail text;
  v_confirmation_error_hint text;
  v_confirmation_error_context text;
  v_worker uuid;
  v_workers uuid[];
  v_assignment_pending boolean;
  v_cells integer;
  v_cell_dates date[];
  v_cell_hours integer[];
  v_cell_workers uuid[];
BEGIN
  SELECT *
  INTO v_attempt
  FROM public.booking_payment_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Intento de pago no encontrado.';
  END IF;

  IF v_attempt.booking_id IS NOT NULL OR v_attempt.status = 'booking_created' THEN
    RETURN public.get_booking_payment_attempt_summary(v_attempt.id);
  END IF;

  IF v_attempt.status = 'reconciliation_required' THEN
    RETURN public.get_booking_payment_attempt_summary(v_attempt.id);
  END IF;

  PERFORM public.cleanup_expired_booking_payment_state(
    ARRAY[v_attempt.gardener_id],
    v_attempt.selected_date - 20,
    v_attempt.selected_date + 20
  );

  IF p_amount_total_cents <> v_attempt.payable_now_amount_cents THEN
    PERFORM public.release_booking_payment_attempt(
      v_attempt.id,
      'reconciliation_required',
      'amount_mismatch',
      p_stripe_payment_intent_id,
      COALESCE(p_gateway_payload, '{}'::jsonb)
    );
    RETURN public.get_booking_payment_attempt_summary(v_attempt.id);
  END IF;

  IF lower(COALESCE(p_currency, 'eur')) <> lower(COALESCE(v_attempt.currency, 'eur')) THEN
    PERFORM public.release_booking_payment_attempt(
      v_attempt.id,
      'reconciliation_required',
      'currency_mismatch',
      p_stripe_payment_intent_id,
      COALESCE(p_gateway_payload, '{}'::jsonb)
    );
    RETURN public.get_booking_payment_attempt_summary(v_attempt.id);
  END IF;

  UPDATE public.booking_payment_attempts
  SET status = 'processing',
      stripe_payment_intent_id = COALESCE(NULLIF(BTRIM(COALESCE(p_stripe_payment_intent_id, '')), ''), stripe_payment_intent_id),
      last_webhook_event_id = COALESCE(NULLIF(BTRIM(COALESCE(p_stripe_event_id, '')), ''), last_webhook_event_id),
      gateway_response = CASE
        WHEN COALESCE(p_gateway_payload, '{}'::jsonb) = '{}'::jsonb THEN gateway_response
        ELSE gateway_response || p_gateway_payload
      END,
      updated_at = now()
  WHERE id = v_attempt.id;

  SELECT *
  INTO v_hold
  FROM public.booking_schedule_holds
  WHERE payment_attempt_id = v_attempt.id
  FOR UPDATE;

  IF NOT FOUND OR v_hold.status <> 'active' OR v_hold.expires_at <= now() THEN
    PERFORM public.release_booking_payment_attempt(
      v_attempt.id,
      'reconciliation_required',
      'hold_unavailable_after_payment',
      p_stripe_payment_intent_id,
      COALESCE(p_gateway_payload, '{}'::jsonb)
    );
    RETURN public.get_booking_payment_attempt_summary(v_attempt.id);
  END IF;

  SELECT *
  INTO v_quote
  FROM public.booking_quotes
  WHERE id = v_attempt.quote_id
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.release_booking_payment_attempt(
      v_attempt.id,
      'reconciliation_required',
      'quote_missing_after_payment',
      p_stripe_payment_intent_id,
      COALESCE(p_gateway_payload, '{}'::jsonb)
    );
    RETURN public.get_booking_payment_attempt_summary(v_attempt.id);
  END IF;

  IF v_quote.booking_id IS NOT NULL THEN
    DELETE FROM public.booking_schedule_hold_blocks WHERE hold_id = v_hold.id;

    UPDATE public.booking_schedule_holds
    SET status = 'consumed',
        booking_id = v_quote.booking_id,
        release_reason = 'booking_already_created',
        released_at = COALESCE(released_at, now()),
        updated_at = now()
    WHERE id = v_hold.id;

    UPDATE public.booking_payment_attempts
    SET status = 'booking_created',
        booking_id = v_quote.booking_id,
        confirmed_at = COALESCE(confirmed_at, now()),
        updated_at = now()
    WHERE id = v_attempt.id;

    RETURN public.get_booking_payment_attempt_summary(v_attempt.id);
  END IF;

  v_start_hour := EXTRACT(HOUR FROM v_attempt.selected_start_time);
  v_end_hour := v_start_hour + v_attempt.duration_hours;

  -- F4 (GarSer Empresas): la persona apartada al pagar. Los intentos anteriores a F4 no la
  -- tienen: entonces es el proveedor, como siempre ha sido para un autónomo.
  v_worker := COALESCE(v_hold.assignee_id, v_attempt.gardener_id);
  -- Empresa en modo «yo elijo quién va»: la persona es una propuesta que el dueño confirma.
  v_assignment_pending := EXISTS (
    SELECT 1 FROM public.companies co
    WHERE co.provider_user_id = v_attempt.gardener_id AND co.assignment_mode = 'manual'
  );

  -- F7 (GarSer Empresas): quién hace cada hora de cada día sale del bloqueo del pago (lo que
  -- decidió el planificador). Sin ese detalle (intentos antiguos): la de siempre, un día.
  SELECT array_agg(hb.date ORDER BY hb.date, hb.hour_block, hb.gardener_id),
         array_agg(hb.hour_block ORDER BY hb.date, hb.hour_block, hb.gardener_id),
         array_agg(hb.gardener_id ORDER BY hb.date, hb.hour_block, hb.gardener_id)
  INTO v_cell_dates, v_cell_hours, v_cell_workers
  FROM public.booking_schedule_hold_blocks hb
  WHERE hb.hold_id = v_hold.id;
  IF v_cell_workers IS NULL THEN
    SELECT array_agg(v_attempt.selected_date), array_agg(g ORDER BY g), array_agg(v_worker)
    INTO v_cell_dates, v_cell_hours, v_cell_workers
    FROM generate_series(v_start_hour, v_end_hour - 1) AS g;
  END IF;
  v_cells := array_length(v_cell_workers, 1);

  PERFORM 1
  FROM public.availability a
  JOIN unnest(v_cell_dates, v_cell_hours, v_cell_workers) AS c(d, h, w)
    ON a.gardener_id = c.w AND a.date = c.d AND EXTRACT(HOUR FROM a.start_time) = c.h
  WHERE a.is_available = true
  FOR UPDATE OF a;

  SELECT count(*)::integer INTO v_available_count
  FROM unnest(v_cell_dates, v_cell_hours, v_cell_workers) AS c(d, h, w)
  WHERE EXISTS (
    SELECT 1 FROM public.availability a
    WHERE a.gardener_id = c.w AND a.date = c.d AND a.is_available = true
      AND EXTRACT(HOUR FROM a.start_time) = c.h
  );

  IF v_available_count <> v_cells THEN
    PERFORM public.release_booking_payment_attempt(
      v_attempt.id,
      'reconciliation_required',
      'availability_conflict_after_payment',
      p_stripe_payment_intent_id,
      COALESCE(p_gateway_payload, '{}'::jsonb)
    );
    RETURN public.get_booking_payment_attempt_summary(v_attempt.id);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_schedule_hold_blocks hb
    JOIN unnest(v_cell_dates, v_cell_hours, v_cell_workers) AS c(d, h, w)
      ON hb.gardener_id = c.w AND hb.date = c.d AND hb.hour_block = c.h
    WHERE hb.hold_id <> v_hold.id
  ) THEN
    PERFORM public.release_booking_payment_attempt(
      v_attempt.id,
      'reconciliation_required',
      'conflicting_hold_after_payment',
      p_stripe_payment_intent_id,
      COALESCE(p_gateway_payload, '{}'::jsonb)
    );
    RETURN public.get_booking_payment_attempt_summary(v_attempt.id);
  END IF;

  v_client_address := NULLIF(BTRIM(COALESCE(v_quote.input_payload ->> 'address', '')), '');
  v_notes := NULLIF(BTRIM(COALESCE(v_quote.input_payload ->> 'description', '')), '');

  IF v_client_address IS NULL THEN
    PERFORM public.release_booking_payment_attempt(
      v_attempt.id,
      'reconciliation_required',
      'missing_client_address',
      p_stripe_payment_intent_id,
      COALESCE(p_gateway_payload, '{}'::jsonb)
    );
    RETURN public.get_booking_payment_attempt_summary(v_attempt.id);
  END IF;

  v_pricing_context := jsonb_build_object(
    'quote_id', v_quote.id,
    'pricing_version', v_quote.pricing_version,
    'provider_config_version', v_quote.provider_config_version,
    'quote_signature', v_quote.signature,
    'quote_snapshot', v_quote.pricing_snapshot,
    'quote_expires_at', v_quote.expires_at,
    'quote_availability_snapshot', v_quote.availability_snapshot,
    'quote_economic_snapshot', v_quote.economic_snapshot,
    'payment_attempt_id', v_attempt.id,
    'payment_currency', v_attempt.currency,
    'payable_now_amount_cents', v_attempt.payable_now_amount_cents,
    'payment_intent_id', COALESCE(NULLIF(BTRIM(COALESCE(p_stripe_payment_intent_id, '')), ''), v_attempt.stripe_payment_intent_id),
    'payment_last_webhook_event_id', NULLIF(BTRIM(COALESCE(p_stripe_event_id, '')), ''),
    -- Sin gastos de gestión (exención del lanzamiento) no hay pasarela: la reserva no pasa por Stripe.
    'payment_gateway_source', CASE WHEN v_attempt.payable_now_amount_cents = 0 THEN 'none' ELSE 'stripe_elements' END
  );

  BEGIN
    INSERT INTO public.bookings (
      id,
      client_id,
      gardener_id,
      service_id,
      date,
      start_time,
      duration_hours,
      status,
      total_price,
      travel_fee,
      hourly_rate,
      client_address,
      notes,
      pricing_context,
      assignment_pending,
      end_date,
      labour_hours
    ) VALUES (
      v_booking_id,
      v_attempt.client_id,
      v_attempt.gardener_id,
      v_attempt.service_id,
      v_attempt.selected_date,
      v_attempt.selected_start_time,
      v_attempt.duration_hours,
      'pending',
      ROUND(v_attempt.service_total_amount_cents::numeric / 100, 2),
      15,
      25,
      v_client_address,
      v_notes,
      v_pricing_context,
      v_assignment_pending,
      v_attempt.end_date,
      -- Solo en trabajos de equipo o de varios días (en los demás, las horas son la duración).
      CASE WHEN v_attempt.end_date IS NOT NULL OR COALESCE(v_attempt.labour_hours, v_attempt.duration_hours) <> v_attempt.duration_hours
           THEN v_attempt.labour_hours END
    );

    -- F8: los servicios de la reserva (uno, si el presupuesto es de un servicio).
    IF v_quote.items IS NOT NULL THEN
      INSERT INTO public.booking_items (booking_id, position, service_id, input_payload, breakdown, total_price, labour_hours, requires_license)
      SELECT v_booking_id, t.o::smallint, (t.x ->> 'serviceId')::uuid,
             COALESCE(t.x -> 'inputPayload', '{}'::jsonb), COALESCE(t.x -> 'breakdown', '[]'::jsonb),
             ROUND((t.x ->> 'totalPrice')::numeric, 2), (t.x ->> 'estimatedHours')::numeric,
             COALESCE((t.x ->> 'requiresLicense')::boolean, false)
      FROM jsonb_array_elements(v_quote.items) WITH ORDINALITY AS t(x, o);
    ELSE
      INSERT INTO public.booking_items (booking_id, position, service_id, input_payload, breakdown, total_price, labour_hours, requires_license)
      VALUES (
        v_booking_id, 1, v_quote.service_id, COALESCE(v_quote.input_payload, '{}'::jsonb),
        COALESCE(v_quote.pricing_snapshot -> 'breakdown', '[]'::jsonb), ROUND(v_quote.total_price, 2),
        GREATEST(COALESCE(v_quote.estimated_hours, 1), 0.01),
        COALESCE((v_quote.pricing_snapshot ->> 'requiresPhytosanitaryLicense')::boolean, false)
      );
    END IF;

    INSERT INTO public.booking_blocks (booking_id, date, hour_block, assignee_id)
    SELECT v_booking_id, c.d, c.h, c.w
    FROM unnest(v_cell_dates, v_cell_hours, v_cell_workers) AS c(d, h, w)
    ON CONFLICT (booking_id, date, hour_block, assignee_id) DO NOTHING;

    UPDATE public.availability a
    SET is_available = false
    FROM unnest(v_cell_dates, v_cell_hours, v_cell_workers) AS c(d, h, w)
    WHERE a.gardener_id = c.w
      AND a.date = c.d
      AND EXTRACT(HOUR FROM a.start_time) = c.h;

    UPDATE public.availability_blocks ab
    SET is_available = false
    FROM unnest(v_cell_dates, v_cell_hours, v_cell_workers) AS c(d, h, w)
    WHERE ab.gardener_id = c.w
      AND ab.date = c.d
      AND ab.hour_block = c.h;

    DELETE FROM public.booking_schedule_hold_blocks
    WHERE hold_id = v_hold.id;

    UPDATE public.booking_schedule_holds
    SET status = 'consumed',
        booking_id = v_booking_id,
        release_reason = 'booking_created',
        released_at = COALESCE(released_at, now()),
        updated_at = now()
    WHERE id = v_hold.id;

    UPDATE public.booking_quotes
    SET status = 'consumed',
        consumed_at = now(),
        booking_id = v_booking_id
    WHERE id = v_quote.id;

    UPDATE public.booking_payment_attempts
    SET status = 'booking_created',
        stripe_payment_intent_id = COALESCE(NULLIF(BTRIM(COALESCE(p_stripe_payment_intent_id, '')), ''), stripe_payment_intent_id),
        booking_id = v_booking_id,
        confirmed_at = COALESCE(confirmed_at, now()),
        last_webhook_event_id = COALESCE(NULLIF(BTRIM(COALESCE(p_stripe_event_id, '')), ''), last_webhook_event_id),
        gateway_response = CASE
          WHEN COALESCE(p_gateway_payload, '{}'::jsonb) = '{}'::jsonb THEN gateway_response
          ELSE gateway_response || p_gateway_payload
        END,
        updated_at = now()
    WHERE id = v_attempt.id;
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_confirmation_error_sqlstate = RETURNED_SQLSTATE,
        v_confirmation_error_message = MESSAGE_TEXT,
        v_confirmation_error_detail = PG_EXCEPTION_DETAIL,
        v_confirmation_error_hint = PG_EXCEPTION_HINT,
        v_confirmation_error_context = PG_EXCEPTION_CONTEXT;

      v_confirmation_failure_code := CASE
        WHEN v_confirmation_error_sqlstate = '23505' THEN 'booking_creation_duplicate'
        WHEN v_confirmation_error_sqlstate = '23503' THEN 'booking_creation_reference_error'
        ELSE 'booking_creation_failed'
      END;
      v_confirmation_failure_message := COALESCE(
        NULLIF(BTRIM(v_confirmation_error_message), ''),
        'No se pudo materializar la reserva tras confirmar el pago.'
      );

      PERFORM public.release_booking_payment_attempt(
        v_attempt.id,
        'reconciliation_required',
        v_confirmation_failure_code,
        p_stripe_payment_intent_id,
        COALESCE(p_gateway_payload, '{}'::jsonb) || jsonb_build_object(
          'confirmation_error_sqlstate', v_confirmation_error_sqlstate,
          'confirmation_error_message', v_confirmation_error_message,
          'confirmation_error_detail', v_confirmation_error_detail,
          'confirmation_error_hint', v_confirmation_error_hint,
          'confirmation_error_context', v_confirmation_error_context
        )
      );

      UPDATE public.booking_payment_attempts
      SET last_error_code = v_confirmation_failure_code,
          last_error_message = v_confirmation_failure_message,
          updated_at = now()
      WHERE id = v_attempt.id;

      RETURN public.get_booking_payment_attempt_summary(v_attempt.id);
  END;

  RETURN public.get_booking_payment_attempt_summary(v_attempt.id);
END;
$function$;

-- ── 8) Planes: el plan guarda la economía completa (copia de F9 + unwaive) ──

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
    -- El plan guarda SIEMPRE la economía completa: si la reserva de origen iba sin gastos (por el
    -- enlace, por ejemplo), se recupera la comisión perdonada. La exención de cada visita la
    -- decide el interruptor al generar la propuesta, no el origen del plan.
    public.unwaive_quote_economics(v_quote.economic_snapshot),
    v_quote.total_price, v_quote.estimated_hours, v_quote.pricing_version, v_quote.provider_config_version,
    v_quote.client_latitude, v_quote.client_longitude, v_quote.provider_latitude, v_quote.provider_longitude
  ) RETURNING id INTO v_plan_id;

  RETURN jsonb_build_object('planId', v_plan_id, 'frequency', p_frequency, 'nextVisitDate', v_next, 'totalPrice', v_quote.total_price);
END;
$$;

-- ── 9) Propuestas de visita: sin gastos con el interruptor encendido (copia de F9 + CASE) ──

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
          -- Lanzamiento: con el interruptor encendido, las visitas de los planes van sin gastos de gestión.
          CASE WHEN public.own_clients_fee_waiver_enabled()
            THEN public.waive_quote_economics(v_plan.economic_snapshot, 'maintenance_plan')
            ELSE v_plan.economic_snapshot END,
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

-- ── 10) Visita intacta: admite la versión sin gastos (copia de F9 + OR) ──

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
      -- La de la visita es la del plan, o la misma sin gastos de gestión (exención del lanzamiento).
      AND (q.economic_snapshot = p.economic_snapshot
           OR q.economic_snapshot = public.waive_quote_economics(p.economic_snapshot, 'maintenance_plan'))
      AND q.items IS NOT DISTINCT FROM p.items
      AND q.input_payload = p.input_payload
      AND (q.pricing_snapshot ->> 'requiresPhytosanitaryLicense') IS NOT DISTINCT FROM (p.pricing_snapshot ->> 'requiresPhytosanitaryLicense')
      AND q.selected_date = v.date
      AND EXTRACT(HOUR FROM q.selected_start_time)::integer = v.start_hour
  );
$$;
