DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'booking_payment_attempts'
      AND column_name = 'checkout_expires_at'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'booking_payment_attempts'
      AND column_name = 'payment_expires_at'
  ) THEN
    ALTER TABLE public.booking_payment_attempts
      RENAME COLUMN checkout_expires_at TO payment_expires_at;
  END IF;
END
$$;

ALTER TABLE public.booking_payment_attempts
  DROP CONSTRAINT IF EXISTS booking_payment_attempts_status_check;

ALTER TABLE public.booking_payment_attempts
  ADD CONSTRAINT booking_payment_attempts_status_check CHECK (
    status IN (
      'created',
      'payment_pending',
      'processing',
      'booking_created',
      'cancelled',
      'failed',
      'expired',
      'reconciliation_required'
    )
  );

ALTER TABLE public.booking_payment_attempts
  DROP COLUMN IF EXISTS checkout_url;

ALTER TABLE public.booking_payment_attempts
  DROP COLUMN IF EXISTS stripe_checkout_session_id;

DROP FUNCTION IF EXISTS public.release_booking_payment_attempt(uuid, text, text, text, text, jsonb);
CREATE OR REPLACE FUNCTION public.release_booking_payment_attempt(
  p_attempt_id uuid,
  p_next_status text,
  p_reason text DEFAULT NULL,
  p_stripe_payment_intent_id text DEFAULT NULL,
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
  v_effective_reason text := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
BEGIN
  IF p_next_status NOT IN ('cancelled', 'failed', 'expired', 'reconciliation_required') THEN
    RAISE EXCEPTION 'Estado terminal no soportado para liberar el intento de pago.';
  END IF;

  SELECT *
  INTO v_attempt
  FROM public.booking_payment_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Intento de pago no encontrado.';
  END IF;

  IF v_attempt.status = 'booking_created' OR v_attempt.booking_id IS NOT NULL THEN
    RETURN public.get_booking_payment_attempt_summary(v_attempt.id);
  END IF;

  SELECT *
  INTO v_hold
  FROM public.booking_schedule_holds
  WHERE payment_attempt_id = p_attempt_id
  FOR UPDATE;

  IF FOUND AND v_hold.status = 'active' THEN
    DELETE FROM public.booking_schedule_hold_blocks
    WHERE hold_id = v_hold.id;

    UPDATE public.booking_schedule_holds
    SET status = CASE WHEN p_next_status = 'expired' THEN 'expired' ELSE 'released' END,
        release_reason = COALESCE(v_effective_reason, release_reason, p_next_status),
        released_at = COALESCE(released_at, now()),
        updated_at = now()
    WHERE id = v_hold.id;
  END IF;

  UPDATE public.booking_payment_attempts
  SET status = p_next_status,
      stripe_payment_intent_id = COALESCE(NULLIF(BTRIM(COALESCE(p_stripe_payment_intent_id, '')), ''), stripe_payment_intent_id),
      gateway_response = CASE
        WHEN COALESCE(p_gateway_payload, '{}'::jsonb) = '{}'::jsonb THEN gateway_response
        ELSE gateway_response || p_gateway_payload
      END,
      last_error_code = COALESCE(v_effective_reason, last_error_code, p_next_status),
      last_error_message = CASE
        WHEN p_next_status = 'cancelled' THEN COALESCE(last_error_message, 'El pago se ha cancelado antes de completarse.')
        WHEN p_next_status = 'expired' THEN COALESCE(last_error_message, 'El tiempo del pago ha expirado. Puedes reintentarlo.')
        WHEN p_next_status = 'reconciliation_required' THEN COALESCE(last_error_message, 'El pago necesita revision manual antes de consolidar la reserva.')
        ELSE COALESCE(last_error_message, 'No se pudo completar el pago. Puedes reintentarlo.')
      END,
      cancelled_at = CASE WHEN p_next_status = 'cancelled' THEN COALESCE(cancelled_at, now()) ELSE cancelled_at END,
      failed_at = CASE WHEN p_next_status IN ('failed', 'reconciliation_required') THEN COALESCE(failed_at, now()) ELSE failed_at END,
      expired_at = CASE WHEN p_next_status = 'expired' THEN COALESCE(expired_at, now()) ELSE expired_at END,
      updated_at = now()
  WHERE id = p_attempt_id;

  RETURN public.get_booking_payment_attempt_summary(p_attempt_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_booking_payment_attempt_summary(
  p_attempt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.booking_payment_attempts%ROWTYPE;
  v_hold public.booking_schedule_holds%ROWTYPE;
BEGIN
  SELECT *
  INTO v_attempt
  FROM public.booking_payment_attempts
  WHERE id = p_attempt_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_hold
  FROM public.booking_schedule_holds
  WHERE payment_attempt_id = p_attempt_id
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'attemptId', v_attempt.id,
    'quoteId', v_attempt.quote_id,
    'status', v_attempt.status,
    'currency', v_attempt.currency,
    'payableNowAmountCents', v_attempt.payable_now_amount_cents,
    'serviceTotalAmountCents', v_attempt.service_total_amount_cents,
    'paymentIntentId', v_attempt.stripe_payment_intent_id,
    'paymentExpiresAt', v_attempt.payment_expires_at,
    'holdExpiresAt', CASE WHEN v_hold.status = 'active' THEN v_hold.expires_at ELSE NULL END,
    'bookingId', COALESCE(v_attempt.booking_id, v_hold.booking_id),
    'retryable', v_attempt.status IN ('cancelled', 'failed', 'expired'),
    'terminal', v_attempt.status IN ('booking_created', 'cancelled', 'failed', 'expired', 'reconciliation_required'),
    'lastErrorCode', v_attempt.last_error_code,
    'lastErrorMessage', v_attempt.last_error_message
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_expired_booking_payment_state(
  p_gardener_ids uuid[] DEFAULT NULL,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hold_ids uuid[];
  v_attempt_ids uuid[];
  v_scoped_count integer := 0;
BEGIN
  SELECT COALESCE(array_agg(id), '{}'::uuid[]), COALESCE(array_agg(payment_attempt_id), '{}'::uuid[])
  INTO v_hold_ids, v_attempt_ids
  FROM public.booking_schedule_holds
  WHERE status = 'active'
    AND expires_at <= now()
    AND (p_gardener_ids IS NULL OR gardener_id = ANY(p_gardener_ids))
    AND (p_start_date IS NULL OR selected_date >= p_start_date)
    AND (p_end_date IS NULL OR selected_date <= p_end_date);

  v_scoped_count := COALESCE(array_length(v_hold_ids, 1), 0);
  IF v_scoped_count = 0 THEN
    RETURN jsonb_build_object('expired_holds', 0, 'expired_attempts', 0);
  END IF;

  DELETE FROM public.booking_schedule_hold_blocks
  WHERE hold_id = ANY(v_hold_ids);

  UPDATE public.booking_schedule_holds
  SET status = 'expired',
      release_reason = COALESCE(release_reason, 'payment_expired'),
      released_at = COALESCE(released_at, now()),
      updated_at = now()
  WHERE id = ANY(v_hold_ids)
    AND status = 'active';

  UPDATE public.booking_payment_attempts
  SET status = 'expired',
      expired_at = COALESCE(expired_at, now()),
      last_error_code = COALESCE(last_error_code, 'payment_expired'),
      last_error_message = COALESCE(last_error_message, 'El tiempo del pago ha expirado. Puedes reintentarlo.'),
      updated_at = now()
  WHERE id = ANY(v_attempt_ids)
    AND status IN ('created', 'payment_pending', 'processing');

  RETURN jsonb_build_object(
    'expired_holds', v_scoped_count,
    'expired_attempts', COALESCE(array_length(v_attempt_ids, 1), 0)
  );
END;
$$;

DROP FUNCTION IF EXISTS public.prepare_booking_payment_attempt_for_client(uuid, uuid, integer);
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
    RAISE EXCEPTION 'Debes regenerar el presupuesto antes de iniciar el pago.';
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

  SELECT COUNT(*)
  INTO v_available_count
  FROM public.availability
  WHERE gardener_id = v_quote.gardener_id
    AND date = v_quote.selected_date
    AND is_available = true
    AND EXTRACT(HOUR FROM start_time) >= v_start_hour
    AND EXTRACT(HOUR FROM start_time) < v_end_hour;

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

  SELECT COUNT(*)
  INTO v_available_count
  FROM public.availability
  WHERE gardener_id = v_attempt.gardener_id
    AND date = v_attempt.selected_date
    AND is_available = true
    AND EXTRACT(HOUR FROM start_time) >= v_start_hour
    AND EXTRACT(HOUR FROM start_time) < v_end_hour;

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

      IF v_confirmation_error_sqlstate = '42501' THEN
        v_confirmation_failure_code := 'post_payment_confirmation_security_error';
        v_confirmation_failure_message := 'El pago ya esta cobrado, pero la reserva no pudo consolidarse por un fallo de permisos o configuracion. Requiere conciliacion manual.';
      ELSIF v_confirmation_error_sqlstate IN ('23502', '23503', '23505', '23514', '23P01', 'P0001') THEN
        v_confirmation_failure_code := 'post_payment_confirmation_booking_write_error';
        v_confirmation_failure_message := 'El pago ya esta cobrado, pero la reserva no pudo consolidarse por un conflicto interno al escribir la reserva. Requiere conciliacion manual.';
      ELSE
        v_confirmation_failure_code := 'post_payment_confirmation_infrastructure_error';
        v_confirmation_failure_message := 'El pago ya esta cobrado, pero la confirmacion backend ha fallado por un error tecnico interno. Requiere conciliacion manual.';
      END IF;

      UPDATE public.booking_payment_attempts
      SET status = 'reconciliation_required',
          stripe_payment_intent_id = COALESCE(NULLIF(BTRIM(COALESCE(p_stripe_payment_intent_id, '')), ''), stripe_payment_intent_id),
          last_webhook_event_id = COALESCE(NULLIF(BTRIM(COALESCE(p_stripe_event_id, '')), ''), last_webhook_event_id),
          gateway_response = gateway_response
            || COALESCE(p_gateway_payload, '{}'::jsonb)
            || jsonb_build_object(
              'internalConfirmationError',
              jsonb_strip_nulls(
                jsonb_build_object(
                  'code', v_confirmation_failure_code,
                  'stage', 'booking_confirmation_finalize_write',
                  'sqlstate', v_confirmation_error_sqlstate,
                  'message', v_confirmation_error_message,
                  'detail', v_confirmation_error_detail,
                  'hint', v_confirmation_error_hint,
                  'context', v_confirmation_error_context,
                  'paymentIntentId', NULLIF(BTRIM(COALESCE(p_stripe_payment_intent_id, '')), ''),
                  'stripeEventId', NULLIF(BTRIM(COALESCE(p_stripe_event_id, '')), '')
                )
              )
            ),
          last_error_code = v_confirmation_failure_code,
          last_error_message = v_confirmation_failure_message,
          failed_at = COALESCE(failed_at, now()),
          updated_at = now()
      WHERE id = v_attempt.id;

      RETURN public.get_booking_payment_attempt_summary(v_attempt.id);
  END;

  RETURN public.get_booking_payment_attempt_summary(v_attempt.id);
END;
$$;

REVOKE ALL ON FUNCTION public.release_booking_payment_attempt(uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prepare_booking_payment_attempt_for_client(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prepare_booking_payment_attempt(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_booking_payment_attempt(uuid, text, text, integer, text, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.release_booking_payment_attempt(uuid, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_booking_payment_attempt(uuid, integer) TO authenticated;

GRANT EXECUTE ON FUNCTION public.release_booking_payment_attempt(uuid, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_booking_payment_attempt_for_client(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_booking_payment_attempt(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_booking_payment_attempt(uuid, text, text, integer, text, jsonb) TO service_role;
