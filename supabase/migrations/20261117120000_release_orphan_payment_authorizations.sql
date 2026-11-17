-- QA-139 (PH-37) y retenciones de tarjeta sin reserva.
--
-- Problema 1: si el cliente paga cuando su hueco ya ha caducado (30 min), confirm_booking_payment_attempt
-- no crea la reserva y deja el intento en `reconciliation_required`, pero la AUTORIZACIÓN de la tarjeta
-- se quedaba viva en Stripe (hasta 7 días) sin que nada la anulase. Igual con cualquier otro motivo
-- por el que un pago autorizado acaba sin reserva (hueco ocupado mientras pagaba, error al crearla).
--   → list_orphan_payment_authorizations(): los intentos SIN reserva con un PaymentIntent que aún
--     no se ha liberado. La función booking-payment los libera al momento y el reloj
--     (booking-lifecycle-tick) repasa la lista como respaldo.
--
-- Problema 2: con el webhook `payment_intent.payment_failed` (una tarjeta rechazada) el intento pasaba
-- a `failed` y SOLTABA el hueco, aunque el PaymentIntent sigue admitiendo otra tarjeta en el mismo
-- formulario. Si el cliente probaba otra tarjeta, Stripe la autorizaba pero la reserva ya no se podía
-- crear: el mismo dinero retenido sin reserva. En local no se veía porque allí no llegan los webhooks.
--   → mark_booking_payment_attempt_declined(): con el hueco vigente, el intento sigue pendiente de
--     pago y solo se anota el rechazo; con el hueco caducado se cierra como antes.
--
-- Problema 3: release_booking_payment_attempt se podía llamar desde el navegador (GRANT a
-- authenticated): cualquier usuario con sesión podía soltar el hueco de otro cliente.

-- ── 1) Rechazo de tarjeta ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_booking_payment_attempt_declined(
  p_attempt_id uuid,
  p_stripe_payment_intent_id text DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_error_message text DEFAULT NULL,
  p_gateway_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.booking_payment_attempts%ROWTYPE;
  v_hold public.booking_schedule_holds%ROWTYPE;
BEGIN
  SELECT * INTO v_attempt
  FROM public.booking_payment_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Intento de pago no encontrado.';
  END IF;

  -- Un rechazo que llega tarde (el intento ya tiene reserva o ya se cerró) no cambia nada.
  IF v_attempt.booking_id IS NOT NULL
     OR v_attempt.status NOT IN ('created', 'payment_pending', 'processing') THEN
    RETURN public.get_booking_payment_attempt_summary(v_attempt.id);
  END IF;

  SELECT * INTO v_hold
  FROM public.booking_schedule_holds
  WHERE payment_attempt_id = v_attempt.id
  FOR UPDATE;

  IF FOUND AND v_hold.status = 'active' AND v_hold.expires_at > now() THEN
    UPDATE public.booking_payment_attempts
    SET status = 'payment_pending',
        stripe_payment_intent_id = COALESCE(NULLIF(BTRIM(COALESCE(p_stripe_payment_intent_id, '')), ''), stripe_payment_intent_id),
        last_error_code = COALESCE(NULLIF(BTRIM(COALESCE(p_error_code, '')), ''), 'card_declined'),
        last_error_message = COALESCE(NULLIF(BTRIM(COALESCE(p_error_message, '')), ''),
          'Tu banco ha rechazado el pago. Prueba con otra tarjeta.'),
        gateway_response = CASE
          WHEN COALESCE(p_gateway_payload, '{}'::jsonb) = '{}'::jsonb THEN gateway_response
          ELSE COALESCE(gateway_response, '{}'::jsonb) || p_gateway_payload
        END,
        updated_at = now()
    WHERE id = v_attempt.id;

    RETURN public.get_booking_payment_attempt_summary(v_attempt.id);
  END IF;

  RETURN public.release_booking_payment_attempt(
    v_attempt.id,
    'failed',
    'stripe_payment_failed',
    p_stripe_payment_intent_id,
    COALESCE(p_gateway_payload, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_booking_payment_attempt_declined(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_booking_payment_attempt_declined(uuid, text, text, text, jsonb) TO service_role;

-- ── 2) Retenciones sin reserva ───────────────────────────────────────────────────────────────
-- Entran los intentos cerrados SIN reserva que tienen un PaymentIntent y aún no se han liberado
-- (`gateway_response.settlement` vacío, el mismo marcador que usa la conciliación de reservas).
-- Quedan fuera, a propósito:
--   · los motivos de integridad (el PaymentIntent no cuadra con el intento): los revisa una persona;
--   · cualquier intento con reserva (y un PaymentIntent no puede estar en dos intentos: es UNIQUE);
--   · lo de hace más de 8 días (Stripe anula sola la autorización a los 7);
--   · lo de los últimos 2 minutos: booking-payment lo libera al momento y así no compiten.
CREATE OR REPLACE FUNCTION public.list_orphan_payment_authorizations(
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  attempt_id uuid,
  payment_intent_id text,
  attempt_status text,
  last_error_code text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.stripe_payment_intent_id, a.status, a.last_error_code
  FROM public.booking_payment_attempts a
  WHERE a.booking_id IS NULL
    AND a.stripe_payment_intent_id IS NOT NULL
    AND a.status IN ('reconciliation_required', 'expired', 'cancelled', 'failed')
    AND COALESCE(a.gateway_response ->> 'settlement', '') = ''
    AND COALESCE(a.last_error_code, '') NOT IN (
      'stripe_metadata_incomplete',
      'stripe_metadata_mismatch',
      'stripe_payment_intent_binding_mismatch'
    )
    AND a.updated_at < now() - interval '2 minutes'
    AND a.created_at >= now() - interval '8 days'
  ORDER BY a.updated_at ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
$$;

REVOKE ALL ON FUNCTION public.list_orphan_payment_authorizations(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_orphan_payment_authorizations(integer) TO service_role;

-- ── 4) Un pago sin reserva no se rebaja a «cancelado» ────────────────────────────────────────
-- Copia de 20260522113000 con una sola regla nueva (marcada QA-139).
CREATE OR REPLACE FUNCTION public.release_booking_payment_attempt(
  p_attempt_id uuid,
  p_next_status text,
  p_reason text DEFAULT NULL,
  p_stripe_payment_intent_id text DEFAULT NULL,
  p_gateway_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.booking_payment_attempts%ROWTYPE;
  v_hold public.booking_schedule_holds%ROWTYPE;
  v_effective_reason text := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
BEGIN
  IF p_next_status NOT IN ('cancelled', 'failed', 'expired', 'reconciliation_required') THEN
    RAISE EXCEPTION 'Estado terminal no soportado para liberar el intento de pago.';
  END IF;

  SELECT *
  INTO v_attempt
  FROM public.booking_payment_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Intento de pago no encontrado.';
  END IF;

  IF v_attempt.status = 'booking_created' OR v_attempt.booking_id IS NOT NULL THEN
    RETURN public.get_booking_payment_attempt_summary(v_attempt.id);
  END IF;

  -- QA-139: un intento ya CERRADO (caducado, cancelado, fallido o sin reserva) conserva su estado y
  -- su motivo. Cuando después se anula su pago, Stripe manda `payment_intent.canceled` y antes eso lo
  -- reescribía a `cancelled` («tu reserva sigue pendiente, vuelve a pagar»), que es falso. Solo se
  -- admite un cambio: a `reconciliation_required`, cuando el cliente paga tarde un intento caducado.
  IF v_attempt.status = 'reconciliation_required'
     OR (v_attempt.status IN ('cancelled', 'failed', 'expired') AND p_next_status <> 'reconciliation_required') THEN
    RETURN public.get_booking_payment_attempt_summary(v_attempt.id);
  END IF;

  SELECT *
  INTO v_hold
  FROM public.booking_schedule_holds
  WHERE payment_attempt_id = p_attempt_id
  FOR UPDATE;

  IF FOUND AND v_hold.status = 'active' THEN
    DELETE FROM public.booking_schedule_hold_blocks
    WHERE hold_id = v_hold.id;

    UPDATE public.booking_schedule_holds
    SET status = CASE WHEN p_next_status = 'expired' THEN 'expired' ELSE 'released' END,
        release_reason = COALESCE(v_effective_reason, release_reason, p_next_status),
        released_at = COALESCE(released_at, now()),
        updated_at = now()
    WHERE id = v_hold.id;
  END IF;

  UPDATE public.booking_payment_attempts
  SET status = p_next_status,
      stripe_payment_intent_id = COALESCE(NULLIF(BTRIM(COALESCE(p_stripe_payment_intent_id, '')), ''), stripe_payment_intent_id),
      gateway_response = CASE
        WHEN COALESCE(p_gateway_payload, '{}'::jsonb) = '{}'::jsonb THEN gateway_response
        ELSE gateway_response || p_gateway_payload
      END,
      last_error_code = COALESCE(v_effective_reason, last_error_code, p_next_status),
      last_error_message = CASE
        WHEN p_next_status = 'cancelled' THEN COALESCE(last_error_message, 'El pago se ha cancelado antes de completarse.')
        WHEN p_next_status = 'expired' THEN COALESCE(last_error_message, 'El tiempo del pago ha expirado. Puedes reintentarlo.')
        WHEN p_next_status = 'reconciliation_required' THEN COALESCE(last_error_message, 'El pago necesita revision manual antes de consolidar la reserva.')
        ELSE COALESCE(last_error_message, 'No se pudo completar el pago. Puedes reintentarlo.')
      END,
      cancelled_at = CASE WHEN p_next_status = 'cancelled' THEN COALESCE(cancelled_at, now()) ELSE cancelled_at END,
      failed_at = CASE WHEN p_next_status IN ('failed', 'reconciliation_required') THEN COALESCE(failed_at, now()) ELSE failed_at END,
      expired_at = CASE WHEN p_next_status = 'expired' THEN COALESCE(expired_at, now()) ELSE expired_at END,
      updated_at = now()
  WHERE id = p_attempt_id;

  RETURN public.get_booking_payment_attempt_summary(p_attempt_id);
END;
$$;

-- ── 3) Liberar intentos solo desde el servidor ───────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.release_booking_payment_attempt(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_booking_payment_attempt(uuid, text, text, text, jsonb) TO service_role;
