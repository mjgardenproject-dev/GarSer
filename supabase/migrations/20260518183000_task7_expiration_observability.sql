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

  INSERT INTO public.booking_funnel_events (
    user_id,
    level,
    event,
    source,
    path,
    context,
    created_at
  ) VALUES (
    CASE WHEN v_is_service_role THEN NULL ELSE auth.uid() END,
    'info',
    'booking.requests_expired',
    CASE WHEN v_is_service_role THEN 'db-pg-cron' ELSE 'rpc-expire-stale-booking-requests' END,
    '/rpc/expire_stale_booking_requests',
    jsonb_build_object(
      'expiredCount', v_count,
      'scope', CASE WHEN v_is_service_role THEN 'scheduler' ELSE 'manual_or_dashboard' END,
      'gardenerId', COALESCE(p_gardener_id::text, auth.uid()::text)
    ),
    now()
  );

  RETURN v_count;
END;
$$;
