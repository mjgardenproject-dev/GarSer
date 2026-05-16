CREATE OR REPLACE FUNCTION public.release_booking_schedule(
  p_booking_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.availability_blocks ab
  SET is_available = true
  FROM public.booking_blocks bb
  WHERE bb.booking_id = p_booking_id
    AND ab.gardener_id = v_booking.gardener_id
    AND ab.date = bb.date
    AND ab.hour_block = bb.hour_block;

  UPDATE public.availability a
  SET is_available = true
  FROM public.booking_blocks bb
  WHERE bb.booking_id = p_booking_id
    AND a.gardener_id = v_booking.gardener_id
    AND a.date = bb.date
    AND EXTRACT(HOUR FROM a.start_time) = bb.hour_block;

  DELETE FROM public.booking_blocks
  WHERE booking_id = p_booking_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_booking_schedule(
  p_booking_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_start_hour integer;
  v_end_hour integer;
  v_available_count integer := 0;
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_blocks
    WHERE booking_id = p_booking_id
  ) THEN
    RETURN;
  END IF;

  v_start_hour := EXTRACT(HOUR FROM v_booking.start_time);
  v_end_hour := v_start_hour + v_booking.duration_hours;

  PERFORM 1
  FROM public.availability_blocks
  WHERE gardener_id = v_booking.gardener_id
    AND date = v_booking.date
    AND hour_block >= v_start_hour
    AND hour_block < v_end_hour
    AND is_available = true
  FOR UPDATE;

  SELECT COUNT(*)
    INTO v_available_count
  FROM public.availability_blocks
  WHERE gardener_id = v_booking.gardener_id
    AND date = v_booking.date
    AND hour_block >= v_start_hour
    AND hour_block < v_end_hour
    AND is_available = true;

  IF v_available_count <> v_booking.duration_hours THEN
    RAISE EXCEPTION 'La franja seleccionada ya no está disponible.';
  END IF;

  INSERT INTO public.booking_blocks (booking_id, date, hour_block)
  SELECT p_booking_id, v_booking.date, hour_block
  FROM generate_series(v_start_hour, v_end_hour - 1) AS hour_block;

  UPDATE public.availability_blocks
  SET is_available = false
  WHERE gardener_id = v_booking.gardener_id
    AND date = v_booking.date
    AND hour_block >= v_start_hour
    AND hour_block < v_end_hour;

  UPDATE public.availability
  SET is_available = false
  WHERE gardener_id = v_booking.gardener_id
    AND date = v_booking.date
    AND EXTRACT(HOUR FROM start_time) >= v_start_hour
    AND EXTRACT(HOUR FROM start_time) < v_end_hour;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_stale_booking_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired_id uuid;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;

  FOR v_expired_id IN
    SELECT id
    FROM public.bookings
    WHERE gardener_id = auth.uid()
      AND status = 'pending'
      AND created_at <= now() - interval '24 hours'
  LOOP
    PERFORM public.release_booking_schedule(v_expired_id);

    UPDATE public.bookings
    SET status = 'expired',
        updated_at = now()
    WHERE id = v_expired_id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_booking_request(
  p_booking_id uuid,
  p_response text,
  p_operation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_payload_signature text;
  v_should_execute boolean;
  v_response jsonb;
  v_sibling_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;

  IF p_response NOT IN ('accept', 'reject') THEN
    RAISE EXCEPTION 'Respuesta no válida.';
  END IF;

  v_payload_signature := format('%s|%s', p_booking_id, p_response);
  v_should_execute := public.register_booking_operation_once(
    'respond_booking_request',
    p_booking_id,
    p_operation_id,
    v_payload_signature
  );

  IF NOT v_should_execute THEN
    SELECT response_payload INTO v_response
    FROM public.booking_rpc_idempotency
    WHERE actor_id = auth.uid()
      AND action = 'respond_booking_request'
      AND operation_id = p_operation_id;

    RETURN COALESCE(v_response, jsonb_build_object('booking_id', p_booking_id, 'status', 'idempotent_replayed'));
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada.';
  END IF;

  IF v_booking.gardener_id <> auth.uid() THEN
    RAISE EXCEPTION 'No autorizado para responder a esta reserva.';
  END IF;

  IF v_booking.status <> 'pending' THEN
    v_response := jsonb_build_object(
      'booking_id', v_booking.id,
      'status', v_booking.status,
      'message', 'La reserva ya no está pendiente.'
    );
    PERFORM public.complete_booking_operation('respond_booking_request', p_operation_id, v_response);
    RETURN v_response;
  END IF;

  IF p_response = 'accept' THEN
    IF COALESCE(v_booking.price_change_status, 'none') = 'pending_client_acceptance' THEN
      RAISE EXCEPTION 'No puedes confirmar la reserva mientras exista un cambio de precio pendiente.';
    END IF;

    PERFORM public.reserve_booking_schedule(v_booking.id);

    UPDATE public.bookings
    SET status = 'confirmed',
        updated_at = now()
    WHERE id = v_booking.id;

    FOR v_sibling_id IN
      SELECT id
      FROM public.bookings
      WHERE id <> v_booking.id
        AND client_id = v_booking.client_id
        AND service_id = v_booking.service_id
        AND date = v_booking.date
        AND start_time = v_booking.start_time
        AND status = 'pending'
    LOOP
      PERFORM public.release_booking_schedule(v_sibling_id);

      UPDATE public.bookings
      SET status = 'cancelled',
          updated_at = now()
      WHERE id = v_sibling_id;
    END LOOP;

    v_response := jsonb_build_object(
      'booking_id', v_booking.id,
      'status', 'confirmed'
    );
  ELSE
    PERFORM public.release_booking_schedule(v_booking.id);

    UPDATE public.bookings
    SET status = 'cancelled',
        updated_at = now()
    WHERE id = v_booking.id;

    v_response := jsonb_build_object(
      'booking_id', v_booking.id,
      'status', 'cancelled'
    );
  END IF;

  PERFORM public.complete_booking_operation('respond_booking_request', p_operation_id, v_response);
  RETURN v_response;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_broadcast_booking_requests(
  p_gardener_ids uuid[],
  p_service_id uuid,
  p_date date,
  p_start_time time,
  p_duration_hours integer,
  p_total_price numeric,
  p_client_address text,
  p_notes text DEFAULT NULL,
  p_pricing_context jsonb DEFAULT '{}'::jsonb,
  p_travel_fee numeric DEFAULT 15,
  p_hourly_rate numeric DEFAULT 25,
  p_operation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gardener_id uuid;
  v_booking_id uuid;
  v_response jsonb;
  v_inserted_ids uuid[] := '{}';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para enviar la solicitud.';
  END IF;

  IF p_gardener_ids IS NULL OR array_length(p_gardener_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Debes indicar al menos un jardinero.';
  END IF;

  IF p_service_id IS NULL OR p_date IS NULL OR p_start_time IS NULL THEN
    RAISE EXCEPTION 'Faltan datos obligatorios para crear la solicitud.';
  END IF;

  IF p_duration_hours IS NULL OR p_duration_hours < 1 OR p_duration_hours > 12 THEN
    RAISE EXCEPTION 'La duración no es válida.';
  END IF;

  IF p_total_price IS NULL OR p_total_price <= 0 THEN
    RAISE EXCEPTION 'El precio total no es válido.';
  END IF;

  FOREACH v_gardener_id IN ARRAY p_gardener_ids LOOP
    v_booking_id := gen_random_uuid();

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
      pricing_context
    ) VALUES (
      v_booking_id,
      auth.uid(),
      v_gardener_id,
      p_service_id,
      p_date,
      p_start_time,
      p_duration_hours,
      'pending',
      p_total_price,
      COALESCE(p_travel_fee, 15),
      COALESCE(p_hourly_rate, 25),
      p_client_address,
      p_notes,
      COALESCE(p_pricing_context, '{}'::jsonb)
    );

    v_inserted_ids := array_append(v_inserted_ids, v_booking_id);
  END LOOP;

  v_response := jsonb_build_object(
    'status', 'pending',
    'booking_ids', to_jsonb(v_inserted_ids)
  );

  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION public.release_booking_schedule(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_booking_schedule(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_stale_booking_requests() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.respond_booking_request(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_broadcast_booking_requests(uuid[], uuid, date, time, integer, numeric, text, text, jsonb, numeric, numeric, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.expire_stale_booking_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_booking_request(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_broadcast_booking_requests(uuid[], uuid, date, time, integer, numeric, text, text, jsonb, numeric, numeric, uuid) TO authenticated;
