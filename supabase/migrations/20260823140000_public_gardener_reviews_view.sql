-- Fase 3: vista publica de reseñas, con el autor ya enmascarado.
--
-- POR QUE UNA VISTA Y NO LEER `reviews` + `profiles`: desde el paso 1, `profiles` esta cerrada a
-- `anon` (contiene nombre completo, telefono y direccion). Un visitante sin sesion puede leer las
-- reseñas pero NO puede resolver quien las escribio, asi que necesitariamos abrir `profiles` otra
-- vez -reabriendo la fuga de PII que cerramos- o denormalizar el nombre en cada reseña.
--
-- La vista resuelve las dos cosas: expone solo lo que se publica y enmascara el autor en el
-- servidor, de forma que el nombre completo del cliente NUNCA sale de la base de datos.
--
-- Decision del usuario (2026-08-23): autor como "Laura F.", igual que Google. Identifica lo justo
-- para dar credibilidad a la reseña sin exponer a quien abrio su casa a un profesional.
CREATE OR REPLACE VIEW public.public_gardener_reviews
WITH (security_invoker = false) AS
SELECT
  r.id,
  r.gardener_id,
  r.booking_id,
  r.rating,
  r.comment,
  r.created_at,
  r.gardener_response,
  r.gardener_response_at,
  r.is_system_penalty,
  r.system_reason,
  CASE
    -- Penalizacion automatica del paso 8C: la firma GarSer, nunca un cliente. Es honesto
    -- -nadie recibio ese servicio- y defendible si el profesional la reclama.
    WHEN r.is_system_penalty THEN 'GarSer'
    ELSE COALESCE(
      NULLIF(
        split_part(TRIM(p.full_name), ' ', 1) ||
        CASE
          WHEN NULLIF(split_part(TRIM(p.full_name), ' ', 2), '') IS NOT NULL
            THEN ' ' || upper(left(split_part(TRIM(p.full_name), ' ', 2), 1)) || '.'
          ELSE ''
        END,
        ''
      ),
      'Cliente de GarSer'
    )
  END AS author_display_name,
  -- El servicio contratado da contexto a la nota sin identificar la reserva.
  s.name AS service_name
FROM public.reviews r
LEFT JOIN public.profiles p ON p.user_id = r.client_id
LEFT JOIN public.bookings b ON b.id = r.booking_id
LEFT JOIN public.services  s ON s.id = b.service_id
WHERE r.hidden_at IS NULL;

COMMENT ON VIEW public.public_gardener_reviews IS
  'Resenas publicables de cada jardinero con el autor enmascarado ("Laura F."). Evita abrir profiles a anon.';

REVOKE ALL ON public.public_gardener_reviews FROM PUBLIC;
GRANT SELECT ON public.public_gardener_reviews TO anon, authenticated;
