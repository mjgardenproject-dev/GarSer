-- QA-192: al abrir el cliente una incidencia, avisar también al PROFESIONAL.
--
-- Antes solo salía `booking_incident_received` (al cliente) y el aviso al admin; el profesional no
-- se enteraba hasta abrir «Reservas», y su versión es lo que el admin necesita para decidir. El
-- aviso nuevo `booking_incident_opened` lo redacta send-email-notification (correo + push) y le
-- lleva a contar su versión. Mismo patrón de cola que el resto (dedupe por incidencia).

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
  -- Solo si la abre el cliente: es el profesional quien tiene que responder.
  IF NEW.reporter_role = 'client' THEN
    PERFORM private.enqueue_notification('booking_incident_opened',
      format('booking_incident_opened:%s', NEW.id), NEW.booking_id,
      jsonb_build_object('bookingId', NEW.booking_id, 'incidentId', NEW.id));
  END IF;
  RETURN NULL;
END;
$$;
