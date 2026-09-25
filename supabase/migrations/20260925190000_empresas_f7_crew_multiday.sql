-- GarSer Empresas · F7.1: equipos y trabajos de varios días (servidor).
--
-- Decisiones del usuario (2026-09-24): D11 — la empresa pone un límite de personas a la vez y
-- GarSer arma el equipo más pequeño que acabe cuanto antes; D12 — los trabajos de varios días
-- también para autónomos; D13 — en varios días cada persona trabaja las horas libres seguidas
-- que tenga (con el tope de 12 h por jornada).
--
-- L = horas de trabajo del presupuesto (mano de obra). El precio sale de L y no cambia con el
-- número de personas.
--
-- 1) Modelo: companies.max_crew; bookings.end_date (último día, nulo = un día) y
--    bookings.labour_hours (solo en trabajos de equipo o de varios días; nulo = igual que
--    duration_hours). duration_hours sigue siendo lo que dura el PRIMER día (≤ 12: los guardas
--    de H-02 no se tocan). La agenda admite varias personas en la misma hora del mismo trabajo.
-- 2) plan_booking_cells(): EL planificador. Devuelve quién hace cada hora de cada día. La web
--    (booking-authority, F7.2) repite la misma regla en TypeScript y una prueba comprueba que
--    coinciden.
-- 3) Pago: prepare aparta las celdas del planificador; confirm las convierte en la agenda.
-- 4) Trabajos de equipo o varios días: no se alargan/acortan ni se reparten por horas; sí se
--    cambia una persona por otra en todo el trabajo (replace_booking_worker) y se mueven de
--    fecha volviendo a planificar.
-- 5) Agendas (empresa y empleado) con trabajos que empiezan antes del rango y horas por día.

-- ── 1) Modelo ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS max_crew integer NOT NULL DEFAULT 1;
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_max_crew_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_max_crew_check CHECK (max_crew BETWEEN 1 AND 10);
COMMENT ON COLUMN public.companies.max_crew IS
  'D11: cuántas personas pueden ir a la vez a un mismo trabajo (1 = nunca en equipo).';

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS labour_hours integer;
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_end_date_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_end_date_check CHECK (end_date IS NULL OR (end_date > date AND end_date <= date + 20));
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_labour_hours_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_labour_hours_check CHECK (labour_hours IS NULL OR labour_hours BETWEEN 1 AND 250);
COMMENT ON COLUMN public.bookings.end_date IS
  'F7: último día de un trabajo de varios días. Nulo = el trabajo es de un día (date).';
COMMENT ON COLUMN public.bookings.labour_hours IS
  'F7: horas de trabajo totales, solo en trabajos de equipo o de varios días. Nulo = trabajo normal (una persona o por turnos): las horas son duration_hours.';

ALTER TABLE public.booking_payment_attempts ADD COLUMN IF NOT EXISTS labour_hours integer;
ALTER TABLE public.booking_payment_attempts ADD COLUMN IF NOT EXISTS end_date date;

-- Varias personas en la misma hora del mismo trabajo. Que una PERSONA no esté en dos sitios lo
-- sigue garantizando uq_booking_blocks_assignee_slot (assignee_id, date, hour_block).
ALTER TABLE public.booking_blocks DROP CONSTRAINT IF EXISTS booking_blocks_booking_id_date_hour_block_key;
ALTER TABLE public.booking_blocks DROP CONSTRAINT IF EXISTS booking_blocks_booking_cell_key;
ALTER TABLE public.booking_blocks ADD CONSTRAINT booking_blocks_booking_cell_key UNIQUE (booking_id, date, hour_block, assignee_id);

-- El bloqueo del pago, igual: varios días y varias personas por hora. Que una persona no esté
-- apartada dos veces lo sigue garantizando idx_booking_schedule_hold_blocks_unique_slot.
ALTER TABLE public.booking_schedule_hold_blocks DROP CONSTRAINT IF EXISTS booking_schedule_hold_blocks_pkey;
ALTER TABLE public.booking_schedule_hold_blocks ADD CONSTRAINT booking_schedule_hold_blocks_pkey PRIMARY KEY (hold_id, date, hour_block, gardener_id);

CREATE OR REPLACE FUNCTION public.set_company_max_crew(p_max integer)
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
  IF p_max IS NULL OR p_max < 1 OR p_max > 10 THEN
    RAISE EXCEPTION 'Elige entre 1 y 10 personas.';
  END IF;
  UPDATE public.companies SET max_crew = p_max, updated_at = now() WHERE id = v_company_id;
  RETURN jsonb_build_object('max_crew', p_max);
END;
$$;
REVOKE ALL ON FUNCTION public.set_company_max_crew(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_company_max_crew(integer) TO authenticated;

-- Autónomo: siempre 1 (D11).
CREATE OR REPLACE FUNCTION public.provider_max_crew(p_provider uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT c.max_crew FROM public.companies c
    JOIN public.gardener_profiles gp ON gp.user_id = c.provider_user_id AND gp.provider_kind = 'company'
    WHERE c.provider_user_id = p_provider AND c.status = 'active'
  ), 1);
$$;
REVOKE ALL ON FUNCTION public.provider_max_crew(uuid) FROM PUBLIC, anon, authenticated;

-- ── 2) El planificador ────────────────────────────────────────────────────────────
-- Horas libres seguidas desde p_from, con el tope de 12 h por jornada y hasta las 20:00.
-- La web usa exactamente esta regla (freeRun en bookingEligibilityCore.ts).
CREATE OR REPLACE FUNCTION public.free_run(p_hours integer[], p_from integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_from IS NULL OR p_from < 0 OR p_from > 19 THEN 0
    ELSE COALESCE(
      (SELECT MIN(g) FROM generate_series(p_from, LEAST(p_from + 11, 19)) AS g WHERE NOT (g = ANY (COALESCE(p_hours, '{}')))),
      LEAST(p_from + 12, 20)
    ) - p_from
  END;
$$;

-- Quién hace cada hora de cada día de un trabajo de p_labour horas que empieza el p_date a las
-- p_start_hour. Sin filas = no se puede. Reglas (diseño F7, 01-PLAN):
--  a) En un día, con el equipo más pequeño (1 … límite de la empresa): todos empiezan a la hora
--     elegida y se reparten L a partes iguales (los primeros, una hora más). La jornada, como
--     mucho 12 h y hasta las 20:00.
--  b) Si no hay equipo y la empresa acepta trabajos partidos (D10) y L ≤ 12: por turnos, una
--     persona por hora (F6).
--  c) Un trabajo de 12 h o menos nunca se parte en varios días. Si L > 12: días seguidos desde
--     p_date (se saltan los días sin nadie), hasta 21 días. El primer día todos empiezan a la
--     hora elegida (y alguien tiene que poder); los demás, cada persona desde su primera hora
--     libre. Cada día van hasta N personas, las que más horas seguidas tienen, cada una con sus
--     horas seguidas (D13).
-- p_ignore_booking: sus horas cuentan como libres (para volver a planificar ese trabajo).
-- La elección entre personas igual de válidas (menos carga ese día) no cambia si se puede ni
-- hasta qué día dura: la web, que no conoce la carga, llega al mismo resultado.
CREATE OR REPLACE FUNCTION public.plan_booking_cells(
  p_provider uuid,
  p_service uuid,
  p_date date,
  p_start_hour integer,
  p_labour integer,
  p_requires_license boolean DEFAULT false,
  p_ignore_booking uuid DEFAULT NULL
)
RETURNS TABLE(date date, hour_block integer, worker_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_crew integer := public.provider_max_crew(p_provider);
  v_days integer;
  v_free jsonb;
  v_k integer;
  v_span integer;
  v_base integer;
  v_extra integer;
  v_len integer;
  v_remaining integer;
  v_used integer;
  v_day date;
  v_prev uuid;
  v_pick uuid;
  v_taken uuid[];
  v_row record;
  h integer;
  i integer;
  c_d date[] := '{}';
  c_h integer[] := '{}';
  c_w uuid[] := '{}';
BEGIN
  IF p_labour IS NULL OR p_labour < 1 OR p_date IS NULL OR p_start_hour IS NULL OR p_start_hour < 0 OR p_start_hour > 19 THEN
    RETURN;
  END IF;
  v_days := CASE WHEN p_labour > 12 THEN 21 ELSE 1 END;

  -- Horas libres de cada persona que puede hacer el trabajo, por día: {"<persona>|<día>": [h…]}.
  SELECT COALESCE(jsonb_object_agg(x.k, x.hours), '{}'::jsonb) INTO v_free
  FROM (
    SELECT w.worker_id::text || '|' || a.date::text AS k,
           jsonb_agg(DISTINCT EXTRACT(HOUR FROM a.start_time)::integer) AS hours
    FROM public.provider_workers(p_provider, p_service, p_requires_license) AS w(worker_id)
    JOIN public.availability a
      ON a.gardener_id = w.worker_id AND a.date BETWEEN p_date AND p_date + v_days - 1
    WHERE (
        a.is_available
        AND NOT EXISTS (
          SELECT 1 FROM public.booking_schedule_hold_blocks hb
          WHERE hb.gardener_id = w.worker_id AND hb.date = a.date AND hb.hour_block = EXTRACT(HOUR FROM a.start_time)::integer
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.booking_blocks bb
          WHERE bb.assignee_id = w.worker_id AND bb.date = a.date AND bb.hour_block = EXTRACT(HOUR FROM a.start_time)::integer
            AND bb.booking_id IS DISTINCT FROM p_ignore_booking
        )
      )
      OR EXISTS (
        SELECT 1 FROM public.booking_blocks bb
        WHERE bb.booking_id = p_ignore_booking AND bb.assignee_id = w.worker_id
          AND bb.date = a.date AND bb.hour_block = EXTRACT(HOUR FROM a.start_time)::integer
      )
    GROUP BY 1
  ) x;

  -- a) Un día, el equipo más pequeño.
  FOR v_k IN 1 .. LEAST(v_max_crew, p_labour) LOOP
    v_span := CEIL(p_labour::numeric / v_k)::integer;
    CONTINUE WHEN v_span > 12 OR p_start_hour + v_span > 20;
    v_base := p_labour / v_k;
    v_extra := p_labour % v_k;
    v_taken := '{}';
    -- Primero quienes hacen una hora más (necesitan base + 1 seguidas), luego el resto (base).
    FOR i IN 1 .. v_k LOOP
      v_len := v_base + CASE WHEN i <= v_extra THEN 1 ELSE 0 END;
      SELECT w.worker_id INTO v_pick
      FROM public.provider_workers(p_provider, p_service, p_requires_license) AS w(worker_id)
      WHERE NOT (w.worker_id = ANY (v_taken))
        AND public.free_run(ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_free -> (w.worker_id::text || '|' || p_date::text), '[]'::jsonb))::integer), p_start_hour) >= v_len
      ORDER BY (SELECT count(*) FROM public.booking_blocks bb WHERE bb.assignee_id = w.worker_id AND bb.date = p_date AND bb.booking_id IS DISTINCT FROM p_ignore_booking),
               w.worker_id
      LIMIT 1;
      EXIT WHEN v_pick IS NULL;
      v_taken := v_taken || v_pick;
      FOR h IN p_start_hour .. p_start_hour + v_len - 1 LOOP
        c_d := c_d || p_date; c_h := c_h || h; c_w := c_w || v_pick;
      END LOOP;
      v_pick := NULL;
    END LOOP;
    IF array_length(v_taken, 1) = v_k THEN
      RETURN QUERY SELECT * FROM unnest(c_d, c_h, c_w);
      RETURN;
    END IF;
    c_d := '{}'; c_h := '{}'; c_w := '{}';
  END LOOP;

  -- b) Por turnos (D10), con los menos cambios de persona posibles.
  IF p_labour <= 12 THEN
    IF p_start_hour + p_labour > 20 OR NOT public.provider_allows_split_jobs(p_provider) THEN
      RETURN;
    END IF;
    FOR h IN p_start_hour .. p_start_hour + p_labour - 1 LOOP
      IF v_prev IS NOT NULL AND (v_free -> (v_prev::text || '|' || p_date::text)) @> to_jsonb(h) THEN
        c_d := c_d || p_date; c_h := c_h || h; c_w := c_w || v_prev;
        CONTINUE;
      END IF;
      v_pick := NULL;
      SELECT w.worker_id INTO v_pick
      FROM public.provider_workers(p_provider, p_service, p_requires_license) AS w(worker_id)
      WHERE (v_free -> (w.worker_id::text || '|' || p_date::text)) @> to_jsonb(h)
      ORDER BY LEAST(
                 public.free_run(ARRAY(SELECT jsonb_array_elements_text(v_free -> (w.worker_id::text || '|' || p_date::text))::integer), h),
                 p_start_hour + p_labour - h
               ) DESC,
               (SELECT count(*) FROM public.booking_blocks bb WHERE bb.assignee_id = w.worker_id AND bb.date = p_date AND bb.booking_id IS DISTINCT FROM p_ignore_booking),
               w.worker_id
      LIMIT 1;
      IF v_pick IS NULL THEN
        RETURN;
      END IF;
      c_d := c_d || p_date; c_h := c_h || h; c_w := c_w || v_pick;
      v_prev := v_pick;
    END LOOP;
    RETURN QUERY SELECT * FROM unnest(c_d, c_h, c_w);
    RETURN;
  END IF;

  -- c) Varios días.
  v_remaining := p_labour;
  FOR i IN 0 .. v_days - 1 LOOP
    v_day := p_date + i;
    v_used := 0;
    FOR v_row IN
      SELECT t.worker_id, t.from_hour, public.free_run(t.hours, t.from_hour) AS run
      FROM (
        SELECT w.worker_id,
               ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_free -> (w.worker_id::text || '|' || v_day::text), '[]'::jsonb))::integer) AS hours,
               CASE WHEN i = 0 THEN p_start_hour ELSE (
                 SELECT MIN(x::integer) FROM jsonb_array_elements_text(COALESCE(v_free -> (w.worker_id::text || '|' || v_day::text), '[]'::jsonb)) AS x
               ) END AS from_hour
        FROM public.provider_workers(p_provider, p_service, p_requires_license) AS w(worker_id)
      ) t
      WHERE public.free_run(t.hours, t.from_hour) > 0
      ORDER BY 3 DESC,
               (SELECT count(*) FROM public.booking_blocks bb WHERE bb.assignee_id = t.worker_id AND bb.date = v_day AND bb.booking_id IS DISTINCT FROM p_ignore_booking),
               t.worker_id
      LIMIT v_max_crew
    LOOP
      EXIT WHEN v_remaining = 0;
      v_len := LEAST(v_row.run, v_remaining);
      FOR h IN v_row.from_hour .. v_row.from_hour + v_len - 1 LOOP
        c_d := c_d || v_day; c_h := c_h || h; c_w := c_w || v_row.worker_id;
      END LOOP;
      v_remaining := v_remaining - v_len;
      v_used := v_used + 1;
    END LOOP;
    IF i = 0 AND v_used = 0 THEN
      RETURN;
    END IF;
    IF v_remaining = 0 THEN
      RETURN QUERY SELECT * FROM unnest(c_d, c_h, c_w);
      RETURN;
    END IF;
  END LOOP;
  RETURN;
END;
$$;
REVOKE ALL ON FUNCTION public.plan_booking_cells(uuid, uuid, date, integer, integer, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_booking_cells(uuid, uuid, date, integer, integer, boolean, uuid) TO service_role;

-- El fin del servicio (avisos de confirmación, cierre automático). En varios días, el final
-- de la jornada del último día.
CREATE OR REPLACE FUNCTION public.booking_service_end(p_booking bookings)
RETURNS timestamp with time zone
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_booking.end_date IS NOT NULL THEN ((p_booking.end_date + time '20:00') AT TIME ZONE 'Europe/Madrid')
    ELSE (((p_booking.date + p_booking.start_time) AT TIME ZONE 'Europe/Madrid')
          + make_interval(hours => GREATEST(COALESCE(p_booking.duration_hours, 1), 1)))
  END;
$$;

CREATE OR REPLACE FUNCTION public.set_booking_confirmation_window()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status <> 'confirmed' THEN
    RETURN NEW;
  END IF;

  -- Se recalcula al confirmar y TAMBIEN si cambia el horario de una reserva ya confirmada.
  -- Sin lo segundo, mover una reserva dejaria la fecha limite apuntando al dia viejo: el
  -- correo prometeria una fecha y el reloj aplicaria otra, que es justo lo que esta columna
  -- existe para impedir.
  IF TG_OP = 'INSERT'
     OR OLD.status IS DISTINCT FROM 'confirmed'
     OR NEW.confirmation_deadline_at IS NULL
     OR NEW.date IS DISTINCT FROM OLD.date
     OR NEW.start_time IS DISTINCT FROM OLD.start_time
     OR NEW.duration_hours IS DISTINCT FROM OLD.duration_hours
     OR NEW.end_date IS DISTINCT FROM OLD.end_date THEN
    NEW.confirmation_prompt_due_at := public.booking_service_end(NEW) + interval '1 hour';
    NEW.confirmation_deadline_at   := public.booking_service_end(NEW) + interval '24 hours';
    -- El aviso vuelve a la cola: el que se hubiera mandado hablaba de otra fecha.
    IF TG_OP = 'UPDATE' AND (
         NEW.date IS DISTINCT FROM OLD.date
         OR NEW.start_time IS DISTINCT FROM OLD.start_time
         OR NEW.duration_hours IS DISTINCT FROM OLD.duration_hours
     OR NEW.end_date IS DISTINCT FROM OLD.end_date) THEN
      NEW.confirmation_prompt_state := 'pending';
      NEW.confirmation_prompt_attempts := 0;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

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

  IF v_payable_now_cents <= 0 THEN
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
    v_quote.gardener_id, v_quote.service_id, v_quote.selected_date, v_start_hour, v_labour, v_requires_license
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
  ON CONFLICT (booking_id, date, hour_block, assignee_id) DO NOTHING;

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

  -- F7: un trabajo de equipo o de varios días no se alarga ni se acorta (se mueve de fecha).
  IF v_booking.labour_hours IS NOT NULL AND p_new_duration_hours IS DISTINCT FROM v_booking.duration_hours THEN
    RAISE EXCEPTION 'Este trabajo es de varias personas o de varios días: no se puede cambiar su duración.' USING ERRCODE = 'check_violation';
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
    ON CONFLICT (booking_id, date, hour_block, assignee_id) DO NOTHING;

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

CREATE OR REPLACE FUNCTION public.propose_booking_price_change(p_booking_id uuid, p_proposed_total_price numeric, p_reason text DEFAULT NULL::text, p_operation_id uuid DEFAULT NULL::uuid, p_expires_in_minutes integer DEFAULT 1440, p_proposed_duration_hours integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_reason text;
  v_payload_signature text;
  v_should_execute boolean;
  v_response jsonb;
  v_expires_at timestamptz;
  v_ttl_minutes integer;
  v_service_name text;
  v_is_palm_service boolean := false;
  v_has_terminal_open_range boolean := false;
BEGIN
  IF p_proposed_total_price IS NULL OR p_proposed_total_price <= 0 THEN
    RAISE EXCEPTION 'El nuevo precio debe ser mayor que 0.';
  END IF;

  -- D5: solo se mueve la hora de FIN. 1-12h es el mismo tope que ya usa el resto del
  -- ciclo de vida (create_broadcast_booking_requests) para duration_hours.
  IF p_proposed_duration_hours IS NOT NULL
     AND (p_proposed_duration_hours < 1 OR p_proposed_duration_hours > 12) THEN
    RAISE EXCEPTION 'La duración propuesta debe estar entre 1 y 12 horas.';
  END IF;

  v_ttl_minutes := GREATEST(1, LEAST(COALESCE(p_expires_in_minutes, 1440), 10080));
  v_reason := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
  v_payload_signature := format('%s|%s|%s|%s', p_proposed_total_price, COALESCE(v_reason, ''), v_ttl_minutes, COALESCE(p_proposed_duration_hours::text, ''));
  v_should_execute := public.register_booking_operation_once(
    'propose_booking_price_change',
    p_booking_id,
    p_operation_id,
    v_payload_signature
  );

  IF NOT v_should_execute THEN
    SELECT response_payload INTO v_response
    FROM public.booking_rpc_idempotency
    WHERE actor_id = auth.uid()
      AND action = 'propose_booking_price_change'
      AND operation_id = p_operation_id;
    RETURN COALESCE(v_response, jsonb_build_object('status', 'idempotent_replayed'));
  END IF;

  PERFORM public.expire_pending_price_change(p_booking_id);

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada.';
  END IF;

  -- F7: en un trabajo de equipo o de varios días solo se cambia el precio, no la duración.
  IF v_booking.labour_hours IS NOT NULL AND p_proposed_duration_hours IS NOT NULL
     AND p_proposed_duration_hours IS DISTINCT FROM v_booking.duration_hours THEN
    RAISE EXCEPTION 'Este trabajo es de varias personas o de varios días: puedes cambiar el precio, pero no la duración.';
  END IF;

  IF v_booking.gardener_id <> auth.uid() THEN
    RAISE EXCEPTION 'No autorizado para proponer cambio de precio.';
  END IF;

  IF COALESCE(v_booking.price_change_status, 'none') = 'pending_client_acceptance' THEN
    RAISE EXCEPTION 'Ya existe una propuesta de precio pendiente. Debe resolverse antes de crear otra.';
  END IF;

  SELECT s.name
  INTO v_service_name
  FROM public.services s
  WHERE s.id = v_booking.service_id;

  v_is_palm_service :=
    COALESCE(v_booking.pricing_context->>'service_type', '') = 'palm_pruning'
    OR COALESCE(v_service_name, '') ILIKE '%palmera%';

  IF v_is_palm_service THEN
    SELECT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(v_booking.pricing_context->'palm_groups', '[]'::jsonb)) elem
      WHERE COALESCE((elem->>'is_terminal_open_range')::boolean, false) = true
        AND (elem->>'quantity') ~ '^[0-9]+(\.[0-9]+)?$'
        AND (elem->>'quantity')::numeric > 0
    ) INTO v_has_terminal_open_range;

    IF NOT v_has_terminal_open_range THEN
      RAISE EXCEPTION 'No se permite proponer cambio de precio en palmeras fuera del último rango abierto de la especie.';
    END IF;
  END IF;

  v_expires_at := now() + make_interval(mins => v_ttl_minutes);

  UPDATE public.bookings
  SET price_change_status = 'pending_client_acceptance',
      proposed_total_price = p_proposed_total_price,
      proposed_duration_hours = p_proposed_duration_hours,
      proposed_price_reason = v_reason,
      proposed_price_by = auth.uid(),
      proposed_price_at = now(),
      proposed_price_expires_at = v_expires_at,
      updated_at = now()
  WHERE id = p_booking_id;

  INSERT INTO public.chat_messages (booking_id, sender_id, message)
  VALUES (
    p_booking_id,
    auth.uid(),
    format(
      'Propuesta de nuevo precio del servicio: %s.%s%s Los gastos de gestión ya abonados no cambian.',
      public.format_eur(p_proposed_total_price),
      CASE WHEN p_proposed_duration_hours IS NULL OR p_proposed_duration_hours = v_booking.duration_hours THEN ''
           ELSE format(' Nueva duración estimada: %s h (antes %s h).', p_proposed_duration_hours, v_booking.duration_hours)
      END,
      CASE WHEN v_reason IS NULL THEN '' ELSE ' Motivo: ' || v_reason || '.' END
    )
  );

  v_response := jsonb_build_object(
    'status', 'pending_client_acceptance',
    'booking_id', p_booking_id,
    'proposed_total_price', p_proposed_total_price,
    'proposed_duration_hours', p_proposed_duration_hours,
    'expires_at', v_expires_at
  );
  PERFORM public.complete_booking_operation('propose_booking_price_change', p_operation_id, v_response);
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_booking_hours(p_booking_id uuid, p_workers uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF v_booking.labour_hours IS NOT NULL THEN
    RAISE EXCEPTION 'Este trabajo es de varias personas o de varios días: cambia a una persona por otra.';
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
$function$;

CREATE OR REPLACE FUNCTION public.booking_hour_options(p_booking_id uuid)
 RETURNS TABLE(user_id uuid, full_name text, free_hours integer[], current_hours integer[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_start integer;
  v_end integer;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.provider_user_id = v_booking.gardener_id AND public.is_company_owner(c.id)
  ) THEN
    RAISE EXCEPTION 'Solo el dueño de la empresa puede repartir este trabajo.';
  END IF;
  IF v_booking.labour_hours IS NOT NULL THEN
    RAISE EXCEPTION 'Este trabajo es de varias personas o de varios días: cambia a una persona por otra.';
  END IF;
  v_start := EXTRACT(HOUR FROM v_booking.start_time)::integer;
  v_end := v_start + GREATEST(COALESCE(v_booking.duration_hours, 1), 1);

  RETURN QUERY
  SELECT w.worker_id,
         COALESCE(NULLIF(BTRIM(p.full_name), ''), 'Sin nombre'),
         COALESCE((
           SELECT array_agg(h ORDER BY h) FROM generate_series(v_start, v_end - 1) AS h
           WHERE public.worker_free_at(w.worker_id, v_booking.date, h)
              OR EXISTS (SELECT 1 FROM public.booking_blocks bb WHERE bb.booking_id = p_booking_id AND bb.assignee_id = w.worker_id AND bb.hour_block = h)
         ), '{}'),
         COALESCE((
           SELECT array_agg(bb.hour_block ORDER BY bb.hour_block) FROM public.booking_blocks bb
           WHERE bb.booking_id = p_booking_id AND bb.assignee_id = w.worker_id
         ), '{}')
  FROM public.provider_workers(v_booking.gardener_id, v_booking.service_id, public.booking_requires_phyto_license(p_booking_id)) AS w(worker_id)
  LEFT JOIN public.profiles p ON p.user_id = w.worker_id
  ORDER BY 2;
END;
$function$;

CREATE OR REPLACE FUNCTION public.booking_assignment_candidates(p_booking_id uuid)
 RETURNS TABLE(user_id uuid, full_name text, is_current boolean, is_free boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_start integer;
  v_end integer;
  v_current uuid;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.provider_user_id = v_booking.gardener_id AND public.is_company_owner(c.id)
  ) THEN
    RAISE EXCEPTION 'Solo el dueño de la empresa puede ver quién puede ir.';
  END IF;
  IF v_booking.labour_hours IS NOT NULL THEN
    RAISE EXCEPTION 'Este trabajo es de varias personas o de varios días: cambia a una persona por otra.';
  END IF;

  v_start := EXTRACT(HOUR FROM v_booking.start_time)::integer;
  v_end := v_start + GREATEST(COALESCE(v_booking.duration_hours, 1), 1);
  SELECT bb.assignee_id INTO v_current FROM public.booking_blocks bb WHERE bb.booking_id = p_booking_id LIMIT 1;

  RETURN QUERY
  SELECT w.worker_id,
         NULLIF(BTRIM(p.full_name), ''),
         w.worker_id = v_current,
         w.worker_id = v_current OR (
           public.count_distinct_available_legacy_hours(w.worker_id, v_booking.date, v_start, v_end) = v_end - v_start
           AND NOT EXISTS (
             SELECT 1 FROM public.booking_blocks bb
             WHERE bb.assignee_id = w.worker_id AND bb.date = v_booking.date
               AND bb.hour_block >= v_start AND bb.hour_block < v_end AND bb.booking_id <> p_booking_id
           )
           AND NOT EXISTS (
             SELECT 1 FROM public.booking_schedule_hold_blocks hb
             WHERE hb.gardener_id = w.worker_id AND hb.date = v_booking.date
               AND hb.hour_block >= v_start AND hb.hour_block < v_end
           )
         )
  FROM public.provider_workers(v_booking.gardener_id, v_booking.service_id, public.booking_requires_phyto_license(p_booking_id)) AS w(worker_id)
  LEFT JOIN public.profiles p ON p.user_id = w.worker_id
  ORDER BY 3 DESC, 4 DESC, 2;
END;
$function$;


CREATE OR REPLACE FUNCTION public.assign_booking_worker(p_booking_id uuid, p_worker_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_duration integer;
  v_team boolean;
  v_result jsonb;
BEGIN
  SELECT GREATEST(COALESCE(duration_hours, 1), 1), labour_hours IS NOT NULL INTO v_duration, v_team
  FROM public.bookings WHERE id = p_booking_id;
  IF v_duration IS NULL THEN
    RAISE EXCEPTION 'Solo el dueño de la empresa puede decidir quién va.';
  END IF;
  IF v_team THEN
    RAISE EXCEPTION 'Este trabajo es de varias personas o de varios días: cambia a una persona por otra.';
  END IF;
  v_result := public.assign_booking_hours(p_booking_id, array_fill(p_worker_id, ARRAY[v_duration]));
  RETURN v_result || jsonb_build_object('workerId', p_worker_id);
END;
$$;

-- ── 4) Cambiar a una persona por otra en todo el trabajo ────────────────────────────
-- Las horas que le quedan (de hoy en adelante) a p_from pasan a p_to, que tiene que poder hacer
-- el servicio y estar libre en TODAS ellas. Sirve para cualquier trabajo; es la única forma de
-- reasignar uno de equipo o de varios días.
CREATE OR REPLACE FUNCTION public.replace_booking_worker(p_booking_id uuid, p_from uuid, p_to uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_dates date[];
  v_hours integer[];
  v_had_to boolean;
  i integer;
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
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN
    RAISE EXCEPTION 'Elige a otra persona.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.provider_workers(v_booking.gardener_id, v_booking.service_id, public.booking_requires_phyto_license(p_booking_id)) AS w(worker_id)
    WHERE w.worker_id = p_to
  ) THEN
    RAISE EXCEPTION 'Esa persona no puede hacer este trabajo: no tiene este servicio asignado o le falta el carnet.';
  END IF;

  SELECT array_agg(bb.date ORDER BY bb.date, bb.hour_block), array_agg(bb.hour_block ORDER BY bb.date, bb.hour_block)
  INTO v_dates, v_hours
  FROM public.booking_blocks bb
  WHERE bb.booking_id = p_booking_id AND bb.assignee_id = p_from AND bb.date >= current_date;
  IF v_dates IS NULL THEN
    RAISE EXCEPTION 'Esa persona no tiene horas pendientes en este trabajo.';
  END IF;

  PERFORM 1 FROM public.availability a
  JOIN unnest(v_dates, v_hours) AS c(d, h) ON a.date = c.d AND EXTRACT(HOUR FROM a.start_time) = c.h
  WHERE a.gardener_id = p_to
  FOR UPDATE OF a;
  FOR i IN 1 .. array_length(v_dates, 1) LOOP
    IF NOT public.worker_free_at(p_to, v_dates[i], v_hours[i]) THEN
      RAISE EXCEPTION 'Esa persona no está libre el % a las %:00.', to_char(v_dates[i], 'DD/MM'), v_hours[i];
    END IF;
  END LOOP;

  v_had_to := EXISTS (SELECT 1 FROM public.booking_blocks bb WHERE bb.booking_id = p_booking_id AND bb.assignee_id = p_to);

  -- Primero la agenda (protect_sold_availability no deja liberar una hora aún vendida).
  UPDATE public.booking_blocks bb SET assignee_id = p_to
  WHERE bb.booking_id = p_booking_id AND bb.assignee_id = p_from AND bb.date >= current_date;

  UPDATE public.availability a SET is_available = true
  FROM unnest(v_dates, v_hours) AS c(d, h)
  WHERE a.gardener_id = p_from AND a.date = c.d AND EXTRACT(HOUR FROM a.start_time) = c.h;
  UPDATE public.availability_blocks ab SET is_available = true
  FROM unnest(v_dates, v_hours) AS c(d, h)
  WHERE ab.gardener_id = p_from AND ab.date = c.d AND ab.hour_block = c.h;
  UPDATE public.availability a SET is_available = false
  FROM unnest(v_dates, v_hours) AS c(d, h)
  WHERE a.gardener_id = p_to AND a.date = c.d AND EXTRACT(HOUR FROM a.start_time) = c.h;
  UPDATE public.availability_blocks ab SET is_available = false
  FROM unnest(v_dates, v_hours) AS c(d, h)
  WHERE ab.gardener_id = p_to AND ab.date = c.d AND ab.hour_block = c.h;

  UPDATE public.bookings SET assignment_pending = false WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'bookingId', p_booking_id,
    'changed', true,
    'changedHours', array_length(v_dates, 1),
    'removedWorkerIds', CASE WHEN EXISTS (SELECT 1 FROM public.booking_blocks bb WHERE bb.booking_id = p_booking_id AND bb.assignee_id = p_from)
                             THEN '[]'::jsonb ELSE jsonb_build_array(p_from) END,
    'addedWorkerIds', CASE WHEN v_had_to THEN '[]'::jsonb ELSE jsonb_build_array(p_to) END,
    'previousWorkerId', p_from,
    'workerId', p_to
  );
END;
$$;
REVOKE ALL ON FUNCTION public.replace_booking_worker(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_booking_worker(uuid, uuid, uuid) TO authenticated;

-- Para la pantalla: quién podría sustituir a p_from (libre en todas sus horas pendientes).
CREATE OR REPLACE FUNCTION public.booking_replace_candidates(p_booking_id uuid, p_from uuid)
RETURNS TABLE(user_id uuid, full_name text, is_free boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.provider_user_id = v_booking.gardener_id AND public.is_company_owner(c.id)
  ) THEN
    RAISE EXCEPTION 'Solo el dueño de la empresa puede ver quién puede ir.';
  END IF;

  RETURN QUERY
  SELECT w.worker_id,
         COALESCE(NULLIF(BTRIM(p.full_name), ''), 'Sin nombre'),
         NOT EXISTS (
           SELECT 1 FROM public.booking_blocks bb
           WHERE bb.booking_id = p_booking_id AND bb.assignee_id = p_from AND bb.date >= current_date
             AND NOT public.worker_free_at(w.worker_id, bb.date, bb.hour_block)
         )
  FROM public.provider_workers(v_booking.gardener_id, v_booking.service_id, public.booking_requires_phyto_license(p_booking_id)) AS w(worker_id)
  LEFT JOIN public.profiles p ON p.user_id = w.worker_id
  WHERE w.worker_id <> p_from
  ORDER BY 3 DESC, 2;
END;
$$;
REVOKE ALL ON FUNCTION public.booking_replace_candidates(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_replace_candidates(uuid, uuid) TO authenticated;

-- ── 4) Mover de fecha: se vuelve a planificar ────────────────────────────────────
-- Trabajo normal: lo de F6 (booking_slot_workers, primero quien ya va). Trabajo de equipo o de
-- varios días: el planificador con sus mismas horas de trabajo, contando las suyas como libres.
CREATE OR REPLACE FUNCTION public.booking_replan_cells(p_booking_id uuid, p_date date, p_start_hour integer)
RETURNS TABLE(date date, hour_block integer, worker_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_workers uuid[];
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND OR p_date IS NULL OR p_start_hour IS NULL THEN
    RETURN;
  END IF;
  IF v_booking.labour_hours IS NULL THEN
    v_workers := public.booking_slot_workers(p_booking_id, p_date, p_start_hour);
    IF v_workers IS NULL THEN
      RETURN;
    END IF;
    RETURN QUERY SELECT p_date, (p_start_hour + w.idx - 1)::integer, w.wid
    FROM unnest(v_workers) WITH ORDINALITY AS w(wid, idx);
    RETURN;
  END IF;
  IF p_start_hour < 7 THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT c.date, c.hour_block, c.worker_id
  FROM public.plan_booking_cells(
    v_booking.gardener_id, v_booking.service_id, p_date, p_start_hour, v_booking.labour_hours,
    public.booking_requires_phyto_license(p_booking_id), p_booking_id
  ) AS c;
END;
$$;
REVOKE ALL ON FUNCTION public.booking_replan_cells(uuid, date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_replan_cells(uuid, date, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.reschedule_options(p_booking_id uuid, p_date date)
RETURNS integer[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_result integer[] := '{}';
  h integer;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.companies c WHERE c.provider_user_id = v_booking.gardener_id AND public.is_company_owner(c.id)
  ) THEN
    RAISE EXCEPTION 'Solo el dueño de la empresa puede mover este trabajo.';
  END IF;
  IF p_date < current_date THEN RETURN v_result; END IF;
  FOR h IN 7 .. 19 LOOP
    CONTINUE WHEN p_date = v_booking.date AND h = EXTRACT(HOUR FROM v_booking.start_time)::integer;
    IF EXISTS (SELECT 1 FROM public.booking_replan_cells(p_booking_id, p_date, h)) THEN
      v_result := v_result || h;
    END IF;
  END LOOP;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.propose_booking_reschedule(p_booking_id uuid, p_date date, p_start_hour integer, p_reason text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.companies c WHERE c.provider_user_id = v_booking.gardener_id AND public.is_company_owner(c.id)
  ) THEN
    RAISE EXCEPTION 'Solo el dueño de la empresa puede mover este trabajo.';
  END IF;
  IF v_booking.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Solo se puede mover un trabajo confirmado (estado: %).', v_booking.status;
  END IF;
  IF v_booking.price_change_status = 'pending_client_acceptance' THEN
    RAISE EXCEPTION 'Hay un cambio de precio esperando al cliente: espera su respuesta antes de proponer otra fecha.';
  END IF;
  IF p_date IS NULL OR p_date < current_date OR (p_date = current_date AND p_start_hour <= EXTRACT(HOUR FROM (now() AT TIME ZONE 'Europe/Madrid'))) THEN
    RAISE EXCEPTION 'Elige una fecha y hora que aún no hayan pasado.';
  END IF;
  IF p_date = v_booking.date AND p_start_hour = EXTRACT(HOUR FROM v_booking.start_time)::integer THEN
    RAISE EXCEPTION 'Es la misma fecha y hora que ya tiene.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.booking_replan_cells(p_booking_id, p_date, p_start_hour)) THEN
    RAISE EXCEPTION 'En esa franja no hay nadie de tu equipo libre para hacer este trabajo.';
  END IF;

  UPDATE public.bookings
  SET reschedule_status = 'pending_client',
      proposed_date = p_date,
      proposed_start_time = make_time(p_start_hour, 0, 0),
      reschedule_reason = NULLIF(BTRIM(COALESCE(p_reason, '')), ''),
      reschedule_proposed_at = now(),
      reschedule_expires_at = now() + interval '48 hours',
      reschedule_proposal_notified_at = NULL,
      reschedule_answer_notified_at = NULL
  WHERE id = p_booking_id;

  RETURN jsonb_build_object('bookingId', p_booking_id, 'proposedDate', p_date, 'proposedStartHour', p_start_hour);
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_booking_reschedule(p_booking_id uuid, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_new_start integer;
  v_cell_dates date[];
  v_cell_hours integer[];
  v_cell_workers uuid[];
  v_span integer;
  v_end_date date;
  v_old_workers uuid[];
  v_old_dates date[];
  v_old_hours integer[];
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR v_booking.client_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Esta propuesta no es para ti.';
  END IF;
  IF v_booking.reschedule_status <> 'pending_client' THEN
    RAISE EXCEPTION 'No hay ninguna propuesta de cambio de fecha pendiente.';
  END IF;
  IF v_booking.reschedule_expires_at <= now() OR v_booking.status <> 'confirmed' THEN
    UPDATE public.bookings SET reschedule_status = 'expired' WHERE id = p_booking_id;
    RETURN jsonb_build_object('bookingId', p_booking_id, 'outcome', 'expired');
  END IF;

  IF NOT COALESCE(p_accept, false) THEN
    UPDATE public.bookings SET reschedule_status = 'rejected' WHERE id = p_booking_id;
    RETURN jsonb_build_object('bookingId', p_booking_id, 'outcome', 'rejected');
  END IF;

  v_new_start := EXTRACT(HOUR FROM v_booking.proposed_start_time)::integer;
  SELECT array_agg(c.date ORDER BY c.date, c.hour_block, c.worker_id),
         array_agg(c.hour_block ORDER BY c.date, c.hour_block, c.worker_id),
         array_agg(c.worker_id ORDER BY c.date, c.hour_block, c.worker_id)
  INTO v_cell_dates, v_cell_hours, v_cell_workers
  FROM public.booking_replan_cells(p_booking_id, v_booking.proposed_date, v_new_start) AS c;
  IF v_cell_workers IS NULL THEN
    UPDATE public.bookings SET reschedule_status = 'expired' WHERE id = p_booking_id;
    RETURN jsonb_build_object('bookingId', p_booking_id, 'outcome', 'no_longer_available');
  END IF;
  SELECT MAX(c.h) + 1 - v_new_start INTO v_span
  FROM unnest(v_cell_dates, v_cell_hours) AS c(d, h) WHERE c.d = v_booking.proposed_date;
  SELECT NULLIF(MAX(d), v_booking.proposed_date) INTO v_end_date FROM unnest(v_cell_dates) AS d;

  -- Todo o nada: fuera de la agenda las horas viejas (y libres), dentro las nuevas.
  WITH released AS (
    DELETE FROM public.booking_blocks WHERE booking_id = p_booking_id RETURNING assignee_id, date, hour_block
  )
  SELECT array_agg(assignee_id), array_agg(date), array_agg(hour_block) INTO v_old_workers, v_old_dates, v_old_hours FROM released;

  UPDATE public.availability a SET is_available = true
  FROM unnest(COALESCE(v_old_workers, '{}'), COALESCE(v_old_dates, '{}'), COALESCE(v_old_hours, '{}')) AS r(worker_id, date, hour_block)
  WHERE a.gardener_id = r.worker_id AND a.date = r.date AND EXTRACT(HOUR FROM a.start_time) = r.hour_block;
  UPDATE public.availability_blocks ab SET is_available = true
  FROM unnest(COALESCE(v_old_workers, '{}'), COALESCE(v_old_dates, '{}'), COALESCE(v_old_hours, '{}')) AS r(worker_id, date, hour_block)
  WHERE ab.gardener_id = r.worker_id AND ab.date = r.date AND ab.hour_block = r.hour_block;

  -- En un trabajo de equipo o de varios días lo que dura el primer día y el último día salen del
  -- nuevo plan (las horas de trabajo, y por tanto el precio, no cambian).
  UPDATE public.bookings
  SET date = v_booking.proposed_date,
      start_time = v_booking.proposed_start_time,
      duration_hours = CASE WHEN v_booking.labour_hours IS NULL THEN duration_hours ELSE v_span END,
      end_date = v_end_date,
      reschedule_status = 'accepted'
  WHERE id = p_booking_id;

  INSERT INTO public.booking_blocks (booking_id, date, hour_block, assignee_id)
  SELECT p_booking_id, c.d, c.h, c.w
  FROM unnest(v_cell_dates, v_cell_hours, v_cell_workers) AS c(d, h, w);

  UPDATE public.availability a SET is_available = false
  FROM unnest(v_cell_dates, v_cell_hours, v_cell_workers) AS c(d, h, w)
  WHERE a.gardener_id = c.w AND a.date = c.d AND EXTRACT(HOUR FROM a.start_time) = c.h;
  UPDATE public.availability_blocks ab SET is_available = false
  FROM unnest(v_cell_dates, v_cell_hours, v_cell_workers) AS c(d, h, w)
  WHERE ab.gardener_id = c.w AND ab.date = c.d AND ab.hour_block = c.h;

  RETURN jsonb_build_object('bookingId', p_booking_id, 'outcome', 'accepted', 'date', v_booking.proposed_date, 'startHour', v_new_start, 'endDate', v_end_date);
END;
$$;

-- ── 5) Agenda del empleado: trabajos que empiezan antes del rango y horas por día ─────────
DROP FUNCTION IF EXISTS public.my_jobs(date, date);
CREATE FUNCTION public.my_jobs(p_from date, p_to date)
RETURNS TABLE(
  booking_id uuid, date date, start_time time without time zone, duration_hours integer, status text,
  service_name text, client_address text, client_name text, client_phone text, notes text,
  company_name text, assignment_pending boolean, finished_at timestamp with time zone,
  service_start timestamp with time zone, my_hours integer[],
  end_date date, labour_hours integer, team_size integer, my_days jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.date, b.start_time::time, b.duration_hours, b.status, s.name,
         b.client_address, NULLIF(BTRIM(cp.full_name), ''), NULLIF(BTRIM(cp.phone), ''), b.notes,
         gp.full_name, b.assignment_pending, b.gardener_finished_at, public.booking_service_start(b),
         -- Las horas del empleado el primer día del trabajo (lo de F6; en varios días, my_days).
         (SELECT array_agg(bb.hour_block ORDER BY bb.hour_block) FROM public.booking_blocks bb
          WHERE bb.booking_id = b.id AND bb.assignee_id = auth.uid() AND bb.date = b.date),
         b.end_date, b.labour_hours,
         (SELECT count(DISTINCT bb.assignee_id)::integer FROM public.booking_blocks bb WHERE bb.booking_id = b.id),
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object('date', d.date, 'hours', d.hours) ORDER BY d.date)
           FROM (
             SELECT bb.date, array_agg(bb.hour_block ORDER BY bb.hour_block) AS hours
             FROM public.booking_blocks bb
             WHERE bb.booking_id = b.id AND bb.assignee_id = auth.uid()
             GROUP BY bb.date
           ) d
         ), '[]'::jsonb)
  FROM public.bookings b
  JOIN public.services s ON s.id = b.service_id
  JOIN public.gardener_profiles gp ON gp.user_id = b.gardener_id
  LEFT JOIN public.profiles cp ON cp.user_id = b.client_id
  WHERE b.date <= p_to AND COALESCE(b.end_date, b.date) >= p_from
    AND b.status IN ('pending', 'confirmed', 'in_progress', 'completed', 'disputed')
    AND EXISTS (SELECT 1 FROM public.booking_blocks bb WHERE bb.booking_id = b.id AND bb.assignee_id = auth.uid())
  ORDER BY b.date, b.start_time;
$$;
REVOKE ALL ON FUNCTION public.my_jobs(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_jobs(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.company_schedule(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        'end_date', b.end_date,
        'labour_hours', b.labour_hours,
        'status', b.status,
        'service', s.name,
        'client_name', NULLIF(split_part(BTRIM(COALESCE(cp.full_name, '')), ' ', 1), ''),
        'address', b.client_address,
        'assignment_pending', b.assignment_pending,
        'reschedule_status', b.reschedule_status,
        'proposed_date', b.proposed_date,
        'proposed_start_hour', EXTRACT(HOUR FROM b.proposed_start_time)::integer,
        'hours', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('date', bb.date, 'hour', bb.hour_block, 'worker_id', bb.assignee_id) ORDER BY bb.date, bb.hour_block, bb.assignee_id)
          FROM public.booking_blocks bb WHERE bb.booking_id = b.id
        ), '[]'::jsonb)
      ) ORDER BY b.date, b.start_time)
      FROM public.bookings b
      JOIN public.services s ON s.id = b.service_id
      LEFT JOIN public.profiles cp ON cp.user_id = b.client_id
      WHERE b.gardener_id = v_company.provider_user_id
        AND b.date <= p_to AND COALESCE(b.end_date, b.date) >= p_from
        AND b.status IN ('pending', 'confirmed', 'in_progress', 'disputed', 'completed')
    ), '[]'::jsonb)
  );
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
        'max_crew', c.max_crew,
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
