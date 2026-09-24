-- GarSer Empresas · F6.1: planificación (servidor).
--
-- D10 (usuario, 2026-09-24): la empresa reparte las horas de un trabajo entre su gente como vea
-- conveniente, y decide si acepta o no VENDER trabajos que solo se pueden cubrir por turnos
-- (varias personas, una detrás de otra). Apagado por defecto: lo de F4 (una persona entera).
--
-- 1) companies.allow_split_jobs + RPC; provider_allows_split_jobs().
-- 2) worker_free_at() y pick_provider_workers_by_hour(): reparto por turnos al vender.
-- 3) El camino del dinero ya no supone «una persona para todo el trabajo»: prepare y confirm
--    llevan una persona por hora (del bloqueo del pago); acortar libera a quien hacía cada hora;
--    alargar lo hace quien hace la última hora. Autónomo o una sola persona: idéntico.
-- 4) assign_booking_hours(): la empresa reparte las horas (D10). assign_booking_worker() pasa a
--    ser «todas las horas a esta persona» y libera a todos los que tenían alguna hora.
-- 5) company_schedule(): la agenda de la empresa para el planificador, en una llamada.
-- 6) my_jobs() dice qué horas son del empleado; booking_worker_for_client() da todos los que van.
--    (reserve_booking_schedule, el camino de las solicitudes sin pago, sigue con una persona.)

-- ── 1) Ajuste de la empresa ───────────────────────────────────────────────────────
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS allow_split_jobs boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.companies.allow_split_jobs IS
  'D10: true = se venden también trabajos que solo se pueden cubrir por turnos (una persona por hora). false = solo si una persona hace el trabajo entero.';

CREATE OR REPLACE FUNCTION public.set_company_allow_split_jobs(p_allow boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid := public.my_company_id();
BEGIN
  IF v_company_id IS NULL OR NOT public.is_company_owner(v_company_id) THEN
    RAISE EXCEPTION 'Solo el dueño de la empresa puede cambiar esto.';
  END IF;
  UPDATE public.companies SET allow_split_jobs = COALESCE(p_allow, false), updated_at = now() WHERE id = v_company_id;
  RETURN jsonb_build_object('allow_split_jobs', COALESCE(p_allow, false));
END;
$$;
REVOKE ALL ON FUNCTION public.set_company_allow_split_jobs(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_company_allow_split_jobs(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.provider_allows_split_jobs(p_provider uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT c.allow_split_jobs FROM public.companies c WHERE c.provider_user_id = p_provider AND c.status = 'active'), false);
$$;

-- ── 2) Reparto por turnos al vender ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.worker_free_at(p_worker uuid, p_date date, p_hour integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
      SELECT 1 FROM public.availability a
      WHERE a.gardener_id = p_worker AND a.date = p_date AND a.is_available = true
        AND EXTRACT(HOUR FROM a.start_time) = p_hour
    )
    AND NOT EXISTS (SELECT 1 FROM public.booking_schedule_hold_blocks hb WHERE hb.gardener_id = p_worker AND hb.date = p_date AND hb.hour_block = p_hour)
    AND NOT EXISTS (SELECT 1 FROM public.booking_blocks bb WHERE bb.assignee_id = p_worker AND bb.date = p_date AND bb.hour_block = p_hour);
$$;

-- Una persona por hora, con los menos cambios posibles: se sigue con la misma mientras esté
-- libre; cuando no, entra quien pueda seguir más horas seguidas (y, a igualdad, quien menos
-- trabajo tenga ese día). NULL si alguna hora no la puede hacer nadie.
CREATE OR REPLACE FUNCTION public.pick_provider_workers_by_hour(
  p_provider uuid, p_service uuid, p_date date, p_start_hour integer, p_end_hour integer, p_requires_license boolean DEFAULT false
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result uuid[] := '{}';
  v_prev uuid;
  v_pick uuid;
  h integer;
BEGIN
  FOR h IN p_start_hour .. p_end_hour - 1 LOOP
    IF v_prev IS NOT NULL AND public.worker_free_at(v_prev, p_date, h) THEN
      v_result := v_result || v_prev;
      CONTINUE;
    END IF;
    SELECT w.worker_id INTO v_pick
    FROM public.provider_workers(p_provider, p_service, p_requires_license) AS w(worker_id)
    WHERE public.worker_free_at(w.worker_id, p_date, h)
    ORDER BY (
      SELECT COALESCE(MIN(g) - h, p_end_hour - h)
      FROM generate_series(h, p_end_hour - 1) AS g
      WHERE NOT public.worker_free_at(w.worker_id, p_date, g)
    ) DESC,
    (SELECT count(*) FROM public.booking_blocks bb WHERE bb.assignee_id = w.worker_id AND bb.date = p_date),
    w.worker_id
    LIMIT 1;
    IF v_pick IS NULL THEN
      RETURN NULL;
    END IF;
    v_result := v_result || v_pick;
    v_prev := v_pick;
  END LOOP;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_allows_split_jobs(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.worker_free_at(uuid, date, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pick_provider_workers_by_hour(uuid, uuid, date, integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_allows_split_jobs(uuid) TO service_role;

-- ── 3) El camino del dinero, por horas ────────────────────────────────────────────
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

  -- F4 (GarSer Empresas): las horas se apartan a UNA persona. Autónomo: él mismo. Empresa:
  -- alguien del equipo que hace el servicio (con carnet si hace falta) y está libre todas las
  -- horas del trabajo (H-26). Sin nadie así, la franja ya no está disponible.
  v_requires_license := COALESCE((v_quote.pricing_snapshot ->> 'requiresPhytosanitaryLicense')::boolean, false);
  v_worker := public.pick_provider_worker(
    v_quote.gardener_id, v_quote.service_id, v_quote.selected_date, v_start_hour, v_end_hour, v_requires_license
  );
  -- F6 (GarSer Empresas, D10): si nadie puede hacerlo entero y la empresa acepta trabajos
  -- partidos, se reparte por turnos: una persona por hora. v_workers[i] = quien hace la hora
  -- v_start_hour + i - 1. Autónomo, o una sola persona: la misma en todas.
  IF v_worker IS NOT NULL THEN
    v_workers := array_fill(v_worker, ARRAY[v_duration_hours]);
  ELSIF public.provider_allows_split_jobs(v_quote.gardener_id) THEN
    v_workers := public.pick_provider_workers_by_hour(
      v_quote.gardener_id, v_quote.service_id, v_quote.selected_date, v_start_hour, v_end_hour, v_requires_license
    );
    v_worker := v_workers[1];
  END IF;
  IF v_workers IS NULL THEN
    RAISE EXCEPTION 'La franja seleccionada ya no esta disponible para iniciar el pago.';
  END IF;

  PERFORM 1
  FROM public.availability a
  JOIN unnest(v_workers) WITH ORDINALITY AS w(worker_id, idx)
    ON a.gardener_id = w.worker_id AND EXTRACT(HOUR FROM a.start_time) = v_start_hour + w.idx - 1
  WHERE a.date = v_quote.selected_date
    AND a.is_available = true
  FOR UPDATE OF a;

  SELECT count(*)::integer INTO v_available_count
  FROM unnest(v_workers) WITH ORDINALITY AS w(worker_id, idx)
  WHERE EXISTS (
    SELECT 1 FROM public.availability a
    WHERE a.gardener_id = w.worker_id AND a.date = v_quote.selected_date AND a.is_available = true
      AND EXTRACT(HOUR FROM a.start_time) = v_start_hour + w.idx - 1
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
  SELECT v_hold_id, w.worker_id, v_quote.selected_date, v_start_hour + w.idx - 1
  FROM unnest(v_workers) WITH ORDINALITY AS w(worker_id, idx)
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
$function$;

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

  -- F4 (GarSer Empresas): la persona apartada al pagar. Los intentos anteriores a F4 no la
  -- tienen: entonces es el proveedor, como siempre ha sido para un autónomo.
  v_worker := COALESCE(v_hold.assignee_id, v_attempt.gardener_id);
  -- Empresa en modo «yo elijo quién va»: la persona es una propuesta que el dueño confirma.
  v_assignment_pending := EXISTS (
    SELECT 1 FROM public.companies co
    WHERE co.provider_user_id = v_attempt.gardener_id AND co.assignment_mode = 'manual'
  );

  -- F6 (GarSer Empresas, D10): quién hace cada hora sale del bloqueo del pago (una persona
  -- por hora si se vendió por turnos). Sin ese detalle (intentos antiguos), la de siempre.
  SELECT array_agg(hb.gardener_id ORDER BY hb.hour_block) INTO v_workers
  FROM public.booking_schedule_hold_blocks hb
  WHERE hb.hold_id = v_hold.id AND hb.hour_block >= v_start_hour AND hb.hour_block < v_end_hour;
  IF v_workers IS NULL OR array_length(v_workers, 1) <> v_attempt.duration_hours THEN
    v_workers := array_fill(v_worker, ARRAY[v_attempt.duration_hours]);
  END IF;

  PERFORM 1
  FROM public.availability a
  JOIN unnest(v_workers) WITH ORDINALITY AS w(worker_id, idx)
    ON a.gardener_id = w.worker_id AND EXTRACT(HOUR FROM a.start_time) = v_start_hour + w.idx - 1
  WHERE a.date = v_attempt.selected_date
    AND a.is_available = true
  FOR UPDATE OF a;

  SELECT count(*)::integer INTO v_available_count
  FROM unnest(v_workers) WITH ORDINALITY AS w(worker_id, idx)
  WHERE EXISTS (
    SELECT 1 FROM public.availability a
    WHERE a.gardener_id = w.worker_id AND a.date = v_attempt.selected_date AND a.is_available = true
      AND EXTRACT(HOUR FROM a.start_time) = v_start_hour + w.idx - 1
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
    JOIN unnest(v_workers) WITH ORDINALITY AS w(worker_id, idx)
      ON hb.gardener_id = w.worker_id AND hb.hour_block = v_start_hour + w.idx - 1
    WHERE hb.date = v_attempt.selected_date
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
      pricing_context,
      assignment_pending
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
      v_assignment_pending
    );

    INSERT INTO public.booking_blocks (booking_id, date, hour_block, assignee_id)
    SELECT v_booking_id, v_attempt.selected_date, v_start_hour + w.idx - 1, w.worker_id
    FROM unnest(v_workers) WITH ORDINALITY AS w(worker_id, idx)
    ON CONFLICT (booking_id, date, hour_block) DO NOTHING;

    UPDATE public.availability a
    SET is_available = false
    FROM unnest(v_workers) WITH ORDINALITY AS w(worker_id, idx)
    WHERE a.gardener_id = w.worker_id
      AND a.date = v_attempt.selected_date
      AND EXTRACT(HOUR FROM a.start_time) = v_start_hour + w.idx - 1;

    UPDATE public.availability_blocks ab
    SET is_available = false
    FROM unnest(v_workers) WITH ORDINALITY AS w(worker_id, idx)
    WHERE ab.gardener_id = w.worker_id
      AND ab.date = v_attempt.selected_date
      AND ab.hour_block = v_start_hour + w.idx - 1;

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
  v_worker uuid;
  v_freed_workers uuid[];
  v_freed_hours integer[];
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF p_new_duration_hours IS NULL OR p_new_duration_hours < 1 THEN
    RAISE EXCEPTION 'La duración debe ser de al menos 1 hora.' USING ERRCODE = '22023';
  END IF;

  -- F4 (GarSer Empresas): se alarga o acorta la agenda de QUIEN hace el trabajo (la persona de
  -- sus bloques). Autónomo: él mismo.
  -- F6: si el trabajo está repartido, lo que se alarga lo hace quien hace la última hora.
  v_worker := COALESCE(
    (SELECT bb.assignee_id FROM public.booking_blocks bb WHERE bb.booking_id = p_booking_id ORDER BY bb.hour_block DESC LIMIT 1),
    v_booking.gardener_id
  );

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
    WHERE gardener_id = v_worker
      AND date = v_booking.date
      AND is_available = true
      AND EXTRACT(HOUR FROM start_time) >= v_old_end_hour
      AND EXTRACT(HOUR FROM start_time) < v_new_end_hour
    FOR UPDATE;

    v_free_count := public.count_distinct_available_legacy_hours(
      v_worker, v_booking.date, v_old_end_hour, v_new_end_hour
    );

    IF v_free_count <> (v_new_end_hour - v_old_end_hour) THEN
      RAISE EXCEPTION 'El profesional ya no tiene libres las horas necesarias para alargar el servicio.'
        USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO public.booking_blocks (booking_id, date, hour_block, assignee_id)
    SELECT p_booking_id, v_booking.date, hour_block, v_worker
    FROM generate_series(v_old_end_hour, v_new_end_hour - 1) AS hour_block
    ON CONFLICT (booking_id, date, hour_block) DO NOTHING;

    UPDATE public.availability_blocks
    SET is_available = false
    WHERE gardener_id = v_worker
      AND date = v_booking.date
      AND hour_block >= v_old_end_hour
      AND hour_block < v_new_end_hour;

    UPDATE public.availability
    SET is_available = false
    WHERE gardener_id = v_worker
      AND date = v_booking.date
      AND EXTRACT(HOUR FROM start_time) >= v_old_end_hour
      AND EXTRACT(HOUR FROM start_time) < v_new_end_hour;

  ELSIF v_new_end_hour < v_old_end_hour THEN
    -- Acortar: libera [v_new_end_hour, v_old_end_hour) en las tres tablas, a quien hacía
    -- cada una de esas horas (F6: si estaba repartido, pueden ser personas distintas).
    WITH freed AS (
      DELETE FROM public.booking_blocks
      WHERE booking_id = p_booking_id
        AND hour_block >= v_new_end_hour
        AND hour_block < v_old_end_hour
      RETURNING assignee_id, date, hour_block
    )
    SELECT array_agg(assignee_id), array_agg(hour_block) INTO v_freed_workers, v_freed_hours FROM freed;

    UPDATE public.availability_blocks ab
    SET is_available = true
    FROM unnest(COALESCE(v_freed_workers, '{}'), COALESCE(v_freed_hours, '{}')) AS f(worker_id, hour_block)
    WHERE ab.gardener_id = f.worker_id
      AND ab.date = v_booking.date
      AND ab.hour_block = f.hour_block;

    UPDATE public.availability a
    SET is_available = true
    FROM unnest(COALESCE(v_freed_workers, '{}'), COALESCE(v_freed_hours, '{}')) AS f(worker_id, hour_block)
    WHERE a.gardener_id = f.worker_id
      AND a.date = v_booking.date
      AND EXTRACT(HOUR FROM a.start_time) = f.hour_block;
  END IF;
  -- v_new_end_hour = v_old_end_hour: nada que mover en la agenda.

  UPDATE public.bookings
  SET duration_hours = p_new_duration_hours
  WHERE id = p_booking_id;
  -- end_time se recalcula solo: trigger_calculate_end_time (20250929000002) ya existente.
END;
$function$;

CREATE OR REPLACE FUNCTION public.company_team_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id uuid := public.my_company_id();
  v_provider uuid;
BEGIN
  IF v_company_id IS NULL OR NOT public.is_company_owner(v_company_id) THEN
    RAISE EXCEPTION 'Solo el dueño de la empresa puede ver su equipo.';
  END IF;

  SELECT provider_user_id INTO v_provider FROM public.companies WHERE id = v_company_id;

  RETURN jsonb_build_object(
    'company', (
      SELECT jsonb_build_object(
        'id', c.id, 'legal_name', c.legal_name, 'tax_id', c.tax_id, 'status', c.status,
        'assignment_mode', c.assignment_mode,
        'allow_split_jobs', c.allow_split_jobs,
        'commercial_name', gp.full_name, 'phone', gp.phone, 'address', gp.address
      )
      FROM public.companies c JOIN public.gardener_profiles gp ON gp.user_id = c.provider_user_id
      WHERE c.id = v_company_id
    ),
    'offered_services', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
      FROM public.gardener_service_prices p JOIN public.services s ON s.id = p.service_id
      WHERE p.gardener_id = v_provider AND p.active
    ), '[]'::jsonb),
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'member_id', m.id,
        'user_id', m.user_id,
        'role', m.role,
        'status', m.status,
        'counts_as_labour', m.counts_as_labour,
        'joined_at', m.joined_at,
        'full_name', NULLIF(BTRIM(pr.full_name), ''),
        'phone', NULLIF(BTRIM(pr.phone), ''),
        'email', u.email,
        'services', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
          FROM public.company_member_services cms JOIN public.services s ON s.id = cms.service_id
          WHERE cms.member_id = m.id
        ), '[]'::jsonb),
        'license_status', (
          SELECT l.status FROM public.gardener_licenses l
          WHERE l.gardener_id = m.user_id AND l.status <> 'replaced'
          ORDER BY l.created_at DESC LIMIT 1
        ),
        'has_valid_phyto_license', public.has_valid_phyto_license(m.user_id)
      ) ORDER BY (m.role = 'owner') DESC, m.status, m.joined_at)
      FROM public.company_members m
      JOIN auth.users u ON u.id = m.user_id
      LEFT JOIN public.profiles pr ON pr.user_id = m.user_id
      WHERE m.company_id = v_company_id
    ), '[]'::jsonb),
    'invitations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'email', i.email, 'created_at', i.created_at, 'expires_at', i.expires_at
      ) ORDER BY i.created_at DESC)
      FROM public.company_invitations i
      WHERE i.company_id = v_company_id AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
    ), '[]'::jsonb)
  );
END;
$function$;


-- ── 4) Repartir las horas de un trabajo (D10) ─────────────────────────────────────
-- p_workers[i] = quien hace la hora (inicio + i - 1). Solo el dueño; cada persona tiene que hacer
-- el servicio (y tener carnet si hace falta) y estar libre en las horas que gana. Todo o nada.
CREATE OR REPLACE FUNCTION public.assign_booking_hours(p_booking_id uuid, p_workers uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_start integer;
  v_duration integer;
  v_before uuid[];
  v_license boolean;
  i integer;
  v_changed integer := 0;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.provider_user_id = v_booking.gardener_id AND public.is_company_owner(c.id)
  ) THEN
    RAISE EXCEPTION 'Solo el dueño de la empresa puede decidir quién va.';
  END IF;
  IF v_booking.status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'Este trabajo ya no se puede reasignar (estado: %).', v_booking.status;
  END IF;
  IF v_booking.date < current_date THEN
    RAISE EXCEPTION 'Este trabajo ya ha pasado.';
  END IF;

  v_start := EXTRACT(HOUR FROM v_booking.start_time)::integer;
  v_duration := GREATEST(COALESCE(v_booking.duration_hours, 1), 1);
  IF p_workers IS NULL OR array_length(p_workers, 1) IS DISTINCT FROM v_duration OR array_position(p_workers, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Indica quién hace cada una de las % horas del trabajo.', v_duration;
  END IF;

  SELECT array_agg(bb.assignee_id ORDER BY bb.hour_block) INTO v_before
  FROM public.booking_blocks bb WHERE bb.booking_id = p_booking_id;
  IF v_before IS NULL OR array_length(v_before, 1) <> v_duration THEN
    RAISE EXCEPTION 'Este trabajo aún no tiene horas en la agenda: acéptalo primero.';
  END IF;

  v_license := public.booking_requires_phyto_license(p_booking_id);
  FOR i IN 1 .. v_duration LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.provider_workers(v_booking.gardener_id, v_booking.service_id, v_license) AS w(worker_id)
      WHERE w.worker_id = p_workers[i]
    ) THEN
      RAISE EXCEPTION 'Una de las personas no puede hacer este trabajo: no tiene este servicio asignado%.',
        CASE WHEN v_license THEN ' o no tiene el carnet fitosanitario aprobado' ELSE '' END;
    END IF;
  END LOOP;

  -- Bloquear las horas que se ganan y comprobar que están libres.
  PERFORM 1 FROM public.availability a
  JOIN unnest(p_workers) WITH ORDINALITY AS w(worker_id, idx)
    ON a.gardener_id = w.worker_id AND EXTRACT(HOUR FROM a.start_time) = v_start + w.idx - 1
  WHERE a.date = v_booking.date AND w.worker_id IS DISTINCT FROM v_before[w.idx]
  FOR UPDATE OF a;

  FOR i IN 1 .. v_duration LOOP
    IF p_workers[i] IS DISTINCT FROM v_before[i] AND NOT public.worker_free_at(p_workers[i], v_booking.date, v_start + i - 1) THEN
      RAISE EXCEPTION 'Una de las personas no está libre a las %:00.', v_start + i - 1;
    END IF;
  END LOOP;

  FOR i IN 1 .. v_duration LOOP
    CONTINUE WHEN p_workers[i] IS NOT DISTINCT FROM v_before[i];
    v_changed := v_changed + 1;
    DELETE FROM public.booking_blocks WHERE booking_id = p_booking_id AND hour_block = v_start + i - 1;
    UPDATE public.availability SET is_available = true
    WHERE gardener_id = v_before[i] AND date = v_booking.date AND EXTRACT(HOUR FROM start_time) = v_start + i - 1;
    UPDATE public.availability_blocks SET is_available = true
    WHERE gardener_id = v_before[i] AND date = v_booking.date AND hour_block = v_start + i - 1;
    INSERT INTO public.booking_blocks (booking_id, date, hour_block, assignee_id)
    VALUES (p_booking_id, v_booking.date, v_start + i - 1, p_workers[i]);
    UPDATE public.availability SET is_available = false
    WHERE gardener_id = p_workers[i] AND date = v_booking.date AND EXTRACT(HOUR FROM start_time) = v_start + i - 1;
    UPDATE public.availability_blocks SET is_available = false
    WHERE gardener_id = p_workers[i] AND date = v_booking.date AND hour_block = v_start + i - 1;
  END LOOP;

  UPDATE public.bookings SET assignment_pending = false WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'bookingId', p_booking_id,
    'changed', v_changed > 0,
    'changedHours', v_changed,
    -- Quien tenía alguna hora y ya no tiene ninguna: para avisarle.
    'removedWorkerIds', COALESCE((SELECT jsonb_agg(DISTINCT b) FROM unnest(v_before) AS b WHERE NOT (b = ANY (p_workers))), '[]'::jsonb),
    -- Quien no tenía ninguna hora y ahora sí.
    'addedWorkerIds', COALESCE((SELECT jsonb_agg(DISTINCT n) FROM unnest(p_workers) AS n WHERE NOT (n = ANY (v_before))), '[]'::jsonb),
    'previousWorkerId', v_before[1]
  );
END;
$$;
REVOKE ALL ON FUNCTION public.assign_booking_hours(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_booking_hours(uuid, uuid[]) TO authenticated;

-- «Todas las horas a esta persona»: el caso de siempre, ahora encima del reparto.
CREATE OR REPLACE FUNCTION public.assign_booking_worker(p_booking_id uuid, p_worker_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_duration integer;
  v_result jsonb;
BEGIN
  SELECT GREATEST(COALESCE(duration_hours, 1), 1) INTO v_duration FROM public.bookings WHERE id = p_booking_id;
  IF v_duration IS NULL THEN
    RAISE EXCEPTION 'Solo el dueño de la empresa puede decidir quién va.';
  END IF;
  v_result := public.assign_booking_hours(p_booking_id, array_fill(p_worker_id, ARRAY[v_duration]));
  RETURN v_result || jsonb_build_object('workerId', p_worker_id);
END;
$$;

-- ── 5) Agenda de la empresa ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.company_schedule(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company public.companies%ROWTYPE;
BEGIN
  SELECT * INTO v_company FROM public.companies WHERE id = public.my_company_id();
  IF NOT FOUND OR NOT public.is_company_owner(v_company.id) THEN
    RAISE EXCEPTION 'Solo el dueño de la empresa puede ver la agenda de su equipo.';
  END IF;
  IF p_to < p_from OR p_to - p_from > 31 THEN
    RAISE EXCEPTION 'Elige como mucho un mes.';
  END IF;

  RETURN jsonb_build_object(
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', m.user_id,
        'name', COALESCE(NULLIF(BTRIM(p.full_name), ''), u.email),
        'role', m.role,
        'works', m.counts_as_labour
      ) ORDER BY (m.role = 'owner') DESC, p.full_name)
      FROM public.company_members m
      JOIN auth.users u ON u.id = m.user_id
      LEFT JOIN public.profiles p ON p.user_id = m.user_id
      WHERE m.company_id = v_company.id AND m.status = 'active'
    ), '[]'::jsonb),
    'free', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('user_id', x.gardener_id, 'date', x.date, 'hours', x.hours))
      FROM (
        SELECT a.gardener_id, a.date, array_agg(DISTINCT EXTRACT(HOUR FROM a.start_time)::integer ORDER BY EXTRACT(HOUR FROM a.start_time)::integer) AS hours
        FROM public.availability a
        JOIN public.company_members m ON m.user_id = a.gardener_id AND m.company_id = v_company.id AND m.status = 'active'
        WHERE a.date BETWEEN p_from AND p_to AND a.is_available
        GROUP BY a.gardener_id, a.date
      ) x
    ), '[]'::jsonb),
    'jobs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'booking_id', b.id,
        'date', b.date,
        'start_hour', EXTRACT(HOUR FROM b.start_time)::integer,
        'duration', b.duration_hours,
        'status', b.status,
        'service', s.name,
        'client_name', NULLIF(split_part(BTRIM(COALESCE(cp.full_name, '')), ' ', 1), ''),
        'address', b.client_address,
        'assignment_pending', b.assignment_pending,
        'hours', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('hour', bb.hour_block, 'worker_id', bb.assignee_id) ORDER BY bb.hour_block)
          FROM public.booking_blocks bb WHERE bb.booking_id = b.id
        ), '[]'::jsonb)
      ) ORDER BY b.date, b.start_time)
      FROM public.bookings b
      JOIN public.services s ON s.id = b.service_id
      LEFT JOIN public.profiles cp ON cp.user_id = b.client_id
      WHERE b.gardener_id = v_company.provider_user_id
        AND b.date BETWEEN p_from AND p_to
        AND b.status IN ('pending', 'confirmed', 'in_progress', 'disputed', 'completed')
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.company_schedule(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_schedule(date, date) TO authenticated;

-- ── 6) Mis trabajos (con mis horas) y quién va para el cliente ────────────────────
DROP FUNCTION IF EXISTS public.my_jobs(date, date);
CREATE FUNCTION public.my_jobs(p_from date, p_to date)
RETURNS TABLE (
  booking_id uuid,
  date date,
  start_time time,
  duration_hours integer,
  status text,
  service_name text,
  client_address text,
  client_name text,
  client_phone text,
  notes text,
  company_name text,
  assignment_pending boolean,
  finished_at timestamptz,
  service_start timestamptz,
  my_hours integer[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.date, b.start_time::time, b.duration_hours, b.status, s.name,
         b.client_address, NULLIF(BTRIM(cp.full_name), ''), NULLIF(BTRIM(cp.phone), ''), b.notes,
         gp.full_name, b.assignment_pending, b.gardener_finished_at, public.booking_service_start(b),
         (SELECT array_agg(bb.hour_block ORDER BY bb.hour_block) FROM public.booking_blocks bb
          WHERE bb.booking_id = b.id AND bb.assignee_id = auth.uid())
  FROM public.bookings b
  JOIN public.services s ON s.id = b.service_id
  JOIN public.gardener_profiles gp ON gp.user_id = b.gardener_id
  LEFT JOIN public.profiles cp ON cp.user_id = b.client_id
  WHERE b.date BETWEEN p_from AND p_to
    AND b.status IN ('pending', 'confirmed', 'in_progress', 'completed', 'disputed')
    AND EXISTS (SELECT 1 FROM public.booking_blocks bb WHERE bb.booking_id = b.id AND bb.assignee_id = auth.uid())
  ORDER BY b.date, b.start_time;
$$;
REVOKE ALL ON FUNCTION public.my_jobs(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_jobs(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.booking_worker_for_client(p_booking_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH b AS (
    SELECT b.* FROM public.bookings b
    JOIN public.gardener_profiles gp ON gp.user_id = b.gardener_id AND gp.provider_kind = 'company'
    WHERE b.id = p_booking_id
      AND b.client_id = auth.uid()
      AND b.status IN ('confirmed', 'in_progress')
      AND (now() AT TIME ZONE 'Europe/Madrid')::date >= b.date - 1
  ),
  people AS (
    SELECT bb.assignee_id, MIN(bb.hour_block) AS first_hour,
      CASE
        WHEN BTRIM(COALESCE(p.full_name, '')) = '' THEN NULL
        WHEN strpos(BTRIM(p.full_name), ' ') = 0 THEN BTRIM(p.full_name)
        ELSE split_part(BTRIM(p.full_name), ' ', 1) || ' ' || left(split_part(BTRIM(p.full_name), ' ', 2), 1) || '.'
      END AS name,
      p.avatar_url
    FROM b JOIN public.booking_blocks bb ON bb.booking_id = b.id
    LEFT JOIN public.profiles p ON p.user_id = bb.assignee_id
    GROUP BY bb.assignee_id, p.full_name, p.avatar_url
  )
  SELECT jsonb_build_object(
    'name', (SELECT name FROM people ORDER BY first_hour LIMIT 1),
    'avatar_url', (SELECT avatar_url FROM people ORDER BY first_hour LIMIT 1),
    'workers', (SELECT jsonb_agg(jsonb_build_object('name', name, 'avatar_url', avatar_url) ORDER BY first_hour) FROM people)
  )
  WHERE EXISTS (SELECT 1 FROM b);
$$;
