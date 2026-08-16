-- Paso 9 — Límite de uso por usuario del análisis con IA.
--
-- PROBLEMA: `ai-pricing-estimator` llama a Gemini sin ningún límite. Cada llamada cuesta
-- dinero real y la paga GarSer. Con la clave pública en el bundle, un tercero podía dejar un
-- bucle corriendo toda la noche: no roba datos, pero vacía el presupuesto de IA y, de paso,
-- agota la cuota del proyecto, con lo que los clientes de verdad dejan de poder analizar sus
-- fotos. Coste ilimitado y denegación de servicio con la misma llave.
--
-- POR QUÉ UNA TABLA PROPIA Y NO `ai_analysis_logs`: contar filas de un log parece más barato,
-- pero el cron de limpieza de logs borraría el historial y con él el límite. Un contador de
-- cuota es estado operativo, no telemetría: si se puede borrar por otro motivo, no es un límite.
--
-- POR QUÉ UNA RPC Y NO UN SELECT + UPDATE DESDE LA FUNCIÓN: leer y luego escribir deja una
-- ventana entre ambas; con peticiones en paralelo (justo lo que hace un abusador) el contador
-- se pisa y el límite se escapa. Aquí el incremento y la decisión ocurren en una sola sentencia
-- atómica.

CREATE TABLE IF NOT EXISTS public.ai_pricing_rate_limits (
  user_id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count     integer     NOT NULL DEFAULT 0,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_pricing_rate_limits IS
  'Cuota por usuario del analisis con IA (ventana fija). Estado operativo: no es telemetria y no se limpia con los logs.';

ALTER TABLE public.ai_pricing_rate_limits ENABLE ROW LEVEL SECURITY;

-- Sin políticas para anon/authenticated: nadie lee ni escribe su propio contador. Que el
-- sujeto del límite pueda tocarlo lo convierte en decorativo.
REVOKE ALL ON TABLE public.ai_pricing_rate_limits FROM anon, authenticated;
GRANT ALL ON TABLE public.ai_pricing_rate_limits TO service_role;

-- ---------------------------------------------------------------------------
-- Consumo atómico de cuota: incrementa y decide en una sola sentencia.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_ai_pricing_quota(
  p_user_id      uuid,
  p_max_requests integer  DEFAULT 30,
  p_window       interval DEFAULT interval '1 hour'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_row public.ai_pricing_rate_limits;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'consume_ai_pricing_quota requiere un user_id';
  END IF;

  INSERT INTO public.ai_pricing_rate_limits AS r (user_id, window_started_at, request_count, updated_at)
  VALUES (p_user_id, v_now, 1, v_now)
  ON CONFLICT (user_id) DO UPDATE
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

COMMENT ON FUNCTION public.consume_ai_pricing_quota(uuid, integer, interval) IS
  'Incrementa y evalua la cuota de IA de un usuario de forma atomica. Solo service_role.';

-- Solo la llama la edge function con la clave de servicio. Si `authenticated` pudiera
-- ejecutarla, cualquiera podria quemar la cuota de otro usuario pasando su id.
REVOKE ALL ON FUNCTION public.consume_ai_pricing_quota(uuid, integer, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_pricing_quota(uuid, integer, interval) TO service_role;
