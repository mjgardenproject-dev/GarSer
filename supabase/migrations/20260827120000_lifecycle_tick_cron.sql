-- Migration: el reloj deja de ser solo SQL y puede avisar al cliente
--
-- El cron del ciclo de vida (`run_booking_lifecycle_maintenance`) es SQL puro, y Postgres no
-- sabe mandar correos ni borrar de Storage. Por eso hasta ahora una reserva podia cerrarse
-- sola y cobrarse SIN que nadie escribiera al cliente: el aviso de valoracion solo salia por
-- el cierre manual, y las autofinalizadas ni siquiera borraban sus fotos.
--
-- Esta migracion añade el brazo que faltaba: el cron llama por HTTP a la edge function
-- `booking-lifecycle-tick`, que hace lo que no cabe en la base de datos.
--
-- ---------------------------------------------------------------------------------------
-- Por que ahora si se usa `pg_net`, si el equipo lo habia evitado a proposito
-- ---------------------------------------------------------------------------------------
-- La objecion registrada en `booking-complete/index.ts` era: "meter la clave de servicio en la
-- base de datos es peor negocio que este alcance parcial". La objecion es correcta, pero
-- apuntaba al secreto equivocado.
--
-- Aqui NO se guarda la clave de servicio. Se acuña un secreto DEDICADO
-- (`lifecycle_tick_secret`), valido unicamente para disparar el tick y para nada mas. Si se
-- filtrara, el radio de explosion es "alguien puede pulsar el timbre" —y pulsarlo de mas es
-- inocuo, porque el tick es idempotente por construccion— en vez de "alguien es dueño de la
-- base de datos". Ademas va cifrado en reposo en Vault, no en texto plano.
--
-- Y lo mas importante: la llamada HTTP es SOLO el timbre, nunca el registro. A quien hay que
-- escribirle vive en columnas de `bookings`. Si el POST se pierde, la fila sigue pendiente y
-- la pasada de dentro de 15 minutos la vuelve a coger. Ningun camino pierde un aviso por
-- perder una peticion.

CREATE EXTENSION IF NOT EXISTS pg_net;

-- Nadie debe poder lanzar peticiones HTTP arbitrarias desde la base de datos salvo el cron.
REVOKE ALL ON SCHEMA net FROM PUBLIC, anon, authenticated;

-- =============================================
-- Configuracion del tick
-- =============================================
-- La URL del proyecto y el secreto se leen de Vault si esta disponible, y si no de la
-- configuracion de la base. Se resuelve en tiempo de ejecucion y no se hornea en la
-- migracion: la URL cambia entre local y produccion, y el secreto no debe viajar en git.
CREATE OR REPLACE FUNCTION public.lifecycle_tick_setting(p_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_value text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_value
    FROM vault.decrypted_secrets WHERE name = p_name LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_value := NULL;  -- Vault no disponible en este entorno
  END;

  IF v_value IS NULL OR btrim(v_value) = '' THEN
    v_value := current_setting('app.' || p_name, true);
  END IF;

  RETURN NULLIF(btrim(COALESCE(v_value, '')), '');
END;
$$;

REVOKE ALL ON FUNCTION public.lifecycle_tick_setting(text) FROM PUBLIC, anon, authenticated;

-- =============================================
-- El mantenimiento pasa a llamar al tick
-- =============================================
CREATE OR REPLACE FUNCTION public.run_booking_lifecycle_maintenance()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url text;
  v_secret text;
  v_request_id bigint;
  v_deleted integer := 0;
BEGIN
  -- Housekeeping que sigue siendo puramente SQL.
  DELETE FROM public.booking_confirmation_tokens
  WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  v_url := public.lifecycle_tick_setting('lifecycle_tick_url');
  v_secret := public.lifecycle_tick_setting('lifecycle_tick_secret');

  -- Sin configurar, el reloj sigue haciendo lo de siempre en SQL y lo deja anotado. Preferible
  -- a fallar: caducar solicitudes y cerrar reservas no puede depender de que haya correo.
  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN jsonb_build_object(
      'mode', 'sql_only',
      'reason', 'faltan lifecycle_tick_url o lifecycle_tick_secret en Vault',
      'expired_requests', public.expire_due_booking_requests(),
      'auto_completed_bookings', public.auto_complete_due_bookings(),
      'purged_tokens', v_deleted,
      'ran_at', now()
    );
  END IF;

  -- Una sola peticion por pasada, no una por correo. `pg_net` es asincrono: devuelve el id y
  -- no bloquea la transaccion del cron.
  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-lifecycle-secret', v_secret
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 20000
  ) INTO v_request_id;

  RETURN jsonb_build_object(
    'mode', 'tick',
    'request_id', v_request_id,
    'purged_tokens', v_deleted,
    'ran_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_booking_lifecycle_maintenance() FROM PUBLIC, anon, authenticated;

-- El cron sigue siendo el mismo job cada 15 minutos: solo cambia lo que hace por dentro.
DO $$
BEGIN
  PERFORM cron.unschedule('booking-lifecycle-maintenance');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'booking-lifecycle-maintenance',
    '*/15 * * * *',
    $cron$SELECT public.run_booking_lifecycle_maintenance();$cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron no disponible: programa run_booking_lifecycle_maintenance() externamente';
END $$;
