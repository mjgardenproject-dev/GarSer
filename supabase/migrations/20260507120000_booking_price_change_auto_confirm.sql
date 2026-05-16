-- Auto-confirm and auto-cancel logic for booking price changes

CREATE OR REPLACE FUNCTION public.respond_booking_price_change(
  p_booking_id uuid,
  p_accept boolean,
  p_operation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
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
    -- Auto-confirm the booking
    UPDATE public.bookings
    SET total_price = v_proposed,
        price_change_status = 'accepted',
        status = 'confirmed',
        proposed_price_expires_at = NULL,
        updated_at = now()
    WHERE id = p_booking_id;

    -- Cancel parallel bookings for the same client, service, date, and start_time
    UPDATE public.bookings
    SET status = 'cancelled',
        updated_at = now()
    WHERE client_id = v_booking.client_id
      AND service_id = v_booking.service_id
      AND date = v_booking.date
      AND start_time = v_booking.start_time
      AND id <> p_booking_id
      AND status = 'pending';

    -- Block availability for the gardener
    -- start_time is a string like '09:00' or '09:00:00'
    v_start_hour := cast(split_part(v_booking.start_time::text, ':', 1) as int);
    v_duration := COALESCE(v_booking.duration_hours, 1);
    
    -- Block the hours of the booking + 1 hour margin
    FOR v_hour IN v_start_hour .. (v_start_hour + v_duration) LOOP
      UPDATE public.availability
      SET is_available = false
      WHERE gardener_id = v_booking.gardener_id
        AND date = v_booking.date
        AND start_time = lpad(v_hour::text, 2, '0') || ':00:00';
    END LOOP;

    INSERT INTO public.chat_messages (booking_id, sender_id, message)
    VALUES (
      p_booking_id,
      auth.uid(),
      format('Cliente acepta el nuevo precio: €%s. Reserva confirmada automáticamente.', to_char(v_proposed, 'FM999999990.00'))
    );

    v_response := jsonb_build_object(
      'status', 'accepted',
      'booking_id', p_booking_id,
      'final_total_price', v_proposed
    );
  ELSE
    -- Auto-cancel the booking
    UPDATE public.bookings
    SET price_change_status = 'rejected',
        status = 'cancelled',
        proposed_price_expires_at = NULL,
        updated_at = now()
    WHERE id = p_booking_id;

    INSERT INTO public.chat_messages (booking_id, sender_id, message)
    VALUES (
      p_booking_id,
      auth.uid(),
      'Cliente rechaza la propuesta de nuevo precio. Reserva cancelada automáticamente.'
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
