-- El flujo de cambio de precio llevaba roto desde el 12/07/2026.
--
-- `20260713000001_harden_bookings_writes.sql` hizo REVOKE UPDATE ON bookings FROM authenticated
-- dejando solo GRANT UPDATE (status). Pero NINGUNA de las seis migraciones del flujo de cambio
-- de precio declaraba SECURITY DEFINER, asi que ambas RPC se ejecutaban con los privilegios del
-- invocador (rol `authenticated`) y sus UPDATE sobre total_price / price_change_status fallaban
-- con "permission denied for table bookings". Ni proponer ni aceptar un cambio de precio
-- funcionaba: el jardinero pulsaba y no pasaba nada.
--
-- Comparar con respond_booking_request (20260514090000), que si lo declara. Aqui se recrean
-- ambas funciones con el mismo cuerpo, anadiendo SECURITY DEFINER + SET search_path. Las dos
-- ya validan auth.uid() explicitamente contra gardener_id / client_id, asi que elevar el
-- privilegio no abre ningun acceso nuevo.
--
-- Se aprovecha para dejar los mensajes de chat con el formato de euros unico (format_eur) y una
-- redaccion que aclara que los gastos de gestion ya cobrados NO se recobran al cambiar el precio.

-- ---------------------------------------------------------------------------------------
-- propose_booking_price_change
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.propose_booking_price_change(
  p_booking_id uuid,
  p_proposed_total_price numeric,
  p_reason text DEFAULT NULL,
  p_operation_id uuid DEFAULT NULL,
  p_expires_in_minutes integer DEFAULT 1440
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_reason text;
  v_payload_signature text;
  v_should_execute boolean;
  v_response jsonb;
  v_expires_at timestamptz;
  v_ttl_minutes integer;
  v_service_name text;
  v_is_palm_service boolean := false;
  v_has_terminal_open_range boolean := false;
BEGIN
  IF p_proposed_total_price IS NULL OR p_proposed_total_price <= 0 THEN
    RAISE EXCEPTION 'El nuevo precio debe ser mayor que 0.';
  END IF;

  v_ttl_minutes := GREATEST(1, LEAST(COALESCE(p_expires_in_minutes, 1440), 10080));
  v_reason := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
  v_payload_signature := format('%s|%s|%s', p_proposed_total_price, COALESCE(v_reason, ''), v_ttl_minutes);
  v_should_execute := public.register_booking_operation_once(
    'propose_booking_price_change',
    p_booking_id,
    p_operation_id,
    v_payload_signature
  );

  IF NOT v_should_execute THEN
    SELECT response_payload INTO v_response
    FROM public.booking_rpc_idempotency
    WHERE actor_id = auth.uid()
      AND action = 'propose_booking_price_change'
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

  IF v_booking.gardener_id <> auth.uid() THEN
    RAISE EXCEPTION 'No autorizado para proponer cambio de precio.';
  END IF;

  IF COALESCE(v_booking.price_change_status, 'none') = 'pending_client_acceptance' THEN
    RAISE EXCEPTION 'Ya existe una propuesta de precio pendiente. Debe resolverse antes de crear otra.';
  END IF;

  SELECT s.name
  INTO v_service_name
  FROM public.services s
  WHERE s.id = v_booking.service_id;

  v_is_palm_service :=
    COALESCE(v_booking.pricing_context->>'service_type', '') = 'palm_pruning'
    OR COALESCE(v_service_name, '') ILIKE '%palmera%';

  IF v_is_palm_service THEN
    SELECT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(v_booking.pricing_context->'palm_groups', '[]'::jsonb)) elem
      WHERE COALESCE((elem->>'is_terminal_open_range')::boolean, false) = true
        AND (elem->>'quantity') ~ '^[0-9]+(\.[0-9]+)?$'
        AND (elem->>'quantity')::numeric > 0
    ) INTO v_has_terminal_open_range;

    IF NOT v_has_terminal_open_range THEN
      RAISE EXCEPTION 'No se permite proponer cambio de precio en palmeras fuera del último rango abierto de la especie.';
    END IF;
  END IF;

  v_expires_at := now() + make_interval(mins => v_ttl_minutes);

  UPDATE public.bookings
  SET price_change_status = 'pending_client_acceptance',
      proposed_total_price = p_proposed_total_price,
      proposed_price_reason = v_reason,
      proposed_price_by = auth.uid(),
      proposed_price_at = now(),
      proposed_price_expires_at = v_expires_at,
      updated_at = now()
  WHERE id = p_booking_id;

  INSERT INTO public.chat_messages (booking_id, sender_id, message)
  VALUES (
    p_booking_id,
    auth.uid(),
    format(
      'Propuesta de nuevo precio del servicio: %s.%s Los gastos de gestión ya abonados no cambian.',
      public.format_eur(p_proposed_total_price),
      CASE WHEN v_reason IS NULL THEN '' ELSE ' Motivo: ' || v_reason || '.' END
    )
  );

  v_response := jsonb_build_object(
    'status', 'pending_client_acceptance',
    'booking_id', p_booking_id,
    'proposed_total_price', p_proposed_total_price,
    'expires_at', v_expires_at
  );
  PERFORM public.complete_booking_operation('propose_booking_price_change', p_operation_id, v_response);
  RETURN v_response;
END;
$$;

-- ---------------------------------------------------------------------------------------
-- respond_booking_price_change
-- ---------------------------------------------------------------------------------------

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

    UPDATE public.bookings
    SET status = 'cancelled',
        updated_at = now()
    WHERE client_id = v_booking.client_id
      AND service_id = v_booking.service_id
      AND date = v_booking.date
      AND start_time = v_booking.start_time
      AND id <> p_booking_id
      AND status = 'pending';

    v_start_hour := cast(split_part(v_booking.start_time::text, ':', 1) as int);
    v_duration := COALESCE(v_booking.duration_hours, 1);

    FOR v_hour IN v_start_hour .. (v_start_hour + v_duration) LOOP
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

REVOKE ALL ON FUNCTION public.propose_booking_price_change(uuid, numeric, text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_booking_price_change(uuid, numeric, text, uuid, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.respond_booking_price_change(uuid, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_booking_price_change(uuid, boolean, uuid) TO authenticated;
