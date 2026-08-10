-- Migration: garantizar los privilegios de `service_role` sobre el esquema public
--
-- PROBLEMA (detectado en el entorno local, 2026-08-06): solo 7 de 35 tablas de `public`
-- tenían SELECT para `service_role`. Las tablas creadas por nuestras migraciones no reciben
-- ese privilegio automáticamente: en Supabase Cloud la plataforma lo concede por su cuenta,
-- pero en un stack local reconstruido con `db reset` no ocurre.
--
-- Efecto: TODA edge function que usa la clave de servicio (booking-authority, booking-payment,
-- booking-complete, los emails…) recibía "permission denied" y fallaba. En el funnel se
-- traducía en `inactive_service`: ningún jardinero aparecía nunca, aunque estuviera bien
-- configurado. Era indistinguible de un bug de la aplicación.
--
-- `service_role` es el rol de confianza del backend (BYPASSRLS por diseño); esto solo
-- restituye lo que se le presupone. En producción es idempotente: ya los tiene.

-- 1) Tablas, secuencias y funciones existentes
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- 2) Y las que se creen a partir de ahora, para no repetir este agujero con cada tabla nueva.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;

-- Nota: esto NO afecta a las restricciones de `anon` / `authenticated` introducidas en los
-- pasos 1 y 2 (fuga de PII y blindaje de `bookings`). Aquellas siguen intactas: aquí solo se
-- toca el rol de servicio, que nunca atraviesa el navegador.
