-- Avisos al administrador: todo lo que espera su revisión (2026-11-04).
--
-- Hasta ahora el admin se enteraba de una solicitud, un carnet o una incidencia si entraba al panel
-- por su cuenta, y el aviso «en menos de 24 h» que se le promete a quien solicita el alta dependía de
-- que se acordara de mirar. Ahora cada novedad que necesita su revisión apunta UN aviso en la cola del
-- servidor (`notification_outbox`, la misma que ya usan los correos de reservas y carnets):
--
--   · solicitud de alta de jardinero      (gardener_applications  → status 'submitted')
--   · solicitud de alta de empresa        (company_applications   → status 'submitted')
--   · carnet fitosanitario pendiente      (gardener_licenses      → status 'pending'; también el de
--                                           un empleado subido por su empresa)
--   · incidencia de una reserva           (booking_incidents      → INSERT)
--
-- `notification-dispatch` lo reclama y pide a `send-email-notification` el correo `admin_review_needed`,
-- que lo manda a TODOS los administradores y, además, como notificación al móvil a los dispositivos en
-- los que lo hayan activado («Mi cuenta» → Notificaciones). El destinatario sale siempre de la base de
-- datos (profiles.role = 'admin'), nunca de quien pide el correo.
--
-- Garantías:
--   · se apunta en la MISMA transacción que la novedad (si la acción se deshace, el aviso también);
--   · una sola vez por novedad (dedupe_key); una solicitud que se reenvía tras corregirla es otra novedad
--     (la clave lleva la fecha de envío);
--   · el estado se vuelve a comprobar al enviar: si ya está resuelto no se avisa de algo que no existe;
--   · un fallo al apuntar el aviso NUNCA tumba la acción del usuario (EXCEPTION WHEN OTHERS).
--
-- Además, `admin_pending_review_counts()` da al menú del panel los contadores de lo pendiente.
--
-- Aditiva: no toca ninguna tabla existente ni el comportamiento de los avisos actuales.

-- =============================================
-- 1) Apuntar el aviso
-- =============================================
CREATE OR REPLACE FUNCTION private.enqueue_admin_review(p_kind text, p_item_id uuid, p_stamp timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM private.enqueue_notification(
    'admin_review_needed',
    'admin_review:' || p_kind || ':' || p_item_id::text || ':' || private.notification_stamp(p_stamp),
    NULL,
    jsonb_build_object('kind', p_kind, 'itemId', p_item_id)
  );
EXCEPTION WHEN OTHERS THEN
  -- Un aviso que no se puede apuntar no puede impedir que la persona envíe su solicitud.
  RAISE WARNING 'admin_review_needed no se pudo apuntar (%): %', p_kind, SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION private.enqueue_admin_review(text, uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- =============================================
-- 2) Solicitudes de alta (jardinero y empresa)
-- =============================================
CREATE OR REPLACE FUNCTION private.gardener_applications_admin_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM private.enqueue_admin_review('gardener_application', NEW.id, COALESCE(NEW.submitted_at, NEW.updated_at, now()));
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.gardener_applications_admin_notice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_gardener_applications_admin_notice_ins ON public.gardener_applications;
CREATE TRIGGER trg_gardener_applications_admin_notice_ins
  AFTER INSERT ON public.gardener_applications
  FOR EACH ROW
  WHEN (NEW.status = 'submitted')
  EXECUTE FUNCTION private.gardener_applications_admin_notice();

DROP TRIGGER IF EXISTS trg_gardener_applications_admin_notice_upd ON public.gardener_applications;
CREATE TRIGGER trg_gardener_applications_admin_notice_upd
  AFTER UPDATE OF status ON public.gardener_applications
  FOR EACH ROW
  WHEN (NEW.status = 'submitted' AND OLD.status IS DISTINCT FROM 'submitted')
  EXECUTE FUNCTION private.gardener_applications_admin_notice();

CREATE OR REPLACE FUNCTION private.company_applications_admin_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM private.enqueue_admin_review('company_application', NEW.id, COALESCE(NEW.submitted_at, NEW.updated_at, now()));
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.company_applications_admin_notice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_company_applications_admin_notice_ins ON public.company_applications;
CREATE TRIGGER trg_company_applications_admin_notice_ins
  AFTER INSERT ON public.company_applications
  FOR EACH ROW
  WHEN (NEW.status = 'submitted')
  EXECUTE FUNCTION private.company_applications_admin_notice();

DROP TRIGGER IF EXISTS trg_company_applications_admin_notice_upd ON public.company_applications;
CREATE TRIGGER trg_company_applications_admin_notice_upd
  AFTER UPDATE OF status ON public.company_applications
  FOR EACH ROW
  WHEN (NEW.status = 'submitted' AND OLD.status IS DISTINCT FROM 'submitted')
  EXECUTE FUNCTION private.company_applications_admin_notice();

-- =============================================
-- 3) Carnets fitosanitarios pendientes
-- =============================================
CREATE OR REPLACE FUNCTION private.gardener_licenses_admin_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM private.enqueue_admin_review('phyto_license', NEW.id, COALESCE(NEW.created_at, now()));
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.gardener_licenses_admin_notice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_gardener_licenses_admin_notice ON public.gardener_licenses;
CREATE TRIGGER trg_gardener_licenses_admin_notice
  AFTER INSERT ON public.gardener_licenses
  FOR EACH ROW
  WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION private.gardener_licenses_admin_notice();

-- =============================================
-- 4) Incidencias
-- =============================================
CREATE OR REPLACE FUNCTION private.booking_incidents_admin_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM private.enqueue_admin_review('incident', NEW.id, COALESCE(NEW.created_at, now()));
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.booking_incidents_admin_notice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_booking_incidents_admin_notice ON public.booking_incidents;
CREATE TRIGGER trg_booking_incidents_admin_notice
  AFTER INSERT ON public.booking_incidents
  FOR EACH ROW
  WHEN (NEW.status = 'open')
  EXECUTE FUNCTION private.booking_incidents_admin_notice();

-- =============================================
-- 5) Contadores para el menú del panel
-- =============================================
CREATE OR REPLACE FUNCTION public.admin_pending_review_counts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede ver lo pendiente de revisión.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'gardenerApplications', (SELECT count(*) FROM public.gardener_applications WHERE status = 'submitted'),
    'companyApplications', (SELECT count(*) FROM public.company_applications WHERE status = 'submitted'),
    'licenses', (SELECT count(*) FROM public.gardener_licenses WHERE status = 'pending'),
    'incidents', (SELECT count(*) FROM public.booking_incidents WHERE status IN ('open', 'in_review'))
  );
END;
$$;
COMMENT ON FUNCTION public.admin_pending_review_counts() IS
  'Cuántas solicitudes de alta, carnets e incidencias esperan la revisión del administrador. Solo administradores.';
REVOKE ALL ON FUNCTION public.admin_pending_review_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pending_review_counts() TO authenticated, service_role;
