-- Harden booking creation and remove anonymous write/read access to bookings.

DROP POLICY IF EXISTS "Allow anonymous users to create bookings" ON public.bookings;
DROP POLICY IF EXISTS "Allow anonymous users to view bookings" ON public.bookings;

REVOKE INSERT ON public.bookings FROM anon;
REVOKE SELECT ON public.bookings FROM anon;

ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS pricing_context jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.create_atomic_booking(
  p_gardener_id uuid,
  p_service_id uuid,
  p_date date,
  p_start_time time,
  p_duration_hours integer,
  p_total_price numeric,
  p_client_address text,
  p_booking_id uuid DEFAULT NULL,
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
  v_booking_id uuid := COALESCE(p_booking_id, gen_random_uuid());
  v_start_hour integer;
  v_end_hour integer;
  v_payload_signature text;
  v_should_execute boolean;
  v_available_count integer := 0;
  v_expected_count integer := 0;
  v_response jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para confirmar la reserva.';
  END IF;

  IF p_gardener_id IS NULL OR p_service_id IS NULL OR p_date IS NULL OR p_start_time IS NULL THEN
    RAISE EXCEPTION 'Faltan datos obligatorios para confirmar la reserva.';
  END IF;

  IF p_duration_hours IS NULL OR p_duration_hours < 1 OR p_duration_hours > 12 THEN
    RAISE EXCEPTION 'La duración de la reserva no es válida.';
  END IF;

  IF p_total_price IS NULL OR p_total_price <= 0 THEN
    RAISE EXCEPTION 'El precio total de la reserva no es válido.';
  END IF;

  v_start_hour := EXTRACT(HOUR FROM p_start_time);
  v_end_hour := v_start_hour + p_duration_hours;

  IF v_start_hour < 0 OR v_end_hour > 20 THEN
    RAISE EXCEPTION 'La franja seleccionada queda fuera del horario permitido.';
  END IF;

  v_payload_signature := format(
    '%s|%s|%s|%s|%s|%s|%s',
    p_gardener_id,
    p_service_id,
    p_date,
    p_start_time,
    p_duration_hours,
    p_total_price,
    md5(COALESCE(p_client_address, ''))
  );

  v_should_execute := public.register_booking_operation_once(
    'create_atomic_booking',
    v_booking_id,
    p_operation_id,
    v_payload_signature
  );

  IF NOT v_should_execute THEN
    SELECT response_payload INTO v_response
    FROM public.booking_rpc_idempotency
    WHERE actor_id = auth.uid()
      AND action = 'create_atomic_booking'
      AND operation_id = p_operation_id;

    RETURN COALESCE(v_response, jsonb_build_object('booking_id', v_booking_id, 'status', 'pending'));
  END IF;

  PERFORM 1
  FROM public.availability
  WHERE gardener_id = p_gardener_id
    AND date = p_date
    AND is_available = true
    AND EXTRACT(HOUR FROM start_time) >= v_start_hour
    AND EXTRACT(HOUR FROM start_time) < v_end_hour
  FOR UPDATE;

  SELECT COUNT(*)
    INTO v_available_count
  FROM public.availability
  WHERE gardener_id = p_gardener_id
    AND date = p_date
    AND is_available = true
    AND EXTRACT(HOUR FROM start_time) >= v_start_hour
    AND EXTRACT(HOUR FROM start_time) < v_end_hour;

  v_expected_count := p_duration_hours;

  IF v_available_count <> v_expected_count THEN
    RAISE EXCEPTION 'La franja seleccionada ya no está disponible.';
  END IF;

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
    p_gardener_id,
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

  INSERT INTO public.booking_blocks (booking_id, date, hour_block)
  SELECT v_booking_id, p_date, hour_block
  FROM generate_series(v_start_hour, v_end_hour - 1) AS hour_block;

  UPDATE public.availability
  SET is_available = false
  WHERE gardener_id = p_gardener_id
    AND date = p_date
    AND EXTRACT(HOUR FROM start_time) >= v_start_hour
    AND EXTRACT(HOUR FROM start_time) < v_end_hour;

  UPDATE public.availability_blocks
  SET is_available = false
  WHERE gardener_id = p_gardener_id
    AND date = p_date
    AND hour_block >= v_start_hour
    AND hour_block < v_end_hour;

  v_response := jsonb_build_object(
    'booking_id', v_booking_id,
    'status', 'pending',
    'date', p_date,
    'start_time', p_start_time,
    'duration_hours', p_duration_hours
  );

  PERFORM public.complete_booking_operation('create_atomic_booking', p_operation_id, v_response);
  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION public.create_atomic_booking(
  uuid,
  uuid,
  date,
  time,
  integer,
  numeric,
  text,
  uuid,
  text,
  jsonb,
  numeric,
  numeric,
  uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_atomic_booking(
  uuid,
  uuid,
  date,
  time,
  integer,
  numeric,
  text,
  uuid,
  text,
  jsonb,
  numeric,
  numeric,
  uuid
) TO authenticated;
