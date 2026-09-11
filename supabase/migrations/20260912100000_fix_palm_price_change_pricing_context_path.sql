-- Corrige el guardián de "banda terminal abierta" de propose_booking_price_change para
-- palmeras (auditoría de palmeras 2026-09-11/12, hallazgo #4).
--
-- La función buscaba la marca de banda terminal en `pricing_context->'palm_groups'` con
-- la clave `is_terminal_open_range` (snake_case), pero lo que el motor guarda de verdad en
-- `bookings.pricing_context` (buildAuthoritativeBookingQuote → booking-authority) es
-- `pricing_context.quote_snapshot.metadata.pricingContext.palmGroups[].isTerminalOpenRange`
-- — otra ruta, cuatro niveles más adentro, y camelCase. `elem->>'is_terminal_open_range'`
-- devolvía NULL siempre, así que `v_has_terminal_open_range` era siempre falso: el cambio
-- de precio de palmeras era imposible incluso para bandas legítimamente terminales,
-- rechazado con un mensaje que además afirmaba lo contrario de lo cierto.
--
-- Solo se toca la ruta/clave de lectura dentro del bloque `IF v_is_palm_service THEN`; el
-- resto de la función (idempotencia, autorización, expiración, notificación por chat) se
-- deja intacto tal y como quedó en 20260803121000_fix_price_change_security_definer.sql.
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
SET search_path TO 'public'
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
      FROM jsonb_array_elements(
        COALESCE(
          v_booking.pricing_context #> '{quote_snapshot,metadata,pricingContext,palmGroups}',
          '[]'::jsonb
        )
      ) elem
      WHERE COALESCE((elem->>'isTerminalOpenRange')::boolean, false) = true
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
