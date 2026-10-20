-- Completar la cuenta profesional (2026-10-20).
--
-- Una cuenta de jardinero o de empresa recién aprobada no sale a ningún cliente hasta que tiene
-- servicios con precios, zona validada y horas libres (y carnet, para los tratamientos químicos).
-- Hoy nada se lo dice: booking-authority la descarta en silencio. Esta migración da UNA fuente de
-- verdad con las mismas reglas que deciden quién sale en «Profesionales»:
--
--   · provider_setup_status(p_provider)   interna (service_role): el estado de un proveedor.
--   · my_provider_setup_status()           la cuenta proveedora con sesión (su panel).
--   · admin_provider_setup_overview()      el admin: todos los proveedores aprobados.
--
-- Reglas (las de booking-authority/evaluateOperationalEligibility y provider_free_hours):
--   · tarifa ACTIVA del servicio (gardener_service_prices.active);
--   · ficha no suspendida (gardener_profiles.suspended_at) y, en empresa, companies.status = 'active';
--   · coordenadas operativas (vacías o (0,0) = sin coordenadas);
--   · alguien que puede hacer el trabajo (provider_workers_all) con horas libres en los próximos
--     14 días (provider_free_hours), descontando la antelación mínima del proveedor;
--   · químicos/herbicida: carnet vigente (autónomo: el de su ficha, como isPhytosanitaryLicenseActive;
--     empresa: el de cada persona, has_valid_phyto_license).
--
-- Además arregla la foto: «Mi cuenta» la guarda en profiles.avatar_url, pero los clientes ven
-- gardener_profiles.avatar_url y nada la copiaba. Un trigger la copia y se rellenan las que faltan.

-- ── 1) Horas libres de una persona en la ventana (horario del autónomo y de cada miembro) ──────────
CREATE OR REPLACE FUNCTION public.worker_free_hours_count(
  p_worker uuid,
  p_start date,
  p_end date,
  p_not_before timestamptz
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Las mismas exclusiones que provider_free_hours (horas apartadas por un pago y horas con
  -- trabajo), sin mirar servicios: es «¿tiene huecos?», no «¿puede hacer este servicio?».
  SELECT count(*)::integer
  FROM public.availability a
  WHERE a.gardener_id = p_worker
    AND a.is_available = true
    AND a.date BETWEEN p_start AND p_end
    AND ((a.date + a.start_time) AT TIME ZONE 'Europe/Madrid') >= p_not_before
    AND NOT EXISTS (
      SELECT 1 FROM public.booking_schedule_hold_blocks hb
      WHERE hb.gardener_id = p_worker
        AND hb.date = a.date
        AND hb.hour_block = EXTRACT(HOUR FROM a.start_time)::integer
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.booking_blocks bb
      WHERE bb.assignee_id = p_worker
        AND bb.date = a.date
        AND bb.hour_block = EXTRACT(HOUR FROM a.start_time)::integer
    );
$$;

REVOKE ALL ON FUNCTION public.worker_free_hours_count(uuid, date, date, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_free_hours_count(uuid, date, date, timestamptz) TO service_role;

-- Estado del último carnet de una persona. Uno aprobado cuya fecha ya pasó cuenta como caducado.
CREATE OR REPLACE FUNCTION public.latest_phyto_license_status(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN l.status = 'approved' AND l.expires_at IS NOT NULL AND l.expires_at <= now() THEN 'expired'
    ELSE l.status
  END
  FROM public.gardener_licenses l
  WHERE l.gardener_id = p_user_id AND l.status <> 'replaced'
  ORDER BY l.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.latest_phyto_license_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.latest_phyto_license_status(uuid) TO service_role;

-- ── 2) Estado de un proveedor ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.provider_setup_status(p_provider uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gp public.gardener_profiles%ROWTYPE;
  v_company public.companies%ROWTYPE;
  v_is_company boolean;
  -- La misma ventana que «Profesionales»: hoy y los 13 días siguientes, en hora de Madrid.
  v_today date := (now() AT TIME ZONE 'Europe/Madrid')::date;
  v_end date := (now() AT TIME ZONE 'Europe/Madrid')::date + 13;
  v_notice integer;
  v_not_before timestamptz;
  v_has_coordinates boolean;
  v_suspended boolean;
  v_license_active boolean;
  v_services jsonb;
  v_team jsonb;
BEGIN
  SELECT * INTO v_gp FROM public.gardener_profiles WHERE user_id = p_provider;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_is_company := v_gp.provider_kind = 'company';
  IF v_is_company THEN
    SELECT * INTO v_company FROM public.companies WHERE provider_user_id = p_provider;
  END IF;

  -- La antelación mínima es del proveedor y vale para todo su equipo (como en booking-authority).
  SELECT GREATEST(COALESCE(s.min_notice_hours, 0), 0) INTO v_notice
  FROM public.recurring_availability_settings s WHERE s.gardener_id = p_provider;
  v_not_before := now() + make_interval(hours => COALESCE(v_notice, 0));

  v_has_coordinates := v_gp.operational_latitude IS NOT NULL
    AND v_gp.operational_longitude IS NOT NULL
    AND NOT (v_gp.operational_latitude = 0 AND v_gp.operational_longitude = 0);
  v_suspended := v_gp.suspended_at IS NOT NULL
    OR (v_is_company AND v_company.id IS NOT NULL AND v_company.status <> 'active');
  -- Autónomo: la misma regla que isPhytosanitaryLicenseActive (src/shared/bookingEligibilityCore.ts).
  v_license_active := COALESCE(v_gp.license_verification_status = 'approved' AND v_gp.license_expires_at > now(), false);

  SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data ->> 'name'), '[]'::jsonb) INTO v_services
  FROM (
    SELECT jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'service_active', COALESCE(s.is_active, true),
      'needs_license', c.needs_license,
      'workers', c.workers,
      'workers_with_hours', c.workers_with_hours,
      'licensed_workers_with_hours', c.licensed_workers_with_hours,
      'visible', NOT v_suspended AND v_has_coordinates AND COALESCE(s.is_active, true) AND c.workers_with_hours > 0,
      'visible_chemical', NOT v_suspended AND v_has_coordinates AND COALESCE(s.is_active, true) AND c.licensed_workers_with_hours > 0
    ) AS row_data
    FROM public.gardener_service_prices p
    JOIN public.services s ON s.id = p.service_id
    CROSS JOIN LATERAL (
      SELECT
        (SELECT count(*)::integer FROM public.provider_workers_all(p_provider, ARRAY[s.id], false)) AS workers,
        (SELECT count(DISTINCT fh.worker_id)::integer
           FROM public.provider_free_hours(ARRAY[p_provider], s.id, v_today, v_end, false) fh
          WHERE ((fh.date + make_time(fh.hour, 0, 0)) AT TIME ZONE 'Europe/Madrid') >= v_not_before) AS with_hours,
        -- Empresa: el carnet es de cada persona (provider_workers_all ya filtra con él).
        CASE WHEN v_is_company THEN
          (SELECT count(DISTINCT fh.worker_id)::integer
             FROM public.provider_free_hours(ARRAY[p_provider], s.id, v_today, v_end, true) fh
            WHERE ((fh.date + make_time(fh.hour, 0, 0)) AT TIME ZONE 'Europe/Madrid') >= v_not_before)
        END AS company_licensed
    ) w
    CROSS JOIN LATERAL (
      SELECT
        (s.name = 'Servicios fitosanitarios'
          OR (s.name = 'Desbroce de malas hierbas'
              AND COALESCE(public.safe_numeric(p.additional_config ->> 'precio_herbicida_m2'), 0) > 0)) AS needs_license,
        w.workers,
        w.with_hours AS workers_with_hours,
        CASE
          WHEN v_is_company THEN COALESCE(w.company_licensed, 0)
          WHEN v_license_active THEN w.with_hours
          ELSE 0
        END AS licensed_workers_with_hours
    ) c
    WHERE p.gardener_id = p_provider AND p.active = true
  ) services_rows;

  IF v_is_company AND v_company.id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'company_status', v_company.status,
      'owner_works', COALESCE((
        SELECT m.counts_as_labour FROM public.company_members m
        WHERE m.company_id = v_company.id AND m.role = 'owner' AND m.status = 'active'
        LIMIT 1
      ), false),
      'employees', (
        SELECT count(*)::integer FROM public.company_members m
        WHERE m.company_id = v_company.id AND m.role <> 'owner' AND m.status = 'active'
      ),
      'pending_invitations', (
        SELECT count(*)::integer FROM public.company_invitations i
        WHERE i.company_id = v_company.id AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
      ),
      -- Solo quien cuenta como mano de obra (el dueño si «también trabaja» y los empleados activos).
      'members', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'member_id', m.id,
          'user_id', m.user_id,
          'role', m.role,
          'name', COALESCE(NULLIF(BTRIM(pr.full_name), ''), u.email),
          'service_ids', COALESCE((
            SELECT jsonb_agg(cms.service_id) FROM public.company_member_services cms WHERE cms.member_id = m.id
          ), '[]'::jsonb),
          'has_recurring_schedule', EXISTS (SELECT 1 FROM public.recurring_schedules rs WHERE rs.gardener_id = m.user_id),
          'free_hours_14d', public.worker_free_hours_count(m.user_id, v_today, v_end, v_not_before),
          'license_status', public.latest_phyto_license_status(m.user_id),
          'has_valid_license', public.has_valid_phyto_license(m.user_id)
        ) ORDER BY (m.role = 'owner') DESC, m.joined_at)
        FROM public.company_members m
        JOIN auth.users u ON u.id = m.user_id
        LEFT JOIN public.profiles pr ON pr.user_id = m.user_id
        WHERE m.company_id = v_company.id AND m.status = 'active' AND m.counts_as_labour
      ), '[]'::jsonb)
    ) INTO v_team;
  END IF;

  RETURN jsonb_build_object(
    'provider_id', p_provider,
    'provider_kind', v_gp.provider_kind,
    'suspended', v_suspended,
    'window_days', 14,
    'profile', jsonb_build_object(
      'full_name', v_gp.full_name,
      'address', NULLIF(BTRIM(COALESCE(v_gp.address, '')), ''),
      'max_distance', v_gp.max_distance,
      'has_coordinates', v_has_coordinates,
      'has_description', length(BTRIM(COALESCE(v_gp.description, ''))) > 0,
      'has_photo', length(BTRIM(COALESCE(v_gp.avatar_url, ''))) > 0
    ),
    'services', v_services,
    -- El horario del propio proveedor (autónomo; en empresa, el del dueño si trabaja).
    'schedule', jsonb_build_object(
      'has_recurring', EXISTS (SELECT 1 FROM public.recurring_schedules r WHERE r.gardener_id = p_provider),
      'free_hours_14d', public.worker_free_hours_count(p_provider, v_today, v_end, v_not_before)
    ),
    'license', jsonb_build_object(
      'status', public.latest_phyto_license_status(p_provider),
      'active', v_license_active
    ),
    'team', v_team,
    'push_enabled', EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = p_provider),
    'fee_waiver_enabled', public.own_clients_fee_waiver_enabled()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.provider_setup_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_setup_status(uuid) TO service_role;

-- ── 3) El panel del profesional ─────────────────────────────────────────────────────────────────
-- Solo la cuenta proveedora (la que tiene ficha): el autónomo o la cuenta de la empresa (su dueño).
-- Los empleados no tienen ficha (A-03) y un cliente tampoco: reciben error.
CREATE OR REPLACE FUNCTION public.my_provider_setup_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesión.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gardener_profiles WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'Esta cuenta no es una cuenta profesional.' USING ERRCODE = '42501';
  END IF;
  RETURN public.provider_setup_status(v_uid);
END;
$$;

REVOKE ALL ON FUNCTION public.my_provider_setup_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_provider_setup_status() TO authenticated, service_role;

-- ── 4) El admin: todos los proveedores aprobados ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_provider_setup_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado: el usuario no es administrador.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'user_id', gp.user_id,
      'name', gp.full_name,
      'provider_kind', gp.provider_kind,
      'email', u.email,
      'phone', NULLIF(BTRIM(COALESCE(gp.phone, '')), ''),
      'approved_at', gp.created_at,
      'status', public.provider_setup_status(gp.user_id)
    ) ORDER BY gp.created_at DESC)
    FROM public.gardener_profiles gp
    LEFT JOIN auth.users u ON u.id = gp.user_id
    WHERE gp.user_id IS NOT NULL
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_provider_setup_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_provider_setup_overview() TO authenticated, service_role;

-- ── 5) La foto que ven los clientes ──────────────────────────────────────────────────────────────
-- «Mi cuenta» guarda la foto en profiles.avatar_url (la de la persona: la usa también «Quién va»
-- para los empleados). La ficha de proveedor (lo que ven los clientes) es gardener_profiles.
CREATE OR REPLACE FUNCTION public.sync_provider_avatar_from_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.gardener_profiles
  SET avatar_url = NEW.avatar_url, updated_at = now()
  WHERE user_id = NEW.user_id
    AND avatar_url IS DISTINCT FROM NEW.avatar_url;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_provider_avatar_from_profile() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_provider_avatar ON public.profiles;
CREATE TRIGGER trg_sync_provider_avatar
  AFTER UPDATE OF avatar_url ON public.profiles
  FOR EACH ROW
  WHEN (NEW.avatar_url IS DISTINCT FROM OLD.avatar_url)
  EXECUTE FUNCTION public.sync_provider_avatar_from_profile();

-- Una sola vez: las fichas sin foto toman la de su cuenta (nunca se pisa una que ya tienen).
UPDATE public.gardener_profiles gp
SET avatar_url = p.avatar_url, updated_at = now()
FROM public.profiles p
WHERE p.user_id = gp.user_id
  AND NULLIF(BTRIM(COALESCE(gp.avatar_url, '')), '') IS NULL
  AND NULLIF(BTRIM(COALESCE(p.avatar_url, '')), '') IS NOT NULL;
