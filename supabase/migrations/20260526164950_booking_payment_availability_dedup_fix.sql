CREATE OR REPLACE FUNCTION public.count_distinct_available_legacy_hours(
  p_gardener_id uuid,
  p_date date,
  p_start_hour integer,
  p_end_hour integer
)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(COUNT(DISTINCT EXTRACT(HOUR FROM a.start_time)::integer), 0)::integer
  FROM public.availability a
  WHERE a.gardener_id = p_gardener_id
    AND a.date = p_date
    AND a.is_available = true
    AND EXTRACT(HOUR FROM a.start_time) >= p_start_hour
    AND EXTRACT(HOUR FROM a.start_time) < p_end_hour;
$$;

WITH ranked AS (
  SELECT
    a.ctid,
    a.gardener_id,
    a.date,
    a.start_time,
    COALESCE(
      ab.is_available,
      BOOL_OR(a.is_available) OVER (
        PARTITION BY a.gardener_id, a.date, a.start_time
      )
    ) AS resolved_is_available,
    COALESCE(
      MAX(a.end_time) OVER (
        PARTITION BY a.gardener_id, a.date, a.start_time
      ),
      (a.start_time + interval '1 hour')::time
    ) AS resolved_end_time,
    ROW_NUMBER() OVER (
      PARTITION BY a.gardener_id, a.date, a.start_time
      ORDER BY
        CASE
          WHEN ab.is_available IS NOT NULL AND a.is_available = ab.is_available THEN 0
          ELSE 1
        END,
        a.is_available DESC,
        a.end_time DESC,
        a.ctid
    ) AS rn
  FROM public.availability a
  LEFT JOIN public.availability_blocks ab
    ON ab.gardener_id = a.gardener_id
   AND ab.date = a.date
   AND ab.hour_block = EXTRACT(HOUR FROM a.start_time)::integer
)
UPDATE public.availability a
SET is_available = ranked.resolved_is_available,
    end_time = ranked.resolved_end_time
FROM ranked
WHERE a.ctid = ranked.ctid
  AND ranked.rn = 1;

WITH ranked AS (
  SELECT
    a.ctid,
    ROW_NUMBER() OVER (
      PARTITION BY a.gardener_id, a.date, a.start_time
      ORDER BY
        CASE
          WHEN ab.is_available IS NOT NULL AND a.is_available = ab.is_available THEN 0
          ELSE 1
        END,
        a.is_available DESC,
        a.end_time DESC,
        a.ctid
    ) AS rn
  FROM public.availability a
  LEFT JOIN public.availability_blocks ab
    ON ab.gardener_id = a.gardener_id
   AND ab.date = a.date
   AND ab.hour_block = EXTRACT(HOUR FROM a.start_time)::integer
)
DELETE FROM public.availability a
USING ranked
WHERE a.ctid = ranked.ctid
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_availability_unique_slot
  ON public.availability(gardener_id, date, start_time);

INSERT INTO public.availability (
  gardener_id,
  date,
  start_time,
  end_time,
  is_available
)
SELECT
  ab.gardener_id,
  ab.date,
  make_time(ab.hour_block, 0, 0),
  (make_time(ab.hour_block, 0, 0) + interval '1 hour')::time,
  ab.is_available
FROM public.availability_blocks ab
ON CONFLICT (gardener_id, date, start_time) DO UPDATE
SET end_time = EXCLUDED.end_time,
    is_available = EXCLUDED.is_available;

CREATE OR REPLACE FUNCTION public.prepare_booking_payment_attempt_for_client(
  p_quote_id uuid,
  p_client_id uuid,
  p_hold_ttl_minutes integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  v_duration_hours := GREATEST(1, CEIL(COALESCE(v_quote.estimated_hours, 1))::integer);

  IF v_payable_now_cents <= 0 THEN
    RAISE EXCEPTION 'El presupuesto no tiene un importe pendiente valido para Stripe.';
  END IF;

  PERFORM public.cleanup_expired_booking_payment_state(
    ARRAY[v_quote.gardener_id],
    v_quote.selected_date,
    v_quote.selected_date
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
  v_end_hour := v_start_hour + v_duration_hours;
  IF v_start_hour < 0 OR v_end_hour > 20 THEN
    RAISE EXCEPTION 'La franja seleccionada queda fuera del horario permitido.';
  END IF;

  PERFORM 1
  FROM public.availability
  WHERE gardener_id = v_quote.gardener_id
    AND date = v_quote.selected_date
    AND is_available = true
    AND EXTRACT(HOUR FROM start_time) >= v_start_hour
    AND EXTRACT(HOUR FROM start_time) < v_end_hour
  FOR UPDATE;

  v_available_count := public.count_distinct_available_legacy_hours(
    v_quote.gardener_id,
    v_quote.selected_date,
    v_start_hour,
    v_end_hour
  );

  IF v_available_count <> v_duration_hours THEN
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
    expires_at
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
    v_expires_at
  )
  RETURNING id INTO v_hold_id;

  INSERT INTO public.booking_schedule_hold_blocks (hold_id, gardener_id, date, hour_block)
  SELECT v_hold_id, v_quote.gardener_id, v_quote.selected_date, hour_block
  FROM generate_series(v_start_hour, v_end_hour - 1) AS hour_block
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_inserted_blocks = ROW_COUNT;

  IF v_inserted_blocks <> v_duration_hours THEN
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
$$;

DROP FUNCTION IF EXISTS public.prepare_booking_payment_attempt(uuid, integer);
CREATE OR REPLACE FUNCTION public.prepare_booking_payment_attempt(
  p_quote_id uuid,
  p_hold_ttl_minutes integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.prepare_booking_payment_attempt_for_client(
    p_quote_id,
    auth.uid(),
    p_hold_ttl_minutes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_booking_payment_attempt(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_booking_payment_attempt(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_booking_payment_attempt(uuid, integer) TO service_role;

DROP FUNCTION IF EXISTS public.confirm_booking_payment_attempt(uuid, text, text, text, integer, text, jsonb);
CREATE OR REPLACE FUNCTION public.confirm_booking_payment_attempt(
  p_attempt_id uuid,
  p_stripe_event_id text,
  p_stripe_payment_intent_id text,
  p_amount_total_cents integer,
  p_currency text DEFAULT 'eur',
  p_gateway_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    ON CONFLICT DO NOTHING;

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
$$;

CREATE OR REPLACE FUNCTION public.generate_recurring_slots(
  target_gardener_id uuid,
  force_regenerate boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  setting RECORD;
  rule RECORD;
  current_date_val date := CURRENT_DATE;
  start_date date;
  end_date date;
  iter_date date;
  day_idx integer;
  h integer;
  start_h integer;
  end_h integer;
BEGIN
  SELECT *
  INTO setting
  FROM public.recurring_availability_settings
  WHERE gardener_id = target_gardener_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  end_date := current_date_val + (setting.weeks_to_maintain * 7);

  IF force_regenerate THEN
    start_date := current_date_val;

    DELETE FROM public.availability
    WHERE gardener_id = target_gardener_id
      AND date >= start_date;

    DELETE FROM public.availability_blocks
    WHERE gardener_id = target_gardener_id
      AND date >= start_date;
  ELSE
    IF setting.last_generated_date IS NULL THEN
      start_date := current_date_val;
    ELSE
      start_date := GREATEST(current_date_val, setting.last_generated_date + 1);
    END IF;
  END IF;

  IF start_date > end_date THEN
    RETURN;
  END IF;

  iter_date := start_date;
  WHILE iter_date <= end_date LOOP
    day_idx := EXTRACT(DOW FROM iter_date);

    FOR rule IN
      SELECT *
      FROM public.recurring_schedules
      WHERE gardener_id = target_gardener_id
        AND day_of_week = day_idx
    LOOP
      start_h := EXTRACT(HOUR FROM rule.start_time);
      end_h := EXTRACT(HOUR FROM rule.end_time);

      FOR h IN start_h .. (end_h - 1) LOOP
        INSERT INTO public.availability_blocks (
          gardener_id,
          date,
          hour_block,
          is_available
        ) VALUES (
          target_gardener_id,
          iter_date,
          h,
          true
        )
        ON CONFLICT (gardener_id, date, hour_block) DO UPDATE
        SET is_available = EXCLUDED.is_available,
            updated_at = now();

        INSERT INTO public.availability (
          gardener_id,
          date,
          start_time,
          end_time,
          is_available
        ) VALUES (
          target_gardener_id,
          iter_date,
          make_time(h, 0, 0),
          (make_time(h, 0, 0) + interval '1 hour')::time,
          true
        )
        ON CONFLICT (gardener_id, date, start_time) DO UPDATE
        SET end_time = EXCLUDED.end_time,
            is_available = EXCLUDED.is_available;
      END LOOP;
    END LOOP;

    iter_date := iter_date + 1;
  END LOOP;

  UPDATE public.recurring_availability_settings
  SET last_generated_date = end_date
  WHERE gardener_id = target_gardener_id;
END;
$$;
