-- Task 4 completion:
-- 1) True batch idempotency for broadcast booking requests.
-- 2) Explicit hardening against anon/authenticated access to internal funnel/payment tables and RPCs.
-- 3) Payment confirmation consistency when stale holds still exist in the same slot window.

CREATE TABLE IF NOT EXISTS public.booking_batch_rpc_idempotency (
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  operation_id uuid NOT NULL,
  batch_key text NOT NULL,
  payload_signature text NOT NULL,
  response_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (actor_id, action, operation_id)
);

ALTER TABLE public.booking_batch_rpc_idempotency ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own booking batch idempotency records" ON public.booking_batch_rpc_idempotency;
CREATE POLICY "Users can read own booking batch idempotency records"
  ON public.booking_batch_rpc_idempotency
  FOR SELECT
  TO authenticated
  USING (actor_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own booking batch idempotency records" ON public.booking_batch_rpc_idempotency;
CREATE POLICY "Users can insert own booking batch idempotency records"
  ON public.booking_batch_rpc_idempotency
  FOR INSERT
  TO authenticated
  WITH CHECK (actor_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own booking batch idempotency records" ON public.booking_batch_rpc_idempotency;
CREATE POLICY "Users can update own booking batch idempotency records"
  ON public.booking_batch_rpc_idempotency
  FOR UPDATE
  TO authenticated
  USING (actor_id = auth.uid())
  WITH CHECK (actor_id = auth.uid());

CREATE OR REPLACE FUNCTION public.register_booking_batch_operation_once(
  p_action text,
  p_batch_key text,
  p_operation_id uuid,
  p_payload_signature text
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing public.booking_batch_rpc_idempotency%ROWTYPE;
BEGIN
  IF p_operation_id IS NULL THEN
    RETURN true;
  END IF;

  SELECT *
  INTO v_existing
  FROM public.booking_batch_rpc_idempotency
  WHERE actor_id = auth.uid()
    AND action = p_action
    AND operation_id = p_operation_id;

  IF FOUND THEN
    IF v_existing.batch_key <> p_batch_key THEN
      RAISE EXCEPTION 'operation_id ya usado para otro lote.';
    END IF;
    IF v_existing.payload_signature <> p_payload_signature THEN
      RAISE EXCEPTION 'operation_id ya usado con payload distinto.';
    END IF;
    RETURN false;
  END IF;

  INSERT INTO public.booking_batch_rpc_idempotency (
    actor_id,
    action,
    operation_id,
    batch_key,
    payload_signature
  ) VALUES (
    auth.uid(),
    p_action,
    p_operation_id,
    p_batch_key,
    p_payload_signature
  );

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_booking_batch_operation(
  p_action text,
  p_operation_id uuid,
  p_response_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_operation_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.booking_batch_rpc_idempotency
  SET response_payload = p_response_payload,
      completed_at = now()
  WHERE actor_id = auth.uid()
    AND action = p_action
    AND operation_id = p_operation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_broadcast_booking_requests(
  p_gardener_ids uuid[],
  p_service_id uuid,
  p_date date,
  p_start_time time,
  p_duration_hours integer,
  p_total_price numeric,
  p_client_address text,
  p_notes text DEFAULT NULL,
  p_pricing_context jsonb DEFAULT '{}'::jsonb,
  p_travel_fee numeric DEFAULT 15,
  p_hourly_rate numeric DEFAULT 25,
  p_operation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gardener_id uuid;
  v_booking_id uuid;
  v_response jsonb;
  v_inserted_ids uuid[] := '{}'::uuid[];
  v_payload_signature text;
  v_should_execute boolean;
  v_batch_key text;
  v_unique_gardener_ids uuid[] := '{}'::uuid[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesion para enviar la solicitud.';
  END IF;

  SELECT COALESCE(array_agg(gardener_id ORDER BY gardener_id::text), '{}'::uuid[])
  INTO v_unique_gardener_ids
  FROM (
    SELECT DISTINCT gardener_id
    FROM unnest(COALESCE(p_gardener_ids, '{}'::uuid[])) AS gardener_id
    WHERE gardener_id IS NOT NULL
  ) deduped;

  IF array_length(v_unique_gardener_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Debes indicar al menos un jardinero.';
  END IF;

  IF p_service_id IS NULL OR p_date IS NULL OR p_start_time IS NULL THEN
    RAISE EXCEPTION 'Faltan datos obligatorios para crear la solicitud.';
  END IF;

  IF p_duration_hours IS NULL OR p_duration_hours < 1 OR p_duration_hours > 12 THEN
    RAISE EXCEPTION 'La duracion no es valida.';
  END IF;

  IF p_total_price IS NULL OR p_total_price <= 0 THEN
    RAISE EXCEPTION 'El precio total no es valido.';
  END IF;

  IF COALESCE(BTRIM(p_client_address), '') = '' THEN
    RAISE EXCEPTION 'La direccion del cliente es obligatoria.';
  END IF;

  v_batch_key := format(
    '%s|%s|%s|%s',
    array_to_string(v_unique_gardener_ids, ','),
    p_service_id,
    p_date,
    p_start_time
  );

  v_payload_signature := format(
    '%s|%s|%s|%s|%s|%s|%s|%s|%s',
    array_to_string(v_unique_gardener_ids, ','),
    p_service_id,
    p_date,
    p_start_time,
    p_duration_hours,
    p_total_price,
    md5(COALESCE(p_client_address, '')),
    md5(COALESCE(p_notes, '')),
    md5(
      COALESCE(p_pricing_context, '{}'::jsonb)::text
      || '|' || COALESCE(p_travel_fee, 15)::text
      || '|' || COALESCE(p_hourly_rate, 25)::text
    )
  );

  v_should_execute := public.register_booking_batch_operation_once(
    'create_broadcast_booking_requests',
    v_batch_key,
    p_operation_id,
    v_payload_signature
  );

  IF NOT v_should_execute THEN
    SELECT response_payload INTO v_response
    FROM public.booking_batch_rpc_idempotency
    WHERE actor_id = auth.uid()
      AND action = 'create_broadcast_booking_requests'
      AND operation_id = p_operation_id;

    RETURN COALESCE(v_response, jsonb_build_object('status', 'pending', 'booking_ids', '[]'::jsonb));
  END IF;

  FOREACH v_gardener_id IN ARRAY v_unique_gardener_ids LOOP
    v_booking_id := gen_random_uuid();

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
      v_gardener_id,
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
      COALESCE(p_pricing_context, '{}'::jsonb) || jsonb_build_object(
        'broadcast_operation_id', p_operation_id,
        'broadcast_batch_key', v_batch_key
      )
    );

    v_inserted_ids := array_append(v_inserted_ids, v_booking_id);
  END LOOP;

  v_response := jsonb_build_object(
    'status', 'pending',
    'booking_ids', to_jsonb(v_inserted_ids)
  );

  PERFORM public.complete_booking_batch_operation('create_broadcast_booking_requests', p_operation_id, v_response);
  RETURN v_response;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_booking_payment_attempt(
  p_attempt_id uuid,
  p_stripe_event_id text,
  p_stripe_payment_intent_id text,
  p_checkout_session_id text,
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
      p_checkout_session_id,
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
      p_checkout_session_id,
      p_stripe_payment_intent_id,
      COALESCE(p_gateway_payload, '{}'::jsonb)
    );
    RETURN public.get_booking_payment_attempt_summary(v_attempt.id);
  END IF;

  UPDATE public.booking_payment_attempts
  SET status = 'processing',
      stripe_checkout_session_id = COALESCE(NULLIF(BTRIM(COALESCE(p_checkout_session_id, '')), ''), stripe_checkout_session_id),
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
      p_checkout_session_id,
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
      p_checkout_session_id,
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
      p_checkout_session_id,
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
      p_checkout_session_id,
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
      p_checkout_session_id,
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
    'payment_checkout_session_id', COALESCE(NULLIF(BTRIM(COALESCE(p_checkout_session_id, '')), ''), v_attempt.stripe_checkout_session_id),
    'payment_intent_id', COALESCE(NULLIF(BTRIM(COALESCE(p_stripe_payment_intent_id, '')), ''), v_attempt.stripe_payment_intent_id),
    'payment_last_webhook_event_id', NULLIF(BTRIM(COALESCE(p_stripe_event_id, '')), '')
  );

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
      stripe_checkout_session_id = COALESCE(NULLIF(BTRIM(COALESCE(p_checkout_session_id, '')), ''), stripe_checkout_session_id),
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

  RETURN public.get_booking_payment_attempt_summary(v_attempt.id);
END;
$$;

REVOKE ALL ON TABLE public.booking_quotes FROM anon, authenticated;
REVOKE ALL ON TABLE public.booking_funnel_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.booking_payment_attempts FROM anon, authenticated;
REVOKE ALL ON TABLE public.booking_schedule_holds FROM anon, authenticated;
REVOKE ALL ON TABLE public.booking_schedule_hold_blocks FROM anon, authenticated;
REVOKE ALL ON TABLE public.stripe_webhook_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.booking_batch_rpc_idempotency FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_booking_payment_attempt_summary(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_booking_payment_state(uuid[], date, date) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_booking_payment_attempt(uuid, text, text, text, text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prepare_booking_payment_attempt(uuid, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_booking_payment_attempt(uuid, text, text, text, integer, text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.register_booking_batch_operation_once(text, text, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_booking_batch_operation(text, uuid, jsonb) FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_quotes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_funnel_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_batch_rpc_idempotency TO service_role;
GRANT EXECUTE ON FUNCTION public.get_booking_payment_attempt_summary(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_booking_payment_state(uuid[], date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_booking_payment_attempt(uuid, text, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_booking_payment_attempt(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_booking_payment_attempt(uuid, text, text, text, integer, text, jsonb) TO service_role;
