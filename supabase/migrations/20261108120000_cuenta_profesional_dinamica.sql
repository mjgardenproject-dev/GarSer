-- Cuenta de profesional única y dinámica (2026-11-08): de autónomo a equipo, y vuelta.
--
-- Contexto: docs/garser-empresas/08-CUENTA-PROFESIONAL-DINAMICA.md (decisiones D31–D40) y
-- 02-HALLAZGOS.md (H-45…H-50).
--
-- Hasta hoy el tipo de cuenta se elegía al registrarse y no cambiaba nunca: «Jardinero»
-- (profiles.role = 'gardener') o «Empresa» (role = 'company'), con dos altas distintas. Ahora hay UN
-- solo tipo, «Profesional» (role = 'gardener'), y el MODO se deriva del servidor:
--
--   · individual  → ningún empleado activo (el autónomo de siempre);
--   · equipo      → al menos un empleado activo.
--
-- La pieza central es pequeña porque casi todo el motor SQL ya decide con
-- gardener_profiles.provider_kind ('solo' = individual, 'company' = equipo): provider_workers_all,
-- provider_max_crew, booking_worker_for_client, public_gardener_directory, provider_setup_status…
-- Por eso provider_kind pasa a ser el REFLEJO del número de empleados, escrito solo por un
-- disparador sobre company_members (nadie lo escribe por API: sigue sin UPDATE para authenticated).
--
--   1) La empresa cuelga de una ficha de proveedor, sea del tipo que sea (D32).
--   2) private.ensure_provider_team: crea la empresa y el dueño SOBRE la ficha que ya existe (D33).
--   3) create_company_invitation: el primer compañero se invita desde el modo individual y eso
--      promociona la cuenta, con la declaración de seguro de responsabilidad civil (D35).
--   4) private.sync_provider_mode + disparador: el modo sigue a los empleados, y al volver a
--      individual los ajustes de equipo vuelven a fábrica (D34).
--   5) my_provider_mode(): lo que la web necesita para pintar un modo u otro.
--   6) 'company' deja de ser un tipo de cuenta que se asigne (D31).
--   7) Cuentas que había (D37): las 'company' pasan a 'gardener' y se recalcula el modo de todas.
--
-- No se tocan: booking-authority, booking-payment, el motor de precios, Stripe ni el flujo de
-- reserva del cliente. Nada de esto cambia dinero (D40).

-- =============================================
-- 1) La empresa cuelga de una ficha de proveedor (D32)
-- =============================================
-- Antes exigía una ficha 'company': impedía una empresa latente en un autónomo. Ahora basta con que
-- la ficha exista. La coherencia entre kind y empleados la mantiene sync_provider_mode.
CREATE OR REPLACE FUNCTION public.check_company_provider_kind()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.gardener_profiles WHERE user_id = NEW.provider_user_id) THEN
    RAISE EXCEPTION 'Una empresa tiene que colgar de una ficha de proveedor.';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON COLUMN public.gardener_profiles.provider_kind IS
  'Modo de la cuenta de profesional. solo = individual (vende y trabaja él). company = equipo (vende; '
  'trabajan el titular —si cuenta como mano de obra— y sus empleados, en company_members). '
  'Lo mantiene el disparador de company_members: equipo ⟺ al menos un empleado activo. '
  'Una fila de esta tabla es un PROVEEDOR: un empleado nunca la tiene.';

-- =============================================
-- 2) Declaración de seguro (D35)
-- =============================================
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS liability_declared_at timestamptz;
COMMENT ON COLUMN public.companies.liability_declared_at IS
  'Cuándo el titular declaró que su actividad tiene seguro de responsabilidad civil que cubre también a '
  'su equipo (se pide al invitar al primer compañero). NULL en las empresas que nacieron por solicitud '
  'aprobada: aquella encuesta ya preguntaba por el seguro.';

-- =============================================
-- 3) Promoción en sitio (D33)
-- =============================================
-- Idempotente. Crea la empresa y el miembro dueño sobre la ficha del propio titular. Sin EXECUTE para
-- nadie salvo su dueño: solo la llaman funciones SECURITY DEFINER que ya validaron a la persona.
CREATE OR REPLACE FUNCTION private.ensure_provider_team(p_user uuid, p_liability boolean)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.gardener_profiles WHERE user_id = p_user) THEN
    RAISE EXCEPTION 'Solo un profesional con la cuenta aprobada puede tener equipo.';
  END IF;

  INSERT INTO public.companies (provider_user_id, liability_declared_at)
  VALUES (p_user, CASE WHEN COALESCE(p_liability, false) THEN now() END)
  ON CONFLICT (provider_user_id) DO NOTHING;

  SELECT id INTO v_company_id FROM public.companies WHERE provider_user_id = p_user;

  IF COALESCE(p_liability, false) THEN
    UPDATE public.companies SET liability_declared_at = now(), updated_at = now()
    WHERE id = v_company_id AND liability_declared_at IS NULL;
  END IF;

  -- El titular es el miembro dueño y, de partida, también trabaja (D3).
  INSERT INTO public.company_members (company_id, user_id, role, status, counts_as_labour)
  VALUES (v_company_id, p_user, 'owner', 'active', true)
  ON CONFLICT (company_id, user_id) DO UPDATE
    SET role = 'owner', status = 'active', left_at = NULL
    WHERE public.company_members.status <> 'active' OR public.company_members.role <> 'owner';

  RETURN v_company_id;
END;
$$;

REVOKE ALL ON FUNCTION private.ensure_provider_team(uuid, boolean) FROM PUBLIC, anon, authenticated;

-- Misma función de siempre con una declaración más. La firma nueva lleva DEFAULT para que el front
-- que ya esté desplegado (que solo manda p_email) siga funcionando; la vieja se borra porque dos
-- sobrecargas harían ambigua la llamada por nombre desde PostgREST.
DROP FUNCTION IF EXISTS public.create_company_invitation(text);

CREATE FUNCTION public.create_company_invitation(p_email text, p_liability_declared boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_company_id uuid;
  v_email text := lower(BTRIM(COALESCE(p_email, '')));
  v_token text;
  v_invitation_id uuid;
  v_expires_at timestamptz := now() + interval '7 days';
  v_gp public.gardener_profiles%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Inicia sesión para invitar a tu equipo.';
  END IF;

  SELECT * INTO v_gp FROM public.gardener_profiles WHERE user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solo un profesional con la cuenta aprobada puede invitar a su equipo.';
  END IF;
  IF v_gp.suspended_at IS NOT NULL THEN
    RAISE EXCEPTION 'Tu cuenta está suspendida: no puedes invitar a nadie ahora.';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'El correo no es válido.';
  END IF;

  v_company_id := public.my_company_id();
  IF v_company_id IS NULL THEN
    -- Primera invitación: la cuenta se promociona. Todo lo de abajo ocurre en una transacción, así
    -- que si algo falla no queda una empresa a medias.
    IF NOT COALESCE(p_liability_declared, false) THEN
      RAISE EXCEPTION 'Confirma que tu actividad tiene un seguro de responsabilidad civil que cubre también a las personas de tu equipo.';
    END IF;
    v_company_id := private.ensure_provider_team(v_uid, true);
  ELSIF NOT public.is_company_owner(v_company_id) THEN
    RAISE EXCEPTION 'Solo el titular puede invitar a su equipo.';
  END IF;

  IF (SELECT status FROM public.companies WHERE id = v_company_id) <> 'active' THEN
    RAISE EXCEPTION 'Tu cuenta no está activa.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.company_members m JOIN auth.users u ON u.id = m.user_id
    WHERE m.company_id = v_company_id AND m.status = 'active' AND lower(u.email) = v_email
  ) THEN
    RAISE EXCEPTION 'Esa persona ya forma parte de tu equipo.';
  END IF;
  IF (
    SELECT count(*) FROM public.company_invitations
    WHERE company_id = v_company_id AND created_at > now() - interval '24 hours'
  ) >= 20 THEN
    RAISE EXCEPTION 'Has enviado muchas invitaciones hoy. Espera a mañana o escríbenos si necesitas invitar a más personas.';
  END IF;

  -- Una invitación nueva al mismo correo anula las anteriores pendientes.
  UPDATE public.company_invitations
  SET revoked_at = now()
  WHERE company_id = v_company_id AND email = v_email AND accepted_at IS NULL AND revoked_at IS NULL;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO public.company_invitations (company_id, email, token_hash, expires_at, created_by)
  VALUES (v_company_id, v_email, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_expires_at, v_uid)
  RETURNING id INTO v_invitation_id;

  -- El token solo existe aquí y en el email: no se puede recuperar después.
  RETURN jsonb_build_object('invitation_id', v_invitation_id, 'token', v_token, 'email', v_email, 'expires_at', v_expires_at);
END;
$$;

REVOKE ALL ON FUNCTION public.create_company_invitation(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_company_invitation(text, boolean) TO authenticated;

-- =============================================
-- 4) El modo sigue a los empleados (D32, D34)
-- =============================================
-- Calcula el modo que toca (equipo si hay al menos un empleado activo) y, solo si cambia, hace la
-- transición. Idempotente y sin efectos si la empresa ya no existe (cierre de cuenta).
CREATE OR REPLACE FUNCTION private.sync_provider_mode(p_company uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company public.companies%ROWTYPE;
  v_kind text;
  v_desired text;
  v_owner_member uuid;
BEGIN
  SELECT * INTO v_company FROM public.companies WHERE id = p_company;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT provider_kind INTO v_kind
  FROM public.gardener_profiles WHERE user_id = v_company.provider_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_desired := CASE
    WHEN EXISTS (
      SELECT 1 FROM public.company_members m
      WHERE m.company_id = p_company AND m.status = 'active' AND m.role <> 'owner'
    ) THEN 'company'
    ELSE 'solo'
  END;
  IF v_desired = v_kind THEN
    RETURN;
  END IF;

  UPDATE public.gardener_profiles SET provider_kind = v_desired WHERE user_id = v_company.provider_user_id;

  IF v_desired = 'company' THEN
    -- Entra en equipo: el titular hace de partida lo que ya vendía. Sin esto la empresa no tendría
    -- horas que vender (provider_workers_all solo mira company_member_services). Mismas reglas que
    -- set_company_member_services: servicios activos, y fitosanitarios solo con carnet válido.
    SELECT id INTO v_owner_member FROM public.company_members
    WHERE company_id = p_company AND role = 'owner' AND status = 'active';
    IF v_owner_member IS NOT NULL THEN
      DELETE FROM public.company_member_services WHERE member_id = v_owner_member;
      INSERT INTO public.company_member_services (member_id, service_id)
      SELECT v_owner_member, p.service_id
      FROM public.gardener_service_prices p
      JOIN public.services s ON s.id = p.service_id
      WHERE p.gardener_id = v_company.provider_user_id AND p.active
        AND (s.name <> 'Servicios fitosanitarios' OR public.has_valid_phyto_license(v_company.provider_user_id))
      ON CONFLICT DO NOTHING;
    END IF;
  ELSE
    -- Vuelve a individual: el titular es quien hace los trabajos y los ajustes de equipo vuelven a
    -- su valor de fábrica. Si no, una empresa latente con asignación manual dejaría reservas
    -- esperando una confirmación que la pantalla individual no ofrece.
    UPDATE public.company_members SET counts_as_labour = true
    WHERE company_id = p_company AND role = 'owner' AND status = 'active';
    UPDATE public.companies
    SET max_crew = 1, allow_split_jobs = false, assignment_mode = 'auto', updated_at = now()
    WHERE id = p_company;
    UPDATE public.bookings SET assignment_pending = false
    WHERE gardener_id = v_company.provider_user_id AND assignment_pending;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_provider_mode(uuid) FROM PUBLIC, anon, authenticated;

-- Solo mira a quien NO es el dueño: así una empresa creada por el camino antiguo (dueño sin
-- empleados) no cambia por insertarse su propia fila de dueño.
CREATE OR REPLACE FUNCTION private.company_members_sync_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role <> 'owner' THEN
      PERFORM private.sync_provider_mode(OLD.company_id);
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.role <> 'owner' OR (TG_OP = 'UPDATE' AND OLD.role <> 'owner') THEN
    PERFORM private.sync_provider_mode(NEW.company_id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.company_members_sync_mode() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_company_members_sync_mode ON public.company_members;
CREATE TRIGGER trg_company_members_sync_mode
  AFTER INSERT OR UPDATE OF status, role OR DELETE ON public.company_members
  FOR EACH ROW EXECUTE FUNCTION private.company_members_sync_mode();

-- =============================================
-- 5) Qué modo tiene la cuenta (lo que lee la web)
-- =============================================
-- Ligera a propósito: se llama una vez por sesión y al refrescar, no cuelga de la checklist.
CREATE OR REPLACE FUNCTION public.my_provider_mode()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_gp public.gardener_profiles%ROWTYPE;
  v_company public.companies%ROWTYPE;
  v_has_company boolean;
BEGIN
  SELECT * INTO v_gp FROM public.gardener_profiles WHERE v_uid IS NOT NULL AND user_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('is_professional', false);
  END IF;

  SELECT * INTO v_company FROM public.companies WHERE provider_user_id = v_uid;
  v_has_company := FOUND;

  RETURN jsonb_build_object(
    'is_professional', true,
    'mode', CASE WHEN v_gp.provider_kind = 'company' THEN 'team' ELSE 'individual' END,
    'has_team_structure', v_has_company,
    'active_employees', CASE WHEN v_has_company THEN (
      SELECT count(*)::integer FROM public.company_members m
      WHERE m.company_id = v_company.id AND m.role <> 'owner' AND m.status = 'active'
    ) ELSE 0 END,
    'pending_invitations', CASE WHEN v_has_company THEN (
      SELECT count(*)::integer FROM public.company_invitations i
      WHERE i.company_id = v_company.id AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
    ) ELSE 0 END,
    'owner_works', CASE WHEN v_has_company THEN COALESCE((
      SELECT m.counts_as_labour FROM public.company_members m
      WHERE m.company_id = v_company.id AND m.role = 'owner' AND m.status = 'active'
      LIMIT 1
    ), true) ELSE true END,
    'suspended', v_gp.suspended_at IS NOT NULL OR (v_has_company AND v_company.status <> 'active'),
    'liability_declared', v_has_company AND v_company.liability_declared_at IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.my_provider_mode() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_provider_mode() TO authenticated;

-- =============================================
-- 6) 'company' deja de ser un tipo de cuenta (D31)
-- =============================================
-- Quien pidió «empresa» al registrarse (enlaces antiguos con ?role=company, un valor viejo en la
-- sesión del navegador) se registra como profesional. El CHECK de profiles.role sigue admitiendo
-- 'company': no se toca, simplemente nadie lo recibe.
CREATE OR REPLACE FUNCTION public.signup_role_from_metadata(p_meta jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_meta ->> 'requested_role' IN ('gardener', 'company') OR p_meta ->> 'role' IN ('gardener', 'company') THEN 'gardener'
    ELSE 'client'
  END;
$$;

COMMENT ON FUNCTION public.signup_role_from_metadata(jsonb) IS
  'Rol de alta desde user_metadata. gardener y company («se registró como…») dan gardener: hay un solo '
  'tipo de profesional. Todo lo demás es client. Nunca devuelve admin, employee ni company.';

-- Mismo contrato que antes (mismos estados de retorno); 'company' equivale a 'gardener'.
CREATE OR REPLACE FUNCTION public.self_declare_signup_role(p_role text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_current text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sin sesión.';
  END IF;

  IF p_role IS NULL OR p_role NOT IN ('gardener', 'company') THEN
    RAISE EXCEPTION 'Rol no permitido.';
  END IF;

  SELECT role INTO v_current FROM public.profiles WHERE user_id = v_uid;

  IF v_current IS NULL THEN
    RETURN 'no_profile';
  END IF;
  IF v_current IN ('gardener', 'company') THEN
    RETURN 'unchanged';
  END IF;
  IF v_current <> 'client' THEN
    RETURN 'blocked_role';
  END IF;

  IF EXISTS (SELECT 1 FROM public.bookings WHERE client_id = v_uid)
     OR EXISTS (SELECT 1 FROM public.booking_requests WHERE client_id = v_uid)
     OR EXISTS (SELECT 1 FROM public.client_provider_relationships WHERE client_id = v_uid) THEN
    RETURN 'blocked_activity';
  END IF;

  PERFORM private.set_account_role_trusted(v_uid, 'gardener');
  RETURN 'declared';
END;
$$;

REVOKE ALL ON FUNCTION public.self_declare_signup_role(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.self_declare_signup_role(text) TO authenticated;

-- =============================================
-- 7) Cuentas que había (D37)
-- =============================================
-- Son cuentas de prueba (confirmado por el dueño, 2026-11-08): lo imprescindible para que esto
-- aplique limpio desde cero y sobre producción. Las de empresa pasan a profesional; las que tengan
-- un alta de empresa a medias se recrean a mano.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT user_id FROM public.profiles WHERE role = 'company' LOOP
    PERFORM private.set_account_role_trusted(r.user_id, 'gardener');
  END LOOP;

  -- Cada ficha refleja ya su número de empleados. El disparador solo mira filas de empleados, así que
  -- una empresa antigua (dueño sin empleados) se queda como estaba hasta este recálculo: pasa a
  -- individual, que es lo que es.
  FOR r IN SELECT id FROM public.companies LOOP
    PERFORM private.sync_provider_mode(r.id);
  END LOOP;
END;
$$;
