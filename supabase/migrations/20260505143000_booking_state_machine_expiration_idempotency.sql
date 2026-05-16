-- Block A hardening:
-- 1) Strict booking state machine
-- 2) Price-change expiration without cron dependency
-- 3) Practical idempotency for RPC mutations

ALTER TABLE public.bookings
DROP CONSTRAINT IF EXISTS bookings_price_change_status_check;

ALTER TABLE public.bookings
ADD CONSTRAINT bookings_price_change_status_check
CHECK (price_change_status IN ('none', 'pending_client_acceptance', 'accepted', 'rejected', 'expired'));

ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS proposed_price_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_bookings_price_change_expiration
  ON public.bookings(price_change_status, proposed_price_expires_at);

CREATE TABLE IF NOT EXISTS public.booking_rpc_idempotency (
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  operation_id uuid NOT NULL,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  payload_signature text NOT NULL,
  response_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (actor_id, action, operation_id)
);

ALTER TABLE public.booking_rpc_idempotency ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own booking idempotency records" ON public.booking_rpc_idempotency;
CREATE POLICY "Users can read own booking idempotency records"
  ON public.booking_rpc_idempotency
  FOR SELECT
  TO authenticated
  USING (actor_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own booking idempotency records" ON public.booking_rpc_idempotency;
CREATE POLICY "Users can insert own booking idempotency records"
  ON public.booking_rpc_idempotency
  FOR INSERT
  TO authenticated
  WITH CHECK (actor_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own booking idempotency records" ON public.booking_rpc_idempotency;
CREATE POLICY "Users can update own booking idempotency records"
  ON public.booking_rpc_idempotency
  FOR UPDATE
  TO authenticated
  USING (actor_id = auth.uid())
  WITH CHECK (actor_id = auth.uid());

CREATE OR REPLACE FUNCTION public.expire_pending_price_change(
  p_booking_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows_updated integer := 0;
BEGIN
  UPDATE public.bookings
  SET price_change_status = 'expired',
      updated_at = now()
  WHERE id = p_booking_id
    AND COALESCE(price_change_status, 'none') = 'pending_client_acceptance'
    AND proposed_price_expires_at IS NOT NULL
    AND proposed_price_expires_at <= now();

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  RETURN v_rows_updated > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_booking_status_machine()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status IN ('confirmed', 'cancelled', 'expired') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'confirmed' AND NEW.status IN ('in_progress', 'completed', 'cancelled') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'in_progress' AND NEW.status IN ('completed', 'cancelled') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Transición de estado inválida para booking: % -> %', OLD.status, NEW.status;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_booking_status_machine ON public.bookings;
CREATE TRIGGER trg_enforce_booking_status_machine
BEFORE UPDATE ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.enforce_booking_status_machine();

CREATE OR REPLACE FUNCTION public.prevent_confirm_when_price_change_pending()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'confirmed' AND COALESCE(NEW.price_change_status, 'none') = 'pending_client_acceptance' THEN
    IF NEW.proposed_price_expires_at IS NOT NULL AND NEW.proposed_price_expires_at <= now() THEN
      NEW.price_change_status := 'expired';
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'No se puede confirmar la reserva mientras exista un cambio de precio pendiente de aceptación del cliente.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_booking_operation_once(
  p_action text,
  p_booking_id uuid,
  p_operation_id uuid,
  p_payload_signature text
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing public.booking_rpc_idempotency%ROWTYPE;
BEGIN
  IF p_operation_id IS NULL THEN
    RETURN true;
  END IF;

  SELECT * INTO v_existing
  FROM public.booking_rpc_idempotency
  WHERE actor_id = auth.uid()
    AND action = p_action
    AND operation_id = p_operation_id;

  IF FOUND THEN
    IF v_existing.booking_id <> p_booking_id THEN
      RAISE EXCEPTION 'operation_id ya usado para otra reserva.';
    END IF;
    IF v_existing.payload_signature <> p_payload_signature THEN
      RAISE EXCEPTION 'operation_id ya usado con payload distinto.';
    END IF;
    RETURN false;
  END IF;

  INSERT INTO public.booking_rpc_idempotency (
    actor_id,
    action,
    operation_id,
    booking_id,
    payload_signature
  ) VALUES (
    auth.uid(),
    p_action,
    p_operation_id,
    p_booking_id,
    p_payload_signature
  );

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_booking_operation(
  p_action text,
  p_operation_id uuid,
  p_response_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_operation_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.booking_rpc_idempotency
  SET response_payload = p_response_payload,
      completed_at = now()
  WHERE actor_id = auth.uid()
    AND action = p_action
    AND operation_id = p_operation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.propose_booking_price_change(
  p_booking_id uuid,
  p_proposed_total_price numeric,
  p_reason text DEFAULT NULL,
  p_operation_id uuid DEFAULT NULL,
  p_expires_in_minutes integer DEFAULT 1440
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_reason text;
  v_payload_signature text;
  v_should_execute boolean;
  v_response jsonb;
  v_expires_at timestamptz;
  v_ttl_minutes integer;
BEGIN
  IF p_proposed_total_price IS NULL OR p_proposed_total_price <= 0 THEN
    RAISE EXCEPTION 'El nuevo precio debe ser mayor que 0.';
  END IF;

  v_ttl_minutes := GREATEST(1, LEAST(COALESCE(p_expires_in_minutes, 1440), 10080));
  v_reason := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
  v_payload_signature := format('%s|%s|%s', p_proposed_total_price, COALESCE(v_reason, ''), v_ttl_minutes);
  v_should_execute := public.register_booking_operation_once(
    'propose_booking_price_change',
    p_booking_id,
    p_operation_id,
    v_payload_signature
  );

  IF NOT v_should_execute THEN
    SELECT response_payload INTO v_response
    FROM public.booking_rpc_idempotency
    WHERE actor_id = auth.uid()
      AND action = 'propose_booking_price_change'
      AND operation_id = p_operation_id;
    RETURN COALESCE(v_response, jsonb_build_object('status', 'idempotent_replayed'));
  END IF;

  PERFORM public.expire_pending_price_change(p_booking_id);

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada.';
  END IF;

  IF v_booking.gardener_id <> auth.uid() THEN
    RAISE EXCEPTION 'No autorizado para proponer cambio de precio.';
  END IF;

  IF COALESCE(v_booking.price_change_status, 'none') = 'pending_client_acceptance' THEN
    RAISE EXCEPTION 'Ya existe una propuesta de precio pendiente. Debe resolverse antes de crear otra.';
  END IF;

  v_expires_at := now() + make_interval(mins => v_ttl_minutes);

  UPDATE public.bookings
  SET price_change_status = 'pending_client_acceptance',
      proposed_total_price = p_proposed_total_price,
      proposed_price_reason = v_reason,
      proposed_price_by = auth.uid(),
      proposed_price_at = now(),
      proposed_price_expires_at = v_expires_at,
      updated_at = now()
  WHERE id = p_booking_id;

  INSERT INTO public.chat_messages (booking_id, sender_id, message)
  VALUES (
    p_booking_id,
    auth.uid(),
    CASE
      WHEN v_reason IS NULL THEN format('Propuesta de nuevo precio: €%s.', to_char(p_proposed_total_price, 'FM999999990.00'))
      ELSE format('Propuesta de nuevo precio: €%s. Motivo: %s', to_char(p_proposed_total_price, 'FM999999990.00'), v_reason)
    END
  );

  v_response := jsonb_build_object(
    'status', 'pending_client_acceptance',
    'booking_id', p_booking_id,
    'proposed_total_price', p_proposed_total_price,
    'expires_at', v_expires_at
  );
  PERFORM public.complete_booking_operation('propose_booking_price_change', p_operation_id, v_response);
  RETURN v_response;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_booking_price_change(
  p_booking_id uuid,
  p_accept boolean,
  p_operation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_proposed numeric;
  v_payload_signature text;
  v_should_execute boolean;
  v_response jsonb;
BEGIN
  v_payload_signature := format('%s', p_accept);
  v_should_execute := public.register_booking_operation_once(
    'respond_booking_price_change',
    p_booking_id,
    p_operation_id,
    v_payload_signature
  );

  IF NOT v_should_execute THEN
    SELECT response_payload INTO v_response
    FROM public.booking_rpc_idempotency
    WHERE actor_id = auth.uid()
      AND action = 'respond_booking_price_change'
      AND operation_id = p_operation_id;
    RETURN COALESCE(v_response, jsonb_build_object('status', 'idempotent_replayed'));
  END IF;

  PERFORM public.expire_pending_price_change(p_booking_id);

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada.';
  END IF;

  IF v_booking.client_id <> auth.uid() THEN
    RAISE EXCEPTION 'No autorizado para responder cambio de precio.';
  END IF;

  IF COALESCE(v_booking.price_change_status, 'none') <> 'pending_client_acceptance' THEN
    RAISE EXCEPTION 'No hay propuesta de precio pendiente.';
  END IF;

  v_proposed := COALESCE(v_booking.proposed_total_price, 0);
  IF p_accept AND v_proposed <= 0 THEN
    RAISE EXCEPTION 'La propuesta no contiene un precio válido.';
  END IF;

  IF p_accept THEN
    UPDATE public.bookings
    SET total_price = v_proposed,
        price_change_status = 'accepted',
        proposed_price_expires_at = NULL,
        updated_at = now()
    WHERE id = p_booking_id;

    INSERT INTO public.chat_messages (booking_id, sender_id, message)
    VALUES (
      p_booking_id,
      auth.uid(),
      format('Cliente acepta el nuevo precio: €%s.', to_char(v_proposed, 'FM999999990.00'))
    );

    v_response := jsonb_build_object(
      'status', 'accepted',
      'booking_id', p_booking_id,
      'final_total_price', v_proposed
    );
  ELSE
    UPDATE public.bookings
    SET price_change_status = 'rejected',
        proposed_price_expires_at = NULL,
        updated_at = now()
    WHERE id = p_booking_id;

    INSERT INTO public.chat_messages (booking_id, sender_id, message)
    VALUES (
      p_booking_id,
      auth.uid(),
      'Cliente rechaza la propuesta de nuevo precio.'
    );

    v_response := jsonb_build_object(
      'status', 'rejected',
      'booking_id', p_booking_id
    );
  END IF;

  PERFORM public.complete_booking_operation('respond_booking_price_change', p_operation_id, v_response);
  RETURN v_response;
END;
$$;
