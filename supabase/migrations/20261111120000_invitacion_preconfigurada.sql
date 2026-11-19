-- Invitación preconfigurada (2026-11-11, cuestionario «Activa tu cuenta», decisión D3).
--
-- Qué pasaba: el titular solo podía decir qué servicios hace cada persona y su horario DESPUÉS de que esa
-- persona aceptara (el miembro del equipo no existe hasta entonces). En el cuestionario de activación lo
-- natural es decirlo al invitar, una vez y en caliente.
--
-- Ahora:
--   1. `company_invitations.preset` (jsonb, opcional): lo que el titular eligió para esa persona:
--        { display_name?, service_ids?: [uuid], schedule?: {mode:'company'} | {mode:'custom', rules:[…], weeks},
--          request_license?: bool }
--   2. `set_company_invitation_preset(id, preset)`: solo el dueño de la empresa de la invitación y solo si
--      sigue pendiente. Se valida y normaliza en el servidor (servicios que la empresa tiene configurados;
--      fitosanitarios NO, porque exige el carnet aprobado de esa persona; horario 7:00-20:00 en horas en punto).
--   3. Al ACEPTAR (`private.accept_company_invitation_for`) se aplica con las reglas de siempre: solo servicios
--      que la empresa tenga ACTIVOS en ese momento; «mismo horario que la empresa» copia el horario fijo del
--      titular; se generan sus horas reservables; si se pidió, se marca que se le pide el carnet. Si algo de
--      esto fallara, la aceptación sigue adelante (se aplica lo que se pueda y se avisa en el registro).
--   4. El nombre que puso el titular solo rellena el del empleado si este no tiene ninguno.
--
-- Vuelta atrás: restaurar `private.accept_company_invitation_for` de 20260927120000, borrar las funciones
-- nuevas y `ALTER TABLE public.company_invitations DROP COLUMN preset`.

ALTER TABLE public.company_invitations ADD COLUMN IF NOT EXISTS preset jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.company_invitations'::regclass AND conname = 'company_invitations_preset_object'
  ) THEN
    ALTER TABLE public.company_invitations
      ADD CONSTRAINT company_invitations_preset_object CHECK (preset IS NULL OR jsonb_typeof(preset) = 'object');
  END IF;
END $$;

COMMENT ON COLUMN public.company_invitations.preset IS
  'Lo que el titular eligió al invitar (nombre, servicios, horario, pedir carnet). Se aplica al aceptar. Nulo = nada.';

-- ── Validar y normalizar ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.normalize_invitation_preset(p_provider uuid, p_preset jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := NULLIF(btrim(COALESCE(p_preset ->> 'display_name', '')), '');
  v_requested int;
  v_services jsonb := NULL;
  v_valid int;
  v_mode text := p_preset #>> '{schedule,mode}';
  v_rules jsonb;
  v_weeks int;
  v_schedule jsonb := NULL;
  v_license boolean := NULL;
BEGIN
  IF p_preset IS NULL OR jsonb_typeof(p_preset) <> 'object' THEN
    RAISE EXCEPTION 'Configuración no válida.' USING ERRCODE = '22023';
  END IF;
  IF v_name IS NOT NULL AND char_length(v_name) > 80 THEN
    RAISE EXCEPTION 'El nombre es demasiado largo.' USING ERRCODE = '22023';
  END IF;

  IF p_preset ? 'service_ids' THEN
    IF jsonb_typeof(p_preset -> 'service_ids') <> 'array' THEN
      RAISE EXCEPTION 'Servicios no válidos.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(p_preset -> 'service_ids') x
      JOIN public.services s ON s.id::text = x
      WHERE s.name = 'Servicios fitosanitarios'
    ) THEN
      RAISE EXCEPTION 'Los tratamientos fitosanitarios se asignan cuando esa persona tenga su carnet aprobado.' USING ERRCODE = '22023';
    END IF;
    SELECT count(DISTINCT x) INTO v_requested FROM jsonb_array_elements_text(p_preset -> 'service_ids') x;
    SELECT count(DISTINCT s.id), COALESCE(jsonb_agg(DISTINCT s.id::text), '[]'::jsonb)
      INTO v_valid, v_services
    FROM jsonb_array_elements_text(p_preset -> 'service_ids') x
    JOIN public.services s ON s.id::text = x
    JOIN public.gardener_service_prices p ON p.gardener_id = p_provider AND p.service_id = s.id;
    IF v_valid <> v_requested THEN
      RAISE EXCEPTION 'Alguno de esos servicios no lo tiene configurado tu empresa.' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_mode = 'company' THEN
    v_schedule := jsonb_build_object('mode', 'company');
  ELSIF v_mode = 'custom' THEN
    v_rules := COALESCE(p_preset #> '{schedule,rules}', '[]'::jsonb);
    IF jsonb_typeof(v_rules) <> 'array' OR jsonb_array_length(v_rules) = 0 OR jsonb_array_length(v_rules) > 21 THEN
      RAISE EXCEPTION 'Horario no válido.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_rules) r
      WHERE jsonb_typeof(r) <> 'object'
         OR (r ->> 'day_of_week') !~ '^[0-6]$'
         OR (r ->> 'start_time') !~ '^([01][0-9]|2[0-3]):00(:00)?$'
         OR (r ->> 'end_time') !~ '^([01][0-9]|2[0-3]):00(:00)?$'
    ) THEN
      RAISE EXCEPTION 'Horario no válido.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_rules) r
      WHERE (r ->> 'start_time')::time >= (r ->> 'end_time')::time
         OR (r ->> 'start_time')::time < time '07:00'
         OR (r ->> 'end_time')::time > time '20:00'
    ) THEN
      RAISE EXCEPTION 'Horario no válido: entre las 7:00 y las 20:00, con el fin después del inicio.' USING ERRCODE = '22023';
    END IF;
    v_weeks := LEAST(GREATEST(COALESCE((p_preset #>> '{schedule,weeks}')::int, 4), 1), 12);
    v_schedule := jsonb_build_object(
      'mode', 'custom',
      'weeks', v_weeks,
      'rules', (
        SELECT jsonb_agg(jsonb_build_object(
          'day_of_week', (r ->> 'day_of_week')::int,
          'start_time', to_char((r ->> 'start_time')::time, 'HH24:MI:SS'),
          'end_time', to_char((r ->> 'end_time')::time, 'HH24:MI:SS')))
        FROM jsonb_array_elements(v_rules) r
      )
    );
  ELSIF v_mode IS NOT NULL THEN
    RAISE EXCEPTION 'Horario no válido.' USING ERRCODE = '22023';
  END IF;

  IF p_preset ? 'request_license' THEN
    IF jsonb_typeof(p_preset -> 'request_license') <> 'boolean' THEN
      RAISE EXCEPTION 'Configuración no válida.' USING ERRCODE = '22023';
    END IF;
    v_license := (p_preset ->> 'request_license')::boolean;
  END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'display_name', v_name,
    'service_ids', v_services,
    'schedule', v_schedule,
    'request_license', v_license
  ));
END;
$$;
REVOKE ALL ON FUNCTION private.normalize_invitation_preset(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ── El titular guarda lo que eligió para esa persona ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_company_invitation_preset(p_invitation_id uuid, p_preset jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.company_invitations%ROWTYPE;
  v_provider uuid;
  v_norm jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Inicia sesión para continuar.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_inv FROM public.company_invitations WHERE id = p_invitation_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_company_owner(v_inv.company_id) THEN
    RAISE EXCEPTION 'Solo quien invita puede configurar esta invitación.' USING ERRCODE = '42501';
  END IF;
  IF v_inv.accepted_at IS NOT NULL OR v_inv.revoked_at IS NOT NULL OR v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'Esta invitación ya no está pendiente.' USING ERRCODE = '22023';
  END IF;
  SELECT provider_user_id INTO v_provider FROM public.companies WHERE id = v_inv.company_id;
  v_norm := private.normalize_invitation_preset(v_provider, p_preset);
  UPDATE public.company_invitations SET preset = NULLIF(v_norm, '{}'::jsonb) WHERE id = p_invitation_id;
  RETURN v_norm;
END;
$$;
REVOKE ALL ON FUNCTION public.set_company_invitation_preset(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_company_invitation_preset(uuid, jsonb) TO authenticated;

-- ── Aplicarlo al aceptar ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.apply_invitation_preset(p_invitation_id uuid, p_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_preset jsonb;
  v_member public.company_members%ROWTYPE;
  v_provider uuid;
  v_rules jsonb := '[]'::jsonb;
  v_weeks int := 4;
BEGIN
  SELECT preset INTO v_preset FROM public.company_invitations WHERE id = p_invitation_id;
  IF v_preset IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO v_member FROM public.company_members WHERE id = p_member_id;
  SELECT provider_user_id INTO v_provider FROM public.companies WHERE id = v_member.company_id;

  -- Nombre: solo si el empleado no tiene ninguno (él podrá corregirlo).
  IF NULLIF(btrim(COALESCE(v_preset ->> 'display_name', '')), '') IS NOT NULL THEN
    UPDATE public.profiles SET full_name = btrim(v_preset ->> 'display_name')
    WHERE user_id = v_member.user_id AND COALESCE(btrim(full_name), '') = '';
  END IF;

  -- Servicios: solo los que la empresa tenga ACTIVOS ahora (y nunca fitosanitarios: piden su carnet).
  INSERT INTO public.company_member_services (member_id, service_id)
  SELECT p_member_id, s.id
  FROM jsonb_array_elements_text(COALESCE(v_preset -> 'service_ids', '[]'::jsonb)) x
  JOIN public.services s ON s.id::text = x
  JOIN public.gardener_service_prices p ON p.gardener_id = v_provider AND p.service_id = s.id AND p.active
  WHERE s.name <> 'Servicios fitosanitarios'
  ON CONFLICT DO NOTHING;

  -- Horario: el de la empresa (horario fijo del titular) o el elegido.
  IF v_preset #>> '{schedule,mode}' = 'company' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'day_of_week', day_of_week,
             'start_time', to_char(start_time, 'HH24:MI:SS'),
             'end_time', to_char(end_time, 'HH24:MI:SS'))), '[]'::jsonb)
      INTO v_rules
    FROM public.recurring_schedules WHERE gardener_id = v_provider;
    SELECT COALESCE(weeks_to_maintain, 4) INTO v_weeks FROM public.recurring_availability_settings WHERE gardener_id = v_provider;
    v_weeks := COALESCE(v_weeks, 4);
  ELSIF v_preset #>> '{schedule,mode}' = 'custom' THEN
    v_rules := COALESCE(v_preset #> '{schedule,rules}', '[]'::jsonb);
    v_weeks := COALESCE((v_preset #>> '{schedule,weeks}')::int, 4);
  END IF;
  IF jsonb_array_length(v_rules) > 0 THEN
    INSERT INTO public.recurring_availability_settings (gardener_id, weeks_to_maintain, min_notice_hours, updated_at)
    VALUES (v_member.user_id, LEAST(GREATEST(v_weeks, 1), 12), 0, now())
    ON CONFLICT (gardener_id) DO UPDATE SET weeks_to_maintain = EXCLUDED.weeks_to_maintain, updated_at = now();
    DELETE FROM public.recurring_schedules WHERE gardener_id = v_member.user_id;
    INSERT INTO public.recurring_schedules (gardener_id, day_of_week, start_time, end_time)
    SELECT v_member.user_id, (r ->> 'day_of_week')::int, (r ->> 'start_time')::time, (r ->> 'end_time')::time
    FROM jsonb_array_elements(v_rules) r;
    PERFORM public.generate_recurring_slots(v_member.user_id, true);
  END IF;

  -- Pedirle el carnet (lo verá al entrar; la empresa también lo ve en su ficha).
  IF COALESCE((v_preset ->> 'request_license')::boolean, false) THEN
    UPDATE public.company_members SET phyto_license_requested_at = now() WHERE id = p_member_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.apply_invitation_preset(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── Aceptar: lo de siempre + aplicar la configuración ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.accept_company_invitation_for(p_user_id uuid, p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.company_invitations%ROWTYPE;
  v_email text;
  v_company_name text;
  v_member_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
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

  SELECT lower(email) INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email IS DISTINCT FROM v_inv.email THEN
    RAISE EXCEPTION 'Esta invitación es para otro correo. Entra con la cuenta de %.', v_inv.email;
  END IF;
  IF EXISTS (SELECT 1 FROM public.gardener_profiles WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'Tu cuenta es de profesional en GarSer. Para trabajar como empleado de una empresa necesitas una cuenta distinta.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.company_members WHERE user_id = p_user_id AND status = 'active') THEN
    RAISE EXCEPTION 'Ya formas parte de una empresa en GarSer.';
  END IF;
  IF (SELECT role FROM public.profiles WHERE user_id = p_user_id) IS DISTINCT FROM 'client' THEN
    RAISE EXCEPTION 'Solo una cuenta de cliente puede unirse a una empresa como empleado.';
  END IF;

  -- Quien estuvo antes en esta empresa y se fue, se reactiva (se conserva su histórico).
  UPDATE public.company_members
  SET status = 'active', role = 'employee', left_at = NULL, joined_at = now(), counts_as_labour = true
  WHERE company_id = v_inv.company_id AND user_id = p_user_id
  RETURNING id INTO v_member_id;
  IF NOT FOUND THEN
    INSERT INTO public.company_members (company_id, user_id, role)
    VALUES (v_inv.company_id, p_user_id, 'employee')
    RETURNING id INTO v_member_id;
  END IF;

  PERFORM private.set_account_role_trusted(p_user_id, 'employee');

  UPDATE public.company_invitations SET accepted_at = now(), accepted_by = p_user_id WHERE id = v_inv.id;

  -- Lo que el titular eligió al invitar (2026-11-11). Si algo fallara, la aceptación sigue.
  BEGIN
    PERFORM private.apply_invitation_preset(v_inv.id, v_member_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'No se pudo aplicar la configuración de la invitación %: %', v_inv.id, SQLERRM;
  END;

  SELECT gp.full_name INTO v_company_name
  FROM public.companies c JOIN public.gardener_profiles gp ON gp.user_id = c.provider_user_id
  WHERE c.id = v_inv.company_id;

  RETURN jsonb_build_object('company_id', v_inv.company_id, 'company_name', v_company_name);
END;
$$;
