-- GarSer Empresas · F3.3: lo que necesitan las pantallas del panel de empresa y del empleado.
--
-- 1) company_team_overview(): el dueño ve su equipo en una sola llamada — personas, qué servicios
--    hace cada una, si tiene carnet fitosanitario válido (D4), invitaciones pendientes y los
--    servicios que ofrece la empresa (D5). El dueño NO puede leer las licencias de sus empleados
--    directamente (RLS de gardener_licenses: cada uno las suyas); aquí solo recibe el estado.
-- 2) my_company_membership(): el empleado ve a qué empresa pertenece, qué servicios tiene y si
--    la empresa hace fitosanitarios (solo entonces se le pide el carnet, D4).
-- 3) has_valid_phyto_license() deja de estar abierta a cualquier usuario: en F3.1 se concedió
--    EXECUTE a authenticated, y con eso cualquiera podía preguntar si una persona concreta tiene
--    carnet. Solo la usan otras funciones SECURITY DEFINER.

REVOKE EXECUTE ON FUNCTION public.has_valid_phyto_license(uuid) FROM authenticated;

CREATE OR REPLACE FUNCTION public.company_team_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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
        'has_valid_phyto_license', public.has_valid_phyto_license(m.user_id)
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

CREATE OR REPLACE FUNCTION public.my_company_membership()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'member_id', m.id,
    'role', m.role,
    'company_name', gp.full_name,
    'joined_at', m.joined_at,
    'company_offers_phyto', EXISTS (
      SELECT 1 FROM public.gardener_service_prices p JOIN public.services s ON s.id = p.service_id
      WHERE p.gardener_id = c.provider_user_id AND p.active AND s.name = 'Servicios fitosanitarios'
    ),
    'services', COALESCE((
      SELECT jsonb_agg(s.name ORDER BY s.name)
      FROM public.company_member_services cms JOIN public.services s ON s.id = cms.service_id
      WHERE cms.member_id = m.id
    ), '[]'::jsonb)
  )
  FROM public.company_members m
  JOIN public.companies c ON c.id = m.company_id
  JOIN public.gardener_profiles gp ON gp.user_id = c.provider_user_id
  WHERE m.user_id = auth.uid() AND m.status = 'active';
$$;

REVOKE ALL ON FUNCTION public.company_team_overview() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_company_membership() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_team_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_company_membership() TO authenticated;

-- 4) invitation_preview(token): la página del enlace de invitación dice quién invita y en qué
--    estado está ANTES de iniciar sesión (quien la abre aún no tiene cuenta). Solo responde a
--    quien tiene el token (32 bytes aleatorios); no revela nada que el enlace no dé ya.
CREATE OR REPLACE FUNCTION public.invitation_preview(p_token text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT jsonb_build_object(
      'company_name', gp.full_name,
      'email', i.email,
      'state', CASE
        WHEN i.revoked_at IS NOT NULL THEN 'revoked'
        WHEN i.accepted_at IS NOT NULL THEN 'accepted'
        WHEN i.expires_at <= now() THEN 'expired'
        WHEN c.status <> 'active' THEN 'company_inactive'
        ELSE 'valid'
      END
    )
    FROM public.company_invitations i
    JOIN public.companies c ON c.id = i.company_id
    JOIN public.gardener_profiles gp ON gp.user_id = c.provider_user_id
    WHERE i.token_hash = encode(extensions.digest(COALESCE(p_token, ''), 'sha256'), 'hex')
  ), jsonb_build_object('state', 'invalid'));
$$;

REVOKE ALL ON FUNCTION public.invitation_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invitation_preview(text) TO anon, authenticated;
