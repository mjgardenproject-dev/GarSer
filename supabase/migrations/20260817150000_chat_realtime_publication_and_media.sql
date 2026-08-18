-- Chat en tiempo real: publicar las tablas que el cliente ya escuchaba.
--
-- Causa raíz de que el chat no funcionara "en vivo": la UI se suscribe por Realtime a
-- chat_messages (mensajes nuevos) y a bookings (propuestas de precio, cambios de estado),
-- pero NINGUNA de las dos tablas estaba en la publication supabase_realtime — solo
-- chat_thread_reads (20260711090000). El servidor nunca emitía los eventos y cada
-- participante solo veía los mensajes del otro al cerrar y reabrir el chat.
--
-- Además, la subida de adjuntos del chat estaba rota: chatService sube a
-- booking-photos/chat/{booking_id}/{user_id}/..., pero la única policy de INSERT del
-- bucket (booking_photos_insert_auth) exige el prefijo drafts/{uid}/, así que todo
-- envío de imagen fallaba por RLS.

------------------------------------------------------------------------------
-- 1) Realtime: chat_messages y bookings entran en la publication.
--    La entrega sigue filtrada por la RLS de cada tabla (solo participantes).
------------------------------------------------------------------------------
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

------------------------------------------------------------------------------
-- 2) Storage: los participantes de la reserva pueden subir adjuntos del chat
--    bajo chat/{booking_id}/{su_uid}/... en booking-photos.
------------------------------------------------------------------------------
DROP POLICY IF EXISTS "chat_media_insert_participants" ON storage.objects;
CREATE POLICY "chat_media_insert_participants"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'booking-photos'
    AND (storage.foldername(name))[1] = 'chat'
    AND (storage.foldername(name))[3] = (auth.uid())::text
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id::text = (storage.foldername(name))[2]
        AND (b.client_id = auth.uid() OR b.gardener_id = auth.uid())
    )
  );

------------------------------------------------------------------------------
-- 3) Mensaje de sistema al completarse el servicio (hueco del trigger: cubría
--    solicitud, aceptación, cancelación y cambios de precio, pero no el cierre).
--    Misma función que 20260803122000 + la rama 'completed'.
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
      PERFORM public.post_booking_system_message(
        NEW.id,
        'Servicio completado: ' || v_service || '. Gracias por usar GarSer. El cliente ya puede dejar una reseña.'
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
