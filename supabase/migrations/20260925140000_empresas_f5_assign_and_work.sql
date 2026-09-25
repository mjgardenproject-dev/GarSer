-- GarSer Empresas · F5.2: asignar y ejecutar.
--
-- 1) is_booking_assignee(): ¿quien pregunta tiene horas de esta reserva en su agenda?
-- 2) my_jobs(): los trabajos de quien pregunta, con lo justo para hacerlos (dirección, hora,
--    servicio, cliente para contactarle). Mínimo privilegio (A-33): el empleado NO lee la tabla
--    bookings (llevaría precios, pagos y datos del presupuesto) ni los trabajos de sus compañeros;
--    y en cuanto deja de estar asignado, deja de verlo, sin limpiar nada.
-- 3) get_booking_service_details() y mark_gardener_finished(): también para quien va.
-- 4) booking_assignment_candidates() y assign_booking_worker(): el dueño ve quién puede ir
--    (hace el servicio, tiene carnet si hace falta, está libre todas las horas) y elige. El
--    servidor lo vuelve a comprobar todo: una lista en pantalla no es un permiso (F5-10).

-- ── 1) ¿Estoy asignado? ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_booking_assignee(p_booking_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.booking_blocks bb WHERE bb.booking_id = p_booking_id AND bb.assignee_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.is_booking_assignee(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_booking_assignee(uuid) TO authenticated;

-- ── 2) Mis trabajos ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.my_jobs(p_from date, p_to date)
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
  service_start timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.date, b.start_time::time, b.duration_hours, b.status, s.name,
         b.client_address, NULLIF(BTRIM(cp.full_name), ''), NULLIF(BTRIM(cp.phone), ''), b.notes,
         gp.full_name, b.assignment_pending, b.gardener_finished_at, public.booking_service_start(b)
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

-- ── 3) Detalle del trabajo y «he terminado», también para quien va ────────────────
CREATE OR REPLACE FUNCTION public.get_booking_service_details(p_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking record;
  v_quote_id uuid;
  v_payload jsonb;
BEGIN
  SELECT id, client_id, gardener_id, pricing_context
    INTO v_booking
    FROM public.bookings
   WHERE id = p_booking_id;

  IF v_booking.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- F5 (GarSer Empresas): también quien va a hacer el trabajo, para saber qué hay que hacer.
  IF auth.uid() IS DISTINCT FROM v_booking.client_id
     AND auth.uid() IS DISTINCT FROM v_booking.gardener_id
     AND NOT public.is_booking_assignee(p_booking_id) THEN
    RAISE EXCEPTION 'No autorizado para ver el detalle de esta reserva';
  END IF;

  BEGIN
    v_quote_id := NULLIF(v_booking.pricing_context ->> 'quote_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_quote_id := NULL;
  END;

  IF v_quote_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT input_payload INTO v_payload
    FROM public.booking_quotes
   WHERE id = v_quote_id;

  IF v_payload IS NULL THEN
    RETURN NULL;
  END IF;

  -- Subconjunto blanqueado: solo las variables que describen el trabajo
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'dataInputMode', v_payload -> 'dataInputMode',
    'wasteRemoval', v_payload -> 'wasteRemoval',
    'lawnZones', v_payload -> 'lawnZones',
    'hedgeZones', v_payload -> 'hedgeZones',
    'treeGroups', v_payload -> 'treeGroups',
    'shrubGroups', v_payload -> 'shrubGroups',
    'palmGroups', v_payload -> 'palmGroups',
    'phytosanitaryZones', v_payload -> 'phytosanitaryZones',
    'weedingZones', v_payload -> 'weedingZones'
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_gardener_finished(p_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking public.bookings%ROWTYPE;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada' USING ERRCODE = 'no_data_found';
  END IF;

  -- F5 (GarSer Empresas): también quien va a hacer el trabajo (la persona de su agenda).
  IF auth.uid() IS DISTINCT FROM v_booking.gardener_id AND NOT public.is_booking_assignee(p_booking_id) THEN
    RAISE EXCEPTION 'Solo el profesional de la reserva puede marcarla como terminada'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_booking.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Esta reserva no admite marcarse como terminada (estado: %)', v_booking.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Desde que EMPIEZA el servicio: terminar antes de lo estimado es normal y no debe
  -- obligar al profesional a esperar a que pase la hora prevista de fin.
  IF now() < public.booking_service_start(v_booking) THEN
    RAISE EXCEPTION 'Todavía no puedes marcarla: el servicio no ha empezado'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_booking.gardener_finished_at IS NOT NULL THEN
    RETURN jsonb_build_object('bookingId', p_booking_id, 'outcome', 'already_finished', 'idempotent', true);
  END IF;

  UPDATE public.bookings
  SET gardener_finished_at = now(),
      confirmation_prompt_due_at = LEAST(COALESCE(confirmation_prompt_due_at, now()), now()),
      updated_at = now()
  WHERE id = p_booking_id;

  PERFORM public.post_booking_system_message(
    p_booking_id,
    'El profesional ha marcado el servicio como terminado. Confírmalo para cerrar la reserva.'
  );

  RETURN jsonb_build_object('bookingId', p_booking_id, 'outcome', 'finished', 'idempotent', false);
END;
$function$;

-- ── 4) Asignar ────────────────────────────────────────────────────────────────────
-- Quién puede ir a una reserva: las personas que hacen el servicio (y tienen carnet si el
-- trabajo lo exige), y si están libres TODAS las horas del trabajo sin contar esta reserva.
CREATE OR REPLACE FUNCTION public.booking_assignment_candidates(p_booking_id uuid)
RETURNS TABLE (user_id uuid, full_name text, is_current boolean, is_free boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;
REVOKE ALL ON FUNCTION public.booking_assignment_candidates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_assignment_candidates(uuid) TO authenticated;

-- El dueño elige quién va (o confirma la propuesta). Todo o nada: se liberan las horas de quien
-- iba y se ocupan las de quien va; si la nueva persona no está libre, no cambia nada.
CREATE OR REPLACE FUNCTION public.assign_booking_worker(p_booking_id uuid, p_worker_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_start integer;
  v_end integer;
  v_previous uuid;
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

  SELECT bb.assignee_id INTO v_previous FROM public.booking_blocks bb WHERE bb.booking_id = p_booking_id LIMIT 1;
  IF v_previous IS NULL THEN
    RAISE EXCEPTION 'Este trabajo aún no tiene horas en la agenda: acéptalo primero.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.provider_workers(v_booking.gardener_id, v_booking.service_id, public.booking_requires_phyto_license(p_booking_id)) AS w(worker_id)
    WHERE w.worker_id = p_worker_id
  ) THEN
    RAISE EXCEPTION 'Esa persona no puede hacer este trabajo: no tiene este servicio asignado%.',
      CASE WHEN public.booking_requires_phyto_license(p_booking_id) THEN ' o no tiene el carnet fitosanitario aprobado' ELSE '' END;
  END IF;

  IF p_worker_id = v_previous THEN
    UPDATE public.bookings SET assignment_pending = false WHERE id = p_booking_id;
    RETURN jsonb_build_object('bookingId', p_booking_id, 'workerId', p_worker_id, 'previousWorkerId', v_previous, 'changed', false);
  END IF;

  v_start := EXTRACT(HOUR FROM v_booking.start_time)::integer;
  v_end := v_start + GREATEST(COALESCE(v_booking.duration_hours, 1), 1);

  PERFORM 1 FROM public.availability
  WHERE gardener_id = p_worker_id AND date = v_booking.date AND is_available = true
    AND EXTRACT(HOUR FROM start_time) >= v_start AND EXTRACT(HOUR FROM start_time) < v_end
  FOR UPDATE;

  IF public.count_distinct_available_legacy_hours(p_worker_id, v_booking.date, v_start, v_end) <> v_end - v_start
     OR EXISTS (
       SELECT 1 FROM public.booking_schedule_hold_blocks hb
       WHERE hb.gardener_id = p_worker_id AND hb.date = v_booking.date
         AND hb.hour_block >= v_start AND hb.hour_block < v_end
     ) THEN
    RAISE EXCEPTION 'Esa persona no está libre todas las horas de este trabajo.';
  END IF;

  -- Fuera de la agenda de quien iba (y sus horas, libres); dentro de la de quien va.
  DELETE FROM public.booking_blocks WHERE booking_id = p_booking_id;
  UPDATE public.availability SET is_available = true
  WHERE gardener_id = v_previous AND date = v_booking.date
    AND EXTRACT(HOUR FROM start_time) >= v_start AND EXTRACT(HOUR FROM start_time) < v_end;
  UPDATE public.availability_blocks SET is_available = true
  WHERE gardener_id = v_previous AND date = v_booking.date AND hour_block >= v_start AND hour_block < v_end;

  INSERT INTO public.booking_blocks (booking_id, date, hour_block, assignee_id)
  SELECT p_booking_id, v_booking.date, h, p_worker_id FROM generate_series(v_start, v_end - 1) AS h;
  UPDATE public.availability SET is_available = false
  WHERE gardener_id = p_worker_id AND date = v_booking.date
    AND EXTRACT(HOUR FROM start_time) >= v_start AND EXTRACT(HOUR FROM start_time) < v_end;
  UPDATE public.availability_blocks SET is_available = false
  WHERE gardener_id = p_worker_id AND date = v_booking.date AND hour_block >= v_start AND hour_block < v_end;

  UPDATE public.bookings SET assignment_pending = false WHERE id = p_booking_id;

  RETURN jsonb_build_object('bookingId', p_booking_id, 'workerId', p_worker_id, 'previousWorkerId', v_previous, 'changed', true);
END;
$$;
REVOKE ALL ON FUNCTION public.assign_booking_worker(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_booking_worker(uuid, uuid) TO authenticated;
