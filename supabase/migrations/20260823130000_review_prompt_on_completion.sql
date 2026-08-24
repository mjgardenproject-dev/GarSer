-- Fase 2 del plan de reseñas: pedir la valoración cuando el servicio termina.
--
-- PROBLEMA: el cliente no recibia ningun aviso para valorar, asi que sencillamente no valoraba.
-- El trigger de mensajes de sistema cubria `confirmed`, `cancelled`/`rejected` y los cambios de
-- precio, pero NO `completed`: el momento exacto en que tiene sentido pedir la reseña pasaba en
-- silencio.
--
-- Se resuelve en el TRIGGER y no en la edge function de completar a proposito: una reserva llega
-- a `completed` por DOS caminos —el jardinero la cierra, o el sistema la autofinaliza a las 24 h
-- (paso 8C, `auto_complete_due_bookings`, que es puro SQL)—. Enganchado al trigger, el aviso
-- cubre los dos; enganchado a la edge function, se perderia justo en el caso automatico, que es
-- el mas frecuente cuando el jardinero no entra a cerrarla.
--
-- El mensaje entra por `post_booking_system_message`, asi que hereda gratis el tiempo real y el
-- contador de no leidos del chat: no hace falta construir ningun sistema de notificaciones.

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

-- ---------------------------------------------------------------------------
-- Aviso de que el jardinero ha respondido a una reseña.
-- ---------------------------------------------------------------------------
-- La respuesta se escribe con `respond_to_review`, y sin esto el cliente no se enteraria nunca
-- de que le han contestado. Se publica en el chat de la reserva reseñada, que es donde ya vive
-- la conversación de ese servicio.
CREATE OR REPLACE FUNCTION public.trg_review_response_chat_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gardener text;
BEGIN
  -- Solo cuando aparece o cambia una respuesta con contenido.
  IF NEW.gardener_response IS NULL
     OR NEW.gardener_response IS NOT DISTINCT FROM OLD.gardener_response
     OR NEW.booking_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_gardener := public.chat_display_name(NEW.gardener_id, 'El profesional');
  PERFORM public.post_booking_system_message(
    NEW.booking_id,
    v_gardener || ' ha respondido a tu valoración.'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reviews_response_chat_message ON public.reviews;
CREATE TRIGGER trg_reviews_response_chat_message
  AFTER UPDATE OF gardener_response ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_review_response_chat_message();

-- ---------------------------------------------------------------------------
-- BUG PREEXISTENTE encontrado al probar esta fase: los mensajes de sistema que
-- nombran al profesional NUNCA se han publicado.
-- ---------------------------------------------------------------------------
-- `chat_display_name` buscaba el perfil por `profiles.id`, pero el id que recibe es el del
-- usuario de auth, que vive en `profiles.user_id`. Son columnas DISTINTAS (mismo fallo que tenia
-- el Monitor de Roles). La consulta no devolvia ninguna fila, asi que la funcion devolvia NULL
-- -ni siquiera el fallback, porque sin fila no hay COALESCE que aplicar-.
--
-- Y en SQL, concatenar con NULL da NULL: el mensaje entero se volvia NULL y
-- `post_booking_system_message` lo descartaba en su guarda de texto vacio, sin error ni rastro.
--
-- Mensajes que estaban perdiendose por esto:
--   · "X ha aceptado la reserva. ¡Todo listo para el ...!"
--   · "X propone un nuevo precio del servicio: ..." -el aviso de un cambio de DINERO-
--   · y el de servicio finalizado que anade esta fase.
--
-- Los que no nombran al profesional (solicitud, cancelacion, precio aceptado/rechazado) si
-- funcionaban, que es justo lo que hacia el fallo tan dificil de ver: el chat "funcionaba".
CREATE OR REPLACE FUNCTION public.chat_display_name(p_user_id uuid, p_fallback text)
RETURNS text
LANGUAGE sql
STABLE
AS $function$
  -- COALESCE por fuera del SELECT: garantiza el fallback tambien cuando NO hay fila, que era
  -- exactamente el caso que devolvia NULL.
  SELECT COALESCE(
    (
      SELECT NULLIF(TRIM(pr.full_name), '')
      FROM public.profiles pr
      WHERE pr.user_id = p_user_id
      LIMIT 1
    ),
    p_fallback
  );
$function$;
