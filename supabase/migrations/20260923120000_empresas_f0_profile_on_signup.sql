-- GarSer Empresas · F0 (parte servidor): todo usuario tiene perfil, creado por el servidor,
-- y nadie puede crearse un perfil con un rol privilegiado.
--
-- Contexto: docs/garser-empresas/02-HALLAZGOS.md, H-11 y H-12.
--
-- H-12 · Nada creaba el perfil de un usuario nuevo. El único disparador sobre auth.users era
--        trg_provision_admin (solo para el correo corporativo). Ni el frontend ni las Edge
--        Functions insertan en profiles. Confirmado también en producción (2026-09-23).
--        Efectos: la web adivina el rol desde user_metadata/localStorage, y
--        admin_review_gardener_application hace UPDATE profiles SET role='gardener' sobre una
--        fila que no existe (0 filas afectadas).
--
-- H-11 · Como el usuario nuevo no tenía perfil, podía crearlo él mismo con role='admin'
--        (policy de INSERT sin control del rol; prevent_role_escalation solo cubre UPDATE).
--        is_admin() se fía de profiles.role, así que eso abría todas las policies admin_*.
--        Reproducido en local el 2026-09-23.
--
-- Esta migración:
--   1) amplía el dominio de profiles.role a las cuentas de empresa (aún sin uso), y fija el
--      search_path de dos funciones existentes que rompían el alta (H-15);
--   2) crea el perfil en el servidor al registrarse, con rol client|gardener y nunca admin;
--   3) retira al cliente la capacidad de insertar perfiles, y pone un guarda de INSERT;
--   4) rellena el perfil de las cuentas que hoy no lo tienen.
--
-- No toca: prevent_role_escalation (UPDATE), is_admin() ni ninguna policy de lectura o
-- actualización. De prevent_duplicate_profiles y auto_provision_corporate_admin solo cambia
-- el search_path (1b), no lo que hacen.

-- =============================================
-- 1) Dominio de rol: + company, + employee
-- =============================================
-- Se añaden ya para no tener que tocar esta restricción en F2. Ningún flujo los asigna todavía.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['client', 'gardener', 'admin', 'company', 'employee']));

-- =============================================
-- 1b) search_path de las funciones que ya disparan al insertar un perfil
-- =============================================
-- H-15 · prevent_duplicate_profiles() consulta `profiles` sin esquema y sin search_path
-- propio. Cuando el INSERT en profiles ocurre durante el registro, la sesión es la de
-- supabase_auth_admin (search_path = auth) y falla con «relation "profiles" does not exist»,
-- lo que aborta el alta entera («Database error saving new user»). Hoy solo le pasaba al
-- correo corporativo (único alta que creaba perfil); con el disparador de este fichero le
-- pasaría a TODOS los registros. Reproducido en local el 2026-09-23.
-- Se fija el search_path; el comportamiento de ambas funciones no cambia.
ALTER FUNCTION public.prevent_duplicate_profiles() SET search_path = public;
ALTER FUNCTION public.auto_provision_corporate_admin() SET search_path = public;

-- =============================================
-- 2) Rol de alta a partir de la intención declarada al registrarse
-- =============================================
-- user_metadata lo escribe el propio usuario al registrarse (AuthContext.signUp manda
-- { role, requested_role }), así que NO es de fiar para nada privilegiado. De ahí solo se
-- acepta la intención 'gardener'; cualquier otro valor, incluido 'admin', da 'client'.
-- 'gardener' aquí significa «se registró como jardinero»: estar aprobado lo sigue marcando
-- la existencia de gardener_profiles, igual que hoy.
CREATE OR REPLACE FUNCTION public.signup_role_from_metadata(p_meta jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_meta ->> 'requested_role' = 'gardener' OR p_meta ->> 'role' = 'gardener'
      THEN 'gardener'
    ELSE 'client'
  END;
$$;

COMMENT ON FUNCTION public.signup_role_from_metadata(jsonb) IS
  'Rol de alta desde user_metadata. Solo acepta la intención gardener; todo lo demás es client. '
  'Nunca devuelve admin, company ni employee: esos roles no se autodeclaran.';

-- =============================================
-- 3) Perfil creado por el servidor al registrarse
-- =============================================
-- ORDEN DE DISPARO: Postgres ejecuta los disparadores del mismo momento por orden alfabético
-- de nombre. 'trg_provision_admin' < 'trg_provision_profile', así que el del admin corporativo
-- corre primero y crea su perfil como admin; este ve que ya existe y no hace nada. No
-- renombrar ninguno de los dos sin revisar este orden.
CREATE OR REPLACE FUNCTION public.provision_profile_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- prevent_duplicate_profiles lanza excepción si ya existe, así que se comprueba antes en
  -- vez de usar ON CONFLICT.
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = NEW.id) THEN
    INSERT INTO public.profiles (user_id, full_name, role)
    VALUES (
      NEW.id,
      COALESCE(NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'full_name'), ''), ''),
      public.signup_role_from_metadata(NEW.raw_user_meta_data)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_provision_profile ON auth.users;
CREATE TRIGGER trg_provision_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.provision_profile_on_signup();

-- =============================================
-- 4) El cliente ya no crea perfiles
-- =============================================
-- Nadie en src/ ni en supabase/functions/ inserta en profiles (verificado 2026-09-23): el
-- perfil lo crea el disparador de arriba. Se retira el privilegio y las dos policies de
-- INSERT, que eran la puerta de H-11.
REVOKE INSERT ON public.profiles FROM anon, authenticated;
DROP POLICY IF EXISTS "Allow users to insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

-- Defensa en profundidad: si algún día se vuelve a conceder INSERT, el rol sigue sin poder
-- autoasignarse. Mismo criterio que prevent_role_escalation para UPDATE: se permite sin
-- sesión (disparadores de alta, service_role, migraciones) y a los administradores.
CREATE OR REPLACE FUNCTION public.check_profile_role_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS NULL OR NEW.role NOT IN ('client', 'gardener') THEN
    RAISE EXCEPTION 'No tienes permisos para asignar ese rol.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_role_escalation_on_insert ON public.profiles;
CREATE TRIGGER prevent_role_escalation_on_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.check_profile_role_insert();

-- =============================================
-- 5) Relleno: perfil para toda cuenta que no lo tenga
-- =============================================
-- Mismo criterio que el alta. Se ejecuta como owner (sin sesión), así que el guarda de
-- INSERT lo deja pasar.
INSERT INTO public.profiles (user_id, full_name, role)
SELECT
  u.id,
  COALESCE(NULLIF(BTRIM(u.raw_user_meta_data ->> 'full_name'), ''), ''),
  public.signup_role_from_metadata(u.raw_user_meta_data)
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = u.id);

-- Los jardineros ya aprobados (tienen gardener_profiles) quedan como gardener aunque su
-- metadata no lo dijera: admin_review_gardener_application intentó ponerlo al aprobarlos,
-- pero su UPDATE no encontraba fila (H-12).
UPDATE public.profiles p
SET role = 'gardener', updated_at = now()
FROM public.gardener_profiles gp
WHERE gp.user_id = p.user_id
  AND p.role = 'client';
