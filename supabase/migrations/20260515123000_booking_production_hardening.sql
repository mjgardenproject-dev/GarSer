-- Production hardening for booking funnel:
-- 1) Remove unsafe anonymous access to operational booking data and draft uploads.
-- 2) Allow stale-request expiration to run as gardener-scoped action or service-role automation.
-- 3) Add backend telemetry sink for the booking funnel.

DROP POLICY IF EXISTS "Allow anonymous users to create bookings" ON public.bookings;
DROP POLICY IF EXISTS "Allow anonymous users to view bookings" ON public.bookings;

REVOKE INSERT ON public.bookings FROM anon;
REVOKE SELECT ON public.bookings FROM anon;

DROP POLICY IF EXISTS "booking_photos_insert_anon" ON storage.objects;
DROP POLICY IF EXISTS "booking_photos_select_anon" ON storage.objects;

CREATE TABLE IF NOT EXISTS public.booking_funnel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  level text NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  event text NOT NULL,
  source text NOT NULL DEFAULT 'web-client',
  path text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_funnel_events_created_at
  ON public.booking_funnel_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_funnel_events_event
  ON public.booking_funnel_events(event, created_at DESC);

ALTER TABLE public.booking_funnel_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read booking funnel events" ON public.booking_funnel_events;
CREATE POLICY "Admins can read booking funnel events"
  ON public.booking_funnel_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.role = 'admin'
    )
  );

CREATE OR REPLACE FUNCTION public.expire_stale_booking_requests(
  p_gardener_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired_id uuid;
  v_count integer := 0;
  v_is_service_role boolean := auth.role() = 'service_role';
BEGIN
  IF NOT v_is_service_role AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;

  FOR v_expired_id IN
    SELECT id
    FROM public.bookings
    WHERE status = 'pending'
      AND created_at <= now() - interval '24 hours'
      AND (
        (v_is_service_role AND p_gardener_id IS NULL)
        OR gardener_id = COALESCE(p_gardener_id, auth.uid())
      )
  LOOP
    PERFORM public.release_booking_schedule(v_expired_id);

    UPDATE public.bookings
    SET status = 'expired',
        updated_at = now()
    WHERE id = v_expired_id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_booking_requests(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_stale_booking_requests(uuid) TO authenticated;
