-- Prueba real (2026-09-28) · F6: dar de baja o suspender cuentas de forma segura (R-02, D23, R-09,
-- R-12, R-13).
--
-- Antes la única forma de quitar una cuenta era el panel de Supabase, que borra en bruto:
--   · R-02: con una empresa, lo frenaba el RESTRICT de companies (a propósito) y no había otra vía;
--   · R-12: con un cliente o un autónomo, `bookings.client_id/gardener_id ON DELETE CASCADE` se
--     llevaba sus reservas pagadas (el rastro del dinero);
--   · R-13: las columnas de personas de GarSer Empresas no tenían clave foránea y dejaban restos
--     (en producción: una solicitud de empresa «enviada» de un usuario que ya no existe);
--   · R-09: `companies.status = 'suspended'` existía, pero nada lo miraba.
--
-- Ahora:
--   1. Se limpian los restos y se ponen las claves que faltan; las reservas pasan a RESTRICT: un
--      borrado en bruto de una cuenta con reservas FALLA en vez de llevárselas.
--   2. Suspender a un proveedor (`gardener_profiles.suspended_at`) corta las reservas NUEVAS
--      (booking-authority lo excluye y la base de datos no deja crear presupuestos); las ya
--      citadas se siguen haciendo, cobrando y valorando.
--   3. Una sola vía para dar de baja, solo para el admin (función admin-account-closure):
--      primero el análisis (`private.account_closure_plan`), que BLOQUEA si hay reservas en
--      curso, pagos o incidencias abiertas o planes activos; sin historial se borra entera en una
--      transacción; con historial (D23) se da de baja: datos personales fuera, proveedor
--      suspendido, equipo inactivo; reservas, importes y reseñas se quedan.

-- =============================================
-- 1) Restos de cuentas ya borradas (R-13)
-- =============================================
DO $$
DECLARE
  v_members integer;
  v_apps integer;
  v_inv integer;
BEGIN
  DELETE FROM public.company_member_services
  WHERE member_id IN (SELECT m.id FROM public.company_members m WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m.user_id));
  DELETE FROM public.company_members m WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m.user_id);
  GET DIAGNOSTICS v_members = ROW_COUNT;
  DELETE FROM public.company_applications a WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = a.user_id);
  GET DIAGNOSTICS v_apps = ROW_COUNT;
  UPDATE public.company_invitations i SET accepted_by = NULL
  WHERE i.accepted_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = i.accepted_by);
  GET DIAGNOSTICS v_inv = ROW_COUNT;
  UPDATE public.company_applications a SET reviewer_id = NULL
  WHERE a.reviewer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = a.reviewer_id);
  RAISE NOTICE 'Restos limpiados: % miembros, % solicitudes de empresa, % invitaciones', v_members, v_apps, v_inv;
END;
$$;

-- =============================================
-- 2) Claves foráneas que faltaban (R-12, R-13)
-- =============================================
ALTER TABLE public.company_members
  ADD CONSTRAINT company_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
ALTER TABLE public.booking_blocks
  ADD CONSTRAINT booking_blocks_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
-- Una solicitud de alta no es un registro con valor histórico: se va con la cuenta. (Si la
-- empresa llegó a existir, la frena companies.)
ALTER TABLE public.company_applications
  ADD CONSTRAINT company_applications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD CONSTRAINT company_applications_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.company_invitations
  ADD CONSTRAINT company_invitations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD CONSTRAINT company_invitations_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Quién revisó: que se pueda borrar a un admin sin bloquear nada.
ALTER TABLE public.gardener_applications DROP CONSTRAINT IF EXISTS gardener_applications_reviewer_id_fkey;
ALTER TABLE public.gardener_applications
  ADD CONSTRAINT gardener_applications_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.gardener_licenses DROP CONSTRAINT IF EXISTS gardener_licenses_reviewed_by_fkey;
ALTER TABLE public.gardener_licenses
  ADD CONSTRAINT gardener_licenses_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- R-12: un borrado en bruto ya no se lleva reservas pagadas.
ALTER TABLE public.bookings DROP CONSTRAINT bookings_client_id_fkey;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
ALTER TABLE public.bookings DROP CONSTRAINT bookings_gardener_id_fkey;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_gardener_id_fkey FOREIGN KEY (gardener_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

-- =============================================
-- 3) Suspender a un proveedor (R-09)
-- =============================================
ALTER TABLE public.gardener_profiles ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
COMMENT ON COLUMN public.gardener_profiles.suspended_at IS
  'Proveedor suspendido: no recibe reservas nuevas (booking-authority lo excluye; no se crean '
  'presupuestos). Las ya citadas siguen su curso. NULL = activo (lo de siempre).';

CREATE OR REPLACE FUNCTION private.block_quotes_for_suspended_provider()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.gardener_profiles gp WHERE gp.user_id = NEW.gardener_id AND gp.suspended_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Este profesional no acepta reservas ahora mismo.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_quotes_for_suspended_provider ON public.booking_quotes;
CREATE TRIGGER trg_block_quotes_for_suspended_provider
  BEFORE INSERT ON public.booking_quotes
  FOR EACH ROW
  EXECUTE FUNCTION private.block_quotes_for_suspended_provider();

CREATE OR REPLACE FUNCTION public.admin_set_provider_suspended(p_user_id uuid, p_suspended boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede suspender cuentas.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.gardener_profiles
  SET suspended_at = CASE WHEN p_suspended THEN COALESCE(suspended_at, now()) ELSE NULL END
  WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa cuenta no es un profesional ni una empresa.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.companies SET status = CASE WHEN p_suspended THEN 'suspended' ELSE 'active' END, updated_at = now()
  WHERE provider_user_id = p_user_id;
  RETURN jsonb_build_object('userId', p_user_id, 'suspended', p_suspended);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_provider_suspended(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_provider_suspended(uuid, boolean) TO authenticated;

-- =============================================
-- 4) El análisis de la baja
-- =============================================
-- Devuelve qué es la cuenta, qué bloquea la baja y si se borraría (sin historial) o se daría de
-- baja conservando el historial (D23).
CREATE OR REPLACE FUNCTION private.account_closure_plan(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_role text;
  v_company public.companies%ROWTYPE;
  v_member public.company_members%ROWTYPE;
  v_blockers jsonb := '[]'::jsonb;
  v_n integer;
  v_history boolean;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email IS NULL THEN
    RETURN jsonb_build_object('exists', false);
  END IF;
  SELECT role INTO v_role FROM public.profiles WHERE user_id = p_user_id;
  SELECT * INTO v_company FROM public.companies WHERE provider_user_id = p_user_id;
  SELECT * INTO v_member FROM public.company_members WHERE user_id = p_user_id AND role <> 'owner' ORDER BY joined_at DESC LIMIT 1;

  IF v_role = 'admin' THEN
    v_blockers := v_blockers || jsonb_build_object('code', 'admin', 'message', 'Es una cuenta de administración: no se da de baja desde aquí.');
  END IF;

  -- Reservas que aún no han terminado (como cliente o como proveedor).
  SELECT count(*) INTO v_n FROM public.bookings b
  WHERE (b.client_id = p_user_id OR b.gardener_id = p_user_id) AND b.status IN ('pending', 'confirmed', 'disputed');
  IF v_n > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code', 'open_bookings', 'count', v_n,
      'message', format('Tiene %s reserva(s) sin terminar (pendientes, confirmadas o en disputa): hay que completarlas, cancelarlas con reembolso o reasignarlas.', v_n));
  END IF;

  -- Trabajos que va a hacer (empleado).
  SELECT count(DISTINCT bb.booking_id) INTO v_n FROM public.booking_blocks bb JOIN public.bookings b ON b.id = bb.booking_id
  WHERE bb.assignee_id = p_user_id AND b.gardener_id <> p_user_id AND b.status IN ('pending', 'confirmed') AND COALESCE(b.end_date, b.date) >= current_date;
  IF v_n > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code', 'assigned_jobs', 'count', v_n,
      'message', format('Tiene %s trabajo(s) asignado(s) en su empresa: la empresa tiene que reasignarlos.', v_n));
  END IF;

  -- Pagos a medias.
  SELECT count(*) INTO v_n FROM public.booking_payment_attempts a
  WHERE (a.client_id = p_user_id OR a.gardener_id = p_user_id) AND a.status IN ('created', 'payment_pending', 'processing', 'reconciliation_required')
    AND a.created_at > now() - interval '2 days';
  IF v_n > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code', 'payments_in_progress', 'count', v_n,
      'message', format('Tiene %s pago(s) en curso o por conciliar.', v_n));
  END IF;

  -- Incidencias abiertas (pueden acabar en reembolso).
  SELECT count(*) INTO v_n FROM public.booking_incidents i JOIN public.bookings b ON b.id = i.booking_id
  WHERE (b.client_id = p_user_id OR b.gardener_id = p_user_id) AND i.status IN ('open', 'in_review');
  IF v_n > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code', 'open_incidents', 'count', v_n,
      'message', format('Tiene %s incidencia(s) abierta(s): hay que resolverlas antes.', v_n));
  END IF;

  -- Planes de mantenimiento activos.
  SELECT count(*) INTO v_n FROM public.maintenance_plans p
  WHERE (p.client_id = p_user_id OR p.provider_id = p_user_id) AND p.status = 'active';
  IF v_n > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code', 'active_plans', 'count', v_n,
      'message', format('Tiene %s plan(es) de mantenimiento activo(s): hay que cancelarlos antes.', v_n));
  END IF;

  -- Empresa con empleados que aún tienen trabajos de ella (se revisan como sus reservas, arriba).
  v_history := EXISTS (SELECT 1 FROM public.bookings b WHERE b.client_id = p_user_id OR b.gardener_id = p_user_id)
            OR EXISTS (SELECT 1 FROM public.booking_blocks bb WHERE bb.assignee_id = p_user_id)
            OR EXISTS (SELECT 1 FROM public.reviews r WHERE r.client_id = p_user_id OR r.gardener_id = p_user_id);

  RETURN jsonb_build_object(
    'exists', true,
    'userId', p_user_id,
    'email', v_email,
    'role', v_role,
    'company', CASE WHEN v_company.id IS NULL THEN NULL ELSE jsonb_build_object('id', v_company.id, 'status', v_company.status,
      'name', (SELECT full_name FROM public.gardener_profiles WHERE user_id = p_user_id),
      'activeEmployees', (SELECT count(*) FROM public.company_members m WHERE m.company_id = v_company.id AND m.role = 'employee' AND m.status = 'active')) END,
    'employeeOf', CASE WHEN v_member.id IS NULL THEN NULL ELSE (SELECT full_name FROM public.gardener_profiles gp JOIN public.companies c ON c.provider_user_id = gp.user_id WHERE c.id = v_member.company_id) END,
    'suspended', (SELECT suspended_at IS NOT NULL FROM public.gardener_profiles WHERE user_id = p_user_id),
    'hasHistory', v_history,
    'blockers', v_blockers,
    'mode', CASE WHEN jsonb_array_length(v_blockers) > 0 THEN 'blocked' WHEN v_history THEN 'deactivate' ELSE 'delete' END
  );
END;
$$;
REVOKE ALL ON FUNCTION private.account_closure_plan(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_account_closure_preview(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede revisar bajas.' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_user FROM auth.users WHERE lower(email) = lower(btrim(COALESCE(p_email, '')));
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('exists', false);
  END IF;
  RETURN private.account_closure_plan(v_user);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_account_closure_preview(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_account_closure_preview(text) TO authenticated;

-- =============================================
-- 5) Ejecutar la baja (solo la función admin-account-closure, con la clave de servicio)
-- =============================================
-- Sin historial: se borra entera, en orden y en una transacción (lo mismo que el script con el
-- que se borró la cuenta de prueba del 2026-09-28). Con historial (D23): datos personales fuera,
-- proveedor suspendido, empresa suspendida y equipo inactivo, invitaciones anuladas; reservas,
-- importes y reseñas se quedan. El veto de acceso y el correo anónimo de la cuenta los pone
-- después la función con la API de administración de Auth.
-- `p_expected_mode`: lo que el admin vio en el análisis; si ha cambiado, no se hace nada.
CREATE OR REPLACE FUNCTION public.perform_account_closure(p_user_id uuid, p_expected_mode text, p_admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan jsonb;
  v_mode text;
  v_company uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = p_admin_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Solo un administrador puede dar de baja cuentas.' USING ERRCODE = '42501';
  END IF;
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

  SELECT id INTO v_company FROM public.companies WHERE provider_user_id = p_user_id;

  IF v_mode = 'delete' THEN
    IF v_company IS NOT NULL THEN
      DELETE FROM public.company_member_services WHERE member_id IN (SELECT id FROM public.company_members WHERE company_id = v_company);
      DELETE FROM public.company_members WHERE company_id = v_company;
      DELETE FROM public.companies WHERE id = v_company;   -- sus invitaciones se van con ella
    END IF;
    DELETE FROM public.company_member_services WHERE member_id IN (SELECT id FROM public.company_members WHERE user_id = p_user_id);
    DELETE FROM public.company_members WHERE user_id = p_user_id;
    DELETE FROM public.maintenance_plans WHERE client_id = p_user_id OR provider_id = p_user_id;  -- solo cancelados
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
  IF v_company IS NOT NULL THEN
    UPDATE public.companies SET status = 'suspended', logo_url = NULL, updated_at = now() WHERE id = v_company;
    UPDATE public.company_members SET status = 'inactive', left_at = COALESCE(left_at, now())
    WHERE company_id = v_company AND status = 'active';
    UPDATE public.company_invitations SET revoked_at = now()
    WHERE company_id = v_company AND accepted_at IS NULL AND revoked_at IS NULL;
  END IF;
  UPDATE public.company_members SET status = 'inactive', left_at = COALESCE(left_at, now())
  WHERE user_id = p_user_id AND status = 'active';
  -- Sus reservas (todas terminadas: si no, estaría bloqueado) conservan importes y fechas, pero
  -- no la dirección ni las notas de un cliente que se va.
  UPDATE public.bookings SET client_address = 'Dirección eliminada', notes = NULL WHERE client_id = p_user_id;
  DELETE FROM public.availability WHERE gardener_id = p_user_id AND date >= current_date;
  DELETE FROM public.recurring_schedules WHERE gardener_id = p_user_id;

  RETURN jsonb_build_object('mode', 'deactivate', 'userId', p_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.perform_account_closure(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.perform_account_closure(uuid, text, uuid) TO service_role;
