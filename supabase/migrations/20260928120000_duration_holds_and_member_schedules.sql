-- GarSer Empresas · tras la fusión (2026-09-28). Dos fallos vistos por el usuario en garser.es.
--
-- H-40 · Cambiar la duración no apartaba las horas nuevas de quien hace el trabajo (autónomos y
-- empresas). La propuesta de «nueva duración» no reservaba nada hasta que el cliente aceptaba (otro
-- cliente podía comprar esas horas mientras tanto) y `resize_booking_schedule` solo miraba
-- `availability`, no los pagos en curso. Ahora:
--   · private.sync_booking_span: UNA función ajusta la agenda de la reserva a [inicio, inicio+N)
--     comprobando cada hora nueva con worker_free_at (disponibilidad + pagos en curso + agenda) y
--     sin caer nunca en la cuenta de una empresa si el trabajo no tiene a nadie asignado.
--   · Al PROPONER una duración mayor se apartan ya las horas nuevas (trigger); si no caben, la
--     propuesta falla en ese momento. Si la propuesta no se acepta (caduca), se devuelven. Rechazarla
--     cancela la reserva y libera todo, como antes.
--   · Un reloj caduca las propuestas vencidas (antes solo se marcaban cuando alguien volvía a tocar
--     la reserva), para que las horas apartadas no se queden cogidas.
--
-- H-41 / D22 · El horario de un empleado lo pone el dueño de la empresa, no el empleado (cambia
-- A-06: la disponibilidad sigue siendo por persona; la del empleado la declara su empresa).
--   · Escribir en availability, availability_blocks, recurring_schedules y
--     recurring_availability_settings exige ser dueño de la fila y NO ser empleado. Autónomos y
--     dueño de empresa, igual que antes. Las funciones de reserva (SECURITY DEFINER), el reloj
--     nocturno y el trigger de horas vendidas (A-32) no pasan por estas reglas.
--   · RPC para el dueño: leer y guardar el horario fijo de un empleado, guardar un día concreto y
--     ver sus horas ocupadas.

-- ─────────────────────────────────────────────────────────────────────────────
-- H-40 · Agenda de una reserva de un día
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.sync_booking_span(p_booking_id uuid, p_span integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_start int;
  v_cur_end int;
  v_new_end int;
  v_worker uuid;
  v_name text;
  h int;
  v_freed_workers uuid[];
  v_freed_hours integer[];
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF p_span IS NULL OR p_span < 1 THEN
    RAISE EXCEPTION 'La duración debe ser de al menos 1 hora.' USING ERRCODE = '22023';
  END IF;

  v_start := EXTRACT(HOUR FROM v_booking.start_time)::int;
  v_new_end := v_start + p_span;
  IF v_new_end > 24 THEN
    RAISE EXCEPTION 'El servicio no puede acabar después de medianoche.' USING ERRCODE = '22023';
  END IF;

  -- Fin actual según la agenda (no según duration_hours: al proponer ya puede estar alargada).
  SELECT max(hour_block) + 1 INTO v_cur_end
  FROM public.booking_blocks WHERE booking_id = p_booking_id AND date = v_booking.date;

  IF v_cur_end IS NULL THEN
    -- Sin agenda: un autónomo antiguo es él mismo; en una empresa no se adivina a quién apartar.
    IF EXISTS (SELECT 1 FROM public.companies WHERE provider_user_id = v_booking.gardener_id) THEN
      RAISE EXCEPTION 'Este trabajo aún no tiene a nadie asignado en la agenda: asígnalo antes de cambiar su duración.'
        USING ERRCODE = 'check_violation';
    END IF;
    v_cur_end := v_start + GREATEST(COALESCE(v_booking.duration_hours, 1), 1);
  END IF;

  IF v_new_end > v_cur_end THEN
    -- Alargar: las horas de más las hace quien hace la última hora (F6) y tienen que estar libres
    -- de verdad: disponibilidad, ni vendidas ni en un pago en curso (worker_free_at).
    v_worker := COALESCE(
      (SELECT bb.assignee_id FROM public.booking_blocks bb
       WHERE bb.booking_id = p_booking_id ORDER BY bb.date DESC, bb.hour_block DESC LIMIT 1),
      v_booking.gardener_id
    );

    PERFORM 1 FROM public.availability
    WHERE gardener_id = v_worker AND date = v_booking.date
      AND EXTRACT(HOUR FROM start_time) >= v_cur_end AND EXTRACT(HOUR FROM start_time) < v_new_end
    FOR UPDATE;

    FOR h IN v_cur_end .. v_new_end - 1 LOOP
      IF NOT public.worker_free_at(v_worker, v_booking.date, h) THEN
        SELECT NULLIF(btrim(full_name), '') INTO v_name FROM public.profiles WHERE user_id = v_worker;
        RAISE EXCEPTION '% no tiene libre la hora de las %:00 para alargar el servicio.',
          COALESCE(v_name, 'El profesional'), lpad(h::text, 2, '0')
          USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;

    INSERT INTO public.booking_blocks (booking_id, date, hour_block, assignee_id)
    SELECT p_booking_id, v_booking.date, hb, v_worker
    FROM generate_series(v_cur_end, v_new_end - 1) AS hb
    ON CONFLICT (booking_id, date, hour_block, assignee_id) DO NOTHING;

    UPDATE public.availability_blocks SET is_available = false
    WHERE gardener_id = v_worker AND date = v_booking.date
      AND hour_block >= v_cur_end AND hour_block < v_new_end;

    UPDATE public.availability SET is_available = false
    WHERE gardener_id = v_worker AND date = v_booking.date
      AND EXTRACT(HOUR FROM start_time) >= v_cur_end AND EXTRACT(HOUR FROM start_time) < v_new_end;

  ELSIF v_new_end < v_cur_end THEN
    -- Acortar: se libera [v_new_end, v_cur_end) a quien hacía cada hora. La agenda se borra ANTES
    -- de reabrir, para que el trigger de horas vendidas (A-32) no las vuelva a cerrar.
    WITH freed AS (
      DELETE FROM public.booking_blocks
      WHERE booking_id = p_booking_id AND date = v_booking.date
        AND hour_block >= v_new_end AND hour_block < v_cur_end
      RETURNING assignee_id, hour_block
    )
    SELECT array_agg(assignee_id), array_agg(hour_block) INTO v_freed_workers, v_freed_hours FROM freed;

    UPDATE public.availability_blocks ab SET is_available = true
    FROM unnest(COALESCE(v_freed_workers, '{}'), COALESCE(v_freed_hours, '{}')) AS f(worker_id, hour_block)
    WHERE ab.gardener_id = f.worker_id AND ab.date = v_booking.date AND ab.hour_block = f.hour_block;

    UPDATE public.availability a SET is_available = true
    FROM unnest(COALESCE(v_freed_workers, '{}'), COALESCE(v_freed_hours, '{}')) AS f(worker_id, hour_block)
    WHERE a.gardener_id = f.worker_id AND a.date = v_booking.date AND EXTRACT(HOUR FROM a.start_time) = f.hour_block;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_booking_span(uuid, integer) FROM PUBLIC, anon, authenticated;

-- La de siempre (la usa respond_booking_price_change al aceptar): agenda + duración.
CREATE OR REPLACE FUNCTION public.resize_booking_schedule(p_booking_id uuid, p_new_duration_hours integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
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

  IF v_booking.labour_hours IS NULL THEN
    PERFORM private.sync_booking_span(p_booking_id, p_new_duration_hours);
  END IF;

  UPDATE public.bookings SET duration_hours = p_new_duration_hours WHERE id = p_booking_id;
  -- end_time se recalcula solo: trigger_calculate_end_time.
END;
$$;

-- Apartar al proponer, devolver si la propuesta no se acepta.
CREATE OR REPLACE FUNCTION private.booking_price_change_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.labour_hours IS NOT NULL OR NEW.status NOT IN ('pending', 'confirmed') THEN
    RETURN NULL;
  END IF;

  IF NEW.price_change_status = 'pending_client_acceptance'
     AND NEW.proposed_duration_hours IS NOT NULL
     AND NEW.proposed_duration_hours > COALESCE(NEW.duration_hours, 1) THEN
    -- Propuesta que alarga: las horas nuevas quedan ya apartadas para quien va.
    PERFORM private.sync_booking_span(NEW.id, NEW.proposed_duration_hours);
  ELSIF OLD.price_change_status = 'pending_client_acceptance'
     AND NEW.price_change_status IS DISTINCT FROM 'pending_client_acceptance'
     AND NEW.price_change_status IS DISTINCT FROM 'accepted' THEN
    -- No aceptada (caducada): la agenda vuelve a la duración que tiene la reserva.
    PERFORM private.sync_booking_span(NEW.id, GREATEST(COALESCE(NEW.duration_hours, 1), 1));
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.booking_price_change_schedule() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_booking_price_change_schedule ON public.bookings;
CREATE TRIGGER trg_booking_price_change_schedule
AFTER UPDATE ON public.bookings
FOR EACH ROW
WHEN (OLD.price_change_status IS DISTINCT FROM NEW.price_change_status
      OR OLD.proposed_duration_hours IS DISTINCT FROM NEW.proposed_duration_hours)
EXECUTE FUNCTION private.booking_price_change_schedule();

-- Reloj: caduca las propuestas vencidas (el trigger de arriba devuelve las horas apartadas).
CREATE OR REPLACE FUNCTION private.expire_overdue_price_changes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.bookings
  SET price_change_status = 'expired', updated_at = now()
  WHERE price_change_status = 'pending_client_acceptance'
    AND proposed_price_expires_at IS NOT NULL
    AND proposed_price_expires_at <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION private.expire_overdue_price_changes() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('expire-price-change-proposals');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'expire-price-change-proposals',
    '*/15 * * * *',
    $cron$SELECT private.expire_overdue_price_changes();$cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron no disponible: programa private.expire_overdue_price_changes() externamente';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- H-41 / D22 · El horario del empleado lo pone su empresa
-- ─────────────────────────────────────────────────────────────────────────────

-- Escribir el propio horario: sí, salvo que seas empleado.
DROP POLICY IF EXISTS "Gardeners can manage own availability" ON public.availability;
CREATE POLICY "Own availability insert (not employees)" ON public.availability FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = gardener_id AND public.current_account_role() IS DISTINCT FROM 'employee');
CREATE POLICY "Own availability update (not employees)" ON public.availability FOR UPDATE TO authenticated
  USING (auth.uid() = gardener_id AND public.current_account_role() IS DISTINCT FROM 'employee')
  WITH CHECK (auth.uid() = gardener_id AND public.current_account_role() IS DISTINCT FROM 'employee');
CREATE POLICY "Own availability delete (not employees)" ON public.availability FOR DELETE TO authenticated
  USING (auth.uid() = gardener_id AND public.current_account_role() IS DISTINCT FROM 'employee');

DROP POLICY IF EXISTS "Gardeners can manage own availability blocks" ON public.availability_blocks;
CREATE POLICY "Own availability blocks insert (not employees)" ON public.availability_blocks FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = gardener_id AND public.current_account_role() IS DISTINCT FROM 'employee');
CREATE POLICY "Own availability blocks update (not employees)" ON public.availability_blocks FOR UPDATE TO authenticated
  USING (auth.uid() = gardener_id AND public.current_account_role() IS DISTINCT FROM 'employee')
  WITH CHECK (auth.uid() = gardener_id AND public.current_account_role() IS DISTINCT FROM 'employee');
CREATE POLICY "Own availability blocks delete (not employees)" ON public.availability_blocks FOR DELETE TO authenticated
  USING (auth.uid() = gardener_id AND public.current_account_role() IS DISTINCT FROM 'employee');

DROP POLICY IF EXISTS "Users can manage own recurring schedules" ON public.recurring_schedules;
CREATE POLICY "Own recurring schedules read" ON public.recurring_schedules FOR SELECT
  USING (auth.uid() = gardener_id);
CREATE POLICY "Own recurring schedules insert (not employees)" ON public.recurring_schedules FOR INSERT
  WITH CHECK (auth.uid() = gardener_id AND public.current_account_role() IS DISTINCT FROM 'employee');
CREATE POLICY "Own recurring schedules update (not employees)" ON public.recurring_schedules FOR UPDATE
  USING (auth.uid() = gardener_id AND public.current_account_role() IS DISTINCT FROM 'employee')
  WITH CHECK (auth.uid() = gardener_id AND public.current_account_role() IS DISTINCT FROM 'employee');
CREATE POLICY "Own recurring schedules delete (not employees)" ON public.recurring_schedules FOR DELETE
  USING (auth.uid() = gardener_id AND public.current_account_role() IS DISTINCT FROM 'employee');

DROP POLICY IF EXISTS "Users can manage own recurring settings" ON public.recurring_availability_settings;
CREATE POLICY "Own recurring settings read" ON public.recurring_availability_settings FOR SELECT
  USING (auth.uid() = gardener_id);
CREATE POLICY "Own recurring settings insert (not employees)" ON public.recurring_availability_settings FOR INSERT
  WITH CHECK (auth.uid() = gardener_id AND public.current_account_role() IS DISTINCT FROM 'employee');
CREATE POLICY "Own recurring settings update (not employees)" ON public.recurring_availability_settings FOR UPDATE
  USING (auth.uid() = gardener_id AND public.current_account_role() IS DISTINCT FROM 'employee')
  WITH CHECK (auth.uid() = gardener_id AND public.current_account_role() IS DISTINCT FROM 'employee');
CREATE POLICY "Own recurring settings delete (not employees)" ON public.recurring_availability_settings FOR DELETE
  USING (auth.uid() = gardener_id AND public.current_account_role() IS DISTINCT FROM 'employee');

-- El dueño, sobre un empleado activo de SU empresa. Devuelve el usuario del empleado.
CREATE OR REPLACE FUNCTION private.owned_member_user(p_member_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.company_members%ROWTYPE;
BEGIN
  SELECT * INTO v_member FROM public.company_members WHERE id = p_member_id;
  IF NOT FOUND OR v_member.status <> 'active' OR v_member.role <> 'employee'
     OR NOT public.is_company_owner(v_member.company_id) THEN
    RAISE EXCEPTION 'Solo el dueño de la empresa puede cambiar el horario de su equipo.' USING ERRCODE = '42501';
  END IF;
  RETURN v_member.user_id;
END;
$$;

REVOKE ALL ON FUNCTION private.owned_member_user(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.member_recurring_schedule(p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := private.owned_member_user(p_member_id);
BEGIN
  RETURN jsonb_build_object(
    'rules', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('day_of_week', r.day_of_week, 'start_time', r.start_time, 'end_time', r.end_time)
                       ORDER BY r.day_of_week, r.start_time)
      FROM public.recurring_schedules r WHERE r.gardener_id = v_user), '[]'::jsonb),
    'weeks_to_maintain', (SELECT s.weeks_to_maintain FROM public.recurring_availability_settings s WHERE s.gardener_id = v_user)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_member_recurring_schedule(p_member_id uuid, p_rules jsonb, p_weeks integer DEFAULT 4)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := private.owned_member_user(p_member_id);
  v_weeks integer := LEAST(GREATEST(COALESCE(p_weeks, 4), 1), 12);
BEGIN
  IF jsonb_typeof(COALESCE(p_rules, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Horario no válido.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_rules, '[]'::jsonb)) x
    WHERE (x ->> 'day_of_week')::int NOT BETWEEN 0 AND 6
       OR (x ->> 'start_time')::time >= (x ->> 'end_time')::time
  ) THEN
    RAISE EXCEPTION 'Horario no válido.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.recurring_availability_settings (gardener_id, weeks_to_maintain, min_notice_hours, updated_at)
  VALUES (v_user, v_weeks, 0, now())
  ON CONFLICT (gardener_id) DO UPDATE SET weeks_to_maintain = EXCLUDED.weeks_to_maintain, updated_at = now();

  DELETE FROM public.recurring_schedules WHERE gardener_id = v_user;
  INSERT INTO public.recurring_schedules (gardener_id, day_of_week, start_time, end_time)
  SELECT v_user, (x ->> 'day_of_week')::int, (x ->> 'start_time')::time, (x ->> 'end_time')::time
  FROM jsonb_array_elements(COALESCE(p_rules, '[]'::jsonb)) x;

  -- Las horas ya vendidas no se reabren: trigger protect_sold_availability (A-32).
  PERFORM public.generate_recurring_slots(v_user, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_member_day_availability(p_member_id uuid, p_date date, p_hours integer[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := private.owned_member_user(p_member_id);
BEGIN
  IF p_date IS NULL OR p_date < current_date THEN
    RAISE EXCEPTION 'No se puede cambiar el horario de un día pasado.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_hours, '{}')) h WHERE h NOT BETWEEN 0 AND 23) THEN
    RAISE EXCEPTION 'Horas no válidas.' USING ERRCODE = '22023';
  END IF;

  -- Mismo gesto que el guardado de siempre (borrar el día y poner sus horas). Las horas ya
  -- vendidas no se reabren: trigger protect_sold_availability (A-32).
  DELETE FROM public.availability WHERE gardener_id = v_user AND date = p_date;
  INSERT INTO public.availability (gardener_id, date, start_time, end_time, is_available)
  SELECT v_user, p_date, make_time(h, 0, 0), make_time(h, 0, 0) + interval '1 hour', true
  FROM (SELECT DISTINCT h FROM unnest(COALESCE(p_hours, '{}')) h) AS hours;
END;
$$;

CREATE OR REPLACE FUNCTION public.member_busy_hours(p_member_id uuid, p_start date, p_end date)
RETURNS TABLE(date date, hour integer, status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := private.owned_member_user(p_member_id);
BEGIN
  RETURN QUERY
  SELECT bb.date, bb.hour_block, b.status
  FROM public.booking_blocks bb JOIN public.bookings b ON b.id = bb.booking_id
  WHERE bb.assignee_id = v_user AND bb.date BETWEEN p_start AND p_end
  ORDER BY 1, 2;
END;
$$;

REVOKE ALL ON FUNCTION public.member_recurring_schedule(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_member_recurring_schedule(uuid, jsonb, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_member_day_availability(uuid, date, integer[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.member_busy_hours(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_recurring_schedule(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_recurring_schedule(uuid, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_day_availability(uuid, date, integer[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.member_busy_hours(uuid, date, date) TO authenticated;
