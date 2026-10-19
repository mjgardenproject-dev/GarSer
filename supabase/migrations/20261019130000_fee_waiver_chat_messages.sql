-- Lanzamiento (2026-10), complemento de 20261019120000_own_clients_fee_waiver: en una reserva SIN
-- gastos de gestión, los mensajes de chat de un cambio de precio ya no dicen «Los gastos de gestión
-- ya abonados no cambian» (no se abonó nada). Solo cambia ese texto; con gastos, todo igual.
-- Funciones copiadas de su última definición con el mínimo cambio marcado.

-- ── propose_booking_price_change (copia de F7) ──

CREATE OR REPLACE FUNCTION public.propose_booking_price_change(p_booking_id uuid, p_proposed_total_price numeric, p_reason text DEFAULT NULL::text, p_operation_id uuid DEFAULT NULL::uuid, p_expires_in_minutes integer DEFAULT 1440, p_proposed_duration_hours integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- F7: en un trabajo de equipo o de varios días solo se cambia el precio, no la duración.
  IF v_booking.labour_hours IS NOT NULL AND p_proposed_duration_hours IS NOT NULL
     AND p_proposed_duration_hours IS DISTINCT FROM v_booking.duration_hours THEN
    RAISE EXCEPTION 'Este trabajo es de varias personas o de varios días: puedes cambiar el precio, pero no la duración.';
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
      'Propuesta de nuevo precio del servicio: %s.%s%s%s',
      public.format_eur(p_proposed_total_price),
      CASE WHEN p_proposed_duration_hours IS NULL OR p_proposed_duration_hours = v_booking.duration_hours THEN ''
           ELSE format(' Nueva duración estimada: %s h (antes %s h).', p_proposed_duration_hours, v_booking.duration_hours)
      END,
      CASE WHEN v_reason IS NULL THEN '' ELSE ' Motivo: ' || v_reason || '.' END,
      -- Sin gastos de gestión (exención del lanzamiento) no hay nada «ya abonado» que mencionar.
      CASE WHEN COALESCE(v_booking.management_fee, 0) > 0 THEN ' Los gastos de gestión ya abonados no cambian.' ELSE '' END
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
$function$;

-- ── respond_booking_price_change (copia de 20260913121000) ──

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
        'Nuevo precio del servicio aceptado: %s.%s Reserva confirmada.%s',
        public.format_eur(v_proposed),
        v_duration_note,
        -- Sin gastos de gestión (exención del lanzamiento) no hay nada «ya abonado» que mencionar.
        CASE WHEN COALESCE(v_booking.management_fee, 0) > 0 THEN ' Los gastos de gestión ya abonados no cambian.' ELSE '' END
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

-- ── trg_booking_chat_system_message (copia de F8 service label) ──

CREATE OR REPLACE FUNCTION public.trg_booking_chat_system_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gardener text;
  v_service  text;
  v_when     text;
  v_price    text;
  v_proposed text;
BEGIN
  v_gardener := public.chat_display_name(NEW.gardener_id, 'El profesional');
  v_service := COALESCE(public.booking_service_label(NEW.id), 'el servicio');
  v_when  := to_char(NEW.date, 'DD/MM/YYYY') || COALESCE(' a las ' || to_char(NEW.start_time, 'HH24:MI'), '');
  v_price := public.format_eur(COALESCE(NEW.total_price, 0));

  -- Alta de reserva (solicitud). Solo para reservas reales, no estados intermedios.
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('pending', 'confirmed') THEN
      PERFORM public.post_booking_system_message(
        NEW.id,
        'Reserva solicitada: ' || v_service || ' para el ' || v_when ||
        '. Precio del servicio: ' || v_price || ', que el cliente abona al profesional al completarlo.' ||
        ' A la espera de que el profesional la confirme.'
      );
    END IF;
    RETURN NEW;
  END IF;

  -- Cambios de estado de la reserva
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'confirmed' THEN
      PERFORM public.post_booking_system_message(
        NEW.id, v_gardener || ' ha aceptado la reserva. ¡Todo listo para el ' || v_when || '!'
      );

    ELSIF NEW.status = 'completed' THEN
      -- El chat lo leen las DOS partes, asi que el texto tiene que ser correcto para ambas: se
      -- afirma el hecho (servicio finalizado) y se invita a valorar nombrando a quien puede
      -- hacerlo. Sin esto el cliente no tenia forma de saber que se esperaba algo de el.
      PERFORM public.post_booking_system_message(
        NEW.id,
        'Servicio finalizado: ' || v_service || ' del ' || v_when || '.' ||
        ' El cliente puede dejar ahora su valoración de ' || v_gardener ||
        ' desde «Mis reservas» o desde el apartado de reseñas.'
      );

    ELSIF NEW.status IN ('cancelled', 'rejected') THEN
      PERFORM public.post_booking_system_message(
        NEW.id, 'La reserva de ' || v_service || ' ha sido cancelada.'
      );
    END IF;
  END IF;

  -- Cambios de precio del servicio
  IF NEW.price_change_status IS DISTINCT FROM OLD.price_change_status THEN
    IF NEW.price_change_status = 'pending_client_acceptance' THEN
      v_proposed := public.format_eur(COALESCE(NEW.proposed_total_price, 0));
      PERFORM public.post_booking_system_message(
        NEW.id,
        v_gardener || ' propone un nuevo precio del servicio: ' || v_proposed ||
        COALESCE('. Motivo: ' || NULLIF(TRIM(NEW.proposed_price_reason), ''), '') ||
        CASE WHEN COALESCE(NEW.management_fee, 0) > 0 THEN '. Los gastos de gestión ya abonados no cambian' ELSE '' END ||
        '. Puedes aceptarlo o rechazarlo desde el chat.'
      );
    ELSIF NEW.price_change_status = 'accepted' THEN
      PERFORM public.post_booking_system_message(
        NEW.id, 'Nuevo precio del servicio aceptado: ' || v_price || '.'
      );
    ELSIF NEW.price_change_status = 'rejected' THEN
      PERFORM public.post_booking_system_message(
        NEW.id, 'Propuesta de nuevo precio rechazada. Se mantiene el precio del servicio: ' || v_price || '.'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
