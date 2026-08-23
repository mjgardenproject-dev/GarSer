-- Fase 1 del plan de reseñas: cimientos de datos.
--
-- Solo esquema, politicas y RPC nuevas. NINGUN comportamiento actual cambia: el modal que hoy
-- escribe reseñas desde BookingsList sigue funcionando igual. El front se moverá a las RPC en
-- la Fase 3, cuando haya pantallas que las usen.
--
-- Cierra dos agujeros que NO estaban en la peticion y que se encontraron al revisar el esquema:
--
--  F6  Un cliente podia reseñar la MISMA reserva tantas veces como quisiera: el indice unico de
--      `booking_id` solo cubre `is_system_penalty = true`. Todas contaban para la media, asi que
--      la nota de un jardinero era inflable desde la API.
--
--  F5  Un visitante SIN sesion no podia leer reseñas (`TO authenticated`), y el funnel anonimo
--      es una capacidad deliberada del producto.
--
--  +   Y uno mas, visto al leer la policy de alta: `WITH CHECK (auth.uid() = client_id)` no
--      valida NADA sobre la reserva. Cualquiera podia insertar una reseña con un `booking_id` y
--      un `gardener_id` arbitrarios y puntuar a un jardinero al que nunca contrato.

-- =============================================
-- 1) Columnas nuevas
-- =============================================
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS gardener_response    text,
  ADD COLUMN IF NOT EXISTS gardener_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_at            timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_reason        text,
  ADD COLUMN IF NOT EXISTS updated_at           timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.reviews.gardener_response IS 'Respuesta publica del jardinero resenado. Se escribe SOLO via respond_to_review().';
COMMENT ON COLUMN public.reviews.hidden_at IS 'Moderacion: la resena deja de mostrarse y de contar para la media, pero no se borra (traza).';

-- Topes de longitud: es texto libre publico.
ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_comment_length;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_comment_length
  CHECK (comment IS NULL OR length(comment) <= 1000);

ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_response_length;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_response_length
  CHECK (gardener_response IS NULL OR length(gardener_response) <= 1000);

-- =============================================
-- 2) F6 — una sola resena de cliente por reserva
-- =============================================
-- Se limpia cualquier duplicado preexistente antes de crear el indice: si en produccion ya hay
-- reservas con varias resenas, el indice fallaria y tumbaria el despliegue. Se conserva la mas
-- reciente, que es la que refleja la opinion final del cliente.
DELETE FROM public.reviews r
USING public.reviews mas_nueva
WHERE r.is_system_penalty = false
  AND mas_nueva.is_system_penalty = false
  AND r.booking_id = mas_nueva.booking_id
  AND r.booking_id IS NOT NULL
  AND (r.created_at, r.id) < (mas_nueva.created_at, mas_nueva.id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_one_client_review_per_booking
  ON public.reviews (booking_id)
  WHERE is_system_penalty = false;

-- =============================================
-- 3) Lectura: tambien sin sesion, y sin las ocultas
-- =============================================
DROP POLICY IF EXISTS "Anyone can read reviews" ON public.reviews;
DROP POLICY IF EXISTS "reviews_public_read" ON public.reviews;

CREATE POLICY "reviews_public_read" ON public.reviews
  FOR SELECT TO anon, authenticated
  USING (hidden_at IS NULL);

-- La vista publica de jardineros ya se expone a `anon` (paso 1); las resenas la acompanan.
GRANT SELECT ON public.reviews TO anon;

-- =============================================
-- 4) Alta: solo sobre una reserva propia y COMPLETADA
-- =============================================
DROP POLICY IF EXISTS "Clients can create reviews" ON public.reviews;
DROP POLICY IF EXISTS "reviews_client_insert" ON public.reviews;

CREATE POLICY "reviews_client_insert" ON public.reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    is_system_penalty = false
    AND auth.uid() = client_id
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = reviews.booking_id
        AND b.client_id = auth.uid()
        AND b.gardener_id = reviews.gardener_id
        AND b.status = 'completed'
    )
  );

-- =============================================
-- 5) Respuesta del jardinero — via RPC, nunca por UPDATE directo
-- =============================================
-- Deliberadamente NO se abre una policy de UPDATE al jardinero: RLS decide sobre la FILA, no
-- sobre la columna, asi que un jardinero con permiso de UPDATE sobre las resenas dirigidas a el
-- podria cambiarse la propia nota. La RPC escribe solo la respuesta.
CREATE OR REPLACE FUNCTION public.respond_to_review(
  p_review_id uuid,
  p_response  text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_review public.reviews;
  v_text   text := NULLIF(btrim(p_response), '');
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Se requiere sesion' USING ERRCODE = '28000';
  END IF;
  IF v_text IS NOT NULL AND length(v_text) > 1000 THEN
    RAISE EXCEPTION 'La respuesta no puede superar los 1000 caracteres' USING ERRCODE = '22001';
  END IF;

  SELECT * INTO v_review FROM public.reviews WHERE id = p_review_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resena no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_review.gardener_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'Solo el profesional resenado puede responder' USING ERRCODE = '42501';
  END IF;

  -- Ventana de edicion de 48 h desde la primera respuesta: permite corregir un arrebato sin
  -- que la respuesta publica sea mutable para siempre.
  IF v_review.gardener_response_at IS NOT NULL
     AND v_review.gardener_response_at < now() - interval '48 hours' THEN
    RAISE EXCEPTION 'La respuesta ya no se puede modificar' USING ERRCODE = '42501';
  END IF;

  UPDATE public.reviews
  SET gardener_response    = v_text,
      gardener_response_at = COALESCE(gardener_response_at, now()),
      updated_at           = now()
  WHERE id = p_review_id
  RETURNING * INTO v_review;

  RETURN jsonb_build_object(
    'id', v_review.id,
    'gardener_response', v_review.gardener_response,
    'gardener_response_at', v_review.gardener_response_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.respond_to_review(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_review(uuid, text) TO authenticated, service_role;

-- =============================================
-- 6) Edicion de la resena por el cliente (48 h) — tambien via RPC
-- =============================================
CREATE OR REPLACE FUNCTION public.update_own_review(
  p_review_id uuid,
  p_rating    numeric,
  p_comment   text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_review public.reviews;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Se requiere sesion' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_review FROM public.reviews WHERE id = p_review_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resena no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_review.client_id IS DISTINCT FROM v_caller OR v_review.is_system_penalty THEN
    RAISE EXCEPTION 'Solo puedes editar tu propia resena' USING ERRCODE = '42501';
  END IF;
  IF v_review.created_at < now() - interval '48 hours' THEN
    RAISE EXCEPTION 'El plazo para editar la resena ha terminado' USING ERRCODE = '42501';
  END IF;

  UPDATE public.reviews
  SET rating     = p_rating,
      comment    = NULLIF(btrim(p_comment), ''),
      updated_at = now()
  WHERE id = p_review_id
  RETURNING * INTO v_review;

  RETURN jsonb_build_object('id', v_review.id, 'rating', v_review.rating, 'comment', v_review.comment);
END;
$$;

REVOKE ALL ON FUNCTION public.update_own_review(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_own_review(uuid, numeric, text) TO authenticated, service_role;

-- =============================================
-- 7) Moderacion: ocultar sin borrar
-- =============================================
CREATE OR REPLACE FUNCTION public.set_review_hidden(
  p_review_id uuid,
  p_hidden    boolean,
  p_reason    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_review public.reviews;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede moderar resenas' USING ERRCODE = '42501';
  END IF;

  UPDATE public.reviews
  SET hidden_at     = CASE WHEN p_hidden THEN COALESCE(hidden_at, now()) ELSE NULL END,
      hidden_reason = CASE WHEN p_hidden THEN NULLIF(btrim(p_reason), '') ELSE NULL END,
      updated_at    = now()
  WHERE id = p_review_id
  RETURNING * INTO v_review;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resena no encontrada' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('id', v_review.id, 'hidden_at', v_review.hidden_at);
END;
$$;

-- Se concede a `authenticated` y NO solo a service_role: quien modera es el admin desde el
-- navegador, y ahi `is_admin()` -que es la puerta real, dentro del cuerpo- si resuelve. Con
-- service_role no hay `auth.uid()`, asi que la comprobacion daria falso y nadie podria moderar.
REVOKE ALL ON FUNCTION public.set_review_hidden(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_review_hidden(uuid, boolean, text) TO authenticated, service_role;

-- =============================================
-- 8) Los agregados ignoran las resenas ocultas
-- =============================================
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

  -- `hidden_at IS NULL`: una resena moderada deja de contar para la nota. Sin esto, ocultarla
  -- la quitaria de la vista pero seguiria pesando en la media, que es justo lo que se modera.
  SELECT COUNT(*), ROUND(AVG(rating)::numeric, 2)
  INTO v_count, v_avg
  FROM public.reviews
  WHERE gardener_id = v_gardener
    AND hidden_at IS NULL;

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

-- El trigger ya existe sobre INSERT/UPDATE/DELETE: al reemplazar la funcion, recoge el cambio.
