-- Fase 6: la nota deja de ser escribible por el jardinero.
--
-- AGUJERO QUE CIERRA: `gardener_profiles` no tenia proteccion por columna, asi que el jardinero
-- -que legitimamente actualiza su propio perfil- podia escribir tambien `rating`,
-- `rating_average`, `rating_count` y `total_reviews`. Es decir: ponerse un 5,0.
--
-- No es teorico: `ProfileSettings` ya enviaba `rating: gardenerProfile?.rating || 5.0` en cada
-- guardado del perfil, de modo que un profesional sin resenas se autoasignaba un 5,0 con solo
-- pulsar "guardar".
--
-- La nota es un dato del SISTEMA: solo la calcula el trigger `sync_gardener_rating_aggregates`,
-- que es SECURITY DEFINER y por tanto no se ve afectado por estos permisos. Todo el trabajo de
-- las fases 1-3 -que nadie pueda inflar su reputacion- se cae si la nota se puede escribir a
-- mano por la API.
--
-- Mismo patron que el paso 2 con `bookings.total_price`: RLS decide sobre la FILA; para decidir
-- sobre la COLUMNA hacen falta grants por columna.

DO $$
DECLARE
  v_columns text;
BEGIN
  -- Se enumeran todas las columnas MENOS las de nota, en vez de listarlas a mano: asi una
  -- columna nueva en la tabla sigue siendo editable sin tener que acordarse de esta migracion.
  SELECT string_agg(quote_ident(column_name), ', ')
  INTO v_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'gardener_profiles'
    AND column_name NOT IN ('rating', 'rating_average', 'rating_count', 'total_reviews');

  EXECUTE 'REVOKE UPDATE ON public.gardener_profiles FROM authenticated';
  EXECUTE format('GRANT UPDATE (%s) ON public.gardener_profiles TO authenticated', v_columns);
END;
$$;

COMMENT ON COLUMN public.gardener_profiles.rating_average IS
  'Nota media. La calcula el trigger sync_gardener_rating_aggregates; `authenticated` NO tiene UPDATE sobre ella.';
COMMENT ON COLUMN public.gardener_profiles.rating_count IS
  'Numero de resenas visibles. Calculada por trigger; no escribible por el jardinero.';
COMMENT ON COLUMN public.gardener_profiles.rating IS
  'LEGACY, duplica rating_average. Se mantiene sincronizada por el trigger hasta retirar a sus ultimos lectores.';
COMMENT ON COLUMN public.gardener_profiles.total_reviews IS
  'LEGACY, duplica rating_count. Ver nota de `rating`.';
