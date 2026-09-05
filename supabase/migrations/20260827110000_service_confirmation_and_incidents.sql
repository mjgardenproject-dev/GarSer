-- Migration: confirmacion del servicio por el cliente + parte de incidencias
--
-- Hasta ahora, si el jardinero no cerraba una reserva, un cron la daba por completada a las
-- 24 h y los gastos de gestion quedaban cobrados sin que nadie preguntara al cliente. El
-- motor de reembolso existia y estaba probado, pero ninguna pantalla lo disparaba.
--
-- La politica nueva:
--   · El CLIENTE confirma que el trabajo se hizo. Si no dice nada en 24 h, se autocompleta.
--   · Una hora despues del fin previsto se le escribe pidiendole esa confirmacion.
--   · El cliente NO cierra una reserva como "no prestada" por su cuenta: abre una INCIDENCIA.
--   · Un ADMINISTRADOR la revisa y decide si se devuelven los gastos de gestion.
--   · El jardinero ve de que se le acusa y puede dar su version antes de que se resuelva.
--
-- Reparto de responsabilidades, el mismo que ya seguia el ciclo de vida: estas funciones
-- resuelven la BASE DE DATOS y DEVUELVEN que hay que hacer con el dinero (`money_action`).
-- La llamada a Stripe la hace la edge function `booking-payment`.

-- =============================================
-- 1) Inicio del servicio (faltaba el simetrico de `booking_service_end`)
-- =============================================
CREATE OR REPLACE FUNCTION public.booking_service_start(p_booking public.bookings)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ((p_booking.date + p_booking.start_time) AT TIME ZONE 'Europe/Madrid');
$$;

COMMENT ON FUNCTION public.booking_service_start(public.bookings) IS
  'Inicio del servicio reservado, en hora peninsular. Marca desde cuando el jardinero puede '
  'avisar de que ha terminado: acabar antes de lo estimado es normal y no debe obligarle a '
  'esperar sentado a que pase la hora prevista de fin.';

-- =============================================
-- 2) Columnas del ciclo de confirmacion
-- =============================================
ALTER TABLE public.bookings
  -- El jardinero avisa de que termino. NO cierra la reserva: solo adelanta el aviso al cliente.
  ADD COLUMN IF NOT EXISTS gardener_finished_at        timestamptz,
  -- Cuando toca escribirle al cliente (fin del servicio + 1 h), y hasta cuando puede responder.
  ADD COLUMN IF NOT EXISTS confirmation_prompt_due_at  timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_deadline_at    timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_prompt_state   text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS confirmation_prompt_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_prompt_attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS client_confirmed_at         timestamptz,
  ADD COLUMN IF NOT EXISTS client_confirmed_via        text;

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_confirmation_prompt_state_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_confirmation_prompt_state_check
  CHECK (confirmation_prompt_state IN ('pending', 'sending', 'sent', 'skipped', 'failed'));

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_client_confirmed_via_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_client_confirmed_via_check
  CHECK (client_confirmed_via IS NULL OR client_confirmed_via IN ('app', 'email_token'));

-- `confirmation_deadline_at` se ALMACENA en vez de recalcularse cada vez. El correo imprime
-- una fecha y una hora concretas ("antes del jueves a las 18:00") y el reloj tiene que
-- disparar en ESE mismo instante. Si uno la calcula y el otro la recalcula, cualquier cambio
-- futuro de la regla los desincroniza y el cliente ve una promesa incumplida.
COMMENT ON COLUMN public.bookings.confirmation_deadline_at IS
  'Instante exacto en que la reserva se dara por completada sola. Es la fecha que se imprime '
  'en el correo al cliente: fuente unica, para que lo prometido y lo aplicado no puedan diferir.';

CREATE OR REPLACE FUNCTION public.set_booking_confirmation_window()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'confirmed' THEN
    RETURN NEW;
  END IF;

  -- Se recalcula al confirmar y TAMBIEN si cambia el horario de una reserva ya confirmada.
  -- Sin lo segundo, mover una reserva dejaria la fecha limite apuntando al dia viejo: el
  -- correo prometeria una fecha y el reloj aplicaria otra, que es justo lo que esta columna
  -- existe para impedir.
  IF TG_OP = 'INSERT'
     OR OLD.status IS DISTINCT FROM 'confirmed'
     OR NEW.confirmation_deadline_at IS NULL
     OR NEW.date IS DISTINCT FROM OLD.date
     OR NEW.start_time IS DISTINCT FROM OLD.start_time
     OR NEW.duration_hours IS DISTINCT FROM OLD.duration_hours THEN
    NEW.confirmation_prompt_due_at := public.booking_service_end(NEW) + interval '1 hour';
    NEW.confirmation_deadline_at   := public.booking_service_end(NEW) + interval '24 hours';
    -- El aviso vuelve a la cola: el que se hubiera mandado hablaba de otra fecha.
    IF TG_OP = 'UPDATE' AND (
         NEW.date IS DISTINCT FROM OLD.date
         OR NEW.start_time IS DISTINCT FROM OLD.start_time
         OR NEW.duration_hours IS DISTINCT FROM OLD.duration_hours) THEN
      NEW.confirmation_prompt_state := 'pending';
      NEW.confirmation_prompt_attempts := 0;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_booking_confirmation_window ON public.bookings;
CREATE TRIGGER trg_set_booking_confirmation_window
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_booking_confirmation_window();

-- Reservas ya confirmadas antes de esta migracion: sin esto se quedarian fuera del ciclo.
UPDATE public.bookings
SET confirmation_prompt_due_at = public.booking_service_end(bookings) + interval '1 hour',
    confirmation_deadline_at   = public.booking_service_end(bookings) + interval '24 hours'
WHERE status = 'confirmed' AND confirmation_deadline_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_confirmation_prompt_due
  ON public.bookings (confirmation_prompt_due_at)
  WHERE status = 'confirmed' AND confirmation_prompt_state IN ('pending', 'sending');

CREATE INDEX IF NOT EXISTS idx_bookings_confirmation_deadline
  ON public.bookings (confirmation_deadline_at)
  WHERE status = 'confirmed';

-- =============================================
-- 3) Maquina de estados: una reserva completada tambien admite disputa
-- =============================================
-- Si el cliente confirma por error y se arrepiente diez segundos despues, tiene que poder
-- reclamar. Ademas cierra la carrera entre confirmar y abrir incidencia: gane quien gane,
-- ambos caminos desembocan en el mismo sitio.
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

  IF OLD.status = 'confirmed'
     AND NEW.status IN ('completed', 'cancelled', 'no_show_client', 'no_show_gardener', 'disputed') THEN
    RETURN NEW;
  END IF;

  -- Una reserva ya completada puede acabar en disputa si el cliente reclama despues.
  IF OLD.status = 'completed' AND NEW.status = 'disputed' THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('no_show_client', 'no_show_gardener') AND NEW.status = 'disputed' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'disputed' AND NEW.status IN ('completed', 'cancelled') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Transición de estado inválida para booking: % -> %', OLD.status, NEW.status;
END;
$$;

-- =============================================
-- 4) Incidencias
-- =============================================
CREATE TABLE IF NOT EXISTS public.booking_incidents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  reported_by       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reporter_role     text NOT NULL,
  kind              text NOT NULL,
  description       text NOT NULL,
  -- Separa lo que CONGELA la reserva de lo que es un ticket de soporte. Sin esta distincion,
  -- una queja por el trato recibido bloquearia el cierre y el cobro igual que un "no vino".
  blocks_completion boolean GENERATED ALWAYS AS (
    kind IN ('gardener_no_show', 'service_not_done', 'service_incomplete')
  ) STORED,
  status            text NOT NULL DEFAULT 'open',
  gardener_response     text,
  gardener_responded_at timestamptz,
  resolution_note   text,
  resolved_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at       timestamptz,
  money_action      text,
  -- Texto libre a proposito: `booking-payment` devuelve valores dinamicos del tipo
  -- `no_refund_needed_requires_capture` segun lo que conteste Stripe.
  money_status      text,
  money_attempted_at timestamptz,
  stripe_payment_intent_id text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_incidents_reporter_role_check CHECK (reporter_role IN ('client', 'gardener')),
  CONSTRAINT booking_incidents_kind_check CHECK (kind IN (
    'gardener_no_show', 'service_not_done', 'service_incomplete',
    'billing', 'behaviour', 'other'
  )),
  CONSTRAINT booking_incidents_status_check CHECK (status IN (
    'open', 'in_review', 'resolved_refunded', 'resolved_no_action', 'rejected'
  )),
  CONSTRAINT booking_incidents_money_action_check CHECK (money_action IS NULL OR money_action IN ('refund', 'none')),
  CONSTRAINT booking_incidents_description_check CHECK (length(btrim(description)) BETWEEN 10 AND 2000)
);

-- Una sola incidencia bloqueante viva por reserva: dos "no vino" abiertos a la vez sobre el
-- mismo servicio no significan nada distinto y duplicarian la cola del administrador.
CREATE UNIQUE INDEX IF NOT EXISTS idx_incidents_one_blocking_open
  ON public.booking_incidents (booking_id)
  WHERE blocks_completion AND status IN ('open', 'in_review');

CREATE INDEX IF NOT EXISTS idx_incidents_admin_queue
  ON public.booking_incidents (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_by_booking
  ON public.booking_incidents (booking_id);

CREATE OR REPLACE FUNCTION public.enforce_incident_status_machine()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'open'
     AND NEW.status IN ('in_review', 'resolved_refunded', 'resolved_no_action', 'rejected') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'in_review'
     AND NEW.status IN ('resolved_refunded', 'resolved_no_action', 'rejected') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Transición de estado inválida para incidencia: % -> %', OLD.status, NEW.status;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_incident_status_machine ON public.booking_incidents;
CREATE TRIGGER trg_enforce_incident_status_machine
  BEFORE UPDATE ON public.booking_incidents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_incident_status_machine();

-- Auditoria append-only. Es dinero y es una disputa: hay que poder reconstruir despues quien
-- decidio que y cuando, sin depender de los logs de la aplicacion.
CREATE TABLE IF NOT EXISTS public.booking_incident_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES public.booking_incidents(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  from_status text,
  to_status   text NOT NULL,
  note        text,
  context     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incident_events_by_incident
  ON public.booking_incident_events (incident_id, created_at DESC);

-- Lectura: cada parte ve lo suyo; la escritura entra SOLO por RPC, como en `bookings`.
ALTER TABLE public.booking_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_incident_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.booking_incidents FROM anon;
REVOKE ALL ON public.booking_incident_events FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.booking_incidents FROM authenticated;
GRANT SELECT ON public.booking_incidents TO authenticated;

DROP POLICY IF EXISTS incidents_client_read ON public.booking_incidents;
CREATE POLICY incidents_client_read ON public.booking_incidents
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.id = booking_id AND b.client_id = auth.uid()
  ));

-- El jardinero ve de que se le acusa: sin esto recibiria una penalizacion de 1 estrella y un
-- reembolso en su contra sin saber por que.
DROP POLICY IF EXISTS incidents_gardener_read ON public.booking_incidents;
CREATE POLICY incidents_gardener_read ON public.booking_incidents
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.id = booking_id AND b.gardener_id = auth.uid()
  ));

DROP POLICY IF EXISTS incidents_admin_read ON public.booking_incidents;
CREATE POLICY incidents_admin_read ON public.booking_incidents
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS incident_events_admin_read ON public.booking_incident_events;
CREATE POLICY incident_events_admin_read ON public.booking_incident_events
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- =============================================
-- 5) Tokens de confirmacion de un solo uso
-- =============================================
-- Se guarda el HASH, nunca el token: si alguien vuelca la tabla no puede confirmar nada en
-- nombre de nadie. El hash lo calcula la edge function en Deno, asi que tampoco hace falta
-- habilitar pgcrypto ni escribir criptografia en SQL.
CREATE TABLE IF NOT EXISTS public.booking_confirmation_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  token_hash      bytea NOT NULL UNIQUE,
  purpose         text NOT NULL DEFAULT 'client_confirm',
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  used_ip         inet,
  used_user_agent text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_confirmation_tokens_by_booking
  ON public.booking_confirmation_tokens (booking_id);

-- Sin politicas a proposito, igual que `booking_quotes`: solo service_role y SECURITY DEFINER.
ALTER TABLE public.booking_confirmation_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_confirmation_tokens FROM anon, authenticated;

-- =============================================
-- 6) RPCs de servicio interno (solo service_role)
-- =============================================

-- Reclama las reservas a las que toca escribir. El UPDATE con `FOR UPDATE SKIP LOCKED` es lo
-- que hace que dos pasadas simultaneas del reloj no puedan mandar el mismo correo dos veces.
CREATE OR REPLACE FUNCTION public.claim_due_confirmation_prompts(p_limit integer DEFAULT 50)
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH elegibles AS (
    SELECT b.id
    FROM public.bookings b
    WHERE b.status = 'confirmed'
      AND b.confirmation_prompt_due_at <= now()
      AND b.confirmation_prompt_attempts < 3
      AND (
        b.confirmation_prompt_state = 'pending'
        -- Rescate: si la funcion murio entre el envio y el acuse, la fila se quedaria en
        -- 'sending' para siempre y ese cliente no recibiria nunca su aviso.
        OR (b.confirmation_prompt_state = 'sending' AND b.updated_at < now() - interval '30 minutes')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.booking_incidents i
        WHERE i.booking_id = b.id AND i.blocks_completion AND i.status IN ('open', 'in_review')
      )
    ORDER BY b.confirmation_prompt_due_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.bookings b
  SET confirmation_prompt_state = 'sending',
      confirmation_prompt_attempts = b.confirmation_prompt_attempts + 1,
      updated_at = now()
  FROM elegibles e
  WHERE b.id = e.id
  RETURNING b.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_confirmation_prompt_sent(p_booking_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.bookings
  SET confirmation_prompt_state = 'sent',
      confirmation_prompt_sent_at = now(),
      updated_at = now()
  WHERE id = p_booking_id AND confirmation_prompt_state = 'sending';
$$;

-- Vuelve a 'pending' para que el reloj lo reintente; a 'failed' cuando ya no quedan intentos.
-- Un correo perdido significa que el cliente pierde su derecho a objetar sin enterarse, asi
-- que se prefiere reintentar (y arriesgar un duplicado) antes que rendirse en el primer fallo.
CREATE OR REPLACE FUNCTION public.mark_confirmation_prompt_failed(p_booking_id uuid, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.bookings
  SET confirmation_prompt_state = CASE WHEN confirmation_prompt_attempts >= 3 THEN 'failed' ELSE 'pending' END,
      updated_at = now()
  WHERE id = p_booking_id AND confirmation_prompt_state = 'sending';

  INSERT INTO public.booking_funnel_events (level, event, source, context)
  VALUES ('error', 'booking.confirmation_prompt_failed', 'db-rpc',
          jsonb_build_object('bookingId', p_booking_id, 'error', p_error));
EXCEPTION WHEN undefined_table OR undefined_column THEN
  NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_booking_confirmation_token(
  p_booking_id uuid,
  p_token_hash bytea,
  p_expires_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_vivos integer;
BEGIN
  DELETE FROM public.booking_confirmation_tokens
  WHERE booking_id = p_booking_id AND (expires_at < now() OR used_at IS NOT NULL);

  -- Un reintento acuña un token NUEVO y NO mata los anteriores: si el cliente abre el primer
  -- correo despues de que salga el segundo, ese enlace tiene que seguir funcionando. Un
  -- "enlace invalido" es una queja peor que un correo duplicado.
  SELECT count(*) INTO v_vivos FROM public.booking_confirmation_tokens WHERE booking_id = p_booking_id;
  IF v_vivos >= 5 THEN
    DELETE FROM public.booking_confirmation_tokens
    WHERE id IN (
      SELECT id FROM public.booking_confirmation_tokens
      WHERE booking_id = p_booking_id ORDER BY created_at LIMIT (v_vivos - 4)
    );
  END IF;

  INSERT INTO public.booking_confirmation_tokens (booking_id, token_hash, expires_at)
  VALUES (p_booking_id, p_token_hash, p_expires_at)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Consumo del enlace de un clic. Devuelve SIEMPRE un desenlace, nunca una excepcion: la
-- pantalla publica tiene que poder explicarle al cliente que ha pasado en cada caso.
CREATE OR REPLACE FUNCTION public.redeem_booking_confirmation_token(
  p_token_hash bytea,
  p_ip inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token   public.booking_confirmation_tokens%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_outcome text;
  v_service text;
  v_gardener text;
BEGIN
  SELECT * INTO v_token FROM public.booking_confirmation_tokens
  WHERE token_hash = p_token_hash FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_token.booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  SELECT s.name INTO v_service FROM public.services s WHERE s.id = v_booking.service_id;
  SELECT split_part(btrim(p.full_name), ' ', 1) INTO v_gardener
  FROM public.profiles p WHERE p.user_id = v_booking.gardener_id;

  IF v_booking.status = 'disputed' THEN
    v_outcome := 'incident_open';
  ELSIF v_token.used_at IS NOT NULL THEN
    -- Un segundo clic sobre el mismo enlace no es un error: es el mismo si de siempre.
    v_outcome := CASE WHEN v_booking.status = 'completed' THEN 'already_used' ELSE 'not_confirmable' END;
  ELSIF v_booking.status = 'completed' THEN
    v_outcome := 'already_completed';
  ELSIF v_token.expires_at < now() THEN
    v_outcome := 'expired';
  ELSIF v_booking.status <> 'confirmed' THEN
    v_outcome := 'not_confirmable';
  ELSE
    UPDATE public.booking_confirmation_tokens
    SET used_at = now(), used_ip = p_ip, used_user_agent = left(COALESCE(p_user_agent, ''), 500)
    WHERE id = v_token.id;

    UPDATE public.bookings
    SET status = 'completed',
        client_confirmed_at = now(),
        client_confirmed_via = 'email_token',
        updated_at = now()
    WHERE id = v_booking.id;

    v_outcome := 'confirmed';
  END IF;

  -- PII minima a proposito: esto se responde SIN sesion iniciada.
  RETURN jsonb_build_object(
    'outcome', v_outcome,
    'bookingId', v_booking.id,
    'status', v_booking.status,
    'serviceName', v_service,
    'gardenerFirstName', v_gardener,
    'date', v_booking.date,
    'autoCompleted', v_booking.auto_completed_at IS NOT NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_incident_money_result(
  p_incident_id uuid,
  p_money_status text,
  p_payment_intent_id text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.booking_incidents
  SET money_status = p_money_status,
      money_attempted_at = now(),
      stripe_payment_intent_id = COALESCE(p_payment_intent_id, stripe_payment_intent_id),
      updated_at = now()
  WHERE id = p_incident_id;
$$;

REVOKE ALL ON FUNCTION public.claim_due_confirmation_prompts(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_confirmation_prompt_sent(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_confirmation_prompt_failed(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_booking_confirmation_token(uuid, bytea, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redeem_booking_confirmation_token(bytea, inet, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_incident_money_result(uuid, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_due_confirmation_prompts(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_confirmation_prompt_sent(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_confirmation_prompt_failed(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_booking_confirmation_token(uuid, bytea, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.redeem_booking_confirmation_token(bytea, inet, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_incident_money_result(uuid, text, text) TO service_role;

-- =============================================
-- 7) RPCs del cliente
-- =============================================

-- Confirmar NO mueve dinero: los gastos de gestion se capturaron al aceptar el jardinero.
-- Confirmar solo cierra la reserva y desbloquea la valoracion. Eso es justo lo que hace
-- defendible que el enlace del correo funcione sin sesion iniciada.
CREATE OR REPLACE FUNCTION public.confirm_booking_service(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada' USING ERRCODE = 'no_data_found';
  END IF;

  IF auth.uid() IS DISTINCT FROM v_booking.client_id THEN
    RAISE EXCEPTION 'Solo el cliente de la reserva puede confirmar el servicio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Idempotente: pulsar dos veces no puede parecer un error.
  IF v_booking.status = 'completed' THEN
    RETURN jsonb_build_object('bookingId', p_booking_id, 'outcome', 'already_completed', 'idempotent', true);
  END IF;

  IF v_booking.status = 'disputed' THEN
    RAISE EXCEPTION 'Tienes una incidencia en revisión sobre esta reserva'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_booking.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Esta reserva no se puede confirmar (estado: %)', v_booking.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF now() < public.booking_service_end(v_booking) THEN
    RAISE EXCEPTION 'Todavía no puedes confirmar: el servicio no ha terminado'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.bookings
  SET status = 'completed',
      client_confirmed_at = now(),
      client_confirmed_via = 'app',
      updated_at = now()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object('bookingId', p_booking_id, 'outcome', 'confirmed', 'idempotent', false);
END;
$$;

-- Abrir un parte de incidencia. El cliente NO resuelve nada: describe lo que pasó y lo revisa
-- un administrador. Las bloqueantes ademas sacan la reserva del alcance del auto-completado.
CREATE OR REPLACE FUNCTION public.report_booking_incident(
  p_booking_id uuid,
  p_kind text,
  p_description text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_blocks boolean;
  v_id uuid;
  v_abiertas integer;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada' USING ERRCODE = 'no_data_found';
  END IF;

  IF auth.uid() IS DISTINCT FROM v_booking.client_id THEN
    RAISE EXCEPTION 'Solo el cliente de la reserva puede abrir una incidencia'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF length(btrim(COALESCE(p_description, ''))) < 10 THEN
    RAISE EXCEPTION 'Cuéntanos un poco más de lo que ha pasado (al menos 10 caracteres)'
      USING ERRCODE = 'check_violation';
  END IF;

  v_blocks := p_kind IN ('gardener_no_show', 'service_not_done', 'service_incomplete');

  IF v_blocks THEN
    IF now() < public.booking_service_end(v_booking) THEN
      RAISE EXCEPTION 'Todavía no puedes abrir esta incidencia: el servicio no ha terminado'
        USING ERRCODE = 'check_violation';
    END IF;
    -- 14 dias desde el fin del servicio. Es la red que hace RECUPERABLE un correo perdido:
    -- sin ella, quien no viera el aviso se quedaria sin forma de reclamar.
    IF now() > public.booking_service_end(v_booking) + interval '14 days' THEN
      RAISE EXCEPTION 'El plazo para reclamar sobre este servicio ha terminado'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_booking.status NOT IN ('confirmed', 'completed', 'no_show_client') THEN
      RAISE EXCEPTION 'Esta reserva no admite este tipo de incidencia (estado: %)', v_booking.status
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT count(*) INTO v_abiertas FROM public.booking_incidents
    WHERE booking_id = p_booking_id AND NOT blocks_completion;
    IF v_abiertas >= 5 THEN
      RAISE EXCEPTION 'Ya has abierto varias incidencias sobre esta reserva. Escríbenos y lo vemos.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.booking_incidents (booking_id, reported_by, reporter_role, kind, description)
    VALUES (p_booking_id, auth.uid(), 'client', p_kind, btrim(p_description))
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Ya tienes una incidencia abierta sobre esta reserva'
      USING ERRCODE = 'check_violation';
  END;

  INSERT INTO public.booking_incident_events (incident_id, actor_id, from_status, to_status, note)
  VALUES (v_id, auth.uid(), NULL, 'open', 'Incidencia abierta por el cliente');

  IF v_blocks AND v_booking.status IN ('confirmed', 'completed') THEN
    UPDATE public.bookings SET status = 'disputed', updated_at = now() WHERE id = p_booking_id;
  END IF;

  -- Texto neutro: lo leen las dos partes y todavia no se ha resuelto nada.
  PERFORM public.post_booking_system_message(
    p_booking_id,
    'El cliente ha abierto una incidencia sobre este servicio. La estamos revisando y os diremos algo en breve.'
  );

  RETURN jsonb_build_object('incidentId', v_id, 'bookingId', p_booking_id, 'blocksCompletion', v_blocks);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_booking_service(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.report_booking_incident(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_booking_service(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_booking_incident(uuid, text, text) TO authenticated, service_role;

-- =============================================
-- 8) RPCs del jardinero
-- =============================================

-- "He terminado". NO cierra la reserva: solo adelanta el aviso al cliente, que es quien
-- confirma. La fecha limite NO se adelanta: el cliente conserva sus 24 h contadas desde el
-- fin previsto, asi que la diligencia del jardinero nunca le recorta el plazo.
CREATE OR REPLACE FUNCTION public.mark_gardener_finished(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada' USING ERRCODE = 'no_data_found';
  END IF;

  IF auth.uid() IS DISTINCT FROM v_booking.gardener_id THEN
    RAISE EXCEPTION 'Solo el profesional de la reserva puede marcarla como terminada'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_booking.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Esta reserva no admite marcarse como terminada (estado: %)', v_booking.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Desde que EMPIEZA el servicio: terminar antes de lo estimado es normal y no debe
  -- obligar al profesional a esperar a que pase la hora prevista de fin.
  IF now() < public.booking_service_start(v_booking) THEN
    RAISE EXCEPTION 'Todavía no puedes marcarla: el servicio no ha empezado'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_booking.gardener_finished_at IS NOT NULL THEN
    RETURN jsonb_build_object('bookingId', p_booking_id, 'outcome', 'already_finished', 'idempotent', true);
  END IF;

  UPDATE public.bookings
  SET gardener_finished_at = now(),
      confirmation_prompt_due_at = LEAST(COALESCE(confirmation_prompt_due_at, now()), now()),
      updated_at = now()
  WHERE id = p_booking_id;

  PERFORM public.post_booking_system_message(
    p_booking_id,
    'El profesional ha marcado el servicio como terminado. Confírmalo para cerrar la reserva.'
  );

  RETURN jsonb_build_object('bookingId', p_booking_id, 'outcome', 'finished', 'idempotent', false);
END;
$$;

-- Alegacion del jardinero: puede dar su version antes de que el administrador decida.
CREATE OR REPLACE FUNCTION public.respond_to_incident(p_incident_id uuid, p_response text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_incident public.booking_incidents%ROWTYPE;
  v_gardener uuid;
BEGIN
  SELECT * INTO v_incident FROM public.booking_incidents WHERE id = p_incident_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Incidencia no encontrada' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT b.gardener_id INTO v_gardener FROM public.bookings b WHERE b.id = v_incident.booking_id;
  IF auth.uid() IS DISTINCT FROM v_gardener THEN
    RAISE EXCEPTION 'Solo el profesional de la reserva puede responder a esta incidencia'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_incident.status NOT IN ('open', 'in_review') THEN
    RAISE EXCEPTION 'Esta incidencia ya está resuelta' USING ERRCODE = 'check_violation';
  END IF;

  IF length(btrim(COALESCE(p_response, ''))) < 10 THEN
    RAISE EXCEPTION 'Explica un poco más tu versión (al menos 10 caracteres)'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.booking_incidents
  SET gardener_response = btrim(p_response),
      gardener_responded_at = now(),
      updated_at = now()
  WHERE id = p_incident_id;

  INSERT INTO public.booking_incident_events (incident_id, actor_id, from_status, to_status, note)
  VALUES (p_incident_id, auth.uid(), v_incident.status, v_incident.status, 'Alegación del profesional');

  RETURN jsonb_build_object('incidentId', p_incident_id, 'ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_gardener_finished(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_to_incident(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_gardener_finished(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.respond_to_incident(uuid, text) TO authenticated, service_role;

-- =============================================
-- 9) RPCs del administrador
-- =============================================

CREATE OR REPLACE FUNCTION public.set_incident_in_review(p_incident_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_incident public.booking_incidents%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede gestionar incidencias' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_incident FROM public.booking_incidents WHERE id = p_incident_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Incidencia no encontrada' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_incident.status <> 'open' THEN
    RETURN jsonb_build_object('incidentId', p_incident_id, 'status', v_incident.status, 'idempotent', true);
  END IF;

  UPDATE public.booking_incidents SET status = 'in_review', updated_at = now() WHERE id = p_incident_id;
  INSERT INTO public.booking_incident_events (incident_id, actor_id, from_status, to_status)
  VALUES (p_incident_id, auth.uid(), 'open', 'in_review');

  RETURN jsonb_build_object('incidentId', p_incident_id, 'status', 'in_review', 'idempotent', false);
END;
$$;

-- Resuelve la incidencia y DEVUELVE que hay que hacer con el dinero. No habla con Stripe:
-- ese reparto de responsabilidades es el mismo que ya sigue `cancel_booking`.
--
-- Es idempotente a proposito: si quedo resuelta pero el movimiento en Stripe fallo, volver a
-- llamarla devuelve otra vez 'refund'. Asi el boton de "reintentar reembolso" del panel es
-- esta misma accion, sin codigo aparte.
CREATE OR REPLACE FUNCTION public.resolve_booking_incident(
  p_incident_id uuid,
  p_outcome text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_incident public.booking_incidents%ROWTYPE;
  v_booking  public.bookings%ROWTYPE;
  v_new_status text;
  v_money_action text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede resolver incidencias' USING ERRCODE = '42501';
  END IF;

  IF p_outcome NOT IN ('refund', 'no_action', 'reject') THEN
    RAISE EXCEPTION 'Resolución no válida: %', p_outcome USING ERRCODE = 'check_violation';
  END IF;

  IF p_outcome IN ('no_action', 'reject') AND length(btrim(COALESCE(p_note, ''))) < 5 THEN
    RAISE EXCEPTION 'Explica el motivo de la resolución' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_incident FROM public.booking_incidents WHERE id = p_incident_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Incidencia no encontrada' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_incident.booking_id FOR UPDATE;

  -- Ya resuelta: solo se repite la accion economica si quedo a medias.
  IF v_incident.status IN ('resolved_refunded', 'resolved_no_action', 'rejected') THEN
    IF v_incident.status = 'resolved_refunded'
       AND COALESCE(v_incident.money_status, '') NOT IN ('refunded', 'released', 'no_payment') THEN
      RETURN jsonb_build_object(
        'incidentId', p_incident_id, 'bookingId', v_incident.booking_id,
        'status', v_incident.status, 'money_action', 'refund', 'idempotent', true
      );
    END IF;
    RETURN jsonb_build_object(
      'incidentId', p_incident_id, 'bookingId', v_incident.booking_id,
      'status', v_incident.status, 'money_action', 'none', 'idempotent', true
    );
  END IF;

  IF p_outcome = 'refund' THEN
    v_new_status := 'resolved_refunded';
    v_money_action := 'refund';
  ELSIF p_outcome = 'no_action' THEN
    v_new_status := 'resolved_no_action';
    v_money_action := 'none';
  ELSE
    v_new_status := 'rejected';
    v_money_action := 'none';
  END IF;

  UPDATE public.booking_incidents
  SET status = v_new_status,
      money_action = v_money_action,
      -- 'pending' se escribe ANTES de llamar a Stripe: si el proceso se cae a mitad, queda
      -- rastro de que habia un movimiento en curso en vez de parecer que nunca se intento.
      money_status = CASE WHEN v_money_action = 'refund' THEN 'pending' ELSE NULL END,
      resolution_note = NULLIF(btrim(COALESCE(p_note, '')), ''),
      resolved_by = auth.uid(),
      resolved_at = now(),
      updated_at = now()
  WHERE id = p_incident_id;

  INSERT INTO public.booking_incident_events (incident_id, actor_id, from_status, to_status, note, context)
  VALUES (p_incident_id, auth.uid(), v_incident.status, v_new_status, p_note,
          jsonb_build_object('outcome', p_outcome, 'moneyAction', v_money_action));

  IF v_incident.blocks_completion AND v_booking.status = 'disputed' THEN
    IF p_outcome = 'refund' THEN
      UPDATE public.bookings
      SET status = 'cancelled',
          cancellation_actor = 'system',
          cancelled_by = auth.uid(),
          cancelled_at = now(),
          cancellation_reason = 'Incidencia ' || p_incident_id::text,
          updated_at = now()
      WHERE id = v_booking.id;

      IF v_incident.kind = 'gardener_no_show' THEN
        INSERT INTO public.reviews (booking_id, client_id, gardener_id, rating, comment, is_system_penalty, system_reason)
        VALUES (v_booking.id, NULL, v_booking.gardener_id, 1, 'Servicio no completado', true, 'gardener_no_show')
        ON CONFLICT DO NOTHING;
      END IF;

      PERFORM public.release_booking_schedule(v_booking.id);
    ELSE
      UPDATE public.bookings SET status = 'completed', updated_at = now() WHERE id = v_booking.id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'incidentId', p_incident_id, 'bookingId', v_incident.booking_id,
    'status', v_new_status, 'money_action', v_money_action, 'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_incident_in_review(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_booking_incident(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_incident_in_review(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_booking_incident(uuid, text, text) TO authenticated, service_role;

-- =============================================
-- 10) Auto-finalizacion: por fecha limite, y nunca con una incidencia abierta
-- =============================================
CREATE OR REPLACE FUNCTION public.auto_complete_due_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_count integer := 0;
BEGIN
  FOR v_booking IN
    SELECT b.* FROM public.bookings b
    WHERE b.status = 'confirmed'
      AND COALESCE(
            b.confirmation_deadline_at,
            public.booking_service_end(b) + interval '24 hours'
          ) <= now()
      -- Redundante con el estado 'disputed', y ahi esta su valor: si una incidencia
      -- bloqueante llegara a existir sobre una reserva que sigue 'confirmed' por cualquier
      -- camino futuro, esto lo para igual. Coste cero, garantia absoluta.
      AND NOT EXISTS (
        SELECT 1 FROM public.booking_incidents i
        WHERE i.booking_id = b.id AND i.blocks_completion AND i.status IN ('open', 'in_review')
      )
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.bookings
    SET status = 'completed',
        auto_completed_at = now(),
        updated_at = now()
    WHERE id = v_booking.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_complete_due_bookings() FROM PUBLIC;
