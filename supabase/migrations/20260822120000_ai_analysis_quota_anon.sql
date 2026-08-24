-- Cuota del análisis con IA para usuarios ANÓNIMOS (además de los identificados).
--
-- INCIDENCIA QUE CORRIGE (2026-08-22): la cuota del paso 9 se implementó exigiendo un usuario
-- identificado, dando por supuesto que analizar ya requería sesión. Es FALSO: la migración
-- 20260205000000_allow_anon_uploads.sql habilita a propósito las subidas anónimas porque el
-- funnel de reserva sin registro es una capacidad deliberada del producto. Resultado: quien no
-- había iniciado sesión no podía analizar su jardín. Aquí se sustituye "exigir usuario" por
-- "identificar al solicitante de la mejor forma disponible y limitarlo".
--
-- ENCAPSULADO A PROPÓSITO: se crea una tabla y una función NUEVAS en vez de modificar
-- `ai_pricing_rate_limits` / `consume_ai_pricing_quota`. Así la versión de la edge function que
-- está ahora mismo en producción sigue funcionando mientras se despliega la nueva, sin una
-- ventana en la que el análisis quede caído. Los objetos antiguos quedan sin uso y se pueden
-- retirar en una limpieza posterior; borrarlos ahora sería justo el riesgo que se quiere evitar.

CREATE TABLE IF NOT EXISTS public.ai_analysis_rate_limits (
  -- 'user:<uuid>' para identificados, 'ip:<sha256>' para anónimos. Texto y no uuid porque el
  -- sujeto ya no es siempre un usuario.
  subject           text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count     integer     NOT NULL DEFAULT 0,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_analysis_rate_limits IS
  'Cuota del analisis IA por sujeto (usuario identificado o IP anonima). Estado operativo: no es telemetria y no se limpia con los logs.';

CREATE INDEX IF NOT EXISTS idx_ai_analysis_rate_limits_window
  ON public.ai_analysis_rate_limits (window_started_at);

ALTER TABLE public.ai_analysis_rate_limits ENABLE ROW LEVEL SECURITY;

-- Sin políticas para anon/authenticated: que el sujeto del límite pueda tocarlo lo vuelve decorativo.
REVOKE ALL ON TABLE public.ai_analysis_rate_limits FROM anon, authenticated;
GRANT ALL ON TABLE public.ai_analysis_rate_limits TO service_role;

-- ---------------------------------------------------------------------------
-- Consumo atómico: incrementa y decide en una sola sentencia.
-- Leer y luego escribir deja una ventana entre ambas y, con peticiones en paralelo —justo lo
-- que hace un abusador—, el contador se pisa y el límite se escapa.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_ai_analysis_quota(
  p_subject      text,
  p_max_requests integer  DEFAULT 30,
  p_window       interval DEFAULT interval '1 hour'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_row public.ai_analysis_rate_limits;
BEGIN
  IF p_subject IS NULL OR length(btrim(p_subject)) = 0 THEN
    RAISE EXCEPTION 'consume_ai_analysis_quota requiere un sujeto';
  END IF;

  INSERT INTO public.ai_analysis_rate_limits AS r (subject, window_started_at, request_count, updated_at)
  VALUES (btrim(p_subject), v_now, 1, v_now)
  ON CONFLICT (subject) DO UPDATE
    SET request_count = CASE
          WHEN r.window_started_at <= v_now - p_window THEN 1
          ELSE r.request_count + 1
        END,
        window_started_at = CASE
          WHEN r.window_started_at <= v_now - p_window THEN v_now
          ELSE r.window_started_at
        END,
        updated_at = v_now
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'allowed',  v_row.request_count <= p_max_requests,
    'used',     v_row.request_count,
    'limit',    p_max_requests,
    'reset_at', v_row.window_started_at + p_window
  );
END;
$$;

COMMENT ON FUNCTION public.consume_ai_analysis_quota(text, integer, interval) IS
  'Incrementa y evalua de forma atomica la cuota de analisis IA de un sujeto. Solo service_role.';

-- Solo la llama la edge function con la clave de servicio: si `authenticated` pudiera
-- ejecutarla, cualquiera podria quemar la cuota de otro pasando su sujeto.
REVOKE ALL ON FUNCTION public.consume_ai_analysis_quota(text, integer, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_analysis_quota(text, integer, interval) TO service_role;

-- ---------------------------------------------------------------------------
-- Limpieza: las filas de IP se acumularían sin fin. Se purga lo que ya no limita nada.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_stale_ai_analysis_quota()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.ai_analysis_rate_limits
  WHERE window_started_at < now() - interval '2 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_stale_ai_analysis_quota() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_stale_ai_analysis_quota() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('purge-stale-ai-analysis-quota')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-stale-ai-analysis-quota');
    PERFORM cron.schedule(
      'purge-stale-ai-analysis-quota',
      '30 3 * * *',
      $cron$SELECT public.purge_stale_ai_analysis_quota();$cron$
    );
  END IF;
END;
$$;
