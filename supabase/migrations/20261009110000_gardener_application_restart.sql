-- Pendientes · fase B (2026-10-09): un jardinero rechazado puede corregir y volver a enviar (PH-02).
--
-- Antes «Corregir y volver a enviar» (GardenerStatusPage) hacía desde el navegador un UPDATE a
-- 'draft' y un DELETE. La regla `applications_own_update` solo deja tocar borradores y no hay regla
-- de borrado: las dos respondían 200 con 0 filas, la solicitud seguía rechazada y el jardinero
-- quedaba bloqueado para siempre (tampoco puede crear otra: UNIQUE (user_id)).
--
-- Decisión del usuario (2026-09-29): al momento, corrigiendo, con el rechazo en un histórico.
--   1. `gardener_application_reviews`: cada rechazo (motivo, quién y cuándo). Lo ven el admin y el
--      propio solicitante (para saber qué corregir).
--   2. `restart_gardener_application()`: sobre la PROPIA solicitud y solo si está rechazada, guarda
--      el rechazo en el histórico y la reabre como borrador con todos sus datos (hay que volver a
--      aceptar las declaraciones). En una transacción.
--   3. De paso (fase B, paso 3): el solicitante podía escribir los campos de la revisión
--      (`reviewer_id`, `reviewed_at`, `review_comment`) al guardar o enviar su borrador. Ahora solo
--      los cambia el servidor (`admin_review_gardener_application`, la función de arriba).
--
-- Vuelta atrás: DROP de la función, del trigger `trg_guard_gardener_application_review` y de la
-- tabla. Nada de lo anterior cambia.

-- =============================================
-- 1) Histórico de revisiones
-- =============================================
CREATE TABLE IF NOT EXISTS public.gardener_application_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.gardener_applications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('rejected')),
  review_comment text,
  reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gardener_application_reviews_application_idx
  ON public.gardener_application_reviews (application_id, reviewed_at DESC);
COMMENT ON TABLE public.gardener_application_reviews IS
  'Rechazos anteriores de una solicitud de jardinero que se volvió a abrir (PH-02). Solo la escribe '
  'restart_gardener_application.';

ALTER TABLE public.gardener_application_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gardener_application_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gardener_application_reviews TO authenticated;
GRANT ALL ON public.gardener_application_reviews TO service_role;
DROP POLICY IF EXISTS gardener_application_reviews_own_select ON public.gardener_application_reviews;
CREATE POLICY gardener_application_reviews_own_select ON public.gardener_application_reviews
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());

-- =============================================
-- 2) Volver a abrir la solicitud rechazada
-- =============================================
CREATE OR REPLACE FUNCTION public.restart_gardener_application()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.gardener_applications%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Inicia sesión para continuar.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_app FROM public.gardener_applications WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No tienes ninguna solicitud.' USING ERRCODE = '22023';
  END IF;
  IF v_app.status = 'draft' THEN
    -- Ya reabierta (doble clic u otra pestaña): no se duplica el histórico.
    RETURN jsonb_build_object('applicationId', v_app.id, 'status', 'draft');
  END IF;
  IF v_app.status <> 'rejected' THEN
    RAISE EXCEPTION 'Solo se puede corregir una solicitud rechazada.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.gardener_application_reviews (application_id, user_id, status, review_comment, reviewer_id, reviewed_at, submitted_at)
  VALUES (v_app.id, v_app.user_id, 'rejected', v_app.review_comment, v_app.reviewer_id, v_app.reviewed_at, v_app.submitted_at);

  UPDATE public.gardener_applications
  SET status = 'draft',
      reviewer_id = NULL,
      reviewed_at = NULL,
      review_comment = NULL,
      -- Lo que declara es sobre los datos corregidos: se vuelve a aceptar al enviar.
      declaration_truth = false,
      accept_terms = false,
      updated_at = now()
  WHERE id = v_app.id;

  RETURN jsonb_build_object('applicationId', v_app.id, 'status', 'draft');
END;
$$;
REVOKE ALL ON FUNCTION public.restart_gardener_application() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restart_gardener_application() TO authenticated;

-- =============================================
-- 3) Los campos de la revisión solo los cambia el servidor
-- =============================================
-- SECURITY INVOKER a propósito: `current_user` es quien ejecuta la sentencia. Desde el navegador
-- (PostgREST) es `authenticated`; dentro de las funciones SECURITY DEFINER es su dueño, y pasan.
CREATE OR REPLACE FUNCTION private.guard_gardener_application_review()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') OR public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.reviewer_id := NULL;
    NEW.reviewed_at := NULL;
    NEW.review_comment := NULL;
  ELSE
    NEW.reviewer_id := OLD.reviewer_id;
    NEW.reviewed_at := OLD.reviewed_at;
    NEW.review_comment := OLD.review_comment;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_gardener_application_review ON public.gardener_applications;
CREATE TRIGGER trg_guard_gardener_application_review
  BEFORE INSERT OR UPDATE ON public.gardener_applications
  FOR EACH ROW EXECUTE FUNCTION private.guard_gardener_application_review();
