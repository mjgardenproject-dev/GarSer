-- GarSer Empresas · F6.3: mover un trabajo de fecha, proponiéndoselo al cliente (D9).
--
-- La empresa propone otro día/hora; el cliente acepta (se mueve la agenda sola) o rechaza (no
-- cambia nada: a diferencia del cambio de precio, rechazar NO cancela la reserva). Solo para
-- empresas (es parte del planificador); el autónomo no cambia.
--
-- 1) Columnas de la propuesta en bookings (sin permiso de escritura directa: solo por RPC).
-- 2) booking_slot_workers(): quién haría el trabajo en la nueva franja (prefiere a quien ya va;
--    por turnos solo si la empresa acepta trabajos partidos). Sus horas actuales cuentan como
--    libres (moverse dentro del mismo día es posible).
-- 3) reschedule_options(): horas de inicio posibles de un día, para la pantalla del dueño.
-- 4) propose_booking_reschedule() (dueño) y respond_booking_reschedule() (cliente).

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS reschedule_status text NOT NULL DEFAULT 'none'
    CHECK (reschedule_status IN ('none', 'pending_client', 'accepted', 'rejected', 'expired')),
  ADD COLUMN IF NOT EXISTS proposed_date date,
  ADD COLUMN IF NOT EXISTS proposed_start_time time,
  ADD COLUMN IF NOT EXISTS reschedule_reason text,
  ADD COLUMN IF NOT EXISTS reschedule_proposed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reschedule_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS reschedule_proposal_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS reschedule_answer_notified_at timestamptz;
COMMENT ON COLUMN public.bookings.reschedule_status IS
  'D9: propuesta de la empresa para mover el trabajo de fecha. pending_client = esperando al cliente.';

-- ── 2) Quién lo haría en la nueva franja ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.booking_slot_workers(p_booking_id uuid, p_date date, p_start_hour integer)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_duration integer;
  v_license boolean;
  v_candidate uuid;
  v_result uuid[] := '{}';
  v_prev uuid;
  h integer;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_duration := GREATEST(COALESCE(v_booking.duration_hours, 1), 1);
  IF p_start_hour < 7 OR p_start_hour + v_duration > 20 THEN RETURN NULL; END IF;
  v_license := public.booking_requires_phyto_license(p_booking_id);

  -- Una persona entera: primero quien ya va (más horas), luego el resto por carga del día.
  FOR v_candidate IN
    SELECT w.worker_id
    FROM public.provider_workers(v_booking.gardener_id, v_booking.service_id, v_license) AS w(worker_id)
    ORDER BY (SELECT count(*) FROM public.booking_blocks bb WHERE bb.booking_id = p_booking_id AND bb.assignee_id = w.worker_id) DESC,
             (SELECT count(*) FROM public.booking_blocks bb WHERE bb.assignee_id = w.worker_id AND bb.date = p_date),
             w.worker_id
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM generate_series(p_start_hour, p_start_hour + v_duration - 1) AS g
      WHERE NOT (
        public.worker_free_at(v_candidate, p_date, g)
        OR EXISTS (SELECT 1 FROM public.booking_blocks bb WHERE bb.booking_id = p_booking_id AND bb.assignee_id = v_candidate AND bb.date = p_date AND bb.hour_block = g)
      )
    ) THEN
      RETURN array_fill(v_candidate, ARRAY[v_duration]);
    END IF;
  END LOOP;

  IF NOT public.provider_allows_split_jobs(v_booking.gardener_id) THEN
    RETURN NULL;
  END IF;

  -- Por turnos (D10), con los menos cambios de persona posibles.
  FOR h IN p_start_hour .. p_start_hour + v_duration - 1 LOOP
    IF v_prev IS NOT NULL AND (
      public.worker_free_at(v_prev, p_date, h)
      OR EXISTS (SELECT 1 FROM public.booking_blocks bb WHERE bb.booking_id = p_booking_id AND bb.assignee_id = v_prev AND bb.date = p_date AND bb.hour_block = h)
    ) THEN
      v_result := v_result || v_prev;
      CONTINUE;
    END IF;
    SELECT w.worker_id INTO v_candidate
    FROM public.provider_workers(v_booking.gardener_id, v_booking.service_id, v_license) AS w(worker_id)
    WHERE public.worker_free_at(w.worker_id, p_date, h)
       OR EXISTS (SELECT 1 FROM public.booking_blocks bb WHERE bb.booking_id = p_booking_id AND bb.assignee_id = w.worker_id AND bb.date = p_date AND bb.hour_block = h)
    ORDER BY w.worker_id
    LIMIT 1;
    IF v_candidate IS NULL THEN RETURN NULL; END IF;
    v_result := v_result || v_candidate;
    v_prev := v_candidate;
  END LOOP;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.booking_slot_workers(uuid, date, integer) FROM PUBLIC, anon, authenticated;

-- ── 3) Horas posibles de un día (para el dueño) ───────────────────────────────────
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
    IF public.booking_slot_workers(p_booking_id, p_date, h) IS NOT NULL THEN
      v_result := v_result || h;
    END IF;
  END LOOP;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.reschedule_options(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_options(uuid, date) TO authenticated;

-- ── 4) Proponer y responder ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.propose_booking_reschedule(p_booking_id uuid, p_date date, p_start_hour integer, p_reason text DEFAULT NULL)
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
  IF public.booking_slot_workers(p_booking_id, p_date, p_start_hour) IS NULL THEN
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
REVOKE ALL ON FUNCTION public.propose_booking_reschedule(uuid, date, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_booking_reschedule(uuid, date, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.respond_booking_reschedule(p_booking_id uuid, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_new_start integer;
  v_workers uuid[];
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
  v_workers := public.booking_slot_workers(p_booking_id, v_booking.proposed_date, v_new_start);
  IF v_workers IS NULL THEN
    UPDATE public.bookings SET reschedule_status = 'expired' WHERE id = p_booking_id;
    RETURN jsonb_build_object('bookingId', p_booking_id, 'outcome', 'no_longer_available');
  END IF;

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

  UPDATE public.bookings
  SET date = v_booking.proposed_date,
      start_time = v_booking.proposed_start_time,
      reschedule_status = 'accepted'
  WHERE id = p_booking_id;

  INSERT INTO public.booking_blocks (booking_id, date, hour_block, assignee_id)
  SELECT p_booking_id, v_booking.proposed_date, v_new_start + w.idx - 1, w.worker_id
  FROM unnest(v_workers) WITH ORDINALITY AS w(worker_id, idx);

  UPDATE public.availability a SET is_available = false
  FROM unnest(v_workers) WITH ORDINALITY AS w(worker_id, idx)
  WHERE a.gardener_id = w.worker_id AND a.date = v_booking.proposed_date AND EXTRACT(HOUR FROM a.start_time) = v_new_start + w.idx - 1;
  UPDATE public.availability_blocks ab SET is_available = false
  FROM unnest(v_workers) WITH ORDINALITY AS w(worker_id, idx)
  WHERE ab.gardener_id = w.worker_id AND ab.date = v_booking.proposed_date AND ab.hour_block = v_new_start + w.idx - 1;

  RETURN jsonb_build_object('bookingId', p_booking_id, 'outcome', 'accepted', 'date', v_booking.proposed_date, 'startHour', v_new_start);
END;
$$;
REVOKE ALL ON FUNCTION public.respond_booking_reschedule(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_booking_reschedule(uuid, boolean) TO authenticated;

-- ── 5) La agenda de la empresa muestra las propuestas de fecha pendientes ────────
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
        'status', b.status,
        'service', s.name,
        'client_name', NULLIF(split_part(BTRIM(COALESCE(cp.full_name, '')), ' ', 1), ''),
        'address', b.client_address,
        'assignment_pending', b.assignment_pending,
        'reschedule_status', b.reschedule_status,
        'proposed_date', b.proposed_date,
        'proposed_start_hour', EXTRACT(HOUR FROM b.proposed_start_time)::integer,
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
$function$;
