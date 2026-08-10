-- Migration: cimientos del ciclo de vida de la reserva (paso 8C-A)
--
-- Contexto (PLAN-IMPLEMENTACION.md, paso 8C): el ciclo de vida no estaba cerrado. Esta
-- migración prepara el ESQUEMA para la política decidida:
--   · quién canceló y cuándo (hasta ahora `cancelled` no distinguía al actor, y de ese actor
--     depende TODO el desenlace económico y la sanción),
--   · estados de no-show y disputa,
--   · reseña de penalización del sistema distinguible de la opinión de un cliente,
--   · eliminación de `in_progress`, que ningún código escribía jamás.

-- =============================================
-- 1) BOOKINGS · trazabilidad de la cancelación y del no-show
-- =============================================
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  -- 'client' | 'gardener' | 'system': de esto depende si los gastos de gestión se devuelven
  -- o se capturan, y si procede la penalización de 1★. No se deriva de nada más.
  ADD COLUMN IF NOT EXISTS cancellation_actor text,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS no_show_reported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS no_show_reported_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_completed_at timestamptz;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_cancellation_actor_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_cancellation_actor_check
  CHECK (cancellation_actor IS NULL OR cancellation_actor IN ('client', 'gardener', 'system'));

-- =============================================
-- 2) ESTADOS · fuera `in_progress`, dentro no-show y disputa
-- =============================================
-- `in_progress` era inalcanzable: ninguna función lo escribía y 4 componentes lo pintaban.
-- Por si existiera alguna fila histórica, se normaliza antes de endurecer el CHECK.
UPDATE public.bookings SET status = 'confirmed' WHERE status = 'in_progress';

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_status_check
  CHECK (status IN (
    'pending',
    'confirmed',
    'completed',
    'cancelled',
    'expired',
    'no_show_client',
    'no_show_gardener',
    'disputed'
  ));

-- Máquina de estados actualizada: sin `in_progress`, con no-show y disputa.
CREATE OR REPLACE FUNCTION public.enforce_booking_status_machine()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- Solicitud sin responder
  IF OLD.status = 'pending' AND NEW.status IN ('confirmed', 'cancelled', 'expired') THEN
    RETURN NEW;
  END IF;

  -- Reserva aceptada: se completa, se cancela, o alguien no aparece
  IF OLD.status = 'confirmed'
     AND NEW.status IN ('completed', 'cancelled', 'no_show_client', 'no_show_gardener', 'disputed') THEN
    RETURN NEW;
  END IF;

  -- Un no-show reportado por una parte puede pasar a disputa si la otra lo contradice
  IF OLD.status IN ('no_show_client', 'no_show_gardener') AND NEW.status = 'disputed' THEN
    RETURN NEW;
  END IF;

  -- Resolución manual de una disputa por el admin
  IF OLD.status = 'disputed' AND NEW.status IN ('completed', 'cancelled') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Transición de estado inválida para booking: % -> %', OLD.status, NEW.status;
END;
$$;

-- =============================================
-- 3) REVIEWS · penalización del sistema distinguible de una opinión real
-- =============================================
-- Cuando un jardinero cancela tras haber aceptado, se registra 1★ "a nombre de GarSer".
-- Se marca como penalización del sistema y sin cliente: nadie recibió ese servicio, así que
-- no puede presentarse como la opinión de un cliente. Cuenta para la media (efecto buscado),
-- pero es trazable y defendible si el jardinero la reclama.
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS is_system_penalty boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS system_reason text;

ALTER TABLE public.reviews ALTER COLUMN client_id DROP NOT NULL;

-- Una reseña o la firma un cliente, o es una penalización del sistema. Nunca ambas ni ninguna.
ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_author_check;
ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_author_check
  CHECK (
    (is_system_penalty = false AND client_id IS NOT NULL)
    OR (is_system_penalty = true AND client_id IS NULL)
  );

-- Una sola penalización por reserva (idempotencia si la cancelación se reintenta).
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_system_penalty_per_booking
  ON public.reviews (booking_id)
  WHERE is_system_penalty = true;
