-- Migration: Harden direct writes to bookings
-- Contexto (auditoría Dim 3, ALTO): `bookings` concede INSERT/UPDATE directos a
-- `authenticated` con policies laxas ("Clients can create bookings" solo valida client_id;
-- "Participants can update bookings" sin WITH CHECK). Vía PostgREST, un cliente autenticado
-- podía INSERTAR una reserva con `total_price` arbitrario, y un participante podía
-- ACTUALIZAR `total_price`/`status` saltándose el motor de precios y el webhook de pago.
--
-- El flujo real de producción crea y actualiza reservas exclusivamente por RPC
-- SECURITY DEFINER (create_atomic_booking, confirm_booking_payment_attempt,
-- respond_booking_request, create_broadcast_booking_requests), que recalculan el precio
-- contra el presupuesto firmado. La ÚNICA escritura directa legítima desde el front es el
-- cambio de estado del jardinero (GardenerDashboard: .update({ status })).
--
-- Esta migración: (1) revoca INSERT directo — solo las RPC crean reservas; (2) restringe
-- UPDATE directo a la columna `status` mediante privilegios a nivel de columna, de modo que
-- `total_price` (y cualquier otro campo económico o de identidad) queda congelado para
-- escritura directa. Las RPC SECURITY DEFINER siguen operando (se ejecutan como owner).

-- =============================================
-- INSERT: solo por RPC SECURITY DEFINER
-- =============================================
REVOKE INSERT ON public.bookings FROM authenticated;
-- Policy de INSERT directo ya innecesaria (sin GRANT no aplica); se elimina por higiene.
DROP POLICY IF EXISTS "Clients can create bookings" ON public.bookings;

-- =============================================
-- UPDATE: solo la columna `status` (congela total_price y demás campos)
-- =============================================
REVOKE UPDATE ON public.bookings FROM authenticated;
GRANT UPDATE (status) ON public.bookings TO authenticated;

-- Policy de UPDATE redundante y laxa heredada de 2025 (rol público, sin WITH CHECK).
-- La lectura/actualización de participantes queda cubierta por "Participants can update
-- bookings" (USING participante) combinada con el privilegio de columna de arriba.
DROP POLICY IF EXISTS "Allow users to update their own bookings" ON public.bookings;

-- Nota: el refinamiento de transiciones de estado válidas por rol (que un CLIENTE no pueda
-- marcar 'completed', etc.) se aborda en el paso de cancelación por el cliente, donde se
-- introduce el RPC de cambio de estado controlado. Aquí el objetivo es blindar el PRECIO.
