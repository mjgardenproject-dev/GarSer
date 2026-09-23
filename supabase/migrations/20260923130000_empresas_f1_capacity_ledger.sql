-- GarSer Empresas · F1: el registro de capacidad.
--
-- Contexto: docs/garser-empresas/01-PLAN-Y-PROGRESO.md (F1) y 02-HALLAZGOS.md (H-17, H-18).
--
-- booking_blocks(booking_id, date, hour_block) no sabía QUIÉN trabaja cada hora: se deducía de
-- bookings.gardener_id. Sirve mientras el que vende y el que trabaja son la misma persona (el
-- autónomo), pero no puede representar una empresa con varios empleados, dos personas en el
-- mismo trabajo ni un trabajo repartido entre días y personas.
--
-- Esta migración:
--   1) añade booking_blocks.assignee_id (quién trabaja esa hora) y lo rellena con el proveedor
--      de cada reserva — hoy, sin ambigüedad posible, el propio autónomo;
--   2) se DETIENE, sin tocar nada, si hay bloques que no se pueden atribuir o si una misma
--      persona ya tiene una hora vendida dos veces: son datos reales que hay que mirar a mano;
--   3) rellena assignee_id por disparador cuando quien inserta no lo indica, de modo que las
--      cinco funciones que escriben la agenda siguen funcionando sin reescribirse;
--   4) impone UNIQUE (assignee_id, date, hour_block): la misma hora de la misma persona no se
--      puede vender dos veces, por esquema y no por procedimiento;
--   5) H-18 · corrige el `ON CONFLICT DO NOTHING` sin destino de create_atomic_booking,
--      confirm_booking_payment_attempt y resize_booking_schedule. Tal cual, con el índice nuevo
--      se habría tragado el choque y creado la reserva SIN sus horas bloqueadas. Ahora solo se
--      ignora el reintento de la misma reserva (booking_id, date, hour_block) — lo que siempre
--      pretendió — y un choque entre reservas distintas es un error;
--   6) release_booking_schedule libera las horas de quien las trabajaba (assignee_id);
--   7) H-01 · reserve_booking_schedule y resize_booking_schedule deciden si una hora está
--      libre mirando `availability`, como ya hacían la web, el pago y la confirmación. Antes
--      miraban availability_blocks, que solo rellena el generador nocturno: fuera de su
--      ventana, la web ofrecía horas que el jardinero luego no podía aceptar ni alargar.
--      availability_blocks se sigue escribiendo como espejo; deja de decidir.
--
-- Las funciones de 5), 6) y 7) se toman de su definición VIGENTE (pg_get_functiondef) y solo se
-- cambian las líneas señaladas. Sin cambio de comportamiento para el autónomo: verificado con
-- scripts/garser-empresas/verify-f1-schedule.mjs antes y después.

-- =============================================
-- 1) Columna
-- =============================================
ALTER TABLE public.booking_blocks ADD COLUMN IF NOT EXISTS assignee_id uuid;

COMMENT ON COLUMN public.booking_blocks.assignee_id IS
  'Quién trabaja esta hora (auth user id). Autónomo: el propio proveedor (bookings.gardener_id). '
  'Empresa: el empleado asignado. Una hora de una persona solo puede pertenecer a una reserva.';

-- =============================================
-- 2) Comprobaciones previas: si fallan, la migración entera se deshace
-- =============================================
DO $$
DECLARE
  v_orphans integer;
BEGIN
  SELECT count(*) INTO v_orphans
  FROM public.booking_blocks bb
  LEFT JOIN public.bookings b ON b.id = bb.booking_id
  WHERE bb.assignee_id IS NULL
    AND b.gardener_id IS NULL;

  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'F1: % bloque(s) de booking_blocks sin reserva o sin proveedor: no se pueden atribuir a nadie. Revisarlos a mano antes de migrar (docs/garser-empresas/01-PLAN-Y-PROGRESO.md §6).', v_orphans;
  END IF;
END $$;

-- =============================================
-- 3) Relleno
-- =============================================
UPDATE public.booking_blocks bb
SET assignee_id = b.gardener_id
FROM public.bookings b
WHERE b.id = bb.booking_id
  AND bb.assignee_id IS NULL;

DO $$
DECLARE
  v_dupes integer;
BEGIN
  SELECT count(*) INTO v_dupes
  FROM (
    SELECT assignee_id, date, hour_block
    FROM public.booking_blocks
    GROUP BY 1, 2, 3
    HAVING count(*) > 1
  ) d;

  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'F1: % hora(s) ya vendidas dos veces a la misma persona. Son dobles reservas reales: resolverlas a mano antes de migrar (docs/garser-empresas/01-PLAN-Y-PROGRESO.md §6).', v_dupes;
  END IF;
END $$;

-- =============================================
-- 4) Relleno automático al insertar
-- =============================================
-- Quien no indica ejecutante (las cinco funciones actuales) hereda el proveedor de la reserva.
-- La asignación de empleados de empresa (F5) lo indicará explícitamente.
CREATE OR REPLACE FUNCTION public.fill_booking_block_assignee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assignee_id IS NULL THEN
    SELECT b.gardener_id INTO NEW.assignee_id
    FROM public.bookings b
    WHERE b.id = NEW.booking_id;
  END IF;

  IF NEW.assignee_id IS NULL THEN
    RAISE EXCEPTION 'Bloque de agenda sin ejecutante: la reserva % no existe o no tiene proveedor.', NEW.booking_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_booking_block_assignee ON public.booking_blocks;
CREATE TRIGGER trg_fill_booking_block_assignee
  BEFORE INSERT ON public.booking_blocks
  FOR EACH ROW
  EXECUTE FUNCTION public.fill_booking_block_assignee();

-- =============================================
-- 5) Obligatorio y único por persona y hora
-- =============================================
ALTER TABLE public.booking_blocks ALTER COLUMN assignee_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_blocks_assignee_slot
  ON public.booking_blocks (assignee_id, date, hour_block);

-- =============================================
-- 6a) create_atomic_booking — ON CONFLICT con destino (H-18). Sin llamadas hoy; se corrige igual.
-- =============================================
CREATE OR REPLACE FUNCTION public.create_atomic_booking(p_gardener_id uuid, p_service_id uuid, p_date date, p_start_time time without time zone, p_duration_hours integer, p_total_price numeric, p_client_address text, p_booking_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_pricing_context jsonb DEFAULT '{}'::jsonb, p_travel_fee numeric DEFAULT 15, p_hourly_rate numeric DEFAULT 25, p_operation_id uuid DEFAULT NULL::uuid, p_quote_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking_id uuid := COALESCE(p_booking_id, gen_random_uuid());
  v_start_hour integer;
  v_end_hour integer;
  v_payload_signature text;
  v_should_execute boolean;
  v_available_count integer := 0;
  v_expected_count integer := 0;
  v_response jsonb;
  v_quote public.booking_quotes%ROWTYPE;
  v_effective_pricing_context jsonb := COALESCE(p_pricing_context, '{}'::jsonb);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesion para confirmar la reserva.';
  END IF;

  IF p_gardener_id IS NULL OR p_service_id IS NULL OR p_date IS NULL OR p_start_time IS NULL THEN
    RAISE EXCEPTION 'Faltan datos obligatorios para confirmar la reserva.';
  END IF;

  IF p_duration_hours IS NULL OR p_duration_hours < 1 OR p_duration_hours > 12 THEN
    RAISE EXCEPTION 'La duracion de la reserva no es valida.';
  END IF;

  IF p_total_price IS NULL OR p_total_price <= 0 THEN
    RAISE EXCEPTION 'El precio total de la reserva no es valido.';
  END IF;

  IF COALESCE(BTRIM(p_client_address), '') = '' THEN
    RAISE EXCEPTION 'La direccion del cliente es obligatoria.';
  END IF;

  IF p_quote_id IS NULL THEN
    RAISE EXCEPTION 'Debes regenerar el presupuesto antes de confirmar la reserva.';
  END IF;

  SELECT *
  INTO v_quote
  FROM public.booking_quotes
  WHERE id = p_quote_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El presupuesto seleccionado ya no esta disponible.';
  END IF;

  IF v_quote.client_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'El presupuesto no pertenece a la sesion autenticada.';
  END IF;

  IF v_quote.status <> 'active' OR v_quote.expires_at <= now() THEN
    UPDATE public.booking_quotes
    SET status = 'expired'
    WHERE id = p_quote_id
      AND status = 'active';

    RAISE EXCEPTION 'El presupuesto ha expirado. Vuelve a seleccionar el profesional.';
  END IF;

  IF v_quote.selected_date IS NULL OR v_quote.selected_start_time IS NULL THEN
    RAISE EXCEPTION 'Debes regenerar el presupuesto antes de confirmar la reserva.';
  END IF;

  IF v_quote.gardener_id <> p_gardener_id OR v_quote.service_id <> p_service_id THEN
    RAISE EXCEPTION 'El presupuesto no coincide con el jardinero o servicio seleccionados.';
  END IF;

  IF v_quote.selected_date <> p_date THEN
    RAISE EXCEPTION 'La fecha ya no coincide con el presupuesto autorizado.';
  END IF;

  IF v_quote.selected_start_time <> p_start_time THEN
    RAISE EXCEPTION 'La hora ya no coincide con el presupuesto autorizado.';
  END IF;

  IF ROUND(COALESCE(v_quote.total_price, 0)::numeric, 2) <> ROUND(p_total_price::numeric, 2) THEN
    RAISE EXCEPTION 'El precio ya no coincide con el presupuesto autorizado.';
  END IF;

  IF CEIL(COALESCE(v_quote.estimated_hours, 0))::integer <> p_duration_hours THEN
    RAISE EXCEPTION 'La duracion ya no coincide con el presupuesto autorizado.';
  END IF;

  v_effective_pricing_context := v_effective_pricing_context || jsonb_build_object(
    'quote_id', v_quote.id,
    'pricing_version', v_quote.pricing_version,
    'provider_config_version', v_quote.provider_config_version,
    'quote_signature', v_quote.signature,
    'quote_snapshot', v_quote.pricing_snapshot,
    'quote_expires_at', v_quote.expires_at,
    'quote_availability_snapshot', v_quote.availability_snapshot,
    'quote_economic_snapshot', v_quote.economic_snapshot
  );

  v_start_hour := EXTRACT(HOUR FROM p_start_time);
  v_end_hour := v_start_hour + p_duration_hours;

  IF v_start_hour < 0 OR v_end_hour > 20 THEN
    RAISE EXCEPTION 'La franja seleccionada queda fuera del horario permitido.';
  END IF;

  PERFORM public.cleanup_expired_booking_payment_state(ARRAY[p_gardener_id], p_date, p_date);

  IF EXISTS (
    SELECT 1
    FROM public.booking_schedule_hold_blocks hb
    WHERE hb.gardener_id = p_gardener_id
      AND hb.date = p_date
      AND hb.hour_block >= v_start_hour
      AND hb.hour_block < v_end_hour
  ) THEN
    RAISE EXCEPTION 'La franja seleccionada esta temporalmente reservada mientras otro cliente completa el pago.';
  END IF;

  v_payload_signature := format(
    '%s|%s|%s|%s|%s|%s|%s|%s',
    p_gardener_id,
    p_service_id,
    p_date,
    p_start_time,
    p_duration_hours,
    p_total_price,
    md5(COALESCE(p_client_address, '')),
    p_quote_id
  );

  v_should_execute := public.register_booking_operation_once(
    'create_atomic_booking',
    v_booking_id,
    p_operation_id,
    v_payload_signature
  );

  IF NOT v_should_execute THEN
    SELECT response_payload INTO v_response
    FROM public.booking_rpc_idempotency
    WHERE actor_id = auth.uid()
      AND action = 'create_atomic_booking'
      AND operation_id = p_operation_id;

    RETURN COALESCE(v_response, jsonb_build_object('booking_id', v_booking_id, 'status', 'pending'));
  END IF;

  PERFORM 1
  FROM public.availability
  WHERE gardener_id = p_gardener_id
    AND date = p_date
    AND is_available = true
    AND EXTRACT(HOUR FROM start_time) >= v_start_hour
    AND EXTRACT(HOUR FROM start_time) < v_end_hour
  FOR UPDATE;

  SELECT COUNT(*)
  INTO v_available_count
  FROM public.availability
  WHERE gardener_id = p_gardener_id
    AND date = p_date
    AND is_available = true
    AND EXTRACT(HOUR FROM start_time) >= v_start_hour
    AND EXTRACT(HOUR FROM start_time) < v_end_hour;

  v_expected_count := p_duration_hours;

  IF v_available_count <> v_expected_count THEN
    RAISE EXCEPTION 'La franja seleccionada ya no esta disponible.';
  END IF;

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
    pricing_context
  ) VALUES (
    v_booking_id,
    auth.uid(),
    p_gardener_id,
    p_service_id,
    p_date,
    p_start_time,
    p_duration_hours,
    'pending',
    p_total_price,
    COALESCE(p_travel_fee, 15),
    COALESCE(p_hourly_rate, 25),
    p_client_address,
    p_notes,
    v_effective_pricing_context
  );

  INSERT INTO public.booking_blocks (booking_id, date, hour_block)
  SELECT v_booking_id, p_date, hour_block
  FROM generate_series(v_start_hour, v_end_hour - 1) AS hour_block
  ON CONFLICT (booking_id, date, hour_block) DO NOTHING;

  UPDATE public.availability
  SET is_available = false
  WHERE gardener_id = p_gardener_id
    AND date = p_date
    AND EXTRACT(HOUR FROM start_time) >= v_start_hour
    AND EXTRACT(HOUR FROM start_time) < v_end_hour;

  UPDATE public.availability_blocks
  SET is_available = false
  WHERE gardener_id = p_gardener_id
    AND date = p_date
    AND hour_block >= v_start_hour
    AND hour_block < v_end_hour;

  UPDATE public.booking_quotes
  SET status = 'consumed',
      consumed_at = now(),
      booking_id = v_booking_id
  WHERE id = p_quote_id;

  v_response := jsonb_build_object(
    'booking_id', v_booking_id,
    'status', 'pending',
    'date', p_date,
    'start_time', p_start_time,
    'duration_hours', p_duration_hours,
    'quote_id', p_quote_id
  );

  PERFORM public.complete_booking_operation('create_atomic_booking', p_operation_id, v_response);
  RETURN v_response;
END;
$function$;

-- =============================================
-- 6b) confirm_booking_payment_attempt — ON CONFLICT con destino (H-18). Es el camino de TODAS las reservas pagadas.
-- =============================================
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
    v_attempt.selected_date,
    v_attempt.selected_date
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

  PERFORM 1
  FROM public.availability
  WHERE gardener_id = v_attempt.gardener_id
    AND date = v_attempt.selected_date
    AND is_available = true
    AND EXTRACT(HOUR FROM start_time) >= v_start_hour
    AND EXTRACT(HOUR FROM start_time) < v_end_hour
  FOR UPDATE;

  v_available_count := public.count_distinct_available_legacy_hours(
    v_attempt.gardener_id,
    v_attempt.selected_date,
    v_start_hour,
    v_end_hour
  );

  IF v_available_count <> v_attempt.duration_hours THEN
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
    WHERE hb.gardener_id = v_attempt.gardener_id
      AND hb.date = v_attempt.selected_date
      AND hb.hour_block >= v_start_hour
      AND hb.hour_block < v_end_hour
      AND hb.hold_id <> v_hold.id
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
    'payment_gateway_source', 'stripe_elements'
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
      pricing_context
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
      v_pricing_context
    );

    INSERT INTO public.booking_blocks (booking_id, date, hour_block)
    SELECT v_booking_id, v_attempt.selected_date, hour_block
    FROM generate_series(v_start_hour, v_end_hour - 1) AS hour_block
    ON CONFLICT (booking_id, date, hour_block) DO NOTHING;

    UPDATE public.availability
    SET is_available = false
    WHERE gardener_id = v_attempt.gardener_id
      AND date = v_attempt.selected_date
      AND EXTRACT(HOUR FROM start_time) >= v_start_hour
      AND EXTRACT(HOUR FROM start_time) < v_end_hour;

    UPDATE public.availability_blocks
    SET is_available = false
    WHERE gardener_id = v_attempt.gardener_id
      AND date = v_attempt.selected_date
      AND hour_block >= v_start_hour
      AND hour_block < v_end_hour;

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

-- =============================================
-- 6c) resize_booking_schedule — ON CONFLICT con destino (H-18).
-- =============================================
CREATE OR REPLACE FUNCTION public.resize_booking_schedule(p_booking_id uuid, p_new_duration_hours integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_start_hour int;
  v_old_end_hour int;
  v_new_end_hour int;
  v_free_count int;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF p_new_duration_hours IS NULL OR p_new_duration_hours < 1 THEN
    RAISE EXCEPTION 'La duración debe ser de al menos 1 hora.' USING ERRCODE = '22023';
  END IF;

  v_start_hour := EXTRACT(HOUR FROM v_booking.start_time)::int;
  v_old_end_hour := v_start_hour + GREATEST(COALESCE(v_booking.duration_hours, 1), 1);
  v_new_end_hour := v_start_hour + p_new_duration_hours;

  IF v_new_end_hour > v_old_end_hour THEN
    -- Alargar: las horas de más, [v_old_end_hour, v_new_end_hour), tienen que estar libres.
    -- F1 (GarSer Empresas, H-01): se comprueban en `availability`, la MISMA fuente y con el
    -- MISMO criterio que usan la web (booking-authority), el pago y
    -- confirm_booking_payment_attempt. Antes se miraba availability_blocks, que solo rellena
    -- el generador nocturno: en un día sin esas filas el cliente veía la hora libre y el
    -- jardinero no podía alargar («no tiene libres las horas»). availability_blocks se sigue
    -- escribiendo abajo como espejo, pero ya no decide.
    PERFORM 1
    FROM public.availability
    WHERE gardener_id = v_booking.gardener_id
      AND date = v_booking.date
      AND is_available = true
      AND EXTRACT(HOUR FROM start_time) >= v_old_end_hour
      AND EXTRACT(HOUR FROM start_time) < v_new_end_hour
    FOR UPDATE;

    v_free_count := public.count_distinct_available_legacy_hours(
      v_booking.gardener_id, v_booking.date, v_old_end_hour, v_new_end_hour
    );

    IF v_free_count <> (v_new_end_hour - v_old_end_hour) THEN
      RAISE EXCEPTION 'El profesional ya no tiene libres las horas necesarias para alargar el servicio.'
        USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO public.booking_blocks (booking_id, date, hour_block)
    SELECT p_booking_id, v_booking.date, hour_block
    FROM generate_series(v_old_end_hour, v_new_end_hour - 1) AS hour_block
    ON CONFLICT (booking_id, date, hour_block) DO NOTHING;

    UPDATE public.availability_blocks
    SET is_available = false
    WHERE gardener_id = v_booking.gardener_id
      AND date = v_booking.date
      AND hour_block >= v_old_end_hour
      AND hour_block < v_new_end_hour;

    UPDATE public.availability
    SET is_available = false
    WHERE gardener_id = v_booking.gardener_id
      AND date = v_booking.date
      AND EXTRACT(HOUR FROM start_time) >= v_old_end_hour
      AND EXTRACT(HOUR FROM start_time) < v_new_end_hour;

  ELSIF v_new_end_hour < v_old_end_hour THEN
    -- Acortar: libera [v_new_end_hour, v_old_end_hour) en las tres tablas.
    DELETE FROM public.booking_blocks
    WHERE booking_id = p_booking_id
      AND hour_block >= v_new_end_hour
      AND hour_block < v_old_end_hour;

    UPDATE public.availability_blocks
    SET is_available = true
    WHERE gardener_id = v_booking.gardener_id
      AND date = v_booking.date
      AND hour_block >= v_new_end_hour
      AND hour_block < v_old_end_hour;

    UPDATE public.availability
    SET is_available = true
    WHERE gardener_id = v_booking.gardener_id
      AND date = v_booking.date
      AND EXTRACT(HOUR FROM start_time) >= v_new_end_hour
      AND EXTRACT(HOUR FROM start_time) < v_old_end_hour;
  END IF;
  -- v_new_end_hour = v_old_end_hour: nada que mover en la agenda.

  UPDATE public.bookings
  SET duration_hours = p_new_duration_hours
  WHERE id = p_booking_id;
  -- end_time se recalcula solo: trigger_calculate_end_time (20250929000002) ya existente.
END;
$function$;

-- =============================================
-- 7) release_booking_schedule — libera las horas de quien las trabajaba.
-- =============================================
CREATE OR REPLACE FUNCTION public.release_booking_schedule(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking public.bookings%ROWTYPE;
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- F1 (GarSer Empresas): se liberan las horas de QUIEN las trabajaba (bb.assignee_id), no
  -- las del proveedor. Para un autónomo son la misma persona; en una empresa, no.
  UPDATE public.availability_blocks ab
  SET is_available = true
  FROM public.booking_blocks bb
  WHERE bb.booking_id = p_booking_id
    AND ab.gardener_id = bb.assignee_id
    AND ab.date = bb.date
    AND ab.hour_block = bb.hour_block;

  UPDATE public.availability a
  SET is_available = true
  FROM public.booking_blocks bb
  WHERE bb.booking_id = p_booking_id
    AND a.gardener_id = bb.assignee_id
    AND a.date = bb.date
    AND EXTRACT(HOUR FROM a.start_time) = bb.hour_block;

  DELETE FROM public.booking_blocks
  WHERE booking_id = p_booking_id;
END;
$function$;

-- =============================================
-- 8) reserve_booking_schedule — comprueba la franja en `availability` (H-01).
-- =============================================
CREATE OR REPLACE FUNCTION public.reserve_booking_schedule(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_start_hour integer;
  v_end_hour integer;
  v_available_count integer := 0;
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_blocks
    WHERE booking_id = p_booking_id
  ) THEN
    RETURN;
  END IF;

  v_start_hour := EXTRACT(HOUR FROM v_booking.start_time);
  v_end_hour := v_start_hour + v_booking.duration_hours;

  -- F1 (GarSer Empresas, H-01): la franja se comprueba en `availability`, la misma fuente y
  -- con el mismo criterio que la web, el pago y confirm_booking_payment_attempt. Antes se
  -- miraba availability_blocks (solo la rellena el generador nocturno): el jardinero podía no
  -- poder aceptar una hora que la web ofrecía como libre. El espejo se sigue escribiendo.
  PERFORM 1
  FROM public.availability
  WHERE gardener_id = v_booking.gardener_id
    AND date = v_booking.date
    AND is_available = true
    AND EXTRACT(HOUR FROM start_time) >= v_start_hour
    AND EXTRACT(HOUR FROM start_time) < v_end_hour
  FOR UPDATE;

  v_available_count := public.count_distinct_available_legacy_hours(
    v_booking.gardener_id, v_booking.date, v_start_hour, v_end_hour
  );

  IF v_available_count <> v_booking.duration_hours THEN
    RAISE EXCEPTION 'La franja seleccionada ya no está disponible.';
  END IF;

  INSERT INTO public.booking_blocks (booking_id, date, hour_block)
  SELECT p_booking_id, v_booking.date, hour_block
  FROM generate_series(v_start_hour, v_end_hour - 1) AS hour_block;

  UPDATE public.availability_blocks
  SET is_available = false
  WHERE gardener_id = v_booking.gardener_id
    AND date = v_booking.date
    AND hour_block >= v_start_hour
    AND hour_block < v_end_hour;

  UPDATE public.availability
  SET is_available = false
  WHERE gardener_id = v_booking.gardener_id
    AND date = v_booking.date
    AND EXTRACT(HOUR FROM start_time) >= v_start_hour
    AND EXTRACT(HOUR FROM start_time) < v_end_hour;
END;
$function$;
