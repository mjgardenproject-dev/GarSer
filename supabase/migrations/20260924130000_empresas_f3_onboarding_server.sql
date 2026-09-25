-- GarSer Empresas · F3.1: el servidor del alta de empresas y empleados.
--
-- Contexto: docs/garser-empresas/01-PLAN-Y-PROGRESO.md (F3) y 02-HALLAZGOS.md (A-20…A-24, H-22).
--
--   1) Roles: `company` se puede declarar al registrarse (A-20); cambio de rol de confianza para
--      las RPC del servidor (A-21).
--   2) company_applications: solicitud de alta de empresa con el patrón de gardener_applications
--      (A-24). La empresa rellena su borrador; ENVIARLO valida los obligatorios (RPC); aprobar o
--      rechazar solo lo hace el admin (RPC), que crea la ficha de proveedor, la empresa y el dueño.
--   3) Invitaciones: crear, anular y aceptar (A-22). La empresa sale del token, nunca de un
--      parámetro; el token solo se guarda como huella SHA-256.
--   4) Equipo: servicios por empleado (D5), «Yo también trabajo» (D3), baja de un empleado.
--   5) Carnet por persona (D4, A-13, A-23) y cierre de H-22 (licencias creadas ya aprobadas).
--   6) El dueño lee los perfiles de su equipo.
--
-- Todas las funciones de usuario son SECURITY DEFINER con search_path fijo (lección de H-15) y
-- con permisos de ejecución retirados a anon.

-- =============================================
-- 1) Roles
-- =============================================

-- A-20: 'company' declarable como 'gardener' («se registró como…», no «aprobado»).
CREATE OR REPLACE FUNCTION public.signup_role_from_metadata(p_meta jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_meta ->> 'requested_role' = 'gardener' OR p_meta ->> 'role' = 'gardener' THEN 'gardener'
    WHEN p_meta ->> 'requested_role' = 'company' OR p_meta ->> 'role' = 'company' THEN 'company'
    ELSE 'client'
  END;
$$;

COMMENT ON FUNCTION public.signup_role_from_metadata(jsonb) IS
  'Rol de alta desde user_metadata. Acepta las intenciones gardener y company («se registró como…»); '
  'todo lo demás es client. Nunca devuelve admin ni employee: esos roles no se autodeclaran.';

-- Rol de la cuenta con sesión, para usar en policies sin recursión.
CREATE OR REPLACE FUNCTION public.current_account_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.current_account_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_account_role() TO authenticated;

-- A-21: el disparador de escalada de F0 bloquea cualquier cambio de rol hecho con la sesión de
-- un usuario no admin — y dentro de una RPC auth.uid() sigue siendo ese usuario. Las RPC de
-- confianza lo indican con una marca de la transacción. La marca solo se puede poner desde SQL:
-- PostgREST no expone set_config.
CREATE OR REPLACE FUNCTION public.check_profile_role_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Si el rol no cambia, permitir la actualización
  IF NEW.role = OLD.role THEN
    RETURN NEW;
  END IF;

  -- Permitir si se está ejecutando en un contexto de sistema sin sesión
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Permitir el cambio que hace una RPC de confianza del servidor (A-21)
  IF current_setting('garser.trusted_role_change', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- Permitir si el usuario que realiza la acción es admin
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND role = 'admin'
  ) THEN
    RETURN NEW;
  END IF;

  -- Rechazar el cambio de rol
  RAISE EXCEPTION 'No tienes permisos para modificar el rol.';
END;
$function$;

-- Única vía de cambio de rol de confianza. En el esquema `private` (no expuesto por la API) y sin
-- EXECUTE para nadie salvo su dueño: solo la llaman otras funciones SECURITY DEFINER.
CREATE OR REPLACE FUNCTION private.set_account_role_trusted(p_user_id uuid, p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('garser.trusted_role_change', 'on', true);
  UPDATE public.profiles SET role = p_role, updated_at = now() WHERE user_id = p_user_id;
  PERFORM set_config('garser.trusted_role_change', 'off', true);
END;
$$;
REVOKE ALL ON FUNCTION private.set_account_role_trusted(uuid, text) FROM PUBLIC, anon, authenticated;

-- =============================================
-- 2) Solicitud de alta de empresa (A-24, D2, D7)
-- =============================================
-- Columnas: lo que necesita la aprobación. `answers`: el resto de la encuesta (D7), para poder
-- cambiar preguntas sin migración.
CREATE TABLE IF NOT EXISTS public.company_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  commercial_name text,
  legal_name text,
  tax_id text,
  contact_name text,
  phone text,
  address text,
  city_zone text,
  services text[] NOT NULL DEFAULT '{}',
  owner_works boolean NOT NULL DEFAULT false,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  proof_photos text[] NOT NULL DEFAULT '{}',
  logo_url text,
  accept_terms boolean NOT NULL DEFAULT false,
  declaration_truth boolean NOT NULL DEFAULT false,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewer_id uuid,
  review_comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Una sola solicitud abierta por cuenta; tras un rechazo se puede abrir otra.
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_applications_open
  ON public.company_applications (user_id) WHERE status IN ('draft', 'submitted');

REVOKE ALL ON public.company_applications FROM anon, authenticated;
GRANT SELECT ON public.company_applications TO authenticated;
-- Solo las columnas que rellena la empresa: el estado y la revisión no se pueden escribir.
GRANT INSERT (user_id, commercial_name, legal_name, tax_id, contact_name, phone, address, city_zone,
              services, owner_works, answers, proof_photos, logo_url, accept_terms, declaration_truth)
  ON public.company_applications TO authenticated;
GRANT UPDATE (commercial_name, legal_name, tax_id, contact_name, phone, address, city_zone,
              services, owner_works, answers, proof_photos, logo_url, accept_terms, declaration_truth, updated_at)
  ON public.company_applications TO authenticated;

ALTER TABLE public.company_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own company application read" ON public.company_applications;
CREATE POLICY "Own company application read" ON public.company_applications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Company accounts create own application" ON public.company_applications;
CREATE POLICY "Company accounts create own application" ON public.company_applications
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.current_account_role() = 'company');

DROP POLICY IF EXISTS "Own draft company application update" ON public.company_applications;
CREATE POLICY "Own draft company application update" ON public.company_applications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'draft')
  WITH CHECK (user_id = auth.uid() AND status = 'draft');

DROP POLICY IF EXISTS admin_read_company_applications ON public.company_applications;
CREATE POLICY admin_read_company_applications ON public.company_applications
  FOR SELECT TO authenticated USING (public.is_admin());

-- Enviar: valida los obligatorios de D7 y pasa a 'submitted'.
CREATE OR REPLACE FUNCTION public.submit_company_application(p_application_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.company_applications%ROWTYPE;
  v_missing text[] := '{}';
BEGIN
  SELECT * INTO v_app FROM public.company_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND OR v_app.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Solicitud no encontrada.';
  END IF;
  IF v_app.status <> 'draft' THEN
    RAISE EXCEPTION 'Esta solicitud ya se ha enviado.';
  END IF;

  IF COALESCE(BTRIM(v_app.commercial_name), '') = '' THEN v_missing := array_append(v_missing, 'nombre comercial'); END IF;
  IF COALESCE(BTRIM(v_app.legal_name), '') = '' THEN v_missing := array_append(v_missing, 'razón social'); END IF;
  IF COALESCE(BTRIM(v_app.tax_id), '') = '' THEN v_missing := array_append(v_missing, 'CIF'); END IF;
  IF COALESCE(BTRIM(v_app.contact_name), '') = '' THEN v_missing := array_append(v_missing, 'persona de contacto'); END IF;
  IF COALESCE(BTRIM(v_app.phone), '') = '' THEN v_missing := array_append(v_missing, 'teléfono'); END IF;
  IF COALESCE(BTRIM(v_app.address), '') = '' THEN v_missing := array_append(v_missing, 'dirección'); END IF;
  IF COALESCE(BTRIM(v_app.city_zone), '') = '' THEN v_missing := array_append(v_missing, 'zona de trabajo'); END IF;
  IF COALESCE(array_length(v_app.services, 1), 0) = 0 THEN v_missing := array_append(v_missing, 'servicios'); END IF;
  IF NOT v_app.accept_terms THEN v_missing := array_append(v_missing, 'aceptar las condiciones'); END IF;
  IF NOT v_app.declaration_truth THEN v_missing := array_append(v_missing, 'declarar que los datos son ciertos'); END IF;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'Falta: %.', array_to_string(v_missing, ', ');
  END IF;

  UPDATE public.company_applications
  SET status = 'submitted', submitted_at = now(), updated_at = now()
  WHERE id = p_application_id;

  RETURN jsonb_build_object('application_id', p_application_id, 'status', 'submitted');
END;
$$;

-- Revisar: solo el admin. Al aprobar crea ficha de proveedor 'company', empresa y dueño.
CREATE OR REPLACE FUNCTION public.admin_review_company_application(
  p_application_id uuid,
  p_status text,
  p_comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.company_applications%ROWTYPE;
  v_company_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado: el usuario no es administrador.';
  END IF;
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Estado no válido: %', p_status;
  END IF;

  SELECT * INTO v_app FROM public.company_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada.';
  END IF;
  IF v_app.status <> 'submitted' THEN
    RAISE EXCEPTION 'La solicitud no está enviada (estado: %).', v_app.status;
  END IF;

  IF p_status = 'approved' THEN
    IF (SELECT role FROM public.profiles WHERE user_id = v_app.user_id) IS DISTINCT FROM 'company' THEN
      RAISE EXCEPTION 'La cuenta que pidió el alta ya no es una cuenta de empresa.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.gardener_profiles WHERE user_id = v_app.user_id) THEN
      RAISE EXCEPTION 'Esta cuenta ya tiene una ficha de profesional.';
    END IF;

    INSERT INTO public.gardener_profiles (user_id, full_name, phone, address, city_zone, description, provider_kind)
    VALUES (v_app.user_id, v_app.commercial_name, v_app.phone, v_app.address, v_app.city_zone,
            NULLIF(BTRIM(v_app.answers ->> 'description'), ''), 'company');

    INSERT INTO public.companies (provider_user_id, legal_name, tax_id, logo_url)
    VALUES (v_app.user_id, v_app.legal_name, v_app.tax_id, v_app.logo_url)
    RETURNING id INTO v_company_id;

    INSERT INTO public.company_members (company_id, user_id, role, counts_as_labour)
    VALUES (v_company_id, v_app.user_id, 'owner', v_app.owner_works);
  END IF;

  UPDATE public.company_applications
  SET status = p_status, review_comment = p_comment, reviewed_at = now(), reviewer_id = auth.uid(), updated_at = now()
  WHERE id = p_application_id;

  RETURN jsonb_build_object('application_id', p_application_id, 'status', p_status, 'company_id', v_company_id);
END;
$$;

-- =============================================
-- 3) Invitaciones (A-22)
-- =============================================
CREATE OR REPLACE FUNCTION public.create_company_invitation(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid := public.my_company_id();
  v_email text := lower(BTRIM(COALESCE(p_email, '')));
  v_token text;
  v_invitation_id uuid;
  v_expires_at timestamptz := now() + interval '7 days';
BEGIN
  IF v_company_id IS NULL OR NOT public.is_company_owner(v_company_id) THEN
    RAISE EXCEPTION 'Solo el dueño de la empresa puede invitar.';
  END IF;
  IF (SELECT status FROM public.companies WHERE id = v_company_id) <> 'active' THEN
    RAISE EXCEPTION 'La empresa no está activa.';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'El correo no es válido.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.company_members m JOIN auth.users u ON u.id = m.user_id
    WHERE m.company_id = v_company_id AND m.status = 'active' AND lower(u.email) = v_email
  ) THEN
    RAISE EXCEPTION 'Esa persona ya forma parte de tu equipo.';
  END IF;

  -- Una invitación nueva al mismo correo anula las anteriores pendientes.
  UPDATE public.company_invitations
  SET revoked_at = now()
  WHERE company_id = v_company_id AND email = v_email AND accepted_at IS NULL AND revoked_at IS NULL;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO public.company_invitations (company_id, email, token_hash, expires_at, created_by)
  VALUES (v_company_id, v_email, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_expires_at, auth.uid())
  RETURNING id INTO v_invitation_id;

  -- El token solo existe aquí y en el email: no se puede recuperar después.
  RETURN jsonb_build_object('invitation_id', v_invitation_id, 'token', v_token, 'email', v_email, 'expires_at', v_expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_company_invitation(p_invitation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.company_invitations%ROWTYPE;
BEGIN
  SELECT * INTO v_inv FROM public.company_invitations WHERE id = p_invitation_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_company_owner(v_inv.company_id) THEN
    RAISE EXCEPTION 'Invitación no encontrada.';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta invitación ya se aceptó.';
  END IF;
  UPDATE public.company_invitations SET revoked_at = COALESCE(revoked_at, now()) WHERE id = p_invitation_id;
  RETURN jsonb_build_object('invitation_id', p_invitation_id, 'status', 'revoked');
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_company_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inv public.company_invitations%ROWTYPE;
  v_email text;
  v_company_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Inicia sesión para aceptar la invitación.';
  END IF;

  SELECT * INTO v_inv FROM public.company_invitations
  WHERE token_hash = encode(extensions.digest(COALESCE(p_token, ''), 'sha256'), 'hex')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esta invitación no es válida.';
  END IF;
  IF v_inv.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta invitación se ha anulado. Pide a la empresa que te envíe otra.';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta invitación ya se ha usado.';
  END IF;
  IF v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'Esta invitación ha caducado. Pide a la empresa que te envíe otra.';
  END IF;
  IF (SELECT status FROM public.companies WHERE id = v_inv.company_id) <> 'active' THEN
    RAISE EXCEPTION 'La empresa que te invita no está activa.';
  END IF;

  SELECT lower(email) INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_email IS DISTINCT FROM v_inv.email THEN
    RAISE EXCEPTION 'Esta invitación es para otro correo. Entra con la cuenta de %.', v_inv.email;
  END IF;
  IF EXISTS (SELECT 1 FROM public.gardener_profiles WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'Tu cuenta es de profesional en GarSer. Para trabajar como empleado de una empresa necesitas una cuenta distinta.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.company_members WHERE user_id = v_uid AND status = 'active') THEN
    RAISE EXCEPTION 'Ya formas parte de una empresa en GarSer.';
  END IF;
  IF public.current_account_role() IS DISTINCT FROM 'client' THEN
    RAISE EXCEPTION 'Solo una cuenta de cliente puede unirse a una empresa como empleado.';
  END IF;

  -- Quien estuvo antes en esta empresa y se fue, se reactiva (se conserva su histórico).
  UPDATE public.company_members
  SET status = 'active', role = 'employee', left_at = NULL, joined_at = now(), counts_as_labour = true
  WHERE company_id = v_inv.company_id AND user_id = v_uid;
  IF NOT FOUND THEN
    INSERT INTO public.company_members (company_id, user_id, role)
    VALUES (v_inv.company_id, v_uid, 'employee');
  END IF;

  PERFORM private.set_account_role_trusted(v_uid, 'employee');

  UPDATE public.company_invitations SET accepted_at = now(), accepted_by = v_uid WHERE id = v_inv.id;

  SELECT gp.full_name INTO v_company_name
  FROM public.companies c JOIN public.gardener_profiles gp ON gp.user_id = c.provider_user_id
  WHERE c.id = v_inv.company_id;

  RETURN jsonb_build_object('company_id', v_inv.company_id, 'company_name', v_company_name);
END;
$$;

-- =============================================
-- 5) Carnet por persona (D4, A-13, A-23) y H-22
-- =============================================
-- A-23: sin clave ajena a gardener_profiles, un empleado puede tener carnet. Queda la de
-- auth.users (gardener_licenses_gardener_id_fkey), que ya garantiza que es de una persona real.
ALTER TABLE public.gardener_licenses DROP CONSTRAINT IF EXISTS gardener_licenses_gardener_id_fkey_profiles;

-- H-22: la policy de subida solo comprobaba que la licencia fuera tuya, no su estado: un
-- jardinero podía crearla ya 'approved' hasta 2035 (reproducido el 2026-09-24). Ahora solo se
-- crea 'pending' y sin revisión; y solo la suben proveedores y miembros activos de una empresa.
DROP POLICY IF EXISTS "Gardeners can insert own licenses" ON public.gardener_licenses;
CREATE POLICY "Gardeners can insert own licenses" ON public.gardener_licenses
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = gardener_id
    AND status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND (
      EXISTS (SELECT 1 FROM public.gardener_profiles gp WHERE gp.user_id = auth.uid())
      OR public.my_company_id() IS NOT NULL
    )
  );

CREATE OR REPLACE FUNCTION public.has_valid_phyto_license(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.gardener_licenses
    WHERE gardener_id = p_user_id AND status = 'approved' AND expires_at > now()
  );
$$;
REVOKE ALL ON FUNCTION public.has_valid_phyto_license(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_valid_phyto_license(uuid) TO authenticated;

-- F3-13: si el carnet deja de ser válido (caduca, se rechaza o lo sustituye uno nuevo aún sin
-- revisar), a esa persona se le quita el servicio fitosanitario en su empresa.
CREATE OR REPLACE FUNCTION public.revoke_phyto_service_without_license()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'approved' AND NEW.status IS DISTINCT FROM 'approved'
     AND NOT public.has_valid_phyto_license(NEW.gardener_id) THEN
    DELETE FROM public.company_member_services cms
    USING public.company_members m, public.services s
    WHERE cms.member_id = m.id
      AND m.user_id = NEW.gardener_id
      AND s.id = cms.service_id
      AND s.name = 'Servicios fitosanitarios';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_revoke_phyto_service_without_license ON public.gardener_licenses;
CREATE TRIGGER trg_revoke_phyto_service_without_license
  AFTER UPDATE OF status ON public.gardener_licenses
  FOR EACH ROW EXECUTE FUNCTION public.revoke_phyto_service_without_license();

-- =============================================
-- 4) Equipo
-- =============================================
-- D5: servicios de una persona del equipo. Solo servicios activos de la empresa; fitosanitarios
-- solo con carnet válido (D4). Sustituye la lista entera.
CREATE OR REPLACE FUNCTION public.set_company_member_services(p_member_id uuid, p_service_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.company_members%ROWTYPE;
  v_provider uuid;
  v_service_id uuid;
  v_service_name text;
  v_ids uuid[] := COALESCE(p_service_ids, '{}');
BEGIN
  SELECT * INTO v_member FROM public.company_members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_company_owner(v_member.company_id) THEN
    RAISE EXCEPTION 'Solo el dueño de la empresa puede asignar servicios a su equipo.';
  END IF;
  IF v_member.status <> 'active' THEN
    RAISE EXCEPTION 'Esta persona ya no forma parte del equipo.';
  END IF;
  IF v_member.role = 'owner' AND NOT v_member.counts_as_labour AND array_length(v_ids, 1) > 0 THEN
    RAISE EXCEPTION 'Activa «Yo también trabajo» para asignarte servicios.';
  END IF;

  SELECT provider_user_id INTO v_provider FROM public.companies WHERE id = v_member.company_id;

  FOREACH v_service_id IN ARRAY v_ids LOOP
    SELECT name INTO v_service_name FROM public.services WHERE id = v_service_id;
    IF NOT EXISTS (
      SELECT 1 FROM public.gardener_service_prices
      WHERE gardener_id = v_provider AND service_id = v_service_id AND active
    ) THEN
      RAISE EXCEPTION 'La empresa no ofrece «%». Actívalo primero en tus servicios y precios.', COALESCE(v_service_name, 'ese servicio');
    END IF;
    IF v_service_name = 'Servicios fitosanitarios' AND NOT public.has_valid_phyto_license(v_member.user_id) THEN
      RAISE EXCEPTION 'Para hacer tratamientos fitosanitarios, esta persona tiene que tener su carnet adjuntado y aprobado.';
    END IF;
  END LOOP;

  DELETE FROM public.company_member_services
  WHERE member_id = p_member_id AND NOT (service_id = ANY (v_ids));

  INSERT INTO public.company_member_services (member_id, service_id)
  SELECT p_member_id, s FROM unnest(v_ids) AS s
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('member_id', p_member_id, 'service_ids', to_jsonb(v_ids));
END;
$$;

-- D3: el dueño elige si trabaja.
CREATE OR REPLACE FUNCTION public.set_company_owner_works(p_works boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id uuid;
BEGIN
  UPDATE public.company_members
  SET counts_as_labour = COALESCE(p_works, false)
  WHERE user_id = auth.uid() AND role = 'owner' AND status = 'active'
  RETURNING id INTO v_member_id;

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Solo el dueño de la empresa puede cambiar esto.';
  END IF;

  RETURN jsonb_build_object('member_id', v_member_id, 'counts_as_labour', COALESCE(p_works, false));
END;
$$;

-- Baja de un empleado: nunca se borra (histórico); no se permite con trabajos pendientes.
CREATE OR REPLACE FUNCTION public.deactivate_company_member(p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.company_members%ROWTYPE;
BEGIN
  SELECT * INTO v_member FROM public.company_members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_company_owner(v_member.company_id) THEN
    RAISE EXCEPTION 'Solo el dueño de la empresa puede dar de baja a alguien de su equipo.';
  END IF;
  IF v_member.role = 'owner' THEN
    RAISE EXCEPTION 'El dueño no se puede dar de baja de su propia empresa.';
  END IF;
  IF v_member.status <> 'active' THEN
    RAISE EXCEPTION 'Esta persona ya no forma parte del equipo.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.booking_blocks
    WHERE assignee_id = v_member.user_id AND date >= current_date
  ) THEN
    RAISE EXCEPTION 'Tiene trabajos asignados a partir de hoy: reasígnalos antes de darle de baja.';
  END IF;

  UPDATE public.company_members SET status = 'inactive', left_at = now() WHERE id = p_member_id;
  PERFORM private.set_account_role_trusted(v_member.user_id, 'client');

  RETURN jsonb_build_object('member_id', p_member_id, 'status', 'inactive');
END;
$$;

-- =============================================
-- 6) El dueño lee los perfiles de su equipo
-- =============================================
CREATE OR REPLACE FUNCTION public.is_my_team_member(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members m
    WHERE m.user_id = p_user_id AND public.is_company_owner(m.company_id)
  );
$$;
REVOKE ALL ON FUNCTION public.is_my_team_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_my_team_member(uuid) TO authenticated;

DROP POLICY IF EXISTS "Company owner reads team profiles" ON public.profiles;
CREATE POLICY "Company owner reads team profiles" ON public.profiles
  FOR SELECT TO authenticated USING (public.is_my_team_member(user_id));

-- =============================================
-- Permisos de ejecución de las RPC de usuario
-- =============================================
REVOKE ALL ON FUNCTION public.submit_company_application(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_review_company_application(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_company_invitation(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_company_invitation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_company_invitation(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_company_member_services(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_company_owner_works(boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.deactivate_company_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_company_application(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_company_application(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_company_invitation(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_company_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_company_invitation(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_company_member_services(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_company_owner_works(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_company_member(uuid) TO authenticated;
