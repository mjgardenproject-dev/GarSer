-- Detalle del servicio para las tarjetas del jardinero.
--
-- Las variables del trabajo (zonas de césped, setos, árboles, palmeras, métricas fito…)
-- viven en booking_quotes.input_payload, pero su RLS solo permite leer al CLIENTE
-- (client_id = auth.uid()). El jardinero necesita verlas para decidir si acepta.
--
-- Este RPC (SECURITY DEFINER) devuelve un subconjunto BLANQUEADO del payload
-- únicamente a los participantes de la reserva (cliente o jardinero). No expone
-- dirección, consentimientos ni otros campos del quote.

CREATE OR REPLACE FUNCTION public.get_booking_service_details(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking record;
  v_quote_id uuid;
  v_payload jsonb;
BEGIN
  SELECT id, client_id, gardener_id, pricing_context
    INTO v_booking
    FROM public.bookings
   WHERE id = p_booking_id;

  IF v_booking.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF auth.uid() IS DISTINCT FROM v_booking.client_id
     AND auth.uid() IS DISTINCT FROM v_booking.gardener_id THEN
    RAISE EXCEPTION 'No autorizado para ver el detalle de esta reserva';
  END IF;

  BEGIN
    v_quote_id := NULLIF(v_booking.pricing_context ->> 'quote_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_quote_id := NULL;
  END;

  IF v_quote_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT input_payload INTO v_payload
    FROM public.booking_quotes
   WHERE id = v_quote_id;

  IF v_payload IS NULL THEN
    RETURN NULL;
  END IF;

  -- Subconjunto blanqueado: solo las variables que describen el trabajo
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'dataInputMode', v_payload -> 'dataInputMode',
    'wasteRemoval', v_payload -> 'wasteRemoval',
    'lawnZones', v_payload -> 'lawnZones',
    'hedgeZones', v_payload -> 'hedgeZones',
    'treeGroups', v_payload -> 'treeGroups',
    'shrubGroups', v_payload -> 'shrubGroups',
    'palmGroups', v_payload -> 'palmGroups',
    'phytosanitaryZones', v_payload -> 'phytosanitaryZones',
    'weedingZones', v_payload -> 'weedingZones'
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.get_booking_service_details(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_booking_service_details(uuid) TO authenticated;
