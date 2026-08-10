-- Migration: RPCs del ciclo de vida de la reserva (paso 8C-B)
--
-- Implementa la política decidida en PLAN-IMPLEMENTACION.md §8C-D:
--   · Cancelación por AMBAS partes (hasta ahora imposible desde la UI).
--   · Auto-finalización 24 h después del fin del servicio.
--   · Caducidad de solicitudes por RELOJ (no cuando el jardinero abre su panel).
--   · No-show reportable dentro de la ventana.
--
-- Reparto de responsabilidades: estas funciones resuelven la BASE DE DATOS y DEVUELVEN qué
-- hay que hacer con el dinero (`money_action`). La llamada a Stripe la hace la edge function
-- `booking-payment`, que es la única que habla con la pasarela.

-- Fin real del servicio, según lo reservado.
CREATE OR REPLACE FUNCTION public.booking_service_end(p_booking public.bookings)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ((p_booking.date + p_booking.start_time)::timestamptz
          + make_interval(hours => GREATEST(COALESCE(p_booking.duration_hours, 1), 1)));
$$;

-- =============================================
-- CANCELACIÓN (cliente o jardinero)
-- =============================================
-- Devuelve la acción económica que debe ejecutar el llamante:
--   'refund'  → devolver los gastos de gestión (causa del jardinero)
--   'capture' → capturar la autorización pendiente (desiste el cliente)
--   'release' → liberar la autorización sin cobrar (jardinero no llegó a aceptar)
--   'none'    → no hay nada que mover
CREATE OR REPLACE FUNCTION public.cancel_booking(
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
  v_money_action text;
  v_penalty boolean := false;
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

  -- Idempotencia: si ya está cancelada, se devuelve el mismo resultado sin volver a mover dinero.
  IF v_booking.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'bookingId', v_booking.id,
      'status', 'cancelled',
      'actor', v_booking.cancellation_actor,
      'money_action', 'none',
      'idempotent', true
    );
  END IF;

  IF v_booking.status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'Esta reserva ya no se puede cancelar (estado: %)', v_booking.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- POLÍTICA ECONÓMICA (§8C-D3): manda de quién es la causa, no el estado.
  IF v_actor = 'gardener' THEN
    IF v_booking.status = 'confirmed' THEN
      -- Ya había aceptado (y por tanto el cobro ya se capturó): se devuelve al cliente
      -- y el jardinero se lleva la penalización.
      v_money_action := 'refund';
      v_penalty := true;
    ELSE
      -- Aún no había aceptado: es un rechazo, se libera sin cobrar y sin sanción.
      v_money_action := 'release';
    END IF;
  ELSE
    -- Desiste el cliente: los gastos de gestión se capturan (no se devuelven). Si el
    -- jardinero aún no había aceptado, el pago solo está autorizado → hay que capturarlo.
    v_money_action := CASE WHEN v_booking.status = 'pending' THEN 'capture' ELSE 'none' END;
  END IF;

  UPDATE public.bookings
  SET status = 'cancelled',
      cancelled_at = now(),
      cancellation_actor = v_actor,
      cancelled_by = auth.uid(),
      cancellation_reason = NULLIF(TRIM(COALESCE(p_reason, '')), ''),
      updated_at = now()
  WHERE id = p_booking_id;

  -- Libera el hueco de agenda para que otro cliente pueda reservarlo.
  PERFORM public.release_booking_schedule(p_booking_id);

  -- Penalización automática de 1★ (§8C-D4). Marcada como del sistema: nadie recibió el
  -- servicio, así que no puede presentarse como la opinión de un cliente.
  IF v_penalty THEN
    INSERT INTO public.reviews (booking_id, client_id, gardener_id, rating, comment, is_system_penalty, system_reason)
    VALUES (
      p_booking_id, NULL, v_booking.gardener_id, 1,
      'Servicio no completado',
      true,
      'gardener_cancelled_after_accepting'
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'bookingId', v_booking.id,
    'status', 'cancelled',
    'actor', v_actor,
    'money_action', v_money_action,
    'penalty_applied', v_penalty,
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_booking(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_booking(uuid, text) TO authenticated;

-- =============================================
-- NO-SHOW (reportable dentro de la ventana)
-- =============================================
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
  v_new_status text;
  v_money_action text;
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

  -- Solo desde que el servicio debió terminar (antes no hay nada que reportar).
  IF now() < public.booking_service_end(v_booking) THEN
    RAISE EXCEPTION 'Todavía no puedes reportar una incidencia: el servicio no ha terminado'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Si la otra parte ya reportó lo contrario, pasa a disputa (revisión manual).
  IF v_booking.status IN ('no_show_client', 'no_show_gardener') THEN
    UPDATE public.bookings
    SET status = 'disputed', updated_at = now()
    WHERE id = p_booking_id;
    RETURN jsonb_build_object('bookingId', p_booking_id, 'status', 'disputed', 'money_action', 'none');
  END IF;

  IF v_booking.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Esta reserva no admite reporte de incidencia (estado: %)', v_booking.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_actor = 'gardener' THEN
    -- El cliente no estaba: causa del cliente → se mantiene lo cobrado.
    v_new_status := 'no_show_client';
    v_money_action := 'none';
  ELSE
    -- El jardinero no apareció: causa del jardinero → mismo trato que cancelar tras aceptar.
    v_new_status := 'no_show_gardener';
    v_money_action := 'refund';
    INSERT INTO public.reviews (booking_id, client_id, gardener_id, rating, comment, is_system_penalty, system_reason)
    VALUES (p_booking_id, NULL, v_booking.gardener_id, 1, 'Servicio no completado', true, 'gardener_no_show')
    ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.bookings
  SET status = v_new_status,
      no_show_reported_by = auth.uid(),
      no_show_reported_at = now(),
      cancellation_reason = COALESCE(NULLIF(TRIM(COALESCE(p_reason, '')), ''), cancellation_reason),
      updated_at = now()
  WHERE id = p_booking_id;

  PERFORM public.release_booking_schedule(p_booking_id);

  RETURN jsonb_build_object(
    'bookingId', p_booking_id,
    'status', v_new_status,
    'actor', v_actor,
    'money_action', v_money_action
  );
END;
$$;

REVOKE ALL ON FUNCTION public.report_booking_no_show(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_booking_no_show(uuid, text) TO authenticated;

-- =============================================
-- CRON · caducidad de solicitudes POR RELOJ
-- =============================================
-- Sustituye en la práctica a expire_stale_booking_requests(), que solo corría cuando un
-- jardinero abría su panel y además filtraba `gardener_id = auth.uid()` (cada uno caducaba
-- solo las suyas). Aquí no hay actor: lo ejecuta el cron para TODAS.
-- Caduca a las 24 h... o al llegar la hora de inicio, lo que ocurra antes: no tiene sentido
-- esperar 24 h si el servicio era en 3 h.
CREATE OR REPLACE FUNCTION public.expire_due_booking_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_count integer := 0;
BEGIN
  FOR v_id IN
    SELECT id FROM public.bookings
    WHERE status = 'pending'
      AND (
        created_at <= now() - interval '24 hours'
        OR (date + start_time)::timestamptz <= now()
      )
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.release_booking_schedule(v_id);
    UPDATE public.bookings
    SET status = 'expired', updated_at = now()
    WHERE id = v_id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- =============================================
-- CRON · auto-finalización 24 h tras el fin del servicio
-- =============================================
-- Si el jardinero no da el servicio por finalizado, el sistema lo cierra solo para que la
-- reserva no quede viva indefinidamente y, sobre todo, para que EL CLIENTE PUEDA VALORAR
-- (dejar reseña exige `completed`).
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
    SELECT * FROM public.bookings
    WHERE status = 'confirmed'
    FOR UPDATE SKIP LOCKED
  LOOP
    IF now() >= public.booking_service_end(v_booking) + interval '24 hours' THEN
      UPDATE public.bookings
      SET status = 'completed',
          auto_completed_at = now(),
          updated_at = now()
      WHERE id = v_booking.id;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_due_booking_requests() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_complete_due_bookings() FROM PUBLIC;
