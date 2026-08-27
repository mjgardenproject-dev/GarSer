-- Migration: prerrequisitos del ciclo de cierre con confirmacion del cliente
--
-- Tres arreglos independientes que hay que tener EN PIE antes de construir encima el sistema
-- de confirmacion e incidencias. No añaden funcionalidad: corrigen lo que ya esta mal.
--
--   1. `booking_service_end()` devolvia la hora en UTC, no en hora local.
--   2. `report_booking_no_show()` era una puerta de reembolso sin administrador.
--   3. `auto_complete_due_bookings()` bloqueaba TODAS las reservas confirmadas cada 15 minutos.

-- =============================================
-- 1) Fin del servicio en hora local, no en UTC
-- =============================================
-- `(date + start_time)::timestamptz` interpreta la marca de tiempo en la zona de la SESION,
-- que en Supabase es UTC. Una reserva de 10:00 a 12:00 hora peninsular devolvia "12:00 UTC",
-- que son las 14:00 en España: dos horas tarde en verano, una en invierno.
--
-- Hasta hoy el fallo solo retrasaba la auto-finalizacion y nadie lo noto. Deja de ser
-- invisible en cuanto el sistema empiece a escribirle al cliente "confirma antes de las
-- 18:00": el correo saldria dos horas tarde y la fecha limite impresa no coincidiria con la
-- que aplica el reloj.
--
-- `timezone(text, timestamp)` SI es IMMUTABLE -a diferencia del cast a timestamptz, que
-- depende de un GUC de sesion-, asi que la declaracion de la funcion pasa a ser cierta y el
-- planificador puede confiar en ella.
CREATE OR REPLACE FUNCTION public.booking_service_end(p_booking public.bookings)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (((p_booking.date + p_booking.start_time) AT TIME ZONE 'Europe/Madrid')
          + make_interval(hours => GREATEST(COALESCE(p_booking.duration_hours, 1), 1)));
$$;

COMMENT ON FUNCTION public.booking_service_end(public.bookings) IS
  'Fin real del servicio reservado, en hora peninsular. La zona va fijada a proposito: los '
  'horarios de los jardineros y las horas que ve el cliente son horas locales, no UTC.';

-- =============================================
-- 2) Cerrar la puerta de reembolso sin administrador
-- =============================================
-- La rama del CLIENTE de esta funcion ponia `no_show_gardener` + `money_action = 'refund'` e
-- insertaba una reseña de sistema de 1 estrella contra el jardinero. Como la funcion esta
-- expuesta por la edge function `booking-payment` (accion `report_no_show`), cualquier cliente
-- autenticado podia provocarse un reembolso y penalizar a un profesional con una peticion
-- HTTP, sin que ningun administrador revisara nada. Ninguna pantalla la llamaba, pero el
-- endpoint estaba vivo.
--
-- La politica acordada es que el dinero solo se devuelve cuando un administrador acepta una
-- incidencia. Aqui se corta el paso; el camino de sustitucion (parte de incidencia + cola de
-- revision) llega en la migracion del sistema de incidencias.
--
-- La rama del JARDINERO se mantiene intacta: no mueve dinero ni penaliza a nadie.
CREATE OR REPLACE FUNCTION public.report_booking_no_show(
  p_booking_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_actor text;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada' USING ERRCODE = 'no_data_found';
  END IF;

  IF auth.uid() = v_booking.client_id THEN
    v_actor := 'client';
  ELSIF auth.uid() = v_booking.gardener_id THEN
    v_actor := 'gardener';
  ELSE
    RAISE EXCEPTION 'No participas en esta reserva' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- El cliente ya no resuelve por su cuenta: abre una incidencia y decide un administrador.
  IF v_actor = 'client' THEN
    RAISE EXCEPTION 'Para reportar que el profesional no acudio, abre una incidencia desde la reserva'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Solo desde que el servicio debio terminar (antes no hay nada que reportar).
  IF now() < public.booking_service_end(v_booking) THEN
    RAISE EXCEPTION 'Todavía no puedes reportar una incidencia: el servicio no ha terminado'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_booking.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Esta reserva no admite reporte de incidencia (estado: %)', v_booking.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- El cliente no estaba: causa del cliente, se mantiene lo cobrado.
  UPDATE public.bookings
  SET status = 'no_show_client',
      no_show_reported_by = auth.uid(),
      no_show_reported_at = now(),
      cancellation_reason = COALESCE(NULLIF(TRIM(COALESCE(p_reason, '')), ''), cancellation_reason),
      updated_at = now()
  WHERE id = p_booking_id;

  PERFORM public.release_booking_schedule(p_booking_id);

  RETURN jsonb_build_object(
    'bookingId', p_booking_id,
    'status', 'no_show_client',
    'actor', 'gardener',
    'money_action', 'none'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.report_booking_no_show(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_booking_no_show(uuid, text) TO authenticated;

-- =============================================
-- 3) Que la auto-finalizacion no bloquee todo el sistema cada 15 minutos
-- =============================================
-- La version anterior hacia `SELECT * FROM bookings WHERE status = 'confirmed' FOR UPDATE
-- SKIP LOCKED` SIN filtro de fecha, y evaluaba el vencimiento fila a fila dentro del bucle:
-- cada pasada del cron bloqueaba TODAS las reservas confirmadas del sistema, incluidas las de
-- dentro de tres semanas. Con el filtro en el WHERE solo se bloquea lo que de verdad vence.
--
-- El filtro por `date` es una poda barata e indexable que precede al calculo exacto: si el
-- servicio vencio hace mas de 24 h, su fecha es forzosamente anterior o igual a hoy.
CREATE INDEX IF NOT EXISTS idx_bookings_confirmed_by_date
  ON public.bookings (date)
  WHERE status = 'confirmed';

CREATE OR REPLACE FUNCTION public.auto_complete_due_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_count integer := 0;
BEGIN
  FOR v_booking IN
    SELECT b.* FROM public.bookings b
    WHERE b.status = 'confirmed'
      AND b.date <= ((now() AT TIME ZONE 'Europe/Madrid')::date)
      AND public.booking_service_end(b) + interval '24 hours' <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.bookings
    SET status = 'completed',
        auto_completed_at = now(),
        updated_at = now()
    WHERE id = v_booking.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_complete_due_bookings() FROM PUBLIC;
