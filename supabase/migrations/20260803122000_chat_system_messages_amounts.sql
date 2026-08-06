-- Mensajes de sistema del chat: vocabulario e importes coherentes con el resto de la web.
--
-- Dos problemas que arreglaba a medias:
--   1. Decia "Precio estimado: 158.00 €" usando to_char con punto decimal, un TERCER formato de
--      euro distinto al de la web (158,00 €) y al de los emails, sobre el mismo importe.
--   2. Llamaba "precio" a secas al precio del servicio. El chat lo leen CLIENTE y JARDINERO a la
--      vez, asi que no admite un desglose por rol: la unica salida honesta es nombrar el
--      concepto exacto ("precio del servicio"), que es correcto para ambos —el jardinero cobra
--      ese importe, el cliente se lo paga a el— y dejar fuera el total y la comision, que son
--      asimetricos y solo tienen sentido en las superficies propias de cada uno.

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
        '. Los gastos de gestión ya abonados no cambian. Puedes aceptarlo o rechazarlo desde el chat.'
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
$$;
