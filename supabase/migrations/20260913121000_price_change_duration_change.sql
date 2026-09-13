-- T4 (transversal) + decisión D5 del usuario (2026-09-13):
--
-- "En caso de haber una propuesta de cambio de precio, a parte de propuesta de cambio de
-- precio quiero que añadas un cambio de tiempo en el que el jardinero pueda solicitar
-- también un alargamiento o acortamiento del servicio pero únicamente modificando la hora
-- de finalización, no la de inicio."
--
-- Hasta ahora `respond_booking_price_change` NUNCA tocaba `duration_hours`: aceptar un
-- cambio de precio que reflejaba un trabajo más grande dejaba el precio nuevo pero la
-- agenda y el fin del servicio con la duración vieja (T4). Esta migración:
--
--   1) Añade `bookings.proposed_duration_hours`: el jardinero puede adjuntar, junto a la
--      propuesta de precio, una nueva duración total. Solo cambia el FIN — `start_time` no
--      se toca en ningún punto de este flujo.
--   2) `resize_booking_schedule()`: redimensiona la agenda (`booking_blocks`,
--      `availability_blocks`, `availability`) al rango [inicio, inicio+nueva_duración).
--      Si alarga y las horas de más ya no están libres, FALLA (no deja nada a medias): el
--      cliente no puede "aceptar" un alargamiento que en realidad no cabe.
--   3) `propose_booking_price_change` y `respond_booking_price_change` ganan el parámetro
--      de duración. Al aceptar, se llama a `resize_booking_schedule` SIEMPRE (con la
--      duración propuesta o, si no se pidió cambio, la que ya tenía — no-op de agenda);
--      sustituye al bucle que solo tocaba la tabla `availability` heredado de la Fase 0/F5,
--      así que de paso deja también `booking_blocks`/`availability_blocks` coherentes en
--      TODAS las aceptaciones, no solo las que cambian duración.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS proposed_duration_hours integer;

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_proposed_duration_hours_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_proposed_duration_hours_check
  CHECK (proposed_duration_hours IS NULL OR (proposed_duration_hours >= 1 AND proposed_duration_hours <= 12));

COMMENT ON COLUMN public.bookings.proposed_duration_hours IS
  'Nueva duración propuesta junto a un cambio de precio (D5). Solo mueve la hora de FIN: '
  'start_time nunca cambia. NULL = la propuesta no incluye cambio de duración.';

-- =============================================
-- Redimensiona la agenda de una reserva al rango [inicio, inicio + nueva_duración)
-- =============================================
-- Uso interno (llamada por respond_booking_price_change); no la usa nadie más y no
-- necesita GRANT propio, igual que reserve_booking_schedule/release_booking_schedule.
CREATE OR REPLACE FUNCTION public.resize_booking_schedule(
  p_booking_id uuid,
  p_new_duration_hours integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_start_hour int;
  v_old_end_hour int;
  v_new_end_hour int;
  v_free_count int;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF p_new_duration_hours IS NULL OR p_new_duration_hours < 1 THEN
    RAISE EXCEPTION 'La duración debe ser de al menos 1 hora.' USING ERRCODE = '22023';
  END IF;

  v_start_hour := EXTRACT(HOUR FROM v_booking.start_time)::int;
  v_old_end_hour := v_start_hour + GREATEST(COALESCE(v_booking.duration_hours, 1), 1);
  v_new_end_hour := v_start_hour + p_new_duration_hours;

  IF v_new_end_hour > v_old_end_hour THEN
    -- Alargar: las horas de más, [v_old_end_hour, v_new_end_hour), tienen que estar libres
    -- en la agenda REAL del profesional (availability_blocks, la fuente canónica que ya usa
    -- reserve_booking_schedule) — no basta con mirar `availability`, que aquí solo se
    -- mantiene como espejo de lectura para el checkout.
    SELECT count(*) INTO v_free_count
    FROM public.availability_blocks
    WHERE gardener_id = v_booking.gardener_id
      AND date = v_booking.date
      AND hour_block >= v_old_end_hour
      AND hour_block < v_new_end_hour
      AND is_available = true;

    IF v_free_count <> (v_new_end_hour - v_old_end_hour) THEN
      RAISE EXCEPTION 'El profesional ya no tiene libres las horas necesarias para alargar el servicio.'
        USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO public.booking_blocks (booking_id, date, hour_block)
    SELECT p_booking_id, v_booking.date, hour_block
    FROM generate_series(v_old_end_hour, v_new_end_hour - 1) AS hour_block
    ON CONFLICT DO NOTHING;

    UPDATE public.availability_blocks
    SET is_available = false
    WHERE gardener_id = v_booking.gardener_id
      AND date = v_booking.date
      AND hour_block >= v_old_end_hour
      AND hour_block < v_new_end_hour;

    UPDATE public.availability
    SET is_available = false
    WHERE gardener_id = v_booking.gardener_id
      AND date = v_booking.date
      AND EXTRACT(HOUR FROM start_time) >= v_old_end_hour
      AND EXTRACT(HOUR FROM start_time) < v_new_end_hour;

  ELSIF v_new_end_hour < v_old_end_hour THEN
    -- Acortar: libera [v_new_end_hour, v_old_end_hour) en las tres tablas.
    DELETE FROM public.booking_blocks
    WHERE booking_id = p_booking_id
      AND hour_block >= v_new_end_hour
      AND hour_block < v_old_end_hour;

    UPDATE public.availability_blocks
    SET is_available = true
    WHERE gardener_id = v_booking.gardener_id
      AND date = v_booking.date
      AND hour_block >= v_new_end_hour
      AND hour_block < v_old_end_hour;

    UPDATE public.availability
    SET is_available = true
    WHERE gardener_id = v_booking.gardener_id
      AND date = v_booking.date
      AND EXTRACT(HOUR FROM start_time) >= v_new_end_hour
      AND EXTRACT(HOUR FROM start_time) < v_old_end_hour;
  END IF;
  -- v_new_end_hour = v_old_end_hour: nada que mover en la agenda.

  UPDATE public.bookings
  SET duration_hours = p_new_duration_hours
  WHERE id = p_booking_id;
  -- end_time se recalcula solo: trigger_calculate_end_time (20250929000002) ya existente.
END;
$$;

REVOKE ALL ON FUNCTION public.resize_booking_schedule(uuid, integer) FROM PUBLIC;

-- ---------------------------------------------------------------------------------------
-- propose_booking_price_change — gana p_proposed_duration_hours
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.propose_booking_price_change(
  p_booking_id uuid,
  p_proposed_total_price numeric,
  p_reason text DEFAULT NULL,
  p_operation_id uuid DEFAULT NULL,
  p_expires_in_minutes integer DEFAULT 1440,
  p_proposed_duration_hours integer DEFAULT NULL
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

  -- D5: solo se mueve la hora de FIN. 1-12h es el mismo tope que ya usa el resto del
  -- ciclo de vida (create_broadcast_booking_requests) para duration_hours.
  IF p_proposed_duration_hours IS NOT NULL
     AND (p_proposed_duration_hours < 1 OR p_proposed_duration_hours > 12) THEN
    RAISE EXCEPTION 'La duración propuesta debe estar entre 1 y 12 horas.';
  END IF;

  v_ttl_minutes := GREATEST(1, LEAST(COALESCE(p_expires_in_minutes, 1440), 10080));
  v_reason := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
  v_payload_signature := format('%s|%s|%s|%s', p_proposed_total_price, COALESCE(v_reason, ''), v_ttl_minutes, COALESCE(p_proposed_duration_hours::text, ''));
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
      proposed_duration_hours = p_proposed_duration_hours,
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
      'Propuesta de nuevo precio del servicio: %s.%s%s Los gastos de gestión ya abonados no cambian.',
      public.format_eur(p_proposed_total_price),
      CASE WHEN p_proposed_duration_hours IS NULL OR p_proposed_duration_hours = v_booking.duration_hours THEN ''
           ELSE format(' Nueva duración estimada: %s h (antes %s h).', p_proposed_duration_hours, v_booking.duration_hours)
      END,
      CASE WHEN v_reason IS NULL THEN '' ELSE ' Motivo: ' || v_reason || '.' END
    )
  );

  v_response := jsonb_build_object(
    'status', 'pending_client_acceptance',
    'booking_id', p_booking_id,
    'proposed_total_price', p_proposed_total_price,
    'proposed_duration_hours', p_proposed_duration_hours,
    'expires_at', v_expires_at
  );
  PERFORM public.complete_booking_operation('propose_booking_price_change', p_operation_id, v_response);
  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION public.propose_booking_price_change(uuid, numeric, text, uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_booking_price_change(uuid, numeric, text, uuid, integer, integer) TO authenticated;

-- La firma anterior (5 parámetros, sin duración) deja de existir: PostgREST resuelve por
-- nombre+firma exacta, así que un cliente viejo en caché fallaría con "function not found"
-- en vez de silenciosamente ignorar el parámetro nuevo. Se elimina explícitamente para que
-- el error sea ese y no una sobrecarga ambigua conviviendo con la de 6 parámetros.
DROP FUNCTION IF EXISTS public.propose_booking_price_change(uuid, numeric, text, uuid, integer);

-- ---------------------------------------------------------------------------------------
-- respond_booking_price_change — al aceptar, redimensiona la agenda con resize_booking_schedule
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
  v_final_duration integer;
  v_payload_signature text;
  v_should_execute boolean;
  v_response jsonb;
  v_sibling_id uuid;
  v_duration_note text;
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
    v_final_duration := COALESCE(v_booking.proposed_duration_hours, v_booking.duration_hours);

    -- Redimensiona la agenda al rango [inicio, inicio + duración final) ANTES de tocar la
    -- fila: si alargar no cabe, esto lanza y toda la transacción se deshace (la propuesta
    -- sigue pendiente, no queda nada a medias). Cuando no se propuso cambio de duración,
    -- v_final_duration = la que ya tenía → no-op de agenda, y de paso deja
    -- booking_blocks/availability_blocks coherentes con availability en TODAS las
    -- aceptaciones (antes solo se tocaba `availability`).
    PERFORM public.resize_booking_schedule(p_booking_id, v_final_duration);

    -- Solo cambia el precio del servicio (y, si se propuso, la duración). management_fee es
    -- inmutable (trigger trg_bookings_management_fee_guard): la comision ya cobrada no se
    -- recalcula ni se recobra.
    UPDATE public.bookings
    SET total_price = v_proposed,
        duration_hours = v_final_duration,
        price_change_status = 'accepted',
        status = 'confirmed',
        proposed_price_expires_at = NULL,
        proposed_duration_hours = NULL,
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

    v_duration_note := CASE
      WHEN v_final_duration IS DISTINCT FROM v_booking.duration_hours
      THEN format(' La duración del servicio pasa a %s h.', v_final_duration)
      ELSE ''
    END;

    INSERT INTO public.chat_messages (booking_id, sender_id, message)
    VALUES (
      p_booking_id,
      auth.uid(),
      format(
        'Nuevo precio del servicio aceptado: %s.%s Reserva confirmada. Los gastos de gestión ya abonados no cambian.',
        public.format_eur(v_proposed),
        v_duration_note
      )
    );

    v_response := jsonb_build_object(
      'status', 'accepted',
      'booking_id', p_booking_id,
      'final_total_price', v_proposed,
      'final_duration_hours', v_final_duration
    );
  ELSE
    UPDATE public.bookings
    SET price_change_status = 'rejected',
        status = 'cancelled',
        proposed_price_expires_at = NULL,
        proposed_duration_hours = NULL,
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

-- Limpieza (encontrada al aplicar esta migración, no introducida por ella): dos sobrecargas
-- heredadas de ANTES de que `p_operation_id` existiera (20260505110000/20260507120000),
-- nunca eliminadas cuando las migraciones posteriores usaban `CREATE OR REPLACE` con una
-- lista de parámetros distinta — en Postgres eso crea una sobrecarga nueva, no sustituye la
-- vieja. Inalcanzables hoy: todo caller real (`bookingPriceChangeService.ts`) manda siempre
-- `operationId`, así que PostgREST nunca resuelve hacia estas dos.
DROP FUNCTION IF EXISTS public.propose_booking_price_change(uuid, numeric, text);
DROP FUNCTION IF EXISTS public.respond_booking_price_change(uuid, boolean);
