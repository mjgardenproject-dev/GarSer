-- Enforce hard guarantees for price-change workflow.

CREATE OR REPLACE FUNCTION public.prevent_confirm_when_price_change_pending()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'confirmed' AND COALESCE(NEW.price_change_status, 'none') = 'pending_client_acceptance' THEN
    RAISE EXCEPTION 'No se puede confirmar la reserva mientras exista un cambio de precio pendiente de aceptación del cliente.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_confirm_when_price_change_pending ON public.bookings;
CREATE TRIGGER trg_prevent_confirm_when_price_change_pending
BEFORE INSERT OR UPDATE ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.prevent_confirm_when_price_change_pending();

CREATE OR REPLACE FUNCTION public.propose_booking_price_change(
  p_booking_id uuid,
  p_proposed_total_price numeric,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_reason text;
BEGIN
  IF p_proposed_total_price IS NULL OR p_proposed_total_price <= 0 THEN
    RAISE EXCEPTION 'El nuevo precio debe ser mayor que 0.';
  END IF;

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

  v_reason := NULLIF(BTRIM(COALESCE(p_reason, '')), '');

  UPDATE public.bookings
  SET price_change_status = 'pending_client_acceptance',
      proposed_total_price = p_proposed_total_price,
      proposed_price_reason = v_reason,
      proposed_price_by = auth.uid(),
      proposed_price_at = now(),
      updated_at = now()
  WHERE id = p_booking_id;

  INSERT INTO public.chat_messages (booking_id, sender_id, message)
  VALUES (
    p_booking_id,
    auth.uid(),
    CASE
      WHEN v_reason IS NULL THEN format('Propuesta de nuevo precio: €%s.', to_char(p_proposed_total_price, 'FM999999990.00'))
      ELSE format('Propuesta de nuevo precio: €%s. Motivo: %s', to_char(p_proposed_total_price, 'FM999999990.00'), v_reason)
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_booking_price_change(
  p_booking_id uuid,
  p_accept boolean
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_proposed numeric;
BEGIN
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
    UPDATE public.bookings
    SET total_price = v_proposed,
        price_change_status = 'accepted',
        updated_at = now()
    WHERE id = p_booking_id;

    INSERT INTO public.chat_messages (booking_id, sender_id, message)
    VALUES (
      p_booking_id,
      auth.uid(),
      format('Cliente acepta el nuevo precio: €%s.', to_char(v_proposed, 'FM999999990.00'))
    );
  ELSE
    UPDATE public.bookings
    SET price_change_status = 'rejected',
        updated_at = now()
    WHERE id = p_booking_id;

    INSERT INTO public.chat_messages (booking_id, sender_id, message)
    VALUES (
      p_booking_id,
      auth.uid(),
      'Cliente rechaza la propuesta de nuevo precio.'
    );
  END IF;
END;
$$;
