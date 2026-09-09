-- F5 — `respond_booking_price_change` manejaba mal la agenda del profesional en TRES sitios:
--
--  1) Al ACEPTAR, bloqueaba con un bucle propio e INCLUSIVO
--     (`FOR v_hour IN v_start_hour .. (v_start_hour + v_duration)`), marcando
--     `availability.is_available = false` para UNA hora de más (la de después del servicio).
--     Esa hora no tiene fila en `booking_blocks`, así que `release_booking_schedule` no la
--     restauraba nunca: hueco muerto, uno por cada reserva con cambio de precio aceptado.
--     → El rango correcto es `[inicio, inicio + duración)`, el mismo de
--       `reserve_booking_schedule` y `confirm_booking_payment_attempt`.
--
--  2) Al ACEPTAR, cancelaba las reservas HERMANAS pendientes (mismo cliente/servicio/franja)
--     sin liberar SU agenda. `respond_booking_request` accept sí llama a
--     `release_booking_schedule` por cada hermana. → Se iguala.
--
--  3) Al RECHAZAR, ponía la reserva en `cancelled` pero NO liberaba la agenda: los
--     `booking_blocks` creados al reservar seguían ahí y las horas quedaban ocupadas para
--     siempre, aun con la reserva cancelada. Todas las demás vías de cancelación
--     (`cancel_booking`, `respond_booking_request` reject) sí liberan. → Se añade el
--     `release_booking_schedule`.
--
-- El resto de `respond_booking_price_change` queda idéntico a 20260803121000.

CREATE OR REPLACE FUNCTION public.respond_booking_price_change(
  p_booking_id uuid,
  p_accept boolean,
  p_operation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_proposed numeric;
  v_payload_signature text;
  v_should_execute boolean;
  v_response jsonb;
  v_start_hour int;
  v_duration int;
  v_hour int;
  v_sibling_id uuid;
BEGIN
  v_payload_signature := format('%s', p_accept);
  v_should_execute := public.register_booking_operation_once(
    'respond_booking_price_change',
    p_booking_id,
    p_operation_id,
    v_payload_signature
  );

  IF NOT v_should_execute THEN
    SELECT response_payload INTO v_response
    FROM public.booking_rpc_idempotency
    WHERE actor_id = auth.uid()
      AND action = 'respond_booking_price_change'
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

  IF v_booking.client_id <> auth.uid() THEN
    RAISE EXCEPTION 'No autorizado para responder cambio de precio.';
  END IF;

  IF COALESCE(v_booking.price_change_status, 'none') <> 'pending_client_acceptance' THEN
    RAISE EXCEPTION 'No hay propuesta de precio pendiente.';
  END IF;

  v_proposed := COALESCE(v_booking.proposed_total_price, 0);
  IF p_accept AND v_proposed <= 0 THEN
    RAISE EXCEPTION 'La propuesta no contiene un precio válido.';
  END IF;

  IF p_accept THEN
    -- Solo cambia el precio del servicio. management_fee es inmutable (trigger
    -- trg_bookings_management_fee_guard): la comision ya cobrada no se recalcula ni se recobra.
    UPDATE public.bookings
    SET total_price = v_proposed,
        price_change_status = 'accepted',
        status = 'confirmed',
        proposed_price_expires_at = NULL,
        updated_at = now()
    WHERE id = p_booking_id;

    -- Cancela las reservas hermanas pendientes (mismo hueco) y LIBERA su agenda, igual que
    -- hace `respond_booking_request` accept.
    FOR v_sibling_id IN
      SELECT id FROM public.bookings
      WHERE client_id = v_booking.client_id
        AND service_id = v_booking.service_id
        AND date = v_booking.date
        AND start_time = v_booking.start_time
        AND id <> p_booking_id
        AND status = 'pending'
    LOOP
      PERFORM public.release_booking_schedule(v_sibling_id);
      UPDATE public.bookings SET status = 'cancelled', updated_at = now() WHERE id = v_sibling_id;
    END LOOP;

    v_start_hour := cast(split_part(v_booking.start_time::text, ':', 1) as int);
    v_duration := COALESCE(v_booking.duration_hours, 1);

    -- Rango [inicio, inicio + duración): un servicio de 3 h desde las 09:00 bloquea 09, 10 y
    -- 11, NO las 12. (Antes el límite superior era inclusivo y bloqueaba una hora de más que
    -- luego nadie liberaba.)
    FOR v_hour IN v_start_hour .. (v_start_hour + v_duration - 1) LOOP
      UPDATE public.availability
      SET is_available = false
      WHERE gardener_id = v_booking.gardener_id
        AND date = v_booking.date
        AND start_time = (lpad(v_hour::text, 2, '0') || ':00:00')::time;
    END LOOP;

    INSERT INTO public.chat_messages (booking_id, sender_id, message)
    VALUES (
      p_booking_id,
      auth.uid(),
      format(
        'Nuevo precio del servicio aceptado: %s. Reserva confirmada. Los gastos de gestión ya abonados no cambian.',
        public.format_eur(v_proposed)
      )
    );

    v_response := jsonb_build_object(
      'status', 'accepted',
      'booking_id', p_booking_id,
      'final_total_price', v_proposed
    );
  ELSE
    UPDATE public.bookings
    SET price_change_status = 'rejected',
        status = 'cancelled',
        proposed_price_expires_at = NULL,
        updated_at = now()
    WHERE id = p_booking_id;

    -- Rechazar cancela la reserva → hay que liberar el hueco (antes se quedaba ocupado para
    -- siempre). Mismo gesto que `cancel_booking` y `respond_booking_request` reject.
    PERFORM public.release_booking_schedule(p_booking_id);

    INSERT INTO public.chat_messages (booking_id, sender_id, message)
    VALUES (
      p_booking_id,
      auth.uid(),
      'Propuesta de nuevo precio rechazada. La reserva queda cancelada y no se cobran los gastos de gestión.'
    );

    v_response := jsonb_build_object(
      'status', 'rejected',
      'booking_id', p_booking_id
    );
  END IF;

  PERFORM public.complete_booking_operation('respond_booking_price_change', p_operation_id, v_response);
  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION public.respond_booking_price_change(uuid, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_booking_price_change(uuid, boolean, uuid) TO authenticated;
