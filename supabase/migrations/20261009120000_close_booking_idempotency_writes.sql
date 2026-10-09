-- Pendientes · fase C (2026-10-09): el navegador ya no puede escribir las marcas de idempotencia
-- de las operaciones de reserva (PH-05).
--
-- `booking_rpc_idempotency` guarda que una operación (aceptar una solicitud, proponer o responder
-- un cambio de precio…) ya se hizo y qué respondió, para que un reintento no la repita.
-- `authenticated` podía insertar y actualizar sus propias marcas (reglas «Users can insert/update
-- own booking idempotency records») y llamar directamente a los ayudantes
-- `register_booking_operation_once` y `complete_booking_operation` (EXECUTE para PUBLIC).
--
-- Comprobado en local (fase C, paso 2): un proveedor escribe la marca de «aceptar» con una
-- respuesta inventada, llama a `respond_booking_request` con esa operación y recibe «confirmed»
-- SIN que se ejecute nada (la reserva sigue pendiente)… y la envoltura apunta el correo «Tu
-- reserva ha sido aceptada» al cliente. Es decir: un aviso falso a otra persona, y el verdadero ya
-- no saldría (misma clave de duplicado).
--
-- Ahora:
--   1. Solo las funciones del servidor (SECURITY DEFINER) escriben las marcas; el navegador las
--      sigue pudiendo leer (las suyas). Las tablas de lotes ya no tenían permisos de escritura:
--      se quitan también sus reglas, que no servían para nada.
--   2. Los ayudantes ya no se pueden llamar desde el navegador (como sus gemelos de lotes).
--   3. La envoltura de `respond_booking_request` apunta el aviso según el estado REAL de la
--      reserva, no según lo que diga la respuesta.
--
-- Vuelta atrás: GRANT INSERT, UPDATE ON booking_rpc_idempotency TO authenticated, volver a crear
-- las dos reglas, GRANT EXECUTE de los dos ayudantes a PUBLIC y la envoltura de 20260929100000.

-- =============================================
-- 1) Escritura de las marcas, solo el servidor
-- =============================================
REVOKE INSERT, UPDATE, DELETE ON public.booking_rpc_idempotency FROM authenticated, anon;
DROP POLICY IF EXISTS "Users can insert own booking idempotency records" ON public.booking_rpc_idempotency;
DROP POLICY IF EXISTS "Users can update own booking idempotency records" ON public.booking_rpc_idempotency;

REVOKE INSERT, UPDATE, DELETE ON public.booking_batch_rpc_idempotency FROM authenticated, anon;
DROP POLICY IF EXISTS "Users can insert own booking batch idempotency records" ON public.booking_batch_rpc_idempotency;
DROP POLICY IF EXISTS "Users can update own booking batch idempotency records" ON public.booking_batch_rpc_idempotency;

-- =============================================
-- 2) Los ayudantes, solo dentro del servidor
-- =============================================
REVOKE ALL ON FUNCTION public.register_booking_operation_once(text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_booking_operation_once(text, uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.complete_booking_operation(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_booking_operation(text, uuid, jsonb) TO service_role;

-- =============================================
-- 3) El aviso, por el estado real de la reserva
-- =============================================
CREATE OR REPLACE FUNCTION public.respond_booking_request(p_booking_id uuid, p_response text, p_operation_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_status text;
BEGIN
  v_result := private.respond_booking_request_core(p_booking_id, p_response, p_operation_id);
  IF v_result IS NOT NULL AND NOT (v_result ? 'message') THEN
    -- PH-05: no fiarse de la respuesta (puede venir de una repetición); mirar la reserva.
    SELECT status INTO v_status FROM public.bookings WHERE id = p_booking_id;
    IF v_result->>'status' = 'confirmed' AND v_status = 'confirmed' THEN
      PERFORM private.enqueue_notification('booking_accepted', format('booking_accepted:%s', p_booking_id),
        p_booking_id, jsonb_build_object('bookingId', p_booking_id));
    ELSIF v_result->>'status' = 'cancelled' AND v_status = 'cancelled' THEN
      PERFORM private.enqueue_notification('booking_rejected', format('booking_rejected:%s', p_booking_id),
        p_booking_id, jsonb_build_object('bookingId', p_booking_id));
    END IF;
  END IF;
  RETURN v_result;
END;
$function$;
