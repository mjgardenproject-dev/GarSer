-- GarSer Empresas · F5.1: horarios del equipo.
--
-- Cada persona declara su disponibilidad (A-06): el empleado la suya, el dueño que trabaja la
-- suya. Se reutilizan la tabla `availability`, el horario fijo (`recurring_schedules`) y su
-- generador. Tres arreglos para que eso sea seguro:
--
-- 1) protect_sold_availability(): nadie puede marcar como libre una hora que ya está vendida a
--    esa persona (booking_blocks.assignee_id), lo haga la pantalla de horario, el generador
--    nocturno o cualquier otro camino. Antes solo la pantalla del autónomo lo evitaba, mirando
--    las reservas en las que él era el proveedor: para un empleado no veía ninguna.
-- 2) release_booking_schedule: primero quita las horas de la agenda y después las vuelve a
--    marcar libres (con 1, en el orden anterior, la regla las mantendría ocupadas).
-- 3) generate_recurring_slots: su «re-proteger lo reservado» pasa a ser solo para reservas
--    antiguas sin agenda por persona; lo demás lo hace 1. Evita que al dueño que trabaja se le
--    cierren las horas de todos los trabajos de su empresa.
-- 4) my_busy_hours(): las horas ocupadas de quien pregunta (para pintarlas en su horario).

-- ── 1) Una hora vendida no se puede marcar libre ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.protect_sold_availability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_available AND EXISTS (
    SELECT 1 FROM public.booking_blocks bb
    WHERE bb.assignee_id = NEW.gardener_id
      AND bb.date = NEW.date
      AND bb.hour_block = EXTRACT(HOUR FROM NEW.start_time)::integer
  ) THEN
    NEW.is_available := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_sold_availability ON public.availability;
CREATE TRIGGER trg_protect_sold_availability
  BEFORE INSERT OR UPDATE OF is_available, gardener_id, date, start_time ON public.availability
  FOR EACH ROW EXECUTE FUNCTION public.protect_sold_availability();

-- Las horas que ya estén mal (vendidas y marcadas libres) se corrigen una vez.
UPDATE public.availability a
SET is_available = false
FROM public.booking_blocks bb
WHERE a.is_available
  AND bb.assignee_id = a.gardener_id
  AND bb.date = a.date
  AND bb.hour_block = EXTRACT(HOUR FROM a.start_time)::integer;

-- ── 2) Cancelar: primero fuera de la agenda, después libres ───────────────────────
CREATE OR REPLACE FUNCTION public.release_booking_schedule(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_assignees uuid[];
  v_dates date[];
  v_hours integer[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE id = p_booking_id) THEN
    RETURN;
  END IF;

  -- Se liberan las horas de QUIEN las trabajaba (assignee_id), no las del proveedor (F1).
  -- F5: se sacan de la agenda ANTES de marcarlas libres; si no, protect_sold_availability
  -- las vería aún vendidas y las dejaría ocupadas.
  WITH released AS (
    DELETE FROM public.booking_blocks
    WHERE booking_id = p_booking_id
    RETURNING assignee_id, date, hour_block
  )
  SELECT array_agg(assignee_id), array_agg(date), array_agg(hour_block)
  INTO v_assignees, v_dates, v_hours
  FROM released;

  IF v_assignees IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.availability_blocks ab
  SET is_available = true
  FROM unnest(v_assignees, v_dates, v_hours) AS r(assignee_id, date, hour_block)
  WHERE ab.gardener_id = r.assignee_id
    AND ab.date = r.date
    AND ab.hour_block = r.hour_block;

  UPDATE public.availability a
  SET is_available = true
  FROM unnest(v_assignees, v_dates, v_hours) AS r(assignee_id, date, hour_block)
  WHERE a.gardener_id = r.assignee_id
    AND a.date = r.date
    AND EXTRACT(HOUR FROM a.start_time) = r.hour_block;
END;
$function$;

-- ── 3) Generador del horario fijo ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_recurring_slots(target_gardener_id uuid, force_regenerate boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  setting RECORD;
  rule RECORD;
  current_date_val date := CURRENT_DATE;
  start_date date;
  end_date date;
  iter_date date;
  day_idx integer;
  start_h integer;
  end_h integer;
  slot_hour integer;
  template_count integer;
BEGIN
  SELECT *
  INTO setting
  FROM public.recurring_availability_settings
  WHERE gardener_id = target_gardener_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Guard: never let an empty template destroy availability or move the
  -- watermark. Without recurring rules there is nothing to generate, and the
  -- destructive DELETE below would erase manual availability with no
  -- replacement.
  SELECT count(*) INTO template_count
  FROM public.recurring_schedules
  WHERE gardener_id = target_gardener_id;

  IF template_count = 0 THEN
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

  -- Generate availability slots from recurring schedule rules.
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
      end_h   := EXTRACT(HOUR FROM rule.end_time);

      FOR slot_hour IN start_h .. (end_h - 1) LOOP
        INSERT INTO public.availability_blocks (
          gardener_id, date, hour_block, is_available
        ) VALUES (
          target_gardener_id, iter_date, slot_hour, true
        )
        ON CONFLICT (gardener_id, date, hour_block) DO UPDATE
          SET is_available = EXCLUDED.is_available,
              updated_at   = now();

        INSERT INTO public.availability (
          gardener_id, date, start_time, end_time, is_available
        ) VALUES (
          target_gardener_id,
          iter_date,
          make_time(slot_hour, 0, 0),
          (make_time(slot_hour, 0, 0) + interval '1 hour')::time,
          true
        )
        ON CONFLICT (gardener_id, date, start_time) DO UPDATE
          SET end_time     = EXCLUDED.end_time,
              is_available = EXCLUDED.is_available;
      END LOOP;
    END LOOP;

    iter_date := iter_date + 1;
  END LOOP;

  -- Re-protect slots that belong to confirmed / in-progress bookings.
  UPDATE public.availability av
  SET is_available = false
  WHERE av.gardener_id = target_gardener_id
    AND av.date >= start_date
    AND av.date <= end_date
    AND EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.gardener_id = target_gardener_id
        AND b.date::date    = av.date
        AND b.status        IN ('confirmed', 'in_progress')
        -- F5 (GarSer Empresas): solo reservas antiguas sin agenda por persona. Las que tienen
        -- booking_blocks las protege protect_sold_availability() por la persona que va; sin
        -- este filtro, al dueño de una empresa que trabaja se le cerraban las horas de TODOS
        -- los trabajos de su empresa (b.gardener_id es la empresa, que es su misma cuenta).
        AND NOT EXISTS (SELECT 1 FROM public.booking_blocks bb WHERE bb.booking_id = b.id)
        AND av.start_time  >= b.start_time::time
        AND av.start_time   < (b.start_time::time + (b.duration_hours || ' hours')::interval)::time
    );

  UPDATE public.availability_blocks ab
  SET is_available = false
  WHERE ab.gardener_id = target_gardener_id
    AND ab.date >= start_date
    AND ab.date <= end_date
    AND EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.gardener_id   = target_gardener_id
        AND b.date::date     = ab.date
        AND b.status         IN ('confirmed', 'in_progress')
        AND NOT EXISTS (SELECT 1 FROM public.booking_blocks bb WHERE bb.booking_id = b.id)
        AND ab.hour_block   >= EXTRACT(HOUR FROM b.start_time::time)::int
        AND ab.hour_block    < (EXTRACT(HOUR FROM b.start_time::time)::int + b.duration_hours)
    );

  UPDATE public.recurring_availability_settings
  SET last_generated_date = end_date
  WHERE gardener_id = target_gardener_id;
END;
$function$;

-- ── 4) Mis horas ocupadas ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.my_busy_hours(p_start date, p_end date)
RETURNS TABLE (date date, hour integer, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT bb.date, bb.hour_block, b.status
  FROM public.booking_blocks bb
  JOIN public.bookings b ON b.id = bb.booking_id
  WHERE bb.assignee_id = auth.uid()
    AND bb.date BETWEEN p_start AND p_end
  ORDER BY 1, 2;
$$;
REVOKE ALL ON FUNCTION public.my_busy_hours(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_busy_hours(date, date) TO authenticated;
