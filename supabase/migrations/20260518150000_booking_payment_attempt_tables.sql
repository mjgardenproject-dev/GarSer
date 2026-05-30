-- Task 3 foundations: payment attempts, schedule holds and Stripe webhook ledger.

CREATE TABLE IF NOT EXISTS public.booking_payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gardener_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  quote_id uuid NOT NULL REFERENCES public.booking_quotes(id) ON DELETE CASCADE,
  quote_signature text NOT NULL,
  selected_date date NOT NULL,
  selected_start_time time NOT NULL,
  duration_hours integer NOT NULL CHECK (duration_hours >= 1 AND duration_hours <= 12),
  currency text NOT NULL DEFAULT 'eur',
  service_total_amount_cents integer NOT NULL CHECK (service_total_amount_cents > 0),
  payable_now_amount_cents integer NOT NULL CHECK (payable_now_amount_cents > 0),
  status text NOT NULL DEFAULT 'created' CHECK (
    status IN (
      'created',
      'checkout_open',
      'processing',
      'booking_created',
      'cancelled',
      'failed',
      'expired',
      'reconciliation_required'
    )
  ),
  stripe_idempotency_key text NOT NULL UNIQUE,
  stripe_checkout_session_id text UNIQUE,
  stripe_payment_intent_id text UNIQUE,
  checkout_url text,
  checkout_expires_at timestamptz,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  pricing_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  availability_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  economic_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  gateway_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_webhook_event_id text,
  last_error_code text,
  last_error_message text,
  confirmed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_payment_attempts_quote_created
  ON public.booking_payment_attempts(quote_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_payment_attempts_client_status
  ON public.booking_payment_attempts(client_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_payment_attempts_slot_status
  ON public.booking_payment_attempts(gardener_id, selected_date, selected_start_time, status, created_at DESC);

ALTER TABLE public.booking_payment_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own booking payment attempts" ON public.booking_payment_attempts;
CREATE POLICY "Users can read own booking payment attempts"
  ON public.booking_payment_attempts
  FOR SELECT
  TO authenticated
  USING (client_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.booking_schedule_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_attempt_id uuid NOT NULL UNIQUE REFERENCES public.booking_payment_attempts(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gardener_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  quote_id uuid NOT NULL REFERENCES public.booking_quotes(id) ON DELETE CASCADE,
  selected_date date NOT NULL,
  selected_start_time time NOT NULL,
  duration_hours integer NOT NULL CHECK (duration_hours >= 1 AND duration_hours <= 12),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'consumed', 'released', 'expired')),
  expires_at timestamptz NOT NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  release_reason text,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_schedule_holds_quote_status
  ON public.booking_schedule_holds(quote_id, status, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_schedule_holds_slot_status
  ON public.booking_schedule_holds(gardener_id, selected_date, selected_start_time, status, expires_at DESC);

ALTER TABLE public.booking_schedule_holds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own booking schedule holds" ON public.booking_schedule_holds;
CREATE POLICY "Users can read own booking schedule holds"
  ON public.booking_schedule_holds
  FOR SELECT
  TO authenticated
  USING (client_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.booking_schedule_hold_blocks (
  hold_id uuid NOT NULL REFERENCES public.booking_schedule_holds(id) ON DELETE CASCADE,
  gardener_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  hour_block integer NOT NULL CHECK (hour_block >= 0 AND hour_block < 24),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hold_id, hour_block)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_schedule_hold_blocks_unique_slot
  ON public.booking_schedule_hold_blocks(gardener_id, date, hour_block);

CREATE INDEX IF NOT EXISTS idx_booking_schedule_hold_blocks_scope
  ON public.booking_schedule_hold_blocks(gardener_id, date, hour_block);

ALTER TABLE public.booking_schedule_hold_blocks ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  stripe_event_id text PRIMARY KEY,
  event_type text NOT NULL,
  payment_attempt_id uuid REFERENCES public.booking_payment_attempts(id) ON DELETE SET NULL,
  stripe_object_id text,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'processed', 'ignored', 'failed')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_message text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_type_received
  ON public.stripe_webhook_events(event_type, received_at DESC);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.touch_booking_payment_rows_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_booking_payment_attempts_updated_at ON public.booking_payment_attempts;
CREATE TRIGGER trg_booking_payment_attempts_updated_at
  BEFORE UPDATE ON public.booking_payment_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_booking_payment_rows_updated_at();

DROP TRIGGER IF EXISTS trg_booking_schedule_holds_updated_at ON public.booking_schedule_holds;
CREATE TRIGGER trg_booking_schedule_holds_updated_at
  BEFORE UPDATE ON public.booking_schedule_holds
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_booking_payment_rows_updated_at();

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
    'checkoutUrl', v_attempt.checkout_url,
    'checkoutSessionId', v_attempt.stripe_checkout_session_id,
    'paymentIntentId', v_attempt.stripe_payment_intent_id,
    'checkoutExpiresAt', v_attempt.checkout_expires_at,
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
      release_reason = COALESCE(release_reason, 'checkout_expired'),
      released_at = COALESCE(released_at, now()),
      updated_at = now()
  WHERE id = ANY(v_hold_ids)
    AND status = 'active';

  UPDATE public.booking_payment_attempts
  SET status = 'expired',
      expired_at = COALESCE(expired_at, now()),
      last_error_code = COALESCE(last_error_code, 'checkout_expired'),
      last_error_message = COALESCE(last_error_message, 'El tiempo del checkout ha expirado. Puedes reintentar el pago.'),
      updated_at = now()
  WHERE id = ANY(v_attempt_ids)
    AND status IN ('created', 'checkout_open', 'processing');

  RETURN jsonb_build_object(
    'expired_holds', v_scoped_count,
    'expired_attempts', COALESCE(array_length(v_attempt_ids, 1), 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.release_booking_payment_attempt(
  p_attempt_id uuid,
  p_next_status text,
  p_reason text DEFAULT NULL,
  p_stripe_checkout_session_id text DEFAULT NULL,
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
      stripe_checkout_session_id = COALESCE(NULLIF(BTRIM(COALESCE(p_stripe_checkout_session_id, '')), ''), stripe_checkout_session_id),
      stripe_payment_intent_id = COALESCE(NULLIF(BTRIM(COALESCE(p_stripe_payment_intent_id, '')), ''), stripe_payment_intent_id),
      gateway_response = CASE
        WHEN COALESCE(p_gateway_payload, '{}'::jsonb) = '{}'::jsonb THEN gateway_response
        ELSE gateway_response || p_gateway_payload
      END,
      last_error_code = COALESCE(v_effective_reason, last_error_code, p_next_status),
      last_error_message = CASE
        WHEN p_next_status = 'cancelled' THEN COALESCE(last_error_message, 'El pago se ha cancelado antes de completar el checkout.')
        WHEN p_next_status = 'expired' THEN COALESCE(last_error_message, 'El tiempo del checkout ha expirado. Puedes reintentar el pago.')
        WHEN p_next_status = 'reconciliation_required' THEN COALESCE(last_error_message, 'El pago necesita revision manual antes de consolidar la reserva.')
        ELSE COALESCE(last_error_message, 'No se pudo completar el pago. Puedes reintentar el checkout.')
      END,
      cancelled_at = CASE WHEN p_next_status = 'cancelled' THEN COALESCE(cancelled_at, now()) ELSE cancelled_at END,
      failed_at = CASE WHEN p_next_status IN ('failed', 'reconciliation_required') THEN COALESCE(failed_at, now()) ELSE failed_at END,
      expired_at = CASE WHEN p_next_status = 'expired' THEN COALESCE(expired_at, now()) ELSE expired_at END,
      updated_at = now()
  WHERE id = p_attempt_id;

  RETURN public.get_booking_payment_attempt_summary(p_attempt_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_booking_payment_attempt(
  p_quote_id uuid,
  p_checkout_ttl_minutes integer DEFAULT 15
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
BEGIN
  IF auth.uid() IS NULL THEN
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

  IF v_quote.client_id IS DISTINCT FROM auth.uid() THEN
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

  PERFORM public.cleanup_expired_booking_payment_state(ARRAY[v_quote.gardener_id], v_quote.selected_date, v_quote.selected_date);

  SELECT *
  INTO v_existing_attempt
  FROM public.booking_payment_attempts
  WHERE quote_id = p_quote_id
    AND client_id = auth.uid()
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_attempt.booking_id IS NOT NULL OR v_existing_attempt.status = 'booking_created' THEN
      RETURN public.get_booking_payment_attempt_summary(v_existing_attempt.id);
    END IF;

    IF v_existing_attempt.status IN ('created', 'checkout_open', 'processing')
      AND COALESCE(v_existing_attempt.checkout_expires_at, now() + interval '1 second') > now()
      AND EXISTS (
        SELECT 1
        FROM public.booking_schedule_holds h
        WHERE h.payment_attempt_id = v_existing_attempt.id
          AND h.status = 'active'
          AND h.expires_at > now()
      ) THEN
      RETURN public.get_booking_payment_attempt_summary(v_existing_attempt.id);
    END IF;

    IF v_existing_attempt.status IN ('created', 'checkout_open', 'processing') THEN
      PERFORM public.release_booking_payment_attempt(
        v_existing_attempt.id,
        'expired',
        'stale_attempt_replaced',
        v_existing_attempt.stripe_checkout_session_id,
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

  v_expires_at := now() + make_interval(mins => GREATEST(1, COALESCE(p_checkout_ttl_minutes, 15)));

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
    checkout_expires_at,
    pricing_snapshot,
    availability_snapshot,
    economic_snapshot,
    metadata_snapshot,
    gateway_response
  ) VALUES (
    auth.uid(),
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
    auth.uid(),
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

REVOKE ALL ON public.booking_payment_attempts FROM PUBLIC;
REVOKE ALL ON public.booking_schedule_holds FROM PUBLIC;
REVOKE ALL ON public.booking_schedule_hold_blocks FROM PUBLIC;
REVOKE ALL ON public.stripe_webhook_events FROM PUBLIC;

REVOKE ALL ON FUNCTION public.get_booking_payment_attempt_summary(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_expired_booking_payment_state(uuid[], date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_booking_payment_attempt(uuid, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prepare_booking_payment_attempt(uuid, integer) FROM PUBLIC;

GRANT SELECT ON public.booking_payment_attempts TO authenticated;
GRANT SELECT ON public.booking_schedule_holds TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_booking_payment_attempt_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_booking_payment_state(uuid[], date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_booking_payment_attempt(uuid, text, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_booking_payment_attempt(uuid, integer) TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_payment_attempts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_schedule_holds TO service_role;
GRANT SELECT, INSERT, DELETE ON public.booking_schedule_hold_blocks TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.stripe_webhook_events TO service_role;
GRANT EXECUTE ON FUNCTION public.get_booking_payment_attempt_summary(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_booking_payment_state(uuid[], date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_booking_payment_attempt(uuid, text, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_booking_payment_attempt(uuid, integer) TO service_role;
