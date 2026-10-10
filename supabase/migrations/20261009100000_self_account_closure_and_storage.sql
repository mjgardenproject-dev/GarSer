-- Pendientes · fase A (2026-10-09): baja real desde «Mi cuenta» (PH-01), sus ficheros (PH-04) y
-- quién puede ver los ficheros de Storage (PH-14).
--
--   1. PH-14: `booking-photos` dejaba leer y listar TODO a cualquier usuario con sesión, y
--      `applications` dejaba listar sin sesión los ficheros de todos los solicitantes. Ahora cada
--      fichero lo ven su dueño, quien comparte esa reserva y el admin. `applications` sigue siendo
--      público: los enlaces guardados (fotos de perfil y de la solicitud) siguen funcionando; lo
--      que se cierra es poder listarlo. Las reglas de `marketing-assets` comparaban
--      `profiles.id = auth.uid()` (nunca coincide): pasan a `is_admin()`.
--   2. PH-04: cola `account_storage_cleanup`. Cada baja apunta, en la misma transacción, que hay
--      que borrar los ficheros de la cuenta; la función los borra justo después y el reloj
--      (booking-lifecycle-tick) reintenta los que fallen. Un fallo al borrar NUNCA deshace la baja.
--   3. PH-01: la baja la puede pedir el propio usuario (`my_account_closure_preview` y
--      `perform_self_account_closure`, esta solo para la función `account-closure`), con la misma
--      lógica que la del admin (F6, D23). El cuerpo común pasa a `private.execute_account_closure`.
--   4. Datos personales que la baja con historial aún dejaba: las coordenadas del cliente y del
--      proveedor en reservas, presupuestos y planes; la dirección y las notas de sus solicitudes; su
--      correo en las invitaciones; sus suscripciones al móvil; el número y el fichero del carnet.
--      Los chats se conservan (PR-05).
--
-- Vuelta atrás: restaurar las reglas de Storage anteriores (`booking_photos_select_auth` con
-- `bucket_id = 'booking-photos'`, `Public Read Applications` para `public` y las de
-- `marketing-assets` con `p.id`), y `perform_account_closure` de 20260929130000. La tabla nueva y
-- las funciones nuevas se pueden dejar: nadie más depende de ellas.

-- =============================================
-- 1) Quién ve los ficheros (PH-14)
-- =============================================
-- Fotos de reserva y de chat. Rutas que sube la web:
--   drafts/<usuario>/…  y  bookings/<usuario>/…   (fotos del cliente para su reserva)
--   chat/<reserva>/<usuario>/…                    (imágenes del chat)
CREATE OR REPLACE FUNCTION public.can_read_booking_photo(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    -- Su dueño.
    (split_part(p_name, '/', 1) IN ('drafts', 'bookings') AND split_part(p_name, '/', 2) = auth.uid()::text)
    OR (split_part(p_name, '/', 1) = 'chat' AND split_part(p_name, '/', 3) = auth.uid()::text)
    -- Quien comparte la reserva del chat.
    OR (split_part(p_name, '/', 1) = 'chat' AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id::text = split_part(p_name, '/', 2) AND (b.client_id = auth.uid() OR b.gardener_id = auth.uid())))
    -- Quien comparte la reserva a la que pertenece la foto (las mismas personas que leen booking_media).
    OR EXISTS (
      SELECT 1 FROM public.booking_media bm JOIN public.bookings b ON b.id = bm.booking_id
      WHERE bm.storage_bucket = 'booking-photos' AND bm.storage_path = p_name
        AND (b.client_id = auth.uid() OR b.gardener_id = auth.uid()))
    OR public.is_admin()
  );
$$;
REVOKE ALL ON FUNCTION public.can_read_booking_photo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_booking_photo(text) TO authenticated;

DROP POLICY IF EXISTS booking_photos_select_auth ON storage.objects;
DROP POLICY IF EXISTS booking_photos_select_scoped ON storage.objects;
CREATE POLICY booking_photos_select_scoped ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'booking-photos' AND public.can_read_booking_photo(name));

-- Solicitudes y fotos de perfil: listar, solo el dueño y el admin. (El depósito es público: los
-- enlaces guardados se siguen abriendo sin pasar por esta regla.)
DROP POLICY IF EXISTS "Public Read Applications" ON storage.objects;
DROP POLICY IF EXISTS applications_select_own ON storage.objects;
CREATE POLICY applications_select_own ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'applications' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));

DROP POLICY IF EXISTS marketing_assets_admin_select ON storage.objects;
DROP POLICY IF EXISTS marketing_assets_admin_insert ON storage.objects;
DROP POLICY IF EXISTS marketing_assets_admin_update ON storage.objects;
DROP POLICY IF EXISTS marketing_assets_admin_delete ON storage.objects;
CREATE POLICY marketing_assets_admin_select ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'marketing-assets' AND public.is_admin());
CREATE POLICY marketing_assets_admin_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'marketing-assets' AND public.is_admin());
CREATE POLICY marketing_assets_admin_update ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'marketing-assets' AND public.is_admin())
  WITH CHECK (bucket_id = 'marketing-assets' AND public.is_admin());
CREATE POLICY marketing_assets_admin_delete ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'marketing-assets' AND public.is_admin());

-- =============================================
-- 2) Ficheros de una cuenta dada de baja (PH-04)
-- =============================================
-- Sin clave foránea a propósito: la fila tiene que sobrevivir al borrado de la cuenta.
CREATE TABLE IF NOT EXISTS public.account_storage_cleanup (
  user_id uuid PRIMARY KEY,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  deleted_count integer NOT NULL DEFAULT 0,
  last_error text
);
COMMENT ON TABLE public.account_storage_cleanup IS
  'Ficheros de Storage por borrar de cuentas dadas de baja (PH-04). La apunta la baja y la vacía la '
  'función de baja; booking-lifecycle-tick reintenta las que no terminaron. Solo service_role.';
ALTER TABLE public.account_storage_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_storage_cleanup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_storage_cleanup TO service_role;

-- Los ficheros de esa persona. Los del chat se conservan, como sus mensajes (PR-05).
CREATE OR REPLACE FUNCTION public.account_storage_objects(p_user_id uuid)
RETURNS TABLE (bucket_id text, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT o.bucket_id, o.name FROM storage.objects o
  WHERE (o.bucket_id IN ('applications', 'private_licenses') AND split_part(o.name, '/', 1) = p_user_id::text)
     OR (o.bucket_id = 'booking-photos' AND split_part(o.name, '/', 1) IN ('drafts', 'bookings') AND split_part(o.name, '/', 2) = p_user_id::text)
  ORDER BY 1, 2;
$$;
REVOKE ALL ON FUNCTION public.account_storage_objects(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_storage_objects(uuid) TO service_role;

-- =============================================
-- 3) La baja: cuerpo común, admin y propio usuario (PH-01)
-- =============================================
CREATE OR REPLACE FUNCTION private.execute_account_closure(p_user_id uuid, p_expected_mode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan jsonb;
  v_mode text;
  v_company uuid;
  v_email text;
BEGIN
  -- Nadie más toca esta cuenta mientras tanto.
  PERFORM 1 FROM auth.users WHERE id = p_user_id FOR UPDATE;
  v_plan := private.account_closure_plan(p_user_id);
  v_mode := v_plan ->> 'mode';
  IF NOT COALESCE((v_plan ->> 'exists')::boolean, false) THEN
    RAISE EXCEPTION 'La cuenta ya no existe.' USING ERRCODE = '22023';
  END IF;
  IF v_mode = 'blocked' THEN
    RAISE EXCEPTION 'No se puede dar de baja: %', (SELECT string_agg(b ->> 'message', ' ') FROM jsonb_array_elements(v_plan -> 'blockers') b) USING ERRCODE = '22023';
  END IF;
  IF v_mode IS DISTINCT FROM p_expected_mode THEN
    RAISE EXCEPTION 'La cuenta ha cambiado desde que la revisaste. Vuelve a revisarla.' USING ERRCODE = '40001';
  END IF;

  v_email := v_plan ->> 'email';
  SELECT id INTO v_company FROM public.companies WHERE provider_user_id = p_user_id;

  -- PH-04: sus ficheros, en la misma transacción que la baja (los borra la función después).
  INSERT INTO public.account_storage_cleanup (user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO UPDATE SET requested_at = now(), completed_at = NULL, last_error = NULL;

  IF v_mode = 'delete' THEN
    IF v_company IS NOT NULL THEN
      DELETE FROM public.company_member_services WHERE member_id IN (SELECT id FROM public.company_members WHERE company_id = v_company);
      DELETE FROM public.company_members WHERE company_id = v_company;
      DELETE FROM public.companies WHERE id = v_company;   -- sus invitaciones se van con ella
    END IF;
    DELETE FROM public.company_member_services WHERE member_id IN (SELECT id FROM public.company_members WHERE user_id = p_user_id);
    DELETE FROM public.company_members WHERE user_id = p_user_id;
    DELETE FROM public.maintenance_plans WHERE client_id = p_user_id OR provider_id = p_user_id;  -- solo cancelados
    UPDATE public.company_invitations SET email = format('baja+%s@garser.invalid', p_user_id)
    WHERE lower(email) = lower(v_email);                    -- invitaciones que recibió en otras empresas
    DELETE FROM auth.users WHERE id = p_user_id;           -- perfil, ficha, precios, solicitudes, horarios…
    RETURN jsonb_build_object('mode', 'delete', 'userId', p_user_id);
  END IF;

  -- Baja conservando el historial (D23).
  UPDATE public.profiles SET full_name = 'Cuenta dada de baja', phone = NULL, address = NULL, avatar_url = NULL, updated_at = now()
  WHERE user_id = p_user_id;
  UPDATE public.gardener_profiles
  SET full_name = CASE WHEN v_company IS NOT NULL THEN 'Empresa dada de baja' ELSE 'Profesional dado de baja' END,
      phone = '', address = '', avatar_url = NULL, description = NULL, professional_photo_url = NULL,
      promotional_flyer_url = NULL, proof_photos = NULL, certification_photos = NULL, certification_text = NULL,
      experience_description = NULL, operational_latitude = NULL, operational_longitude = NULL,
      is_available = false, suspended_at = COALESCE(suspended_at, now()), updated_at = now()
  WHERE user_id = p_user_id;
  UPDATE public.gardener_service_prices SET active = false WHERE gardener_id = p_user_id;
  UPDATE public.gardener_applications SET full_name = NULL, phone = NULL, email = NULL, professional_photo_url = NULL,
      proof_photos = NULL, certification_photos = NULL, updated_at = now()
  WHERE user_id = p_user_id;
  UPDATE public.company_applications SET contact_name = NULL, phone = NULL, email = NULL, address = NULL, proof_photos = '{}',
      logo_url = NULL, updated_at = now()
  WHERE user_id = p_user_id;
  -- El carnet: se queda el registro (tipo, fechas, estado, huella), no el número ni el fichero.
  UPDATE public.gardener_licenses SET license_number = NULL, document_url = '' WHERE gardener_id = p_user_id;
  IF v_company IS NOT NULL THEN
    UPDATE public.companies SET status = 'suspended', logo_url = NULL, updated_at = now() WHERE id = v_company;
    UPDATE public.company_members SET status = 'inactive', left_at = COALESCE(left_at, now())
    WHERE company_id = v_company AND status = 'active';
    UPDATE public.company_invitations SET revoked_at = now()
    WHERE company_id = v_company AND accepted_at IS NULL AND revoked_at IS NULL;
    -- Las invitaciones que nunca se aceptaron ya no sirven: fuera el correo de esas personas.
    UPDATE public.company_invitations SET email = format('anulada+%s@garser.invalid', id)
    WHERE company_id = v_company AND accepted_at IS NULL;
  END IF;
  UPDATE public.company_members SET status = 'inactive', left_at = COALESCE(left_at, now())
  WHERE user_id = p_user_id AND status = 'active';
  UPDATE public.company_invitations SET email = format('baja+%s@garser.invalid', p_user_id)
  WHERE lower(email) = lower(v_email);
  -- Sus reservas (todas terminadas: si no, estaría bloqueado) conservan importes y fechas, pero
  -- no la dirección, el punto en el mapa ni las notas de quien se va.
  UPDATE public.bookings SET client_address = 'Dirección eliminada', notes = NULL, client_latitude = NULL, client_longitude = NULL
  WHERE client_id = p_user_id;
  UPDATE public.bookings SET provider_latitude = NULL, provider_longitude = NULL WHERE gardener_id = p_user_id;
  UPDATE public.booking_quotes SET client_latitude = NULL, client_longitude = NULL WHERE client_id = p_user_id;
  UPDATE public.booking_quotes SET provider_latitude = NULL, provider_longitude = NULL WHERE gardener_id = p_user_id;
  UPDATE public.maintenance_plans SET client_latitude = NULL, client_longitude = NULL WHERE client_id = p_user_id;
  UPDATE public.maintenance_plans SET provider_latitude = NULL, provider_longitude = NULL WHERE provider_id = p_user_id;
  UPDATE public.booking_requests SET client_address = 'Dirección eliminada', notes = NULL WHERE client_id = p_user_id;
  DELETE FROM public.push_subscriptions WHERE user_id = p_user_id;
  DELETE FROM public.availability WHERE gardener_id = p_user_id AND date >= current_date;
  DELETE FROM public.recurring_schedules WHERE gardener_id = p_user_id;

  RETURN jsonb_build_object('mode', 'deactivate', 'userId', p_user_id);
END;
$$;
REVOKE ALL ON FUNCTION private.execute_account_closure(uuid, text) FROM PUBLIC, anon, authenticated;

-- La del admin (F6): misma firma y mismo comportamiento, ahora con el cuerpo común.
CREATE OR REPLACE FUNCTION public.perform_account_closure(p_user_id uuid, p_expected_mode text, p_admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = p_admin_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Solo un administrador puede dar de baja cuentas.' USING ERRCODE = '42501';
  END IF;
  RETURN private.execute_account_closure(p_user_id, p_expected_mode);
END;
$$;
REVOKE ALL ON FUNCTION public.perform_account_closure(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.perform_account_closure(uuid, text, uuid) TO service_role;

-- La del propio usuario: solo la llama la función `account-closure`, con el usuario sacado del
-- token (nunca de un parámetro del navegador). Un admin no se da de baja así.
CREATE OR REPLACE FUNCTION public.perform_self_account_closure(p_user_id uuid, p_expected_mode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id = p_user_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Una cuenta de administración no se da de baja desde aquí.' USING ERRCODE = '42501';
  END IF;
  RETURN private.execute_account_closure(p_user_id, p_expected_mode);
END;
$$;
REVOKE ALL ON FUNCTION public.perform_self_account_closure(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.perform_self_account_closure(uuid, text) TO service_role;

-- El análisis para «Mi cuenta»: el mismo plan, sin el correo, y con las reservas que bloquean
-- (fecha, estado y servicio) para decírselo con sus palabras.
CREATE OR REPLACE FUNCTION public.my_account_closure_preview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Inicia sesión para cerrar tu cuenta.' USING ERRCODE = '42501';
  END IF;
  v_plan := private.account_closure_plan(auth.uid());
  RETURN (v_plan - 'email' - 'userId') || jsonb_build_object(
    'openBookings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('date', x.date, 'status', x.status, 'service', x.service, 'asClient', x.as_client) ORDER BY x.date)
      FROM (
        SELECT b.date, b.status, s.name AS service, b.client_id = auth.uid() AS as_client
        FROM public.bookings b LEFT JOIN public.services s ON s.id = b.service_id
        WHERE (b.client_id = auth.uid() OR b.gardener_id = auth.uid()) AND b.status IN ('pending', 'confirmed', 'disputed')
        ORDER BY b.date LIMIT 5
      ) x), '[]'::jsonb),
    'assignedJobs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('date', x.date, 'service', x.service) ORDER BY x.date)
      FROM (
        SELECT DISTINCT b.id, b.date, s.name AS service
        FROM public.booking_blocks bb JOIN public.bookings b ON b.id = bb.booking_id LEFT JOIN public.services s ON s.id = b.service_id
        WHERE bb.assignee_id = auth.uid() AND b.gardener_id <> auth.uid() AND b.status IN ('pending', 'confirmed')
          AND COALESCE(b.end_date, b.date) >= current_date
        ORDER BY b.date LIMIT 5
      ) x), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.my_account_closure_preview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_account_closure_preview() TO authenticated;
