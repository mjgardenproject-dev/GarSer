-- Prueba real (2026-09-28) · F5: equipo.
--
-- R-04: cuando un jardinero acepta la invitación, la empresa no se enteraba, y un empleado sin
-- horario fijo o sin servicios nunca recibe trabajos (la venta solo aparta a quien hace el
-- servicio y está libre, A-29) sin que nadie avise. Ahora `company_team_overview` dice qué le falta
-- a cada empleado (`has_recurring_schedule`, `is_configured`) y se avisa al dueño por correo al
-- unirse alguien (`company_member_joined`, desde la cola de F3).
-- R-05: el empleado no recibía ningún aviso cuando el dueño le cambiaba el horario. Ahora un
-- correo `member_schedule_published` por cada «Guardar» que cambie algo de verdad. Los días
-- sueltos se guardan en UNA llamada (`set_member_days_availability`), todo o nada: antes era una
-- llamada por día y un fallo podía dejar el horario guardado a medias.

-- =============================================
-- 1) Qué le falta a cada empleado
-- =============================================
CREATE OR REPLACE FUNCTION public.company_team_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_company_id uuid := public.my_company_id();
  v_provider uuid;
BEGIN
  IF v_company_id IS NULL OR NOT public.is_company_owner(v_company_id) THEN
    RAISE EXCEPTION 'Solo el dueño de la empresa puede ver su equipo.';
  END IF;

  SELECT provider_user_id INTO v_provider FROM public.companies WHERE id = v_company_id;

  RETURN jsonb_build_object(
    'company', (
      SELECT jsonb_build_object(
        'id', c.id, 'legal_name', c.legal_name, 'tax_id', c.tax_id, 'status', c.status,
        'assignment_mode', c.assignment_mode,
        'allow_split_jobs', c.allow_split_jobs,
        'max_crew', c.max_crew,
        'commercial_name', gp.full_name, 'phone', gp.phone, 'address', gp.address
      )
      FROM public.companies c JOIN public.gardener_profiles gp ON gp.user_id = c.provider_user_id
      WHERE c.id = v_company_id
    ),
    'offered_services', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
      FROM public.gardener_service_prices p JOIN public.services s ON s.id = p.service_id
      WHERE p.gardener_id = v_provider AND p.active
    ), '[]'::jsonb),
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'member_id', m.id,
        'user_id', m.user_id,
        'role', m.role,
        'status', m.status,
        'counts_as_labour', m.counts_as_labour,
        'joined_at', m.joined_at,
        'full_name', NULLIF(BTRIM(pr.full_name), ''),
        'phone', NULLIF(BTRIM(pr.phone), ''),
        'email', u.email,
        'services', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
          FROM public.company_member_services cms JOIN public.services s ON s.id = cms.service_id
          WHERE cms.member_id = m.id
        ), '[]'::jsonb),
        'license_status', (
          SELECT l.status FROM public.gardener_licenses l
          WHERE l.gardener_id = m.user_id AND l.status <> 'replaced'
          ORDER BY l.created_at DESC LIMIT 1
        ),
        'has_valid_phyto_license', public.has_valid_phyto_license(m.user_id),
        -- R-04: lo que le falta para poder recibir trabajos (horario fijo y algún servicio).
        'has_recurring_schedule', EXISTS (SELECT 1 FROM public.recurring_schedules rs WHERE rs.gardener_id = m.user_id),
        'is_configured', EXISTS (SELECT 1 FROM public.recurring_schedules rs WHERE rs.gardener_id = m.user_id)
                         AND EXISTS (SELECT 1 FROM public.company_member_services cms WHERE cms.member_id = m.id)
      ) ORDER BY (m.role = 'owner') DESC, m.status, m.joined_at)
      FROM public.company_members m
      JOIN auth.users u ON u.id = m.user_id
      LEFT JOIN public.profiles pr ON pr.user_id = m.user_id
      WHERE m.company_id = v_company_id
    ), '[]'::jsonb),
    'invitations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'email', i.email, 'created_at', i.created_at, 'expires_at', i.expires_at
      ) ORDER BY i.created_at DESC)
      FROM public.company_invitations i
      WHERE i.company_id = v_company_id AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
    ), '[]'::jsonb)
  );
END;
$$;

-- =============================================
-- 2) Aviso al dueño: alguien se une al equipo
-- =============================================
CREATE OR REPLACE FUNCTION private.company_members_enqueue_joined()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM private.enqueue_notification('company_member_joined',
    format('company_member_joined:%s:%s', NEW.id, private.notification_stamp(NEW.joined_at)), NULL,
    jsonb_build_object('memberId', NEW.id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_company_members_enqueue_joined ON public.company_members;
CREATE TRIGGER trg_company_members_enqueue_joined
  AFTER INSERT OR UPDATE OF status ON public.company_members
  FOR EACH ROW
  WHEN (NEW.role = 'employee' AND NEW.status = 'active')
  EXECUTE FUNCTION private.company_members_enqueue_joined();
-- Un UPDATE que no cambia el estado no avisa: la clave (miembro + fecha de alta) no se repite.

-- =============================================
-- 3) Días sueltos del empleado: una llamada, todo o nada, y un aviso
-- =============================================
-- Firma de las horas libres de unos días (para saber si algo ha cambiado de verdad).
CREATE OR REPLACE FUNCTION private.member_days_signature(p_user uuid, p_dates date[])
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(string_agg(a.date::text || '@' || extract(hour FROM a.start_time)::int, ',' ORDER BY a.date, a.start_time), '')
  FROM public.availability a
  WHERE a.gardener_id = p_user AND a.date = ANY (p_dates) AND a.is_available;
$$;
REVOKE ALL ON FUNCTION private.member_days_signature(uuid, date[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_member_days_availability(p_member_id uuid, p_days jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := private.owned_member_user(p_member_id);
  v_day jsonb;
  v_dates date[];
  v_before text;
  v_after text;
  v_changed boolean;
BEGIN
  IF jsonb_typeof(COALESCE(p_days, 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_days) = 0 THEN
    RAISE EXCEPTION 'No hay días que guardar.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_days) > 62 THEN
    RAISE EXCEPTION 'Demasiados días de una vez.' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(DISTINCT (d ->> 'date')::date) INTO v_dates FROM jsonb_array_elements(p_days) d;
  v_before := private.member_days_signature(v_user, v_dates);

  -- Cada día con las mismas comprobaciones de siempre; si uno falla, no se guarda ninguno.
  FOR v_day IN SELECT * FROM jsonb_array_elements(p_days) LOOP
    PERFORM public.set_member_day_availability(
      p_member_id,
      (v_day ->> 'date')::date,
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_day -> 'hours', '[]'::jsonb))::int)
    );
  END LOOP;

  v_after := private.member_days_signature(v_user, v_dates);
  v_changed := v_before IS DISTINCT FROM v_after;
  IF v_changed THEN
    PERFORM private.enqueue_notification('member_schedule_published',
      format('member_schedule_published:%s:%s', p_member_id, txid_current()), NULL,
      jsonb_build_object('memberId', p_member_id, 'kind', 'days', 'dates', to_jsonb(v_dates)));
  END IF;
  RETURN jsonb_build_object('changed', v_changed);
END;
$$;
REVOKE ALL ON FUNCTION public.set_member_days_availability(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_days_availability(uuid, jsonb) TO authenticated;

-- =============================================
-- 4) Horario fijo del empleado: igual que antes, y un aviso si cambia
-- =============================================
CREATE OR REPLACE FUNCTION public.set_member_recurring_schedule(p_member_id uuid, p_rules jsonb, p_weeks integer DEFAULT 4)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := private.owned_member_user(p_member_id);
  v_weeks integer := LEAST(GREATEST(COALESCE(p_weeks, 4), 1), 12);
  v_before text;
  v_after text;
BEGIN
  IF jsonb_typeof(COALESCE(p_rules, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Horario no válido.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_rules, '[]'::jsonb)) x
    WHERE (x ->> 'day_of_week')::int NOT BETWEEN 0 AND 6
       OR (x ->> 'start_time')::time >= (x ->> 'end_time')::time
  ) THEN
    RAISE EXCEPTION 'Horario no válido.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(string_agg(format('%s@%s-%s', day_of_week, start_time, end_time), ',' ORDER BY day_of_week, start_time), '')
    INTO v_before FROM public.recurring_schedules WHERE gardener_id = v_user;

  INSERT INTO public.recurring_availability_settings (gardener_id, weeks_to_maintain, min_notice_hours, updated_at)
  VALUES (v_user, v_weeks, 0, now())
  ON CONFLICT (gardener_id) DO UPDATE SET weeks_to_maintain = EXCLUDED.weeks_to_maintain, updated_at = now();

  DELETE FROM public.recurring_schedules WHERE gardener_id = v_user;
  INSERT INTO public.recurring_schedules (gardener_id, day_of_week, start_time, end_time)
  SELECT v_user, (x ->> 'day_of_week')::int, (x ->> 'start_time')::time, (x ->> 'end_time')::time
  FROM jsonb_array_elements(COALESCE(p_rules, '[]'::jsonb)) x;

  -- Las horas ya vendidas no se reabren: trigger protect_sold_availability (A-32).
  PERFORM public.generate_recurring_slots(v_user, true);

  SELECT COALESCE(string_agg(format('%s@%s-%s', day_of_week, start_time, end_time), ',' ORDER BY day_of_week, start_time), '')
    INTO v_after FROM public.recurring_schedules WHERE gardener_id = v_user;
  IF v_before IS DISTINCT FROM v_after THEN
    PERFORM private.enqueue_notification('member_schedule_published',
      format('member_schedule_published:%s:%s', p_member_id, txid_current()), NULL,
      jsonb_build_object('memberId', p_member_id, 'kind', 'weekly'));
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_member_recurring_schedule(uuid, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_recurring_schedule(uuid, jsonb, integer) TO authenticated;
