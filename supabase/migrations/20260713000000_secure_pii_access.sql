-- Migration: Secure PII access on profiles and gardener_profiles
-- Contexto: la migración 20250929000001_anonymous_booking_access.sql abrió SELECT a
-- `anon` con USING(true) sobre profiles y gardener_profiles (nombre, teléfono, dirección,
-- coordenadas). Nunca se revocó. Esta migración cierra esa fuga de PII:
--   1) Directorio público de jardineros mediante una VISTA con solo columnas de vitrina
--      (sin phone/address/coordenadas), accesible a anon+authenticated para el funnel.
--   2) Revoca el SELECT anónimo a las tablas base y elimina las políticas USING(true).
--   3) Restringe la lectura autenticada a: dueño + admin + contraparte de una
--      reserva / solicitud (bookings, booking_requests+booking_responses).
-- El chat va atado a booking_id, por lo que su relación queda cubierta por `bookings`.

-- =============================================
-- 1) VISTA PÚBLICA DE VITRINA (sin datos sensibles)
-- =============================================
-- security_invoker = false (por defecto en PG15, explícito aquí): la vista se ejecuta con
-- los permisos del propietario y expone ÚNICAMENTE las columnas no sensibles de abajo, sin
-- dar a anon acceso a la tabla base. Es un directorio público de jardineros por diseño.
CREATE OR REPLACE VIEW public.public_gardener_directory
WITH (security_invoker = false) AS
SELECT
    user_id,
    full_name,
    avatar_url,
    rating,
    rating_average,
    rating_count,
    total_reviews,
    services,
    max_distance,
    description,
    is_available,
    has_phytosanitary_license
FROM public.gardener_profiles;

GRANT SELECT ON public.public_gardener_directory TO anon, authenticated;

-- =============================================
-- 1b) Helper SECURITY DEFINER para relación de contraparte
-- =============================================
-- Las policies de contraparte de profiles/gardener_profiles necesitan consultar bookings y
-- booking_requests. Si lo hicieran con EXISTS directo, aplicarían la RLS de esas tablas —
-- cuyas policies a su vez consultan profiles (chequeo de admin) — provocando RECURSIÓN
-- INFINITA de policies. Esta función SECURITY DEFINER se ejecuta con permisos del owner y
-- por tanto NO dispara la RLS de bookings/booking_requests, rompiendo el ciclo.
CREATE OR REPLACE FUNCTION public.shares_booking_with(target_user uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.bookings b
        WHERE (b.client_id = auth.uid() AND b.gardener_id = target_user)
           OR (b.gardener_id = auth.uid() AND b.client_id = target_user)
    ) OR EXISTS (
        SELECT 1
        FROM public.booking_requests br
        JOIN public.booking_responses bres ON bres.request_id = br.id
        WHERE (bres.gardener_id = auth.uid() AND br.client_id = target_user)
           OR (br.client_id = auth.uid() AND bres.gardener_id = target_user)
    );
$$;

GRANT EXECUTE ON FUNCTION public.shares_booking_with(uuid) TO authenticated;

-- =============================================
-- 2) PROFILES — cerrar lectura anónima y USING(true)
-- =============================================
DROP POLICY IF EXISTS "Allow anonymous users to view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow authenticated users to view profiles" ON public.profiles;

REVOKE SELECT ON public.profiles FROM anon;

-- Lectura autenticada de la ficha de una CONTRAPARTE (nombre, y tras reserva, teléfono
-- para coordinar). Cubre: cliente<->jardinero de una reserva, y jardinero<->cliente de
-- una solicitud a la que el jardinero ha respondido.
DROP POLICY IF EXISTS "Counterparty can read profile" ON public.profiles;
CREATE POLICY "Counterparty can read profile" ON public.profiles
    FOR SELECT
    TO authenticated
    USING (public.shares_booking_with(user_id));

-- Se conservan (ya existentes): "Users can read own profile" (dueño) y
-- "admin_all_profiles" (admin). Las de INSERT/UPDATE no se tocan.

-- =============================================
-- 3) GARDENER_PROFILES — cerrar lectura anónima y USING(true)
-- =============================================
DROP POLICY IF EXISTS "Allow anonymous users to view gardener profiles" ON public.gardener_profiles;
DROP POLICY IF EXISTS "Allow authenticated users to view gardener profiles" ON public.gardener_profiles;
DROP POLICY IF EXISTS "Anyone can read gardener profiles" ON public.gardener_profiles;
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.gardener_profiles;

REVOKE SELECT ON public.gardener_profiles FROM anon;

-- Lectura autenticada de la ficha completa del jardinero por su CONTRAPARTE cliente
-- (reserva o solicitud respondida). La vitrina pública va por la vista de arriba; el
-- dueño lee su propia ficha vía "Gardeners can manage own profile" (ALL) y el admin vía
-- "Admins can read all gardener profiles".
DROP POLICY IF EXISTS "Counterparty can read gardener profile" ON public.gardener_profiles;
CREATE POLICY "Counterparty can read gardener profile" ON public.gardener_profiles
    FOR SELECT
    TO authenticated
    USING (public.shares_booking_with(user_id));
