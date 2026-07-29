-- Migration: mantener sincronizados los agregados de valoraciones del jardinero
--
-- PROBLEMA (auditoría, CRÍTICO): las reseñas nunca llegaban a la pantalla donde el cliente
-- elige jardinero. El cliente escribía en `gardener_profiles.rating` / `total_reviews`,
-- pero ProvidersPage lee `rating_average` / `rating_count` — columnas distintas creadas con
-- DEFAULT 0 que nadie actualizaba jamás. Resultado: por muchas reseñas 5★ que recibiera un
-- jardinero, en el escaparate salía "Nuevo" para siempre (prueba social rota justo en el
-- punto de conversión).
--
-- Ademas, esa actualización desde el cliente NUNCA pudo funcionar: RLS solo permite al
-- propio jardinero modificar su perfil (`auth.uid() = user_id`), así que un cliente
-- escribiendo en el perfil de OTRO usuario era denegado siempre.
--
-- SOLUCIÓN: agregar server-side con un trigger SECURITY DEFINER sobre `reviews`, única
-- fuente de verdad. Mantiene los CUATRO campos coherentes (los dos que lee ProvidersPage y
-- los dos que lee el perfil público) para no volver a dejar lecturas huérfanas.

CREATE OR REPLACE FUNCTION public.sync_gardener_rating_aggregates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gardener uuid := COALESCE(NEW.gardener_id, OLD.gardener_id);
  v_count integer;
  v_avg numeric(3,2);
BEGIN
  IF v_gardener IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COUNT(*), ROUND(AVG(rating)::numeric, 2)
  INTO v_count, v_avg
  FROM public.reviews
  WHERE gardener_id = v_gardener;

  UPDATE public.gardener_profiles
  SET
    -- Leídas por ProvidersPage (elección de jardinero)
    rating_average = COALESCE(v_avg, 0),
    rating_count   = COALESCE(v_count, 0),
    -- Leídas por el perfil público; NULL sin reseñas para no fingir un 5.0
    rating         = v_avg,
    total_reviews  = COALESCE(v_count, 0)
  WHERE user_id = v_gardener;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_gardener_rating_aggregates ON public.reviews;
CREATE TRIGGER trg_sync_gardener_rating_aggregates
  AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_gardener_rating_aggregates();

-- Backfill: recalcula los agregados de todos los jardineros con reseñas ya existentes
-- (hasta ahora ninguna se reflejaba en el escaparate).
UPDATE public.gardener_profiles gp
SET
  rating_average = COALESCE(agg.avg_rating, 0),
  rating_count   = COALESCE(agg.total, 0),
  rating         = agg.avg_rating,
  total_reviews  = COALESCE(agg.total, 0)
FROM (
  SELECT gardener_id, COUNT(*) AS total, ROUND(AVG(rating)::numeric, 2) AS avg_rating
  FROM public.reviews
  GROUP BY gardener_id
) AS agg
WHERE gp.user_id = agg.gardener_id;
