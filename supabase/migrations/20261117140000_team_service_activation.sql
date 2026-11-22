-- QA-044 (P1): en una cuenta con equipo, activar un servicio lo dejaba INVISIBLE para los clientes
-- (nadie del equipo lo tenía asignado en company_member_services) mientras la web decía «los
-- clientes pueden reservarlo» y el perfil público lo listaba.
--
--   1) Al activar un servicio que nadie del equipo hace, se asigna al DUEÑO si trabaja («Yo también
--      trabajo») y puede hacerlo (fitosanitarios solo con carnet aprobado). Así sirve para cualquier
--      pantalla que active servicios. No se toca el reparto de los servicios que ya hace alguien, ni
--      se asigna nada a un dueño que no trabaja: ahí la web avisa de que falta asignarlo.
--   2) El perfil público (public_gardener_directory) de un equipo solo lista los servicios que
--      alguien del equipo puede hacer; el del autónomo no cambia.

CREATE OR REPLACE FUNCTION private.assign_activated_service_to_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner public.company_members%ROWTYPE;
  v_service_name text;
BEGIN
  IF NOT COALESCE(NEW.active, false) THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.active, false) THEN
    RETURN NULL;  -- ya estaba activo: no es una activación
  END IF;

  SELECT m.* INTO v_owner
  FROM public.companies c
  JOIN public.gardener_profiles gp ON gp.user_id = c.provider_user_id AND gp.provider_kind = 'company'
  JOIN public.company_members m ON m.company_id = c.id AND m.role = 'owner' AND m.status = 'active'
  WHERE c.provider_user_id = NEW.gardener_id
  LIMIT 1;

  IF NOT FOUND OR NOT COALESCE(v_owner.counts_as_labour, false) THEN
    RETURN NULL;
  END IF;

  -- Si alguien del equipo (que trabaja) ya lo hace, el reparto se respeta.
  IF EXISTS (
    SELECT 1
    FROM public.company_member_services cms
    JOIN public.company_members m ON m.id = cms.member_id
    WHERE m.company_id = v_owner.company_id AND m.status = 'active' AND m.counts_as_labour
      AND cms.service_id = NEW.service_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT name INTO v_service_name FROM public.services WHERE id = NEW.service_id;
  IF v_service_name = 'Servicios fitosanitarios' AND NOT public.has_valid_phyto_license(v_owner.user_id) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.company_member_services (member_id, service_id)
  VALUES (v_owner.id, NEW.service_id)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.assign_activated_service_to_owner() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_gardener_service_prices_assign_owner ON public.gardener_service_prices;
CREATE TRIGGER trg_gardener_service_prices_assign_owner
  AFTER INSERT OR UPDATE OF active ON public.gardener_service_prices
  FOR EACH ROW
  EXECUTE FUNCTION private.assign_activated_service_to_owner();

-- Mismas columnas y orden que antes (la vista se lee desde la web y desde booking-authority).
CREATE OR REPLACE VIEW public.public_gardener_directory AS
 SELECT gp.user_id,
    gp.full_name,
    gp.avatar_url,
    gp.rating,
    gp.rating_average,
    gp.rating_count,
    gp.total_reviews,
    CASE
      WHEN gp.provider_kind = 'company' THEN ARRAY(
        SELECT s.service_id
        FROM unnest(gp.services) AS s(service_id)
        WHERE EXISTS (
          SELECT 1
          FROM public.companies c
          JOIN public.company_members m ON m.company_id = c.id AND m.status = 'active' AND m.counts_as_labour
          JOIN public.company_member_services cms ON cms.member_id = m.id
          WHERE c.provider_user_id = gp.user_id
            AND cms.service_id::text = s.service_id
        )
      )
      ELSE gp.services
    END AS services,
    gp.max_distance,
    gp.description,
    gp.is_available,
    gp.has_phytosanitary_license,
    gp.provider_kind
   FROM public.gardener_profiles gp;

-- QA-215 (P0, seguridad): las vistas públicas tenían INSERT/UPDATE/DELETE para `authenticated`.
-- public_gardener_directory es una vista simple (una tabla) y Postgres la deja actualizar con los
-- privilegios de su dueño, saltándose la RLS de gardener_profiles: cualquier usuario con sesión
-- podía reescribir el nombre, la descripción, la foto o la valoración de CUALQUIER profesional.
-- Son vistas de solo lectura.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.public_gardener_directory FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.public_gardener_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_gardener_directory TO anon, authenticated;
GRANT SELECT ON public.public_gardener_reviews TO anon, authenticated;
