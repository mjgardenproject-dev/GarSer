-- GarSer Empresas · F5.4: qué ve el cliente de quién va (D6).
--
-- D6: el cliente de una EMPRESA ve el nombre y la foto de quien va a hacer el trabajo, y solo
-- desde el día antes (hora de Madrid). Ni teléfono, ni correo, ni antes de tiempo (F5-11, F5-12).
--
-- 1) booking_worker_for_client(): lo único que el cliente sabe de esa persona, cuando toca.
-- 2) booking_blocks deja de ser legible para el cliente (H-28): desde F4 llevaba el id de la
--    persona apartada. Ninguna pantalla de cliente la leía; solo la del proveedor.

CREATE OR REPLACE FUNCTION public.booking_worker_for_client(p_booking_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'name', CASE
      WHEN BTRIM(COALESCE(p.full_name, '')) = '' THEN NULL
      WHEN strpos(BTRIM(p.full_name), ' ') = 0 THEN BTRIM(p.full_name)
      ELSE split_part(BTRIM(p.full_name), ' ', 1) || ' ' || left(split_part(BTRIM(p.full_name), ' ', 2), 1) || '.'
    END,
    'avatar_url', p.avatar_url
  )
  FROM public.bookings b
  JOIN public.gardener_profiles gp ON gp.user_id = b.gardener_id AND gp.provider_kind = 'company'
  JOIN LATERAL (
    SELECT bb.assignee_id FROM public.booking_blocks bb WHERE bb.booking_id = b.id LIMIT 1
  ) w ON true
  LEFT JOIN public.profiles p ON p.user_id = w.assignee_id
  WHERE b.id = p_booking_id
    AND b.client_id = auth.uid()
    AND b.status IN ('confirmed', 'in_progress')
    AND (now() AT TIME ZONE 'Europe/Madrid')::date >= b.date - 1;
$$;
REVOKE ALL ON FUNCTION public.booking_worker_for_client(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_worker_for_client(uuid) TO authenticated;

DROP POLICY IF EXISTS "Usuarios pueden ver bloques de sus reservas" ON public.booking_blocks;
CREATE POLICY "Proveedor ve los bloques de sus reservas" ON public.booking_blocks
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.bookings b WHERE b.id = booking_blocks.booking_id AND b.gardener_id = auth.uid()
  ));
