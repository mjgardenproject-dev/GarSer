-- ==============================================================================
-- Migración Arquitectónica: Acceso Total de Administradores mediante RLS
-- ==============================================================================
-- PROBLEMA EVITADO: 
-- Consultar la tabla `profiles` directamente dentro de las políticas de RLS 
-- causa recursión infinita en la tabla `profiles` y problemas graves de rendimiento 
-- (N+1 queries ocultos) en las demás tablas.
--
-- SOLUCIÓN ARQUITECTÓNICA:
-- 1. Crear una función `is_admin()` como SECURITY DEFINER.
--    Esto permite consultar `profiles` con privilegios de sistema sin desencadenar 
--    las políticas RLS nuevamente, rompiendo el bucle de recursión.
-- 2. Marcar la función como STABLE para que PostgreSQL cachee el resultado 
--    dentro de la misma consulta, reduciendo el coste de procesamiento.
-- 3. Aplicar políticas `FOR ALL` a las tablas solicitadas usando esta función.
-- ==============================================================================

-- 1. Crear función optimizada y segura para verificación de rol
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles
    WHERE user_id = auth.uid()
    AND role = 'admin'
  );
$$;

-- 2. Asegurar que RLS esté habilitado en todas las tablas objetivo
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

-- 3. Crear políticas de acceso total (ALL) para el rol admin
-- Se utiliza "OR REPLACE" o bloque anónimo si fuera necesario, 
-- pero dado que es una migración nueva, la creación directa es válida.
-- Si hay riesgo de que la política ya exista, podemos hacer un DROP IF EXISTS primero.

DROP POLICY IF EXISTS "admin_all_profiles" ON public.profiles;
CREATE POLICY "admin_all_profiles" 
  ON public.profiles FOR ALL TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_all_booking_requests" ON public.booking_requests;
CREATE POLICY "admin_all_booking_requests" 
  ON public.booking_requests FOR ALL TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_all_booking_responses" ON public.booking_responses;
CREATE POLICY "admin_all_booking_responses" 
  ON public.booking_responses FOR ALL TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_all_booking_blocks" ON public.booking_blocks;
CREATE POLICY "admin_all_booking_blocks" 
  ON public.booking_blocks FOR ALL TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_all_services" ON public.services;
CREATE POLICY "admin_all_services" 
  ON public.services FOR ALL TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_all_availability_blocks" ON public.availability_blocks;
CREATE POLICY "admin_all_availability_blocks" 
  ON public.availability_blocks FOR ALL TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_all_role_logs" ON public.role_logs;
CREATE POLICY "admin_all_role_logs" 
  ON public.role_logs FOR ALL TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_all_reviews" ON public.reviews;
CREATE POLICY "admin_all_reviews" 
  ON public.reviews FOR ALL TO authenticated USING (public.is_admin());
