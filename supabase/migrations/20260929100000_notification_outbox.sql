-- Prueba real (2026-09-28) · F3: los avisos los envía el servidor (R-06 c, R-11, D24) y la
-- reserva ya no se puede cambiar de estado a mano desde el navegador (R-16).
--
-- R-06 c: 16 correos los pedía el NAVEGADOR después de la acción. Si la pestaña se cerraba, se
-- caía la red o la sesión estaba revocada (lo que pasó en producción el 2026-09-28: la propuesta
-- se guardó y `send-email-notification` respondió 403), la acción quedaba hecha y el correo no
-- salía nunca. Ahora la acción deja el aviso en `notification_outbox` EN LA MISMA TRANSACCIÓN, y
-- `notification-dispatch` lo envía con reintentos. La llamada HTTP es solo el timbre: si se
-- pierde, el reloj de cada minuto recoge lo atrasado.
--
-- Quién apunta cada aviso (los mismos correos que antes, salvo R-11):
--   · triggers sobre cambios de estado inequívocos (propuestas de precio y de fecha y sus
--     respuestas, incidencias, solicitudes de alta): valen para cualquier camino;
--   · respond_booking_request (aceptar / rechazar): una envoltura con el mismo nombre, porque un
--     rechazo (pending → cancelled) no se distingue en la fila de otras cancelaciones.
-- `dedupe_key` (única) impide duplicados si la misma transición se repite.
--
-- R-16: la regla «Participants can update bookings» + GRANT UPDATE (status) dejaban a cualquiera
-- de las dos partes cambiar el estado de su reserva por PostgREST (comprobado en local: el
-- jardinero pasaba su reserva de pending a confirmed y a completed sin la aceptación del
-- cliente ni el cobro de los gastos de gestión). Todas las transiciones legítimas van por RPC
-- SECURITY DEFINER o por funciones del servidor; la única escritura directa del front
-- (GardenerDashboard) era un camino muerto.

-- =============================================
-- 0) R-16: sin cambios de estado directos
-- =============================================
DROP POLICY IF EXISTS "Participants can update bookings" ON public.bookings;
REVOKE UPDATE (status) ON public.bookings FROM authenticated;
REVOKE UPDATE, DELETE ON public.bookings FROM authenticated;

-- =============================================
-- 1) La cola
-- =============================================
CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  booking_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

COMMENT ON TABLE public.notification_outbox IS
  'Avisos (correo y, desde F7, móvil) apuntados por el servidor en la misma transacción que la '
  'acción. Los envía notification-dispatch con reintentos. Solo la tocan funciones del servidor.';

CREATE INDEX IF NOT EXISTS notification_outbox_due_idx
  ON public.notification_outbox (next_attempt_at)
  WHERE status IN ('pending', 'sending');

ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_outbox TO service_role;

-- =============================================
-- 2) Apuntar un aviso
-- =============================================
CREATE OR REPLACE FUNCTION private.enqueue_notification(
  p_type text,
  p_dedupe_key text,
  p_booking_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.notification_outbox (type, booking_id, payload, dedupe_key)
  VALUES (p_type, p_booking_id, COALESCE(p_payload, '{}'::jsonb), p_dedupe_key)
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION private.enqueue_notification(text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- Marca de tiempo estable para las claves de deduplicación.
CREATE OR REPLACE FUNCTION private.notification_stamp(p_at timestamptz)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT COALESCE(floor(extract(epoch FROM p_at) * 1000)::bigint::text, '0') $$;

-- =============================================
-- 3) El timbre: pg_net llama a notification-dispatch
-- =============================================
-- URL: `notification_dispatch_url` en Vault (o `app.notification_dispatch_url`); si no está, se
-- deduce de la del reloj (`lifecycle_tick_url`, misma base). Secreto: el del reloj
-- (`lifecycle_tick_secret`): quien lo tenga solo puede hacer que se envíe lo que ya estaba en la
-- cola. Sin configurar (entorno local sin Vault), no llama a nada y la cola espera.
CREATE OR REPLACE FUNCTION private.notification_dispatch_url()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text := public.lifecycle_tick_setting('notification_dispatch_url');
  v_tick text;
BEGIN
  IF v_url IS NOT NULL THEN
    RETURN v_url;
  END IF;
  v_tick := public.lifecycle_tick_setting('lifecycle_tick_url');
  IF v_tick IS NULL OR position('booking-lifecycle-tick' IN v_tick) = 0 THEN
    RETURN NULL;
  END IF;
  RETURN replace(v_tick, 'booking-lifecycle-tick', 'notification-dispatch');
END;
$$;
REVOKE ALL ON FUNCTION private.notification_dispatch_url() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.ring_notification_dispatch()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url text := private.notification_dispatch_url();
  v_secret text := public.lifecycle_tick_setting('lifecycle_tick_secret');
  v_request bigint;
BEGIN
  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN NULL;
  END IF;
  -- Asíncrono: la petición se encola en net.http_request_queue dentro de ESTA transacción, así
  -- que si la acción se deshace, el timbre tampoco suena.
  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-lifecycle-secret', v_secret),
    body := jsonb_build_object('source', 'outbox'),
    timeout_milliseconds := 20000
  ) INTO v_request;
  RETURN v_request;
EXCEPTION WHEN OTHERS THEN
  -- El timbre nunca puede tumbar la acción: el reloj de cada minuto recoge lo que quede.
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.ring_notification_dispatch() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.notification_outbox_ring()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM private.ring_notification_dispatch();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_notification_outbox_ring ON public.notification_outbox;
CREATE TRIGGER trg_notification_outbox_ring
  AFTER INSERT ON public.notification_outbox
  FOR EACH STATEMENT
  EXECUTE FUNCTION private.notification_outbox_ring();

-- El reloj: cada minuto, solo si hay algo que enviar (no despierta la función en vano).
CREATE OR REPLACE FUNCTION private.dispatch_due_notifications()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.notification_outbox
    WHERE (status = 'pending' AND next_attempt_at <= now())
       OR (status = 'sending' AND locked_until < now())
  ) THEN
    RETURN private.ring_notification_dispatch();
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.dispatch_due_notifications() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('notification-outbox-dispatch');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;
SELECT cron.schedule('notification-outbox-dispatch', '* * * * *', 'SELECT private.dispatch_due_notifications();');

-- =============================================
-- 4) Reclamar y cerrar avisos (solo notification-dispatch, con la clave de servicio)
-- =============================================
CREATE OR REPLACE FUNCTION public.claim_notification_outbox(p_limit integer DEFAULT 25)
RETURNS TABLE (id uuid, type text, booking_id uuid, payload jsonb, attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT o.id
    FROM public.notification_outbox o
    WHERE (o.status = 'pending' AND o.next_attempt_at <= now())
       OR (o.status = 'sending' AND o.locked_until < now())   -- una pasada que murió a medias
    ORDER BY o.created_at
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 100))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_outbox o
  SET status = 'sending',
      attempts = o.attempts + 1,
      locked_until = now() + interval '5 minutes'
  FROM due
  WHERE o.id = due.id
  RETURNING o.id, o.type, o.booking_id, o.payload, o.attempts;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_notification_outbox(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_outbox(integer) TO service_role;

-- Reintentos: 1, 5, 15 y 60 minutos; al quinto intento fallido, `failed` (lo ve el admin).
-- `p_permanent`: el envío no tiene arreglo (4xx: la reserva ya no existe, el estado cambió…).
CREATE OR REPLACE FUNCTION public.complete_notification_outbox(
  p_id uuid,
  p_ok boolean,
  p_error text DEFAULT NULL,
  p_permanent boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.notification_outbox%ROWTYPE;
  v_status text;
BEGIN
  SELECT * INTO v_row FROM public.notification_outbox WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF p_ok THEN
    v_status := 'sent';
    UPDATE public.notification_outbox
    SET status = 'sent', sent_at = now(), locked_until = NULL, last_error = NULL
    WHERE id = p_id;
  ELSIF p_permanent OR v_row.attempts >= 5 THEN
    v_status := 'failed';
    UPDATE public.notification_outbox
    SET status = 'failed', locked_until = NULL, last_error = left(COALESCE(p_error, 'error'), 500)
    WHERE id = p_id;
  ELSE
    v_status := 'pending';
    UPDATE public.notification_outbox
    SET status = 'pending',
        locked_until = NULL,
        last_error = left(COALESCE(p_error, 'error'), 500),
        next_attempt_at = now() + CASE v_row.attempts
          WHEN 1 THEN interval '1 minute'
          WHEN 2 THEN interval '5 minutes'
          WHEN 3 THEN interval '15 minutes'
          ELSE interval '60 minutes'
        END
    WHERE id = p_id;
  END IF;
  RETURN v_status;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_notification_outbox(uuid, boolean, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_notification_outbox(uuid, boolean, text, boolean) TO service_role;

-- =============================================
-- 5) Quién apunta: triggers sobre transiciones inequívocas
-- =============================================
-- Propuestas de precio o duración y su desenlace (R-11: la caducidad, que no avisaba a nadie).
-- Propuestas de otra fecha y su respuesta.
CREATE OR REPLACE FUNCTION private.bookings_enqueue_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proposal text := private.notification_stamp(NEW.proposed_price_at);
BEGIN
  IF NEW.price_change_status IS DISTINCT FROM OLD.price_change_status THEN
    IF NEW.price_change_status = 'pending_client_acceptance' THEN
      PERFORM private.enqueue_notification('booking_price_change_proposed',
        format('booking_price_change_proposed:%s:%s', NEW.id, v_proposal), NEW.id,
        jsonb_build_object('bookingId', NEW.id));
    ELSIF OLD.price_change_status = 'pending_client_acceptance'
          AND NEW.price_change_status IN ('accepted', 'rejected', 'expired') THEN
      PERFORM private.enqueue_notification('booking_price_change_' || NEW.price_change_status,
        format('booking_price_change_%s:%s:%s', NEW.price_change_status, NEW.id, v_proposal), NEW.id,
        jsonb_build_object('bookingId', NEW.id));
    END IF;
  END IF;

  IF NEW.reschedule_status IS DISTINCT FROM OLD.reschedule_status THEN
    IF NEW.reschedule_status = 'pending_client' THEN
      PERFORM private.enqueue_notification('booking_reschedule_proposed',
        format('booking_reschedule_proposed:%s:%s', NEW.id, private.notification_stamp(NEW.reschedule_proposed_at)), NEW.id,
        jsonb_build_object('bookingId', NEW.id));
    ELSIF OLD.reschedule_status = 'pending_client' AND NEW.reschedule_status IN ('accepted', 'rejected') THEN
      PERFORM private.enqueue_notification('booking_reschedule_answered',
        format('booking_reschedule_answered:%s:%s', NEW.id, private.notification_stamp(NEW.reschedule_proposed_at)), NEW.id,
        jsonb_build_object('bookingId', NEW.id));
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_enqueue_notifications ON public.bookings;
-- Sin «OF columna»: la caducidad perezosa la pone un trigger BEFORE en otra actualización, y un
-- trigger de columna no ve los cambios que hacen los BEFORE. El WHEN compara la fila final.
CREATE TRIGGER trg_bookings_enqueue_notifications
  AFTER UPDATE ON public.bookings
  FOR EACH ROW
  WHEN (NEW.price_change_status IS DISTINCT FROM OLD.price_change_status
        OR NEW.reschedule_status IS DISTINCT FROM OLD.reschedule_status)
  EXECUTE FUNCTION private.bookings_enqueue_notifications();

-- Incidencias: solo las abre report_booking_incident (el cliente).
CREATE OR REPLACE FUNCTION private.booking_incidents_enqueue_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM private.enqueue_notification('booking_incident_received',
    format('booking_incident_received:%s', NEW.id), NEW.booking_id,
    jsonb_build_object('bookingId', NEW.booking_id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_booking_incidents_enqueue_notification ON public.booking_incidents;
CREATE TRIGGER trg_booking_incidents_enqueue_notification
  AFTER INSERT ON public.booking_incidents
  FOR EACH ROW
  EXECUTE FUNCTION private.booking_incidents_enqueue_notification();

-- Solicitudes de alta revisadas por el admin (solo por su RPC: A-24).
CREATE OR REPLACE FUNCTION private.gardener_applications_enqueue_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM private.enqueue_notification('gardener_' || NEW.status,
    format('gardener_%s:%s:%s', NEW.status, NEW.id, private.notification_stamp(COALESCE(NEW.reviewed_at, NEW.updated_at))), NULL,
    jsonb_build_object(
      'user_id', NEW.user_id,
      'data', jsonb_strip_nulls(jsonb_build_object('name', COALESCE(NULLIF(btrim(COALESCE(NEW.full_name, '')), ''), 'Jardinero'), 'reason', NULLIF(btrim(COALESCE(NEW.review_comment, '')), '')))
    ));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_gardener_applications_enqueue_notification ON public.gardener_applications;
CREATE TRIGGER trg_gardener_applications_enqueue_notification
  AFTER UPDATE OF status ON public.gardener_applications
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('approved', 'rejected'))
  EXECUTE FUNCTION private.gardener_applications_enqueue_notification();

CREATE OR REPLACE FUNCTION private.company_applications_enqueue_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM private.enqueue_notification('company_' || NEW.status,
    format('company_%s:%s:%s', NEW.status, NEW.id, private.notification_stamp(COALESCE(NEW.reviewed_at, NEW.updated_at))), NULL,
    jsonb_build_object('companyApplicationId', NEW.id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_company_applications_enqueue_notification ON public.company_applications;
CREATE TRIGGER trg_company_applications_enqueue_notification
  AFTER UPDATE OF status ON public.company_applications
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('approved', 'rejected'))
  EXECUTE FUNCTION private.company_applications_enqueue_notification();

-- =============================================
-- 6) Aceptar / rechazar una solicitud: envoltura con el mismo nombre
-- =============================================
-- La función de siempre pasa a `private` SIN CAMBIOS (misma lógica, misma idempotencia) y la
-- pública la llama y apunta el aviso según lo que devuelve. Solo cuando de verdad ha respondido:
-- «La reserva ya no está pendiente» (lleva `message`) no avisa.
DO $$
BEGIN
  IF to_regprocedure('private.respond_booking_request_core(uuid, text, uuid)') IS NULL THEN
    ALTER FUNCTION public.respond_booking_request(uuid, text, uuid) RENAME TO respond_booking_request_core;
    ALTER FUNCTION public.respond_booking_request_core(uuid, text, uuid) SET SCHEMA private;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.respond_booking_request_core(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.respond_booking_request(p_booking_id uuid, p_response text, p_operation_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := private.respond_booking_request_core(p_booking_id, p_response, p_operation_id);
  IF v_result IS NOT NULL AND NOT (v_result ? 'message') THEN
    IF v_result->>'status' = 'confirmed' THEN
      PERFORM private.enqueue_notification('booking_accepted', format('booking_accepted:%s', p_booking_id),
        p_booking_id, jsonb_build_object('bookingId', p_booking_id));
    ELSIF v_result->>'status' = 'cancelled' THEN
      PERFORM private.enqueue_notification('booking_rejected', format('booking_rejected:%s', p_booking_id),
        p_booking_id, jsonb_build_object('bookingId', p_booking_id));
    END IF;
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.respond_booking_request(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_booking_request(uuid, text, uuid) TO authenticated, service_role;
