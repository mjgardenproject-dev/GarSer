-- Chat: mensajes automáticos del sistema (server-side, no falsificables).
--
-- Añade soporte de "mensajes de sistema" a chat_messages y un trigger sobre bookings
-- que inserta automáticamente mensajes con plantillas y NOMBRES REALES tras:
--   · crear una reserva (solicitud)
--   · aceptar / cancelar / rechazar la reserva
--   · proponer / aceptar / rechazar un cambio de precio
--
-- Se dispara desde CUALQUIER ruta (cliente, jardinero o webhook de pago), por lo que no
-- depende del código de la UI y no puede spoofearse desde el cliente.

------------------------------------------------------------------------------
-- 1) Columna message_type + sender_id nullable (los mensajes de sistema no tienen autor)
------------------------------------------------------------------------------
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'user';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_message_type_check'
  ) THEN
    ALTER TABLE public.chat_messages
      ADD CONSTRAINT chat_messages_message_type_check
      CHECK (message_type IN ('user', 'system'));
  END IF;
END$$;

ALTER TABLE public.chat_messages ALTER COLUMN sender_id DROP NOT NULL;

------------------------------------------------------------------------------
-- 2) Helper: nombre visible de un usuario (perfil) con fallback
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_display_name(p_user_id uuid, p_fallback text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(TRIM(pr.full_name), ''), p_fallback)
  FROM public.profiles pr
  WHERE pr.id = p_user_id
  LIMIT 1;
$$;

------------------------------------------------------------------------------
-- 3) Insertar un mensaje de sistema en el hilo de una reserva
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_booking_system_message(p_booking_id uuid, p_text text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_text IS NULL OR TRIM(p_text) = '' THEN
    RETURN;
  END IF;
  INSERT INTO public.chat_messages (booking_id, sender_id, message, message_type, created_at)
  VALUES (p_booking_id, NULL, p_text, 'system', now());
END;
$$;

------------------------------------------------------------------------------
-- 4) Trigger de eventos de reserva → mensaje de sistema
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_booking_chat_system_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gardener text;
  v_service  text;
  v_when     text;
  v_price    text;
  v_proposed text;
BEGIN
  v_gardener := public.chat_display_name(NEW.gardener_id, 'El profesional');
  SELECT COALESCE(s.name, 'el servicio') INTO v_service FROM public.services s WHERE s.id = NEW.service_id;
  v_when  := to_char(NEW.date, 'DD/MM/YYYY') || COALESCE(' a las ' || to_char(NEW.start_time, 'HH24:MI'), '');
  v_price := to_char(COALESCE(NEW.total_price, 0), 'FM999999990.00') || ' €';

  -- Alta de reserva (solicitud). Solo para reservas reales, no estados intermedios.
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('pending', 'confirmed') THEN
      PERFORM public.post_booking_system_message(
        NEW.id,
        'Reserva solicitada: ' || v_service || ' para el ' || v_when ||
        '. Precio estimado: ' || v_price || '. A la espera de que el profesional la confirme.'
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
    ELSIF NEW.status IN ('cancelled', 'rejected') THEN
      PERFORM public.post_booking_system_message(
        NEW.id, 'La reserva de ' || v_service || ' ha sido cancelada.'
      );
    END IF;
  END IF;

  -- Cambios de precio del servicio
  IF NEW.price_change_status IS DISTINCT FROM OLD.price_change_status THEN
    IF NEW.price_change_status = 'pending_client_acceptance' THEN
      v_proposed := to_char(COALESCE(NEW.proposed_total_price, 0), 'FM999999990.00') || ' €';
      PERFORM public.post_booking_system_message(
        NEW.id,
        v_gardener || ' propone un nuevo precio: ' || v_proposed ||
        COALESCE('. Motivo: ' || NULLIF(TRIM(NEW.proposed_price_reason), ''), '') ||
        '. Puedes aceptarlo o rechazarlo desde el chat.'
      );
    ELSIF NEW.price_change_status = 'accepted' THEN
      PERFORM public.post_booking_system_message(
        NEW.id, 'Nuevo precio aceptado: ' || v_price || '.'
      );
    ELSIF NEW.price_change_status = 'rejected' THEN
      PERFORM public.post_booking_system_message(
        NEW.id, 'La propuesta de nuevo precio ha sido rechazada. Se mantiene ' || v_price || '.'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_chat_system_message ON public.bookings;
CREATE TRIGGER trg_bookings_chat_system_message
AFTER INSERT OR UPDATE ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.trg_booking_chat_system_message();
