-- Migration: restituir los privilegios base del esquema public y reafirmar las restricciones
--
-- PROBLEMA (detectado en local, 2026-08-06): las tablas creadas por nuestras migraciones no
-- reciben los GRANT del modelo de Supabase. Solo 7 de 35 tablas los tenían para
-- `service_role` y 6 de 35 para `authenticated`. En Supabase Cloud la plataforma los concede
-- por su cuenta; en un stack local reconstruido con `db reset`, no.
--
-- Efecto: toda edge function con clave de servicio recibía "permission denied" (en el funnel
-- se traducía en `inactive_service`: ningún jardinero aparecía nunca), y un jardinero no
-- podía ni leer sus propias tarifas en su panel de configuración.
--
-- Supabase funciona con GRANT amplios + RLS como capa real de control. Esta migración
-- restituye ese modelo y, a continuación, **vuelve a aplicar una por una las revocaciones
-- deliberadas** de los pasos de endurecimiento: sin eso, un GRANT general reabriría la fuga
-- de PII del paso 1 y el agujero de escritura de `bookings` del paso 2.
--
-- Es idempotente y segura de ejecutar en producción, donde el estado ya es este.

-- =============================================
-- 1) Privilegios base del modelo Supabase
-- =============================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;

-- Y para las tablas que se creen a partir de ahora, para no repetir el agujero.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;

-- =============================================
-- 2) Reafirmar las restricciones deliberadas
-- =============================================
-- El orden importa: esto va DESPUÉS de los GRANT de arriba para que gane la restricción.

-- Paso 1 — fuga de PII: `anon` no puede leer datos personales. El funnel público usa la
-- vista `public_gardener_directory`, que no expone teléfono ni dirección.
REVOKE SELECT ON public.profiles FROM anon;
REVOKE SELECT ON public.gardener_profiles FROM anon;

-- Paso 2 — `bookings`: solo los RPC SECURITY DEFINER crean reservas, y por escritura directa
-- únicamente se puede tocar `status` (el precio queda congelado).
REVOKE INSERT, UPDATE ON public.bookings FROM authenticated;
GRANT UPDATE (status) ON public.bookings TO authenticated;
REVOKE INSERT, SELECT ON public.bookings FROM anon;

-- Endurecimiento previo (20260518170000): tablas internas del motor de pagos y telemetría,
-- accesibles solo por service_role.
REVOKE ALL ON TABLE public.booking_quotes FROM anon, authenticated;
REVOKE ALL ON TABLE public.booking_funnel_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.booking_payment_attempts FROM anon, authenticated;
REVOKE ALL ON TABLE public.booking_schedule_holds FROM anon, authenticated;
REVOKE ALL ON TABLE public.booking_schedule_hold_blocks FROM anon, authenticated;
REVOKE ALL ON TABLE public.booking_batch_rpc_idempotency FROM anon, authenticated;
REVOKE ALL ON TABLE public.stripe_webhook_events FROM anon, authenticated;

-- Nota: la protección real de todo lo demás la siguen dando las políticas RLS de cada tabla,
-- que esta migración no toca.
