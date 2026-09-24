-- GarSer Empresas · F8.1: varios servicios en una reserva (servidor).
--
-- Decisiones del usuario (2026-09-24): D14 — una reserva, un profesional para todos sus
-- servicios; D15 — solo se ofrecen los profesionales que hacen todos; D16 — en una empresa solo
-- van personas que tienen asignados todos los servicios del trabajo (y carnet si alguno lo exige).
--
-- 1) booking_items: los servicios de la reserva, con los datos del cliente de cada uno, su
--    precio y sus horas. bookings.service_id sigue siendo el PRIMER servicio (compatibilidad).
--    El pago escribe siempre sus filas (una, si es un servicio). Las reservas anteriores y las
--    de caminos sin pago no tienen filas: booking_service_ids() cae en bookings.service_id.
-- 2) booking_quotes.items: los servicios del presupuesto (null = un servicio, lo de siempre).
-- 3) provider_workers_all(): quien hace TODOS los servicios. provider_workers() es el caso de
--    uno. provider_free_hours() y plan_booking_cells() aceptan servicios de más.
-- 4) Las funciones de un trabajo ya vendido (repartir, cambiar persona, mover de fecha…) miran
--    todos los servicios de la reserva.
-- 5) Pago: prepare comprueba que los servicios cuadran con el total y planifica con todos;
--    confirm escribe booking_items.

-- ── 1) booking_items ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.booking_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position >= 1),
  service_id uuid NOT NULL REFERENCES public.services(id),
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_price numeric(10,2) NOT NULL CHECK (total_price >= 0),
  labour_hours numeric NOT NULL CHECK (labour_hours > 0),
  requires_license boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, position),
  UNIQUE (booking_id, service_id)
);
COMMENT ON TABLE public.booking_items IS
  'F8: servicios de una reserva (D14: un profesional para todos). Solo la escribe confirm_booking_payment_attempt. bookings.service_id = el de position 1.';
CREATE INDEX IF NOT EXISTS idx_booking_items_booking ON public.booking_items(booking_id);

-- Quién puede leerlas: el cliente, el proveedor, quien va a hacer el trabajo y el admin. En
-- función SECURITY DEFINER para no consultar bookings desde la policy (recursión, §3 de la guía).
CREATE OR REPLACE FUNCTION public.can_read_booking_items(p_booking_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = p_booking_id AND auth.uid() IN (b.client_id, b.gardener_id))
    OR public.is_booking_assignee(p_booking_id)
    OR public.is_admin()
  );
$$;
REVOKE ALL ON FUNCTION public.can_read_booking_items(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_booking_items(uuid) TO authenticated;

ALTER TABLE public.booking_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS booking_items_read ON public.booking_items;
CREATE POLICY booking_items_read ON public.booking_items FOR SELECT TO authenticated
  USING (public.can_read_booking_items(booking_id));
REVOKE ALL ON public.booking_items FROM anon, authenticated;
GRANT SELECT ON public.booking_items TO authenticated;
GRANT ALL ON public.booking_items TO service_role;

-- Los servicios de una reserva, en orden. Sin filas (reservas anteriores): el de la reserva.
CREATE OR REPLACE FUNCTION public.booking_service_ids(p_booking_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT array_agg(i.service_id ORDER BY i.position) FROM public.booking_items i WHERE i.booking_id = p_booking_id),
    (SELECT ARRAY[b.service_id] FROM public.bookings b WHERE b.id = p_booking_id)
  );
$$;
REVOKE ALL ON FUNCTION public.booking_service_ids(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_service_ids(uuid) TO service_role;

-- ── 2) booking_quotes.items ────────────────────────────────────────────────────────
ALTER TABLE public.booking_quotes ADD COLUMN IF NOT EXISTS items jsonb;
COMMENT ON COLUMN public.booking_quotes.items IS
  'F8: [{serviceId, inputPayload, totalPrice, estimatedHours, breakdown, requiresLicense}] en orden; el primero es service_id. Null = un servicio (input_payload, total_price y estimated_hours del propio presupuesto).';

-- Carnet: si algún servicio de la reserva lo exige, lo exige el trabajo.
CREATE OR REPLACE FUNCTION public.booking_requires_phyto_license(p_booking_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (b.pricing_context -> 'quote_snapshot' ->> 'requiresPhytosanitaryLicense')::boolean,
    EXISTS (SELECT 1 FROM public.booking_items i WHERE i.booking_id = b.id AND i.requires_license),
    s.name = 'Servicios fitosanitarios',
    false
  )
  FROM public.bookings b LEFT JOIN public.services s ON s.id = b.service_id
  WHERE b.id = p_booking_id;
$$;

-- ── 3) Quién hace todos los servicios ───────────────────────────────────────────────
-- Autónomo: él mismo (qué servicios ofrece lo comprueba la web con sus precios). Empresa: las
-- personas activas que trabajan y tienen asignados TODOS los servicios (D16), con carnet si hace falta.
CREATE OR REPLACE FUNCTION public.provider_workers_all(p_provider uuid, p_services uuid[], p_requires_license boolean DEFAULT false)
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
  WHERE c.provider_user_id = p_provider
    AND c.status = 'active'
    AND cardinality(COALESCE(p_services, '{}')) > 0
    AND NOT EXISTS (
      SELECT 1 FROM unnest(p_services) AS s(service_id)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.company_member_services cms WHERE cms.member_id = m.id AND cms.service_id = s.service_id
      )
    )
    AND (NOT COALESCE(p_requires_license, false) OR public.has_valid_phyto_license(m.user_id));
$$;
REVOKE ALL ON FUNCTION public.provider_workers_all(uuid, uuid[], boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_workers_all(uuid, uuid[], boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.provider_workers(p_provider uuid, p_service uuid, p_requires_license boolean DEFAULT false)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w FROM public.provider_workers_all(p_provider, ARRAY[p_service], p_requires_license) AS w;
$$;

DROP FUNCTION IF EXISTS public.provider_free_hours(uuid[], uuid, date, date, boolean, uuid[]);
-- F8: p_extra_service_ids = los demás servicios del trabajo (las personas tienen que hacerlos todos).
CREATE FUNCTION public.provider_free_hours(p_provider_ids uuid[], p_service_id uuid, p_start date, p_end date, p_requires_license boolean DEFAULT false, p_exclude_hold_ids uuid[] DEFAULT '{}'::uuid[], p_extra_service_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS TABLE(provider_id uuid, worker_id uuid, date date, hour integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT p.provider_id, w.worker_id, a.date, EXTRACT(HOUR FROM a.start_time)::integer
  FROM unnest(p_provider_ids) AS p(provider_id)
  CROSS JOIN LATERAL public.provider_workers_all(p.provider_id, ARRAY[p_service_id] || COALESCE(p_extra_service_ids, '{}'::uuid[]), p_requires_license) AS w(worker_id)
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
$function$;
REVOKE ALL ON FUNCTION public.provider_free_hours(uuid[], uuid, date, date, boolean, uuid[], uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_free_hours(uuid[], uuid, date, date, boolean, uuid[], uuid[]) TO service_role;

DROP FUNCTION IF EXISTS public.plan_booking_cells(uuid, uuid, date, integer, integer, boolean, uuid);
-- F8: p_extra_services = los demás servicios del trabajo (D16).
CREATE FUNCTION public.plan_booking_cells(p_provider uuid, p_service uuid, p_date date, p_start_hour integer, p_labour integer, p_requires_license boolean DEFAULT false, p_ignore_booking uuid DEFAULT NULL::uuid, p_extra_services uuid[] DEFAULT '{}'::uuid[])
 RETURNS TABLE(date date, hour_block integer, worker_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    FROM public.provider_workers_all(p_provider, ARRAY[p_service] || COALESCE(p_extra_services, '{}'::uuid[]), p_requires_license) AS w(worker_id)
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
      FROM public.provider_workers_all(p_provider, ARRAY[p_service] || COALESCE(p_extra_services, '{}'::uuid[]), p_requires_license) AS w(worker_id)
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
      FROM public.provider_workers_all(p_provider, ARRAY[p_service] || COALESCE(p_extra_services, '{}'::uuid[]), p_requires_license) AS w(worker_id)
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
        FROM public.provider_workers_all(p_provider, ARRAY[p_service] || COALESCE(p_extra_services, '{}'::uuid[]), p_requires_license) AS w(worker_id)
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
$function$;
REVOKE ALL ON FUNCTION public.plan_booking_cells(uuid, uuid, date, integer, integer, boolean, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_booking_cells(uuid, uuid, date, integer, integer, boolean, uuid, uuid[]) TO service_role;

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
      SELECT 1 FROM public.provider_workers_all(v_booking.gardener_id, public.booking_service_ids(v_booking.id), v_license) AS w(worker_id)
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
  FROM public.provider_workers_all(v_booking.gardener_id, public.booking_service_ids(v_booking.id), public.booking_requires_phyto_license(p_booking_id)) AS w(worker_id)
  LEFT JOIN public.profiles p ON p.user_id = w.worker_id
  ORDER BY 3 DESC, 4 DESC, 2;
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
  FROM public.provider_workers_all(v_booking.gardener_id, public.booking_service_ids(v_booking.id), public.booking_requires_phyto_license(p_booking_id)) AS w(worker_id)
  LEFT JOIN public.profiles p ON p.user_id = w.worker_id
  ORDER BY 2;
END;
$function$;

CREATE OR REPLACE FUNCTION public.booking_replace_candidates(p_booking_id uuid, p_from uuid)
 RETURNS TABLE(user_id uuid, full_name text, is_free boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  FROM public.provider_workers_all(v_booking.gardener_id, public.booking_service_ids(v_booking.id), public.booking_requires_phyto_license(p_booking_id)) AS w(worker_id)
  LEFT JOIN public.profiles p ON p.user_id = w.worker_id
  WHERE w.worker_id <> p_from
  ORDER BY 3 DESC, 2;
END;
$function$;

CREATE OR REPLACE FUNCTION public.booking_slot_workers(p_booking_id uuid, p_date date, p_start_hour integer)
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    FROM public.provider_workers_all(v_booking.gardener_id, public.booking_service_ids(v_booking.id), v_license) AS w(worker_id)
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
    FROM public.provider_workers_all(v_booking.gardener_id, public.booking_service_ids(v_booking.id), v_license) AS w(worker_id)
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
$function$;

CREATE OR REPLACE FUNCTION public.replace_booking_worker(p_booking_id uuid, p_from uuid, p_to uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    SELECT 1 FROM public.provider_workers_all(v_booking.gardener_id, public.booking_service_ids(v_booking.id), public.booking_requires_phyto_license(p_booking_id)) AS w(worker_id)
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
$function$;

CREATE OR REPLACE FUNCTION public.booking_replan_cells(p_booking_id uuid, p_date date, p_start_hour integer)
 RETURNS TABLE(date date, hour_block integer, worker_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    public.booking_requires_phyto_license(p_booking_id), p_booking_id,
    COALESCE((public.booking_service_ids(p_booking_id))[2:], '{}'::uuid[])
  ) AS c;
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
  v_extra_services uuid[] := '{}';
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

  -- F8: varios servicios. El primero es el del presupuesto, cada uno una vez, y sus precios y
  -- horas suman el total (lo que se cobra y lo que se planifica).
  IF v_quote.items IS NOT NULL THEN
    IF jsonb_typeof(v_quote.items) <> 'array' OR jsonb_array_length(v_quote.items) < 1
       OR (v_quote.items -> 0 ->> 'serviceId')::uuid IS DISTINCT FROM v_quote.service_id
       OR (SELECT count(DISTINCT x ->> 'serviceId') FROM jsonb_array_elements(v_quote.items) x) <> jsonb_array_length(v_quote.items)
       OR ROUND((SELECT SUM((x ->> 'totalPrice')::numeric) FROM jsonb_array_elements(v_quote.items) x), 2) <> ROUND(v_quote.total_price, 2)
       OR ROUND((SELECT SUM((x ->> 'estimatedHours')::numeric) FROM jsonb_array_elements(v_quote.items) x), 2) <> ROUND(v_quote.estimated_hours, 2) THEN
      RAISE EXCEPTION 'El presupuesto de varios servicios no es coherente. Vuelve a seleccionar el profesional.';
    END IF;
    SELECT COALESCE(array_agg((x ->> 'serviceId')::uuid ORDER BY o), '{}') INTO v_extra_services
    FROM jsonb_array_elements(v_quote.items) WITH ORDINALITY AS t(x, o) WHERE o > 1;
  END IF;

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
    v_quote.gardener_id, v_quote.service_id, v_quote.selected_date, v_start_hour, v_labour, v_requires_license,
    NULL, v_extra_services
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

    -- F8: los servicios de la reserva (uno, si el presupuesto es de un servicio).
    IF v_quote.items IS NOT NULL THEN
      INSERT INTO public.booking_items (booking_id, position, service_id, input_payload, breakdown, total_price, labour_hours, requires_license)
      SELECT v_booking_id, t.o::smallint, (t.x ->> 'serviceId')::uuid,
             COALESCE(t.x -> 'inputPayload', '{}'::jsonb), COALESCE(t.x -> 'breakdown', '[]'::jsonb),
             ROUND((t.x ->> 'totalPrice')::numeric, 2), (t.x ->> 'estimatedHours')::numeric,
             COALESCE((t.x ->> 'requiresLicense')::boolean, false)
      FROM jsonb_array_elements(v_quote.items) WITH ORDINALITY AS t(x, o);
    ELSE
      INSERT INTO public.booking_items (booking_id, position, service_id, input_payload, breakdown, total_price, labour_hours, requires_license)
      VALUES (
        v_booking_id, 1, v_quote.service_id, COALESCE(v_quote.input_payload, '{}'::jsonb),
        COALESCE(v_quote.pricing_snapshot -> 'breakdown', '[]'::jsonb), ROUND(v_quote.total_price, 2),
        GREATEST(COALESCE(v_quote.estimated_hours, 1), 0.01),
        COALESCE((v_quote.pricing_snapshot ->> 'requiresPhytosanitaryLicense')::boolean, false)
      );
    END IF;

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
