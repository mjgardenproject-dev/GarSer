-- Migration: cron del ciclo de vida (paso 8C-C)
--
-- El problema de fondo que resuelve: hasta ahora la caducidad de solicitudes solo corría
-- cuando un jardinero abría su panel (`BookingRequestsManager` → `expire_stale_booking_requests`,
-- que además filtraba `gardener_id = auth.uid()`, de modo que cada uno caducaba solo las suyas).
-- Si el jardinero no entraba, la solicitud del cliente seguía viva indefinidamente con el
-- dinero autorizado y el hueco de agenda bloqueado.
--
-- A partir de aquí el ciclo lo mueve el RELOJ, no el comportamiento del usuario.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Punto único e idempotente: caduca solicitudes vencidas y cierra las reservas cuyo servicio
-- terminó hace más de 24 h sin que nadie las marcase.
CREATE OR REPLACE FUNCTION public.run_booking_lifecycle_maintenance()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired integer := 0;
  v_completed integer := 0;
BEGIN
  v_expired := public.expire_due_booking_requests();
  v_completed := public.auto_complete_due_bookings();
  RETURN jsonb_build_object(
    'expired_requests', v_expired,
    'auto_completed_bookings', v_completed,
    'ran_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_booking_lifecycle_maintenance() FROM PUBLIC;

-- Cada 15 minutos. Suficientemente fino para que una solicitud no se pase de su hora de
-- inicio, y suficientemente espaciado para no castigar la base de datos.
DO $$
BEGIN
  PERFORM cron.unschedule('booking-lifecycle-maintenance');
EXCEPTION WHEN OTHERS THEN
  NULL; -- no existía todavía
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'booking-lifecycle-maintenance',
    '*/15 * * * *',
    $cron$SELECT public.run_booking_lifecycle_maintenance();$cron$
  );
EXCEPTION WHEN OTHERS THEN
  -- En entornos sin pg_cron disponible (o sin permisos) la migración no debe romper: las
  -- funciones quedan creadas y se pueden invocar manualmente o desde un scheduler externo.
  RAISE NOTICE 'pg_cron no disponible: programa run_booking_lifecycle_maintenance() externamente';
END $$;
