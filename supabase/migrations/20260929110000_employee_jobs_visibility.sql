-- Prueba real (2026-09-28) · F4: el empleado solo ve lo que ya es suyo (R-07, R-10) y el aviso
-- de trabajo asignado lo envía el servidor en todos los caminos (R-07).
--
-- R-07: `my_jobs` devolvía también las reservas `pending` (la empresa aún no las había aceptado)
-- y las de persona sin decidir (`assignment_pending`), con la etiqueta «Por confirmar».
-- R-10: `is_booking_assignee` (detalle del trabajo, `can_read_booking_items`, «he terminado») solo
-- miraba que tuviera horas apartadas: el empleado podía leer dirección y teléfono del cliente de
-- una solicitud que su empresa aún no había aceptado. Las horas siguen apartadas a esa persona
-- (A-29); solo no se le enseña el trabajo hasta que lo es.
-- Aviso: antes lo pedía el navegador del dueño al aceptar o al cambiar la persona, y no salía
-- cuando la reserva se confirmaba porque el CLIENTE aceptaba una propuesta de precio (el caso del
-- usuario el 2026-09-28). Ahora un trigger diferido compara, al final de cada transacción, quién
-- va con quién ya estaba avisado (`private.booking_job_notices`) y apunta en la cola
-- `job_assigned` para quien entra y `job_unassigned` para quien sale o si se cancela. Diferido
-- para ver el estado final: repartir o mover horas de la misma persona no avisa en falso.

-- =============================================
-- 1) my_jobs
-- =============================================
CREATE OR REPLACE FUNCTION public.my_jobs(p_from date, p_to date)
 RETURNS TABLE(booking_id uuid, date date, start_time time without time zone, duration_hours integer, status text, service_name text, client_address text, client_name text, client_phone text, notes text, company_name text, assignment_pending boolean, finished_at timestamp with time zone, service_start timestamp with time zone, my_hours integer[], end_date date, labour_hours integer, team_size integer, my_days jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT b.id, b.date, b.start_time::time, b.duration_hours, b.status, public.booking_service_label(b.id),
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
    -- R-07: solo lo que ya es suyo de verdad. Una solicitud que la empresa aún no ha aceptado, o
    -- una persona que el dueño aún no ha decidido (modo manual), no se le enseña al empleado.
    AND b.status IN ('confirmed', 'in_progress', 'completed', 'disputed')
    AND NOT COALESCE(b.assignment_pending, false)
    AND EXISTS (SELECT 1 FROM public.booking_blocks bb WHERE bb.booking_id = b.id AND bb.assignee_id = auth.uid())
  ORDER BY b.date, b.start_time;
$$;

-- =============================================
-- 2) is_booking_assignee
-- =============================================
CREATE OR REPLACE FUNCTION public.is_booking_assignee(p_booking_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.booking_blocks bb
    JOIN public.bookings b ON b.id = bb.booking_id
    WHERE bb.booking_id = p_booking_id
      AND bb.assignee_id = auth.uid()
      AND b.status IN ('confirmed', 'in_progress', 'completed', 'disputed')
      AND NOT COALESCE(b.assignment_pending, false)
  );
$$;
REVOKE ALL ON FUNCTION public.is_booking_assignee(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_booking_assignee(uuid) TO authenticated;

-- =============================================
-- 3) Avisos de trabajo asignado / quitado
-- =============================================
CREATE TABLE IF NOT EXISTS private.booking_job_notices (
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  assignee_id uuid NOT NULL,
  notified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (booking_id, assignee_id)
);
COMMENT ON TABLE private.booking_job_notices IS
  'A quién se le ha avisado de que va a un trabajo de empresa (para avisar solo de los cambios).';
REVOKE ALL ON private.booking_job_notices FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.sync_job_notices(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_current uuid[] := '{}';
  v_person uuid;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  -- Solo reservas de empresa: el autónomo no tiene a nadie a quien avisar (Regla 2).
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.provider_user_id = v_booking.gardener_id) THEN
    RETURN;
  END IF;

  IF v_booking.status IN ('confirmed', 'in_progress') AND NOT COALESCE(v_booking.assignment_pending, false) THEN
    SELECT COALESCE(array_agg(DISTINCT bb.assignee_id), '{}') INTO v_current
    FROM public.booking_blocks bb
    WHERE bb.booking_id = p_booking_id
      AND bb.assignee_id IS NOT NULL
      AND bb.assignee_id <> v_booking.gardener_id;   -- al dueño que trabaja no se le avisa
  ELSIF v_booking.status NOT IN ('cancelled', 'expired', 'rejected') THEN
    -- Pendiente, persona sin decidir, o ya terminado: no se avisa de nada.
    RETURN;
  END IF;

  FOR v_person IN
    SELECT unnest(v_current)
    EXCEPT
    SELECT n.assignee_id FROM private.booking_job_notices n WHERE n.booking_id = p_booking_id
  LOOP
    INSERT INTO private.booking_job_notices (booking_id, assignee_id) VALUES (p_booking_id, v_person);
    PERFORM private.enqueue_notification('job_assigned',
      format('job_assigned:%s:%s:%s', p_booking_id, v_person, txid_current()), p_booking_id,
      jsonb_build_object('bookingId', p_booking_id, 'workerId', v_person));
  END LOOP;

  FOR v_person IN
    SELECT n.assignee_id FROM private.booking_job_notices n WHERE n.booking_id = p_booking_id
    EXCEPT
    SELECT unnest(v_current)
  LOOP
    DELETE FROM private.booking_job_notices WHERE booking_id = p_booking_id AND assignee_id = v_person;
    PERFORM private.enqueue_notification('job_unassigned',
      format('job_unassigned:%s:%s:%s', p_booking_id, v_person, txid_current()), p_booking_id,
      jsonb_build_object('bookingId', p_booking_id, 'workerId', v_person));
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION private.sync_job_notices(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.booking_blocks_job_notices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM private.sync_job_notices(COALESCE(NEW.booking_id, OLD.booking_id));
  IF TG_OP = 'UPDATE' AND NEW.booking_id IS DISTINCT FROM OLD.booking_id THEN
    PERFORM private.sync_job_notices(OLD.booking_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.bookings_job_notices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM private.sync_job_notices(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_booking_blocks_job_notices ON public.booking_blocks;
CREATE CONSTRAINT TRIGGER trg_booking_blocks_job_notices
  AFTER INSERT OR UPDATE OR DELETE ON public.booking_blocks
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION private.booking_blocks_job_notices();

DROP TRIGGER IF EXISTS trg_bookings_job_notices ON public.bookings;
CREATE CONSTRAINT TRIGGER trg_bookings_job_notices
  AFTER UPDATE ON public.bookings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.assignment_pending IS DISTINCT FROM NEW.assignment_pending)
  EXECUTE FUNCTION private.bookings_job_notices();

-- Lo que ya había: a quien ya va a un trabajo confirmado se le avisó en su día (lo pedía el
-- navegador). Se apunta como avisado, sin enviar nada, para no repetirle el correo.
INSERT INTO private.booking_job_notices (booking_id, assignee_id)
SELECT DISTINCT b.id, bb.assignee_id
FROM public.bookings b
JOIN public.companies c ON c.provider_user_id = b.gardener_id
JOIN public.booking_blocks bb ON bb.booking_id = b.id
WHERE b.status IN ('confirmed', 'in_progress')
  AND NOT COALESCE(b.assignment_pending, false)
  AND bb.assignee_id IS NOT NULL
  AND bb.assignee_id <> b.gardener_id
ON CONFLICT DO NOTHING;
