-- GarSer Empresas · F2: el proveedor como concepto.
--
-- Contexto: docs/garser-empresas/01-PLAN-Y-PROGRESO.md (F2) y 02-HALLAZGOS.md (A-01…A-14, H-21).
--
-- Separa «quién vende» (el proveedor: un autónomo o una empresa) de «quién trabaja» (el
-- ejecutante: el autónomo o un empleado). No crea una tabla `providers` (A-01): la tabla de
-- proveedores sigue siendo gardener_profiles, ahora con provider_kind. Las empresas añaden solo
-- lo que un autónomo no tiene.
--
-- Esta migración:
--   1) H-21 · cierra dos agujeros existentes que rompían la premisa del modelo:
--        a) cualquier usuario podía INSERTAR su propia ficha en gardener_profiles —saltándose
--           la aprobación, con carnet y valoraciones inventadas— y salir reservable;
--        b) un jardinero podía ACTUALIZAR sus columnas de carnet y aprobárselo él mismo.
--   2) gardener_profiles.provider_kind ('solo' | 'company'), DEFAULT 'solo';
--   3) bookings.gardener_id pasa a significar «proveedor responsable» (solo comentario, A-02);
--   4) companies, company_members, company_member_services (D5) y company_invitations;
--   5) funciones de pertenencia SECURITY DEFINER (evitan la recursión de policies);
--   6) RLS: solo LECTURA (admin: lectura de todo); ninguna escritura directa, ni del admin:
--      todas llegarán por RPC (F3);
--   7) integridad del modelo en la base de datos, no en la interfaz:
--        - un empleado no puede tener ficha de proveedor, ni un proveedor entrar de empleado (A-03);
--        - nadie está activo en dos empresas; ninguna empresa tiene dos dueños activos;
--        - el dueño es la cuenta de la propia empresa; la empresa cuelga de una ficha 'company'.
--
-- Todo lo existente queda como 'solo' y se comporta igual.

-- =============================================
-- 1) H-21 · fichas de proveedor y carnet: solo el servidor
-- =============================================
-- a) Las fichas las crea admin_review_gardener_application (SECURITY DEFINER) al aprobar, y la
--    creará la aprobación de empresas (F3). Nadie más: se retira INSERT y DELETE al cliente.
--    ProfileSettings.tsx tenía un «insert si no existe» inalcanzable para un jardinero aprobado;
--    se sustituye en el mismo cambio por un error explícito.
REVOKE INSERT, DELETE ON public.gardener_profiles FROM anon, authenticated;

-- b) El carnet lo escriben solo handle_new_gardener_license, review_gardener_license y
--    expire_due_phytosanitary_licenses (todas SECURITY DEFINER). Ninguna pantalla escribe estas
--    columnas (verificado 2026-09-24).
REVOKE UPDATE (has_phytosanitary_license, license_verification_status, license_verified_at, license_expires_at)
  ON public.gardener_profiles FROM anon, authenticated;

-- =============================================
-- 2) Tipo de proveedor
-- =============================================
-- Sin privilegio de UPDATE para el cliente: una columna nueva no hereda los privilegios por
-- columna que ya tenía la tabla, así que nadie puede cambiarse a sí mismo de tipo.
ALTER TABLE public.gardener_profiles
  ADD COLUMN IF NOT EXISTS provider_kind text NOT NULL DEFAULT 'solo';

ALTER TABLE public.gardener_profiles DROP CONSTRAINT IF EXISTS gardener_profiles_provider_kind_check;
ALTER TABLE public.gardener_profiles ADD CONSTRAINT gardener_profiles_provider_kind_check
  CHECK (provider_kind IN ('solo', 'company'));

COMMENT ON COLUMN public.gardener_profiles.provider_kind IS
  'solo = jardinero autónomo (vende y trabaja). company = empresa de jardinería (vende; trabajan '
  'sus empleados, en company_members). Una fila de esta tabla es un PROVEEDOR: un empleado nunca la tiene.';

-- =============================================
-- 3) Significado de bookings.gardener_id (A-02: no se renombra)
-- =============================================
COMMENT ON COLUMN public.bookings.gardener_id IS
  'Proveedor RESPONSABLE de la reserva: un autónomo o una empresa (gardener_profiles.user_id). '
  'Quién trabaja cada hora está en booking_blocks.assignee_id; para un autónomo coinciden.';

-- =============================================
-- 4) Tablas
-- =============================================
CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Cuenta de la empresa = ficha de proveedor 'company'. El dueño inicia sesión con ella.
  provider_user_id uuid NOT NULL UNIQUE REFERENCES public.gardener_profiles(user_id) ON DELETE RESTRICT,
  legal_name text,
  tax_id text,
  logo_url text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.companies IS
  'Lo que solo tiene una empresa (razón social, CIF, logo, estado). Lo comercial —servicios, '
  'precios, zona, reseñas— vive en gardener_profiles y gardener_service_prices, como en un autónomo.';

CREATE TABLE IF NOT EXISTS public.company_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  -- A-08: 'manager' lo admite el CHECK pero ningún flujo lo asigna todavía.
  role text NOT NULL DEFAULT 'employee' CHECK (role IN ('owner', 'manager', 'employee')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  -- D3 / A-14: el dueño elige si trabaja. Un empleado, por defecto, sí.
  counts_as_labour boolean NOT NULL DEFAULT true,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  UNIQUE (company_id, user_id)
);

COMMENT ON TABLE public.company_members IS
  'Personas de una empresa. Nunca se borran: al salir pasan a inactive (se conserva el histórico '
  'de quién trabajó qué en booking_blocks.assignee_id).';

-- Una persona solo puede estar activa en una empresa (my_company_id() depende de ello).
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_members_one_active_company
  ON public.company_members (user_id) WHERE status = 'active';

-- Un solo dueño activo por empresa.
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_members_one_active_owner
  ON public.company_members (company_id) WHERE role = 'owner' AND status = 'active';

-- D5 / A-12: qué servicios hace cada persona del equipo. La capacidad se calcula por servicio.
CREATE TABLE IF NOT EXISTS public.company_member_services (
  member_id uuid NOT NULL REFERENCES public.company_members(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, service_id)
);

CREATE TABLE IF NOT EXISTS public.company_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email text NOT NULL,
  -- Se guarda el HASH del token, nunca el token (se envía por email y no se puede recuperar).
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid,
  revoked_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_invitations_company ON public.company_invitations (company_id);

-- =============================================
-- 5) Pertenencia (SECURITY DEFINER: no disparan la RLS de company_members → sin recursión)
-- =============================================
CREATE OR REPLACE FUNCTION public.my_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.company_members
  WHERE user_id = auth.uid() AND status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_company_member(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members
    WHERE company_id = p_company_id AND user_id = auth.uid() AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_company_owner(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members
    WHERE company_id = p_company_id AND user_id = auth.uid()
      AND role = 'owner' AND status = 'active'
  );
$$;

-- Mínimo privilegio: un miembro se ve a sí mismo; el dueño ve a todo su equipo. Los compañeros
-- de un mismo trabajo se verán por una vía específica en F5, no listando la plantilla.
CREATE OR REPLACE FUNCTION public.can_read_company_member(p_member_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members m
    WHERE m.id = p_member_id
      AND (m.user_id = auth.uid() OR public.is_company_owner(m.company_id))
  );
$$;

REVOKE ALL ON FUNCTION public.my_company_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_company_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_company_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_company_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_company_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_company_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_company_member(uuid) TO authenticated;

-- =============================================
-- 6) Privilegios y RLS: los usuarios solo LEEN; las escrituras llegarán por RPC (F3)
-- =============================================
-- Las tablas nuevas de public nacen con todos los privilegios para anon y authenticated
-- (privilegios por defecto del esquema): se retiran explícitamente.
REVOKE ALL ON public.companies, public.company_members, public.company_member_services, public.company_invitations
  FROM anon, authenticated;
GRANT SELECT ON public.companies, public.company_members, public.company_member_services, public.company_invitations
  TO authenticated;
-- Sin INSERT/UPDATE/DELETE para nadie, ni para el admin: si se concedieran y solo las policies
-- lo impidieran, un UPDATE indebido no daría error (afectaría a 0 filas y respondería 200).
-- Sin privilegio, la base de datos lo rechaza con un error claro. Todas las escrituras —alta
-- de empresa, equipo, invitaciones, gestión desde el admin— irán por RPC SECURITY DEFINER.

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_member_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_invitations ENABLE ROW LEVEL SECURITY;

-- companies: la leen sus miembros activos y el admin.
DROP POLICY IF EXISTS "Members read their company" ON public.companies;
CREATE POLICY "Members read their company" ON public.companies
  FOR SELECT TO authenticated USING (public.is_company_member(id));
DROP POLICY IF EXISTS admin_all_companies ON public.companies;
CREATE POLICY admin_all_companies ON public.companies
  FOR SELECT TO authenticated USING (public.is_admin());

-- company_members: cada uno se ve a sí mismo; el dueño, a todo su equipo.
DROP POLICY IF EXISTS "Read own membership or own team" ON public.company_members;
CREATE POLICY "Read own membership or own team" ON public.company_members
  FOR SELECT TO authenticated USING (public.can_read_company_member(id));
DROP POLICY IF EXISTS admin_all_company_members ON public.company_members;
CREATE POLICY admin_all_company_members ON public.company_members
  FOR SELECT TO authenticated USING (public.is_admin());

-- company_member_services: mismo criterio que el miembro al que pertenecen.
DROP POLICY IF EXISTS "Read services of readable members" ON public.company_member_services;
CREATE POLICY "Read services of readable members" ON public.company_member_services
  FOR SELECT TO authenticated USING (public.can_read_company_member(member_id));
DROP POLICY IF EXISTS admin_all_company_member_services ON public.company_member_services;
CREATE POLICY admin_all_company_member_services ON public.company_member_services
  FOR SELECT TO authenticated USING (public.is_admin());

-- company_invitations: solo el dueño de esa empresa. La persona invitada NO la lee: acepta
-- con el token por RPC (F3), que deriva la empresa del token y nunca de un parámetro.
DROP POLICY IF EXISTS "Owners read their invitations" ON public.company_invitations;
CREATE POLICY "Owners read their invitations" ON public.company_invitations
  FOR SELECT TO authenticated USING (public.is_company_owner(company_id));
DROP POLICY IF EXISTS admin_all_company_invitations ON public.company_invitations;
CREATE POLICY admin_all_company_invitations ON public.company_invitations
  FOR SELECT TO authenticated USING (public.is_admin());

-- =============================================
-- 7) Integridad del modelo
-- =============================================
-- La empresa cuelga de una ficha de proveedor de tipo 'company'.
CREATE OR REPLACE FUNCTION public.check_company_provider_kind()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.gardener_profiles
    WHERE user_id = NEW.provider_user_id AND provider_kind = 'company'
  ) THEN
    RAISE EXCEPTION 'Una empresa tiene que colgar de una ficha de proveedor de tipo empresa.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_company_provider_kind ON public.companies;
CREATE TRIGGER trg_check_company_provider_kind
  BEFORE INSERT OR UPDATE OF provider_user_id ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.check_company_provider_kind();

-- A-03: un empleado nunca es proveedor. El dueño, en cambio, ES la cuenta de la empresa.
CREATE OR REPLACE FUNCTION public.check_company_member_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  IF NEW.role = 'owner' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = NEW.company_id AND c.provider_user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'El dueño de una empresa es la propia cuenta de la empresa.';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.gardener_profiles WHERE user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Un proveedor (autónomo o empresa) no puede ser a la vez empleado de una empresa.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_company_member_integrity ON public.company_members;
CREATE TRIGGER trg_check_company_member_integrity
  BEFORE INSERT OR UPDATE OF role, status, user_id, company_id ON public.company_members
  FOR EACH ROW EXECUTE FUNCTION public.check_company_member_integrity();

CREATE OR REPLACE FUNCTION public.check_provider_is_not_employee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.company_members
    WHERE user_id = NEW.user_id AND status = 'active' AND role <> 'owner'
  ) THEN
    RAISE EXCEPTION 'Un empleado de una empresa no puede tener ficha de proveedor.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_provider_is_not_employee ON public.gardener_profiles;
CREATE TRIGGER trg_check_provider_is_not_employee
  BEFORE INSERT OR UPDATE OF user_id ON public.gardener_profiles
  FOR EACH ROW EXECUTE FUNCTION public.check_provider_is_not_employee();
