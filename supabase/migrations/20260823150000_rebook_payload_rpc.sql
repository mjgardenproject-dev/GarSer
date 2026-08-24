-- Fase 5: recuperar las caracteristicas de una reserva anterior para repetirla.
--
-- QUE HACE Y QUE NO: devuelve UNICAMENTE lo que describe el trabajo -direccion, servicio, zonas,
-- grupos, estados, medidas-. NO devuelve ningun importe, y a proposito: el precio se calcula en
-- vivo en la pantalla de jardineros contra la configuracion vigente de cada profesional.
-- Arrastrar el precio antiguo seria vender a una tarifa que quiza ya no existe.
--
-- POR QUE UNA RPC Y NO UNA CONSULTA DEL FRONT: el payload vive en `booking_quotes`, que esta
-- cerrada a anon y authenticated desde el endurecimiento del motor de pagos (solo service_role).
-- La RPC es la unica via, y valida por si misma que quien pregunta es el cliente de ESA reserva.

CREATE OR REPLACE FUNCTION public.get_rebook_payload(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_booking public.bookings;
  v_payload jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Se requiere sesion' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada' USING ERRCODE = 'P0002';
  END IF;

  -- Solo el cliente de la reserva puede repetirla. Sin esto, conocer un id ajeno bastaria para
  -- leer la direccion y las caracteristicas del jardin de otra persona.
  IF v_booking.client_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'Solo puedes repetir tus propias reservas' USING ERRCODE = '42501';
  END IF;

  -- El presupuesto se alcanza por el intento de pago. Puede haber varios (reintentos), asi que
  -- se toma el mas reciente que llegara a tener presupuesto.
  SELECT q.input_payload
  INTO v_payload
  FROM public.booking_payment_attempts a
  JOIN public.booking_quotes q ON q.id = a.quote_id
  WHERE a.booking_id = p_booking_id
    AND q.input_payload IS NOT NULL
    AND q.input_payload <> '{}'::jsonb
  ORDER BY a.created_at DESC
  LIMIT 1;

  IF v_payload IS NULL THEN
    -- Reservas antiguas o creadas por otra via pueden no tener presupuesto asociado. Se
    -- devuelve lo minimo reconstruible desde la propia reserva en vez de fallar: el cliente
    -- repite con la direccion y el servicio, y completa el resto.
    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'address', v_booking.client_address,
      'serviceIds', CASE WHEN v_booking.service_id IS NULL THEN NULL
                         ELSE jsonb_build_array(v_booking.service_id) END,
      'addressCoordinates', CASE
        WHEN v_booking.client_latitude IS NULL OR v_booking.client_longitude IS NULL THEN NULL
        ELSE jsonb_build_object('lat', v_booking.client_latitude, 'lng', v_booking.client_longitude)
      END
    ));
    RETURN jsonb_build_object('payload', v_payload, 'partial', true);
  END IF;

  RETURN jsonb_build_object('payload', v_payload, 'partial', false);
END;
$$;

COMMENT ON FUNCTION public.get_rebook_payload(uuid) IS
  'Caracteristicas de una reserva propia para repetirla. NO devuelve importes: el precio se recalcula en vivo.';

REVOKE ALL ON FUNCTION public.get_rebook_payload(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rebook_payload(uuid) TO authenticated, service_role;
