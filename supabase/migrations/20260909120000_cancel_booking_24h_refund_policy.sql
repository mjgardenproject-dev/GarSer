-- F1 — Política de reembolso por antelación en la cancelación del CLIENTE.
--
-- Hasta ahora `cancel_booking` (20260806121000) no miraba la hora de inicio: el cliente
-- perdía SIEMPRE la tarifa de gestión, cancelara con 1 hora o con 10 días de antelación.
--
-- Política del negocio:
--   · Cliente cancela con MÁS de 24 h hasta el inicio del servicio  → devolución ÍNTEGRA
--     de la tarifa de gestión.
--   · Con MENOS de 24 h  → la pierde (comportamiento anterior).
--
-- Sólo cambia la rama `v_actor = 'client'`. La causa del jardinero (cancelar tras aceptar →
-- refund + penalización 1★; rechazar antes de aceptar → release) queda EXACTAMENTE igual.
--
-- El desenlace económico se sigue devolviendo como `money_action` y lo ejecuta en Stripe la
-- edge function `booking-payment`, que ya soporta 'refund', 'release', 'capture' y 'none':
--   >24 h, reserva 'pending'   → 'release' (sólo estaba autorizado: se libera, cliente paga 0)
--   >24 h, reserva 'confirmed' → 'refund'  (ya capturado: se reembolsa íntegro)
--   <24 h, reserva 'pending'   → 'capture' (se cobra la tarifa)
--   <24 h, reserva 'confirmed' → 'none'    (ya capturado, se mantiene)

CREATE OR REPLACE FUNCTION public.cancel_booking(
  p_booking_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_actor text;
  v_money_action text;
  v_penalty boolean := false;
  v_refundable boolean := false;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada' USING ERRCODE = 'no_data_found';
  END IF;

  IF auth.uid() = v_booking.client_id THEN
    v_actor := 'client';
  ELSIF auth.uid() = v_booking.gardener_id THEN
    v_actor := 'gardener';
  ELSE
    RAISE EXCEPTION 'No participas en esta reserva' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Idempotencia: si ya está cancelada, se devuelve el mismo resultado sin volver a mover dinero.
  IF v_booking.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'bookingId', v_booking.id,
      'status', 'cancelled',
      'actor', v_booking.cancellation_actor,
      'money_action', 'none',
      'idempotent', true
    );
  END IF;

  IF v_booking.status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'Esta reserva ya no se puede cancelar (estado: %)', v_booking.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- POLÍTICA ECONÓMICA (§8C-D3): manda de quién es la causa, no el estado.
  IF v_actor = 'gardener' THEN
    IF v_booking.status = 'confirmed' THEN
      -- Ya había aceptado (y por tanto el cobro ya se capturó): se devuelve al cliente
      -- y el jardinero se lleva la penalización.
      v_money_action := 'refund';
      v_penalty := true;
    ELSE
      -- Aún no había aceptado: es un rechazo, se libera sin cobrar y sin sanción.
      v_money_action := 'release';
    END IF;
  ELSE
    -- Desiste el cliente. La tarifa de gestión se devuelve ÍNTEGRA si cancela con 24 h o más
    -- de antelación respecto al inicio del servicio; con menos de 24 h la pierde.
    -- `booking_service_start` devuelve el instante real de inicio (hora peninsular).
    v_refundable := public.booking_service_start(v_booking) IS NOT NULL
                    AND public.booking_service_start(v_booking) - now() >= interval '24 hours';

    IF v_refundable THEN
      -- Devolución íntegra: si sólo estaba autorizado (reserva 'pending') se libera la
      -- autorización; si ya se había capturado ('confirmed') se reembolsa.
      v_money_action := CASE WHEN v_booking.status = 'pending' THEN 'release' ELSE 'refund' END;
    ELSE
      -- Menos de 24 h: pierde la tarifa (comportamiento histórico).
      v_money_action := CASE WHEN v_booking.status = 'pending' THEN 'capture' ELSE 'none' END;
    END IF;
  END IF;

  UPDATE public.bookings
  SET status = 'cancelled',
      cancelled_at = now(),
      cancellation_actor = v_actor,
      cancelled_by = auth.uid(),
      cancellation_reason = NULLIF(TRIM(COALESCE(p_reason, '')), ''),
      updated_at = now()
  WHERE id = p_booking_id;

  -- Libera el hueco de agenda para que otro cliente pueda reservarlo.
  PERFORM public.release_booking_schedule(p_booking_id);

  -- Penalización automática de 1★ (§8C-D4). Marcada como del sistema: nadie recibió el
  -- servicio, así que no puede presentarse como la opinión de un cliente.
  IF v_penalty THEN
    INSERT INTO public.reviews (booking_id, client_id, gardener_id, rating, comment, is_system_penalty, system_reason)
    VALUES (
      p_booking_id, NULL, v_booking.gardener_id, 1,
      'Servicio no completado',
      true,
      'gardener_cancelled_after_accepting'
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'bookingId', v_booking.id,
    'status', 'cancelled',
    'actor', v_actor,
    'money_action', v_money_action,
    'penalty_applied', v_penalty,
    'refundable_window', v_refundable,
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_booking(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_booking(uuid, text) TO authenticated;
