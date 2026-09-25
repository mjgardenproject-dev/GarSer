-- GarSer Empresas · F4.1: una empresa vende con las horas de su equipo.
--
-- Decisión del usuario (2026-09-24, H-26): contar «cuántos hay libres» a cada hora vendería
-- trabajos de varias horas que nadie puede hacer entero. Así que al vender se aparta a UNA
-- persona concreta que hace el servicio y está libre todas las horas; y el dueño decide en su
-- configuración si esa persona es definitiva (GarSer elige) o una propuesta (él elige quién va,
-- pantalla en F5).
--
-- Para un autónomo «la persona» es él mismo: todo su camino hace exactamente lo de antes.
--
-- 1) companies.assignment_mode ('auto' | 'manual') y su RPC.
-- 2) provider_workers(): quién puede hacer un servicio para un proveedor (A-12, A-13, A-14).
-- 3) provider_free_hours(): horas libres de cada una de esas personas. Fuente única para la web
--    (booking-authority) y para el pago (booking-payment), que hasta ahora lo calculaban cada uno.
-- 4) pick_provider_worker(): elige y bloquea a la persona al vender.
-- 5) El camino del dinero opera por persona: prepare (bloqueo al pagar), confirm, reserve, resize.
--    release_booking_schedule ya lo hacía desde F1.
-- 6) bookings.assignment_pending: la persona es una propuesta (empresa en modo manual).
-- 7) El directorio público dice si el proveedor es empresa (distintivo en el listado).

-- ── 1) Modo de asignación ────────────────────────────────────────────────────────
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS assignment_mode text NOT NULL DEFAULT 'auto'
  CHECK (assignment_mode IN ('auto', 'manual'));
COMMENT ON COLUMN public.companies.assignment_mode IS
  'auto: GarSer elige quién del equipo va y es definitivo. manual: GarSer aparta a alguien libre como propuesta y el dueño confirma o cambia quién va.';

ALTER TABLE public.booking_schedule_holds
  ADD COLUMN IF NOT EXISTS assignee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.booking_schedule_holds.assignee_id IS
  'Persona cuyas horas se bloquean mientras se paga. Autónomo: él mismo. Empresa: la persona apartada.';
COMMENT ON COLUMN public.booking_schedule_hold_blocks.gardener_id IS
  'Persona cuyas horas se bloquean (no el proveedor): en una empresa, la persona apartada.';

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS assignment_pending boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.bookings.assignment_pending IS
  'true: la persona que figura en los bloques es una propuesta pendiente de que el dueño de la empresa confirme quién va (modo manual).';

CREATE OR REPLACE FUNCTION public.set_company_assignment_mode(p_mode text)
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
  IF p_mode IS NULL OR p_mode NOT IN ('auto', 'manual') THEN
    RAISE EXCEPTION 'Opción no válida.';
  END IF;
  UPDATE public.companies SET assignment_mode = p_mode, updated_at = now() WHERE id = v_company_id;
  RETURN jsonb_build_object('assignment_mode', p_mode);
END;
$$;
REVOKE ALL ON FUNCTION public.set_company_assignment_mode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_company_assignment_mode(text) TO authenticated;

-- ── 2) Quién puede hacer el trabajo ───────────────────────────────────────────────
-- Autónomo: él mismo. Empresa ACTIVA: los miembros activos que trabajan (el dueño solo si
-- activó «Yo también trabajo»), que tienen asignado ese servicio y, si el trabajo exige
-- carnet, lo tienen aprobado y en vigor. Una empresa no activa no tiene a nadie.
CREATE OR REPLACE FUNCTION public.provider_workers(p_provider uuid, p_service uuid, p_requires_license boolean DEFAULT false)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_provider
  WHERE NOT EXISTS (
    SELECT 1 FROM public.gardener_profiles gp WHERE gp.user_id = p_provider AND gp.provider_kind = 'company'
  )
  UNION ALL
  SELECT m.user_id
  FROM public.companies c
  JOIN public.gardener_profiles gp ON gp.user_id = c.provider_user_id AND gp.provider_kind = 'company'
  JOIN public.company_members m ON m.company_id = c.id AND m.status = 'active' AND m.counts_as_labour
  JOIN public.company_member_services cms ON cms.member_id = m.id AND cms.service_id = p_service
  WHERE c.provider_user_id = p_provider
    AND c.status = 'active'
    AND (NOT COALESCE(p_requires_license, false) OR public.has_valid_phyto_license(m.user_id));
$$;

-- ── 3) Horas libres por persona ───────────────────────────────────────────────────
-- Una hora está libre para una persona si la marcó disponible, nadie la tiene bloqueada
-- pagando (salvo los bloqueos que se indiquen: los del propio pago que se revalida) y no la
-- tiene ya en su agenda.
CREATE OR REPLACE FUNCTION public.provider_free_hours(
  p_provider_ids uuid[],
  p_service_id uuid,
  p_start date,
  p_end date,
  p_requires_license boolean DEFAULT false,
  p_exclude_hold_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS TABLE (provider_id uuid, worker_id uuid, date date, hour integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT p.provider_id, w.worker_id, a.date, EXTRACT(HOUR FROM a.start_time)::integer
  FROM unnest(p_provider_ids) AS p(provider_id)
  CROSS JOIN LATERAL public.provider_workers(p.provider_id, p_service_id, p_requires_license) AS w(worker_id)
  JOIN public.availability a
    ON a.gardener_id = w.worker_id
   AND a.is_available = true
   AND a.date BETWEEN p_start AND p_end
  WHERE NOT EXISTS (
      SELECT 1 FROM public.booking_schedule_hold_blocks hb
      WHERE hb.gardener_id = w.worker_id
        AND hb.date = a.date
        AND hb.hour_block = EXTRACT(HOUR FROM a.start_time)::integer
        AND NOT (hb.hold_id = ANY (COALESCE(p_exclude_hold_ids, '{}'::uuid[])))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.booking_blocks bb
      WHERE bb.assignee_id = w.worker_id
        AND bb.date = a.date
        AND bb.hour_block = EXTRACT(HOUR FROM a.start_time)::integer
    )
  ORDER BY 1, 2, 3, 4;
$$;

-- ── 4) Elegir a la persona al vender ──────────────────────────────────────────────
-- Autónomo: devuelve al propio proveedor sin más; quien llama hace las comprobaciones de
-- siempre (y da los mensajes de siempre). Empresa: recorre a las personas que pueden hacerlo,
-- primero las que menos horas tienen ya ese día, bloquea sus horas y devuelve la primera libre
-- en TODA la franja. Si dos clientes pagan a la vez, el segundo espera al bloqueo del primero
-- y ve sus horas ya apartadas: se lleva a otra persona o a nadie. NULL = nadie libre.
CREATE OR REPLACE FUNCTION public.pick_provider_worker(
  p_provider uuid,
  p_service uuid,
  p_date date,
  p_start_hour integer,
  p_end_hour integer,
  p_requires_license boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.gardener_profiles gp WHERE gp.user_id = p_provider AND gp.provider_kind = 'company'
  ) THEN
    RETURN p_provider;
  END IF;

  FOR v_candidate IN
    SELECT w.worker_id
    FROM public.provider_workers(p_provider, p_service, p_requires_license) AS w(worker_id)
    ORDER BY (
      SELECT count(*) FROM public.booking_blocks bb WHERE bb.assignee_id = w.worker_id AND bb.date = p_date
    ), w.worker_id
  LOOP
    PERFORM 1
    FROM public.availability
    WHERE gardener_id = v_candidate
      AND date = p_date
      AND is_available = true
      AND EXTRACT(HOUR FROM start_time) >= p_start_hour
      AND EXTRACT(HOUR FROM start_time) < p_end_hour
    FOR UPDATE;

    IF public.count_distinct_available_legacy_hours(v_candidate, p_date, p_start_hour, p_end_hour) = p_end_hour - p_start_hour
      AND NOT EXISTS (
        SELECT 1 FROM public.booking_schedule_hold_blocks hb
        WHERE hb.gardener_id = v_candidate AND hb.date = p_date
          AND hb.hour_block >= p_start_hour AND hb.hour_block < p_end_hour
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.booking_blocks bb
        WHERE bb.assignee_id = v_candidate AND bb.date = p_date
          AND bb.hour_block >= p_start_hour AND bb.hour_block < p_end_hour
      )
    THEN
      RETURN v_candidate;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

-- ¿Exige carnet este trabajo? Lo decide booking-authority al presupuestar (mismo criterio que
-- el filtro del listado) y lo deja en el presupuesto. Para reservas sin presupuesto guardado,
-- se toma el lado seguro: fitosanitarios siempre lo exige.
CREATE OR REPLACE FUNCTION public.booking_requires_phyto_license(p_booking_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (b.pricing_context -> 'quote_snapshot' ->> 'requiresPhytosanitaryLicense')::boolean,
    s.name = 'Servicios fitosanitarios',
    false
  )
  FROM public.bookings b LEFT JOIN public.services s ON s.id = b.service_id
  WHERE b.id = p_booking_id;
$$;

REVOKE ALL ON FUNCTION public.provider_workers(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.provider_free_hours(uuid[], uuid, date, date, boolean, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pick_provider_worker(uuid, uuid, date, integer, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booking_requires_phyto_license(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_free_hours(uuid[], uuid, date, date, boolean, uuid[]) TO service_role;

-- ── 5) El camino del dinero, por persona ──────────────────────────────────────────
-- Las cuatro funciones son las mismas de antes con un único cambio: donde decidían o
-- escribían horas «del proveedor», ahora lo hacen de la persona (v_worker). Para un autónomo
-- v_worker es el proveedor.

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
  IF v_worker IS NULL THEN
    RAISE EXCEPTION 'La franja seleccionada ya no esta disponible para iniciar el pago.';
  END IF;

  PERFORM 1
  FROM public.availability
  WHERE gardener_id = v_worker
    AND date = v_quote.selected_date
    AND is_available = true
    AND EXTRACT(HOUR FROM start_time) >= v_start_hour
    AND EXTRACT(HOUR FROM start_time) < v_end_hour
  FOR UPDATE;

  v_available_count := public.count_distinct_available_legacy_hours(
    v_worker,
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
  SELECT v_hold_id, v_worker, v_quote.selected_date, hour_block
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

  PERFORM 1
  FROM public.availability
  WHERE gardener_id = v_worker
    AND date = v_attempt.selected_date
    AND is_available = true
    AND EXTRACT(HOUR FROM start_time) >= v_start_hour
    AND EXTRACT(HOUR FROM start_time) < v_end_hour
  FOR UPDATE;

  v_available_count := public.count_distinct_available_legacy_hours(
    v_worker,
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
    WHERE hb.gardener_id = v_worker
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
    SELECT v_booking_id, v_attempt.selected_date, hour_block, v_worker
    FROM generate_series(v_start_hour, v_end_hour - 1) AS hour_block
    ON CONFLICT (booking_id, date, hour_block) DO NOTHING;

    UPDATE public.availability
    SET is_available = false
    WHERE gardener_id = v_worker
      AND date = v_attempt.selected_date
      AND EXTRACT(HOUR FROM start_time) >= v_start_hour
      AND EXTRACT(HOUR FROM start_time) < v_end_hour;

    UPDATE public.availability_blocks
    SET is_available = false
    WHERE gardener_id = v_worker
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
  v_worker uuid;
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

  -- F4 (GarSer Empresas): la persona que ocupa las horas. Autónomo: él mismo.
  v_worker := public.pick_provider_worker(
    v_booking.gardener_id, v_booking.service_id, v_booking.date, v_start_hour, v_end_hour,
    public.booking_requires_phyto_license(p_booking_id)
  );
  IF v_worker IS NULL THEN
    RAISE EXCEPTION 'La franja seleccionada ya no está disponible.';
  END IF;

  -- F1 (GarSer Empresas, H-01): la franja se comprueba en `availability`, la misma fuente y
  -- con el mismo criterio que la web, el pago y confirm_booking_payment_attempt. Antes se
  -- miraba availability_blocks (solo la rellena el generador nocturno): el jardinero podía no
  -- poder aceptar una hora que la web ofrecía como libre. El espejo se sigue escribiendo.
  PERFORM 1
  FROM public.availability
  WHERE gardener_id = v_worker
    AND date = v_booking.date
    AND is_available = true
    AND EXTRACT(HOUR FROM start_time) >= v_start_hour
    AND EXTRACT(HOUR FROM start_time) < v_end_hour
  FOR UPDATE;

  v_available_count := public.count_distinct_available_legacy_hours(
    v_worker, v_booking.date, v_start_hour, v_end_hour
  );

  IF v_available_count <> v_booking.duration_hours THEN
    RAISE EXCEPTION 'La franja seleccionada ya no está disponible.';
  END IF;

  INSERT INTO public.booking_blocks (booking_id, date, hour_block, assignee_id)
  SELECT p_booking_id, v_booking.date, hour_block, v_worker
  FROM generate_series(v_start_hour, v_end_hour - 1) AS hour_block;

  UPDATE public.availability_blocks
  SET is_available = false
  WHERE gardener_id = v_worker
    AND date = v_booking.date
    AND hour_block >= v_start_hour
    AND hour_block < v_end_hour;

  UPDATE public.availability
  SET is_available = false
  WHERE gardener_id = v_worker
    AND date = v_booking.date
    AND EXTRACT(HOUR FROM start_time) >= v_start_hour
    AND EXTRACT(HOUR FROM start_time) < v_end_hour;

  UPDATE public.bookings
  SET assignment_pending = EXISTS (
    SELECT 1 FROM public.companies co
    WHERE co.provider_user_id = v_booking.gardener_id AND co.assignment_mode = 'manual'
  )
  WHERE id = p_booking_id;
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
  v_worker := COALESCE(
    (SELECT bb.assignee_id FROM public.booking_blocks bb WHERE bb.booking_id = p_booking_id LIMIT 1),
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
    -- Acortar: libera [v_new_end_hour, v_old_end_hour) en las tres tablas.
    DELETE FROM public.booking_blocks
    WHERE booking_id = p_booking_id
      AND hour_block >= v_new_end_hour
      AND hour_block < v_old_end_hour;

    UPDATE public.availability_blocks
    SET is_available = true
    WHERE gardener_id = v_worker
      AND date = v_booking.date
      AND hour_block >= v_new_end_hour
      AND hour_block < v_old_end_hour;

    UPDATE public.availability
    SET is_available = true
    WHERE gardener_id = v_worker
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


-- ── 6) Panel de la empresa: incluye el modo de asignación ─────────────────────────
CREATE OR REPLACE FUNCTION public.company_team_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- ── 7) Directorio público: empresa o autónomo ─────────────────────────────────────
CREATE OR REPLACE VIEW public.public_gardener_directory AS
 SELECT user_id,
    full_name,
    avatar_url,
    rating,
    rating_average,
    rating_count,
    total_reviews,
    services,
    max_distance,
    description,
    is_available,
    has_phytosanitary_license,
    provider_kind
   FROM gardener_profiles;
