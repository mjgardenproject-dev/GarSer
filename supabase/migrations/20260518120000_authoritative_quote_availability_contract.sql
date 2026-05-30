-- Bind persisted quotes to an authoritative slot and persist an economic snapshot
-- reusable by future checkout/payment integrations.

ALTER TABLE public.booking_quotes
  ADD COLUMN IF NOT EXISTS selected_date date,
  ADD COLUMN IF NOT EXISTS selected_start_time time,
  ADD COLUMN IF NOT EXISTS availability_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS economic_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_booking_quotes_slot_status
  ON public.booking_quotes(gardener_id, selected_date, selected_start_time, status, expires_at DESC);

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
  p_operation_id uuid DEFAULT NULL,
  p_quote_id uuid DEFAULT NULL
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
  v_quote public.booking_quotes%ROWTYPE;
  v_effective_pricing_context jsonb := COALESCE(p_pricing_context, '{}'::jsonb);
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

  IF COALESCE(BTRIM(p_client_address), '') = '' THEN
    RAISE EXCEPTION 'La dirección del cliente es obligatoria.';
  END IF;

  IF p_quote_id IS NULL THEN
    RAISE EXCEPTION 'Debes regenerar el presupuesto antes de confirmar la reserva.';
  END IF;

  SELECT *
  INTO v_quote
  FROM public.booking_quotes
  WHERE id = p_quote_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El presupuesto seleccionado ya no está disponible.';
  END IF;

  IF v_quote.client_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'El presupuesto no pertenece a la sesión autenticada.';
  END IF;

  IF v_quote.status <> 'active' OR v_quote.expires_at <= now() THEN
    UPDATE public.booking_quotes
    SET status = 'expired'
    WHERE id = p_quote_id
      AND status = 'active';

    RAISE EXCEPTION 'El presupuesto ha expirado. Vuelve a seleccionar el profesional.';
  END IF;

  IF v_quote.selected_date IS NULL OR v_quote.selected_start_time IS NULL THEN
    RAISE EXCEPTION 'Debes regenerar el presupuesto antes de confirmar la reserva.';
  END IF;

  IF v_quote.gardener_id <> p_gardener_id OR v_quote.service_id <> p_service_id THEN
    RAISE EXCEPTION 'El presupuesto no coincide con el jardinero o servicio seleccionados.';
  END IF;

  IF v_quote.selected_date <> p_date THEN
    RAISE EXCEPTION 'La fecha ya no coincide con el presupuesto autorizado.';
  END IF;

  IF v_quote.selected_start_time <> p_start_time THEN
    RAISE EXCEPTION 'La hora ya no coincide con el presupuesto autorizado.';
  END IF;

  IF ROUND(COALESCE(v_quote.total_price, 0)::numeric, 2) <> ROUND(p_total_price::numeric, 2) THEN
    RAISE EXCEPTION 'El precio ya no coincide con el presupuesto autorizado.';
  END IF;

  IF CEIL(COALESCE(v_quote.estimated_hours, 0))::integer <> p_duration_hours THEN
    RAISE EXCEPTION 'La duración ya no coincide con el presupuesto autorizado.';
  END IF;

  v_effective_pricing_context := v_effective_pricing_context || jsonb_build_object(
    'quote_id', v_quote.id,
    'pricing_version', v_quote.pricing_version,
    'provider_config_version', v_quote.provider_config_version,
    'quote_signature', v_quote.signature,
    'quote_snapshot', v_quote.pricing_snapshot,
    'quote_expires_at', v_quote.expires_at,
    'quote_availability_snapshot', v_quote.availability_snapshot,
    'quote_economic_snapshot', v_quote.economic_snapshot
  );

  v_start_hour := EXTRACT(HOUR FROM p_start_time);
  v_end_hour := v_start_hour + p_duration_hours;

  IF v_start_hour < 0 OR v_end_hour > 20 THEN
    RAISE EXCEPTION 'La franja seleccionada queda fuera del horario permitido.';
  END IF;

  v_payload_signature := format(
    '%s|%s|%s|%s|%s|%s|%s|%s',
    p_gardener_id,
    p_service_id,
    p_date,
    p_start_time,
    p_duration_hours,
    p_total_price,
    md5(COALESCE(p_client_address, '')),
    p_quote_id
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
    v_effective_pricing_context
  );

  INSERT INTO public.booking_blocks (booking_id, date, hour_block)
  SELECT v_booking_id, p_date, hour_block
  FROM generate_series(v_start_hour, v_end_hour - 1) AS hour_block
  ON CONFLICT DO NOTHING;

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

  UPDATE public.booking_quotes
  SET status = 'consumed',
      consumed_at = now(),
      booking_id = v_booking_id
  WHERE id = p_quote_id;

  v_response := jsonb_build_object(
    'booking_id', v_booking_id,
    'status', 'pending',
    'date', p_date,
    'start_time', p_start_time,
    'duration_hours', p_duration_hours,
    'quote_id', p_quote_id
  );

  PERFORM public.complete_booking_operation('create_atomic_booking', p_operation_id, v_response);
  RETURN v_response;
END;
$$;
