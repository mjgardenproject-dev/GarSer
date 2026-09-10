-- F3 — Red de seguridad para la captura/liberación diferida del pago.
--
-- La captura de la comisión al aceptar (y la liberación al rechazar/cancelar) la disparaba
-- SÓLO el navegador tras `respond_booking_request` / `respond_booking_price_change`. Si esa
-- llamada fallaba y nadie la reintentaba, la reserva quedaba `confirmed` con el PaymentIntent
-- en `requires_capture`: GarSer no cobraba nunca esa comisión y la autorización se perdía a
-- los 7 días. El front ya reintenta (F3, lado cliente); esto es el respaldo del servidor.
--
-- Estas dos RPC las usa el reloj `booking-lifecycle-tick` (job 4):
--   · `list_bookings_pending_payment_reconciliation` devuelve las reservas cuyo pago quizá
--     quedó a medias (el tick comprueba el estado REAL en Stripe y actúa).
--   · `mark_booking_payment_settled` deja una marca en el intento para no volver a mirarlo.
--
-- Alcance deliberadamente conservador:
--   · 'capture'  → sólo reservas `confirmed`.
--   · 'release'  → sólo reservas `cancelled`/`rejected`/`expired`, y el tick SÓLO libera una
--     autorización pendiente; NUNCA reembolsa un cargo ya capturado (eso sería revertir la
--     política de las 24 h, donde una cancelación tardía del cliente conserva la tarifa).
--   · Ventana: entre 20 min (dar margen al navegador) y 7 días (después la autorización ya
--     ha caducado en Stripe y no hay nada que hacer).

CREATE OR REPLACE FUNCTION public.list_bookings_pending_payment_reconciliation(
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  booking_id uuid,
  attempt_id uuid,
  booking_status text,
  payment_intent_id text,
  desired_action text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id,
    a.id,
    b.status::text,
    a.stripe_payment_intent_id,
    CASE
      WHEN b.status = 'confirmed' THEN 'capture'
      ELSE 'release'
    END AS desired_action
  FROM public.bookings b
  JOIN public.booking_payment_attempts a
    ON a.booking_id = b.id
  WHERE a.stripe_payment_intent_id IS NOT NULL
    AND COALESCE(a.gateway_response ->> 'settlement', '') = ''
    AND b.status IN ('confirmed', 'cancelled', 'rejected', 'expired')
    AND b.updated_at <  now() - interval '20 minutes'
    AND b.updated_at >= now() - interval '7 days'
    -- Excluye la cancelación tardía del CLIENTE (<24 h): ahí la tarifa se conserva por
    -- política, el cobro está correcto y no hay nada que reconciliar. Sin esto, el reloj
    -- avisaría de "cargo sobre reserva cancelada" en cada una de ellas, que es ruido.
    AND NOT (
      b.status = 'cancelled'
      AND b.cancellation_actor = 'client'
      AND public.booking_service_start(b) IS NOT NULL
      AND public.booking_service_start(b) - COALESCE(b.cancelled_at, b.updated_at) < interval '24 hours'
    )
  ORDER BY b.updated_at ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
$$;

REVOKE ALL ON FUNCTION public.list_bookings_pending_payment_reconciliation(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_bookings_pending_payment_reconciliation(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_booking_payment_settled(
  p_attempt_id uuid,
  p_result text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.booking_payment_attempts
  SET gateway_response = COALESCE(gateway_response, '{}'::jsonb)
        || jsonb_build_object('settlement', p_result, 'settled_at', now()),
      updated_at = now()
  WHERE id = p_attempt_id;
$$;

REVOKE ALL ON FUNCTION public.mark_booking_payment_settled(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_booking_payment_settled(uuid, text) TO service_role;
