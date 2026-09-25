-- GarSer Empresas · F6.2: opciones por hora para repartir un trabajo.
--
-- Para cada persona que PUEDE hacer el trabajo (servicio y carnet), qué horas del trabajo tiene
-- libres (o ya son suyas en este trabajo). La pantalla de «Repartir» muestra los conflictos antes
-- de confirmar (F6-03); assign_booking_hours lo vuelve a comprobar todo al guardar.

CREATE OR REPLACE FUNCTION public.booking_hour_options(p_booking_id uuid)
RETURNS TABLE (user_id uuid, full_name text, free_hours integer[], current_hours integer[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_start integer;
  v_end integer;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.provider_user_id = v_booking.gardener_id AND public.is_company_owner(c.id)
  ) THEN
    RAISE EXCEPTION 'Solo el dueño de la empresa puede repartir este trabajo.';
  END IF;
  v_start := EXTRACT(HOUR FROM v_booking.start_time)::integer;
  v_end := v_start + GREATEST(COALESCE(v_booking.duration_hours, 1), 1);

  RETURN QUERY
  SELECT w.worker_id,
         COALESCE(NULLIF(BTRIM(p.full_name), ''), 'Sin nombre'),
         COALESCE((
           SELECT array_agg(h ORDER BY h) FROM generate_series(v_start, v_end - 1) AS h
           WHERE public.worker_free_at(w.worker_id, v_booking.date, h)
              OR EXISTS (SELECT 1 FROM public.booking_blocks bb WHERE bb.booking_id = p_booking_id AND bb.assignee_id = w.worker_id AND bb.hour_block = h)
         ), '{}'),
         COALESCE((
           SELECT array_agg(bb.hour_block ORDER BY bb.hour_block) FROM public.booking_blocks bb
           WHERE bb.booking_id = p_booking_id AND bb.assignee_id = w.worker_id
         ), '{}')
  FROM public.provider_workers(v_booking.gardener_id, v_booking.service_id, public.booking_requires_phyto_license(p_booking_id)) AS w(worker_id)
  LEFT JOIN public.profiles p ON p.user_id = w.worker_id
  ORDER BY 2;
END;
$$;
REVOKE ALL ON FUNCTION public.booking_hour_options(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_hour_options(uuid) TO authenticated;
