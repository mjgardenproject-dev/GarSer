-- GarSer Empresas · F9.2: avisos de los planes de mantenimiento.
--
-- El reloj (booking-lifecycle-tick) coge las visitas propuestas o sin hueco aún no avisadas, pide
-- el correo y, si falla, la devuelve a la cola. El estado vive en maintenance_visits.notified_at,
-- no en la llamada HTTP (mismo principio que los avisos de confirmación del servicio).

CREATE OR REPLACE FUNCTION public.claim_maintenance_notifications(p_limit integer DEFAULT 50)
RETURNS TABLE(visit_id uuid, email_type text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT v.id
    FROM public.maintenance_visits v
    JOIN public.maintenance_plans p ON p.id = v.plan_id AND p.status = 'active'
    WHERE v.notified_at IS NULL
      AND v.status IN ('proposed', 'no_availability')
      AND v.created_at > now() - interval '7 days'
    ORDER BY v.created_at
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
    FOR UPDATE OF v SKIP LOCKED
  )
  UPDATE public.maintenance_visits v SET notified_at = now()
  FROM due
  WHERE v.id = due.id
  RETURNING v.id, CASE WHEN v.status = 'proposed' THEN 'maintenance_visit_proposed' ELSE 'maintenance_visit_unavailable' END;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_maintenance_notifications(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_maintenance_notifications(integer) TO service_role;

-- Si el correo no salió, vuelve a la cola para la siguiente pasada.
CREATE OR REPLACE FUNCTION public.release_maintenance_notification(p_visit_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.maintenance_visits SET notified_at = NULL WHERE id = p_visit_id;
$$;
REVOKE ALL ON FUNCTION public.release_maintenance_notification(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_maintenance_notification(uuid) TO service_role;
