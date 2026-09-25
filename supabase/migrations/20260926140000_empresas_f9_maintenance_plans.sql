-- GarSer Empresas · F9.1: planes de mantenimiento (servidor).
--
-- Decisiones del usuario (2026-09-24): D17 — plan con confirmación de cada visita (se propone
-- unos días antes y el cliente la confirma y paga la comisión con el pago de siempre; sin tarjetas
-- guardadas; si no confirma, se salta); D18 — semanal, quincenal o mensual; D19 — precio fijo, el
-- del presupuesto de la reserva de la que sale el plan; D20 — todos los profesionales.
--
-- 1) maintenance_plans: sale de una reserva hecha (servicios, datos, precio, hora, día).
-- 2) maintenance_visits: cada visita que toca, con su propuesta (un presupuesto normal con el
--    precio del plan) y, si se paga, su reserva.
-- 3) generate_maintenance_proposals(): 7 días antes busca hueco con el planificador de F7 y crea
--    la propuesta. La llama el reloj de cada 15 minutos (run_booking_lifecycle_maintenance).
-- 4) Crear, cancelar y consultar planes; datos para pagar una propuesta.
-- 5) Pago: maintenance_quote_is_intact() — el pago no recalcula el precio de un presupuesto de
--    plan (D19); en su lugar comprueba que el presupuesto es exactamente el que generó el plan y
--    que plan y visita siguen vigentes. (Defensa en profundidad: nadie salvo service_role puede
--    escribir en booking_quotes; las policies de cliente de esa tabla no tienen permisos detrás.)
-- 6) Al pagarse la propuesta, la visita queda enlazada a su reserva (y la reserva al plan).

-- ── 1) Planes ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.maintenance_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  source_quote_id uuid REFERENCES public.booking_quotes(id) ON DELETE SET NULL,
  frequency text NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
  start_hour integer NOT NULL CHECK (start_hour BETWEEN 0 AND 19),
  anchor_date date NOT NULL,
  next_visit_date date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  service_id uuid NOT NULL REFERENCES public.services(id),
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  items jsonb,
  pricing_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  economic_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_price numeric NOT NULL CHECK (total_price > 0),
  estimated_hours numeric NOT NULL CHECK (estimated_hours > 0),
  pricing_version text NOT NULL,
  provider_config_version text NOT NULL,
  client_latitude numeric(9,6),
  client_longitude numeric(9,6),
  provider_latitude numeric(9,6),
  provider_longitude numeric(9,6),
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by uuid
);
COMMENT ON TABLE public.maintenance_plans IS
  'F9 (D17–D20): plan de mantenimiento. Sale de una reserva; precio fijo (el de su presupuesto). Solo se escribe por RPC.';
CREATE UNIQUE INDEX IF NOT EXISTS uq_maintenance_plans_active_source
  ON public.maintenance_plans(source_booking_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_maintenance_plans_due ON public.maintenance_plans(next_visit_date) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.maintenance_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.maintenance_plans(id) ON DELETE CASCADE,
  planned_date date NOT NULL,
  date date,
  start_hour integer,
  quote_id uuid REFERENCES public.booking_quotes(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('proposed', 'booked', 'skipped', 'no_availability', 'cancelled')),
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, planned_date)
);
COMMENT ON TABLE public.maintenance_visits IS
  'F9: cada visita de un plan. proposed = hay presupuesto esperando al cliente; booked = pagada (reserva normal); skipped = no la confirmó a tiempo; no_availability = no había hueco.';
CREATE INDEX IF NOT EXISTS idx_maintenance_visits_plan ON public.maintenance_visits(plan_id);

ALTER TABLE public.booking_quotes ADD COLUMN IF NOT EXISTS maintenance_visit_id uuid REFERENCES public.maintenance_visits(id) ON DELETE SET NULL;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS maintenance_plan_id uuid REFERENCES public.maintenance_plans(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.bookings.maintenance_plan_id IS 'F9: la reserva es una visita de este plan de mantenimiento.';

CREATE OR REPLACE FUNCTION public.can_read_maintenance_plan(p_plan_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.maintenance_plans p WHERE p.id = p_plan_id AND auth.uid() IN (p.client_id, p.provider_id))
    OR public.is_admin()
  );
$$;
REVOKE ALL ON FUNCTION public.can_read_maintenance_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_maintenance_plan(uuid) TO authenticated;

ALTER TABLE public.maintenance_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_visits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS maintenance_plans_read ON public.maintenance_plans;
CREATE POLICY maintenance_plans_read ON public.maintenance_plans FOR SELECT TO authenticated
  USING (auth.uid() IN (client_id, provider_id) OR public.is_admin());
DROP POLICY IF EXISTS maintenance_visits_read ON public.maintenance_visits;
CREATE POLICY maintenance_visits_read ON public.maintenance_visits FOR SELECT TO authenticated
  USING (public.can_read_maintenance_plan(plan_id));
REVOKE ALL ON public.maintenance_plans, public.maintenance_visits FROM anon, authenticated;
GRANT SELECT ON public.maintenance_plans, public.maintenance_visits TO authenticated;
GRANT ALL ON public.maintenance_plans, public.maintenance_visits TO service_role;

-- La fecha siguiente a una dada según la frecuencia.
CREATE OR REPLACE FUNCTION public.maintenance_next_date(p_date date, p_frequency text)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_frequency
    WHEN 'weekly' THEN p_date + 7
    WHEN 'biweekly' THEN p_date + 14
    ELSE (p_date + interval '1 month')::date
  END;
$$;

-- ── 4) Crear un plan desde una reserva ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_maintenance_plan(p_booking_id uuid, p_frequency text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_quote public.booking_quotes%ROWTYPE;
  v_next date;
  v_plan_id uuid;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR v_booking.client_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Esta reserva no es tuya.';
  END IF;
  IF p_frequency NOT IN ('weekly', 'biweekly', 'monthly') THEN
    RAISE EXCEPTION 'Elige cada semana, cada 2 semanas o cada mes.';
  END IF;
  IF v_booking.status NOT IN ('confirmed', 'completed') THEN
    RAISE EXCEPTION 'Solo se puede hacer un plan a partir de una reserva confirmada o terminada.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.maintenance_plans p WHERE p.source_booking_id = p_booking_id AND p.status = 'active') THEN
    RAISE EXCEPTION 'Ya tienes un plan a partir de esta reserva.';
  END IF;
  SELECT * INTO v_quote FROM public.booking_quotes
  WHERE id::text = v_booking.pricing_context ->> 'quote_id';
  IF NOT FOUND OR v_quote.total_price IS NULL OR v_quote.total_price <= 0 THEN
    RAISE EXCEPTION 'Esta reserva no se puede convertir en plan: no tiene un presupuesto de GarSer.';
  END IF;

  v_next := public.maintenance_next_date(v_booking.date, p_frequency);
  WHILE v_next <= current_date LOOP
    v_next := public.maintenance_next_date(v_next, p_frequency);
  END LOOP;

  INSERT INTO public.maintenance_plans (
    client_id, provider_id, source_booking_id, source_quote_id, frequency, start_hour, anchor_date, next_visit_date,
    service_id, input_payload, items, pricing_snapshot, economic_snapshot, total_price, estimated_hours,
    pricing_version, provider_config_version, client_latitude, client_longitude, provider_latitude, provider_longitude
  ) VALUES (
    v_booking.client_id, v_booking.gardener_id, v_booking.id, v_quote.id, p_frequency,
    EXTRACT(HOUR FROM v_booking.start_time)::integer, v_booking.date, v_next,
    v_quote.service_id, v_quote.input_payload, v_quote.items, v_quote.pricing_snapshot, v_quote.economic_snapshot,
    v_quote.total_price, v_quote.estimated_hours, v_quote.pricing_version, v_quote.provider_config_version,
    v_quote.client_latitude, v_quote.client_longitude, v_quote.provider_latitude, v_quote.provider_longitude
  ) RETURNING id INTO v_plan_id;

  RETURN jsonb_build_object('planId', v_plan_id, 'frequency', p_frequency, 'nextVisitDate', v_next, 'totalPrice', v_quote.total_price);
END;
$$;
REVOKE ALL ON FUNCTION public.create_maintenance_plan(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_maintenance_plan(uuid, text) TO authenticated;

-- Cancelar: el cliente o el profesional. La propuesta abierta deja de valer.
CREATE OR REPLACE FUNCTION public.cancel_maintenance_plan(p_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.maintenance_plans%ROWTYPE;
BEGIN
  SELECT * INTO v_plan FROM public.maintenance_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR auth.uid() NOT IN (v_plan.client_id, v_plan.provider_id) THEN
    RAISE EXCEPTION 'Este plan no es tuyo.';
  END IF;
  IF v_plan.status <> 'active' THEN
    RETURN jsonb_build_object('planId', p_plan_id, 'status', v_plan.status);
  END IF;
  UPDATE public.maintenance_plans SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid() WHERE id = p_plan_id;
  UPDATE public.booking_quotes q SET status = 'expired'
  FROM public.maintenance_visits v
  WHERE v.plan_id = p_plan_id AND v.status = 'proposed' AND q.id = v.quote_id AND q.status = 'active';
  UPDATE public.maintenance_visits SET status = 'cancelled' WHERE plan_id = p_plan_id AND status = 'proposed';
  RETURN jsonb_build_object('planId', p_plan_id, 'status', 'cancelled');
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_maintenance_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_maintenance_plan(uuid) TO authenticated;

-- ── 3) Propuestas ──────────────────────────────────────────────────────────────────
-- Hueco para una visita: la hora del plan ese día; si no, la más cercana ese día; si no, los dos
-- días siguientes. Con el planificador de F7 (y los servicios de F8), como una reserva normal.
CREATE OR REPLACE FUNCTION public.maintenance_find_slot(p_plan_id uuid, p_date date)
RETURNS TABLE(slot_date date, slot_hour integer, first_day_hours integer, end_date date)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.maintenance_plans%ROWTYPE;
  v_labour integer;
  v_license boolean;
  v_extra uuid[];
  v_day date;
  h integer;
  v_last date;
  v_max integer;
BEGIN
  SELECT * INTO v_plan FROM public.maintenance_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_labour := GREATEST(1, CEIL(v_plan.estimated_hours)::integer);
  v_license := COALESCE((v_plan.pricing_snapshot ->> 'requiresPhytosanitaryLicense')::boolean, false);
  SELECT COALESCE(array_agg((t.x ->> 'serviceId')::uuid ORDER BY t.o), '{}') INTO v_extra
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_plan.items) = 'array' THEN v_plan.items ELSE '[]'::jsonb END) WITH ORDINALITY AS t(x, o)
  WHERE t.o > 1;

  FOR i IN 0 .. 2 LOOP
    v_day := p_date + i;
    -- Al menos pasado mañana: el cliente tiene hasta un día antes para confirmar.
    CONTINUE WHEN v_day < current_date + 2;
    FOR h IN
      SELECT g FROM generate_series(7, 19) AS g ORDER BY abs(g - v_plan.start_hour), g
    LOOP
      SELECT MAX(c.date), MAX(CASE WHEN c.date = v_day THEN c.hour_block END)
      INTO v_last, v_max
      FROM public.plan_booking_cells(v_plan.provider_id, v_plan.service_id, v_day, h, v_labour, v_license, NULL, v_extra) AS c;
      IF v_last IS NOT NULL THEN
        RETURN QUERY SELECT v_day, h, v_max + 1 - h, NULLIF(v_last, v_day);
        RETURN;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.maintenance_find_slot(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.maintenance_find_slot(uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION public.generate_maintenance_proposals()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.maintenance_plans%ROWTYPE;
  v_slot record;
  v_visit_id uuid;
  v_quote_id uuid;
  v_start timestamptz;
  v_selected jsonb;
  v_proposed integer := 0;
  v_unavailable integer := 0;
  v_skipped integer := 0;
BEGIN
  -- Propuestas que el cliente no confirmó a tiempo: se saltan (D17).
  WITH gone AS (
    UPDATE public.maintenance_visits v SET status = 'skipped'
    FROM public.booking_quotes q
    WHERE v.status = 'proposed' AND q.id = v.quote_id AND q.booking_id IS NULL
      AND (q.status <> 'active' OR q.expires_at <= now())
    RETURNING v.id
  )
  SELECT count(*) INTO v_skipped FROM gone;

  FOR v_plan IN
    SELECT * FROM public.maintenance_plans
    WHERE status = 'active' AND next_visit_date <= current_date + 7
    ORDER BY next_visit_date
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Una propuesta abierta cada vez por plan.
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.maintenance_visits v WHERE v.plan_id = v_plan.id AND v.status = 'proposed');
    -- Fechas ya pasadas (el reloj estuvo parado): se avanza sin proponer.
    WHILE v_plan.next_visit_date <= current_date LOOP
      v_plan.next_visit_date := public.maintenance_next_date(v_plan.next_visit_date, v_plan.frequency);
    END LOOP;
    CONTINUE WHEN v_plan.next_visit_date > current_date + 7;

    SELECT * INTO v_slot FROM public.maintenance_find_slot(v_plan.id, v_plan.next_visit_date);
    IF v_slot.slot_date IS NULL THEN
      INSERT INTO public.maintenance_visits (plan_id, planned_date, status)
      VALUES (v_plan.id, v_plan.next_visit_date, 'no_availability')
      ON CONFLICT (plan_id, planned_date) DO NOTHING;
      v_unavailable := v_unavailable + 1;
    ELSE
      v_visit_id := NULL;
      INSERT INTO public.maintenance_visits (plan_id, planned_date, date, start_hour, status)
      VALUES (v_plan.id, v_plan.next_visit_date, v_slot.slot_date, v_slot.slot_hour, 'proposed')
      ON CONFLICT (plan_id, planned_date) DO NOTHING
      RETURNING id INTO v_visit_id;
      IF v_visit_id IS NOT NULL THEN
        v_start := (v_slot.slot_date + make_time(v_slot.slot_hour, 0, 0)) AT TIME ZONE 'Europe/Madrid';
        v_selected := jsonb_build_object(
          'date', v_slot.slot_date,
          'startHour', v_slot.slot_hour,
          'startTime', to_char(make_time(v_slot.slot_hour, 0, 0), 'HH24:MI:SS'),
          'endTime', to_char(make_time(LEAST(v_slot.slot_hour + v_slot.first_day_hours, 23), 0, 0), 'HH24:MI:SS'),
          'durationHours', v_slot.first_day_hours,
          'endDate', v_slot.end_date,
          'labourHours', GREATEST(1, CEIL(v_plan.estimated_hours)::integer)
        );
        INSERT INTO public.booking_quotes (
          client_id, gardener_id, service_id, signature, pricing_version, provider_config_version,
          input_payload, pricing_snapshot, total_price, estimated_hours, status, generated_at, expires_at,
          selected_date, selected_start_time, availability_snapshot, economic_snapshot, items,
          client_latitude, client_longitude, provider_latitude, provider_longitude, maintenance_visit_id
        ) VALUES (
          v_plan.client_id, v_plan.provider_id, v_plan.service_id, 'maintenance:' || v_visit_id::text,
          v_plan.pricing_version, v_plan.provider_config_version,
          v_plan.input_payload,
          v_plan.pricing_snapshot || jsonb_build_object('availability', jsonb_build_object('selectedSlot', v_selected), 'maintenancePlanId', v_plan.id),
          v_plan.total_price, v_plan.estimated_hours, 'active', now(),
          -- 72 h para confirmar, y como muy tarde un día antes de la visita.
          LEAST(now() + interval '72 hours', v_start - interval '24 hours'),
          v_slot.slot_date, make_time(v_slot.slot_hour, 0, 0),
          jsonb_build_object('selectedSlot', v_selected, 'requestedDate', v_slot.slot_date),
          v_plan.economic_snapshot, v_plan.items,
          v_plan.client_latitude, v_plan.client_longitude, v_plan.provider_latitude, v_plan.provider_longitude, v_visit_id
        ) RETURNING id INTO v_quote_id;
        UPDATE public.maintenance_visits SET quote_id = v_quote_id WHERE id = v_visit_id;
        v_proposed := v_proposed + 1;
      END IF;
    END IF;
    UPDATE public.maintenance_plans
    SET next_visit_date = public.maintenance_next_date(v_plan.next_visit_date, v_plan.frequency)
    WHERE id = v_plan.id;
  END LOOP;

  RETURN jsonb_build_object('proposed', v_proposed, 'no_availability', v_unavailable, 'skipped', v_skipped);
END;
$$;
REVOKE ALL ON FUNCTION public.generate_maintenance_proposals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_maintenance_proposals() TO service_role;

-- ── 5) Pago de una propuesta ───────────────────────────────────────────────────────
-- ¿Este presupuesto de plan sigue siendo exactamente lo que generó el plan? (precio, gestión,
-- horas, servicios, cliente, profesional) y ¿el plan sigue activo y la visita pendiente?
CREATE OR REPLACE FUNCTION public.maintenance_quote_is_intact(p_quote_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.booking_quotes q
    JOIN public.maintenance_visits v ON v.id = q.maintenance_visit_id AND v.quote_id = q.id
    JOIN public.maintenance_plans p ON p.id = v.plan_id
    WHERE q.id = p_quote_id
      AND p.status = 'active'
      AND v.status = 'proposed'
      AND q.client_id = p.client_id
      AND q.gardener_id = p.provider_id
      AND q.service_id = p.service_id
      AND q.total_price = p.total_price
      AND q.estimated_hours = p.estimated_hours
      AND q.economic_snapshot = p.economic_snapshot
      AND q.items IS NOT DISTINCT FROM p.items
      AND q.input_payload = p.input_payload
      AND (q.pricing_snapshot ->> 'requiresPhytosanitaryLicense') IS NOT DISTINCT FROM (p.pricing_snapshot ->> 'requiresPhytosanitaryLicense')
      AND q.selected_date = v.date
      AND EXTRACT(HOUR FROM q.selected_start_time)::integer = v.start_hour
  );
$$;
REVOKE ALL ON FUNCTION public.maintenance_quote_is_intact(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.maintenance_quote_is_intact(uuid) TO service_role;

-- Lo que necesita la web para abrir el pago de una propuesta (solo el cliente del plan).
CREATE OR REPLACE FUNCTION public.maintenance_visit_checkout(p_visit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visit public.maintenance_visits%ROWTYPE;
  v_plan public.maintenance_plans%ROWTYPE;
  v_quote public.booking_quotes%ROWTYPE;
BEGIN
  SELECT * INTO v_visit FROM public.maintenance_visits WHERE id = p_visit_id;
  SELECT * INTO v_plan FROM public.maintenance_plans WHERE id = v_visit.plan_id;
  IF v_plan.id IS NULL OR v_plan.client_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Esta visita no es tuya.';
  END IF;
  IF v_visit.status <> 'proposed' OR v_plan.status <> 'active' THEN
    RAISE EXCEPTION 'Esta visita ya no está pendiente de confirmar.';
  END IF;
  SELECT * INTO v_quote FROM public.booking_quotes WHERE id = v_visit.quote_id;
  IF NOT FOUND OR v_quote.status <> 'active' OR v_quote.expires_at <= now() THEN
    RAISE EXCEPTION 'El plazo para confirmar esta visita ha terminado.';
  END IF;
  RETURN jsonb_build_object(
    'quoteId', v_quote.id,
    'signature', v_quote.signature,
    'expiresAt', v_quote.expires_at,
    'providerId', v_quote.gardener_id,
    'serviceId', v_quote.service_id,
    'serviceIds', COALESCE(
      (SELECT jsonb_agg(x -> 'serviceId' ORDER BY o) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_quote.items) = 'array' THEN v_quote.items ELSE '[]'::jsonb END) WITH ORDINALITY AS t(x, o)),
      jsonb_build_array(v_quote.service_id)),
    'items', v_quote.items,
    'inputPayload', v_quote.input_payload,
    'pricingSnapshot', v_quote.pricing_snapshot,
    'economicSnapshot', v_quote.economic_snapshot,
    'availability', v_quote.availability_snapshot,
    'totalPrice', v_quote.total_price,
    'estimatedHours', v_quote.estimated_hours,
    'pricingVersion', v_quote.pricing_version,
    'providerConfigVersion', v_quote.provider_config_version
  );
END;
$$;
REVOKE ALL ON FUNCTION public.maintenance_visit_checkout(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maintenance_visit_checkout(uuid) TO authenticated;

-- ── 6) Al pagarse: la visita, reservada; la reserva, del plan ─────────────────────────
CREATE OR REPLACE FUNCTION public.link_maintenance_visit_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id uuid;
BEGIN
  IF NEW.maintenance_visit_id IS NULL OR NEW.booking_id IS NULL OR NEW.booking_id IS NOT DISTINCT FROM OLD.booking_id THEN
    RETURN NEW;
  END IF;
  UPDATE public.maintenance_visits SET status = 'booked', booking_id = NEW.booking_id
  WHERE id = NEW.maintenance_visit_id
  RETURNING plan_id INTO v_plan_id;
  IF v_plan_id IS NOT NULL THEN
    UPDATE public.bookings SET maintenance_plan_id = v_plan_id WHERE id = NEW.booking_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_link_maintenance_visit_booking ON public.booking_quotes;
CREATE TRIGGER trg_link_maintenance_visit_booking
  AFTER UPDATE OF booking_id ON public.booking_quotes
  FOR EACH ROW EXECUTE FUNCTION public.link_maintenance_visit_booking();

-- Planes del cliente y del profesional, con lo que hace falta para las pantallas.
CREATE OR REPLACE FUNCTION public.my_maintenance_plans()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'role', CASE WHEN p.client_id = auth.uid() THEN 'client' ELSE 'provider' END,
    'status', p.status,
    'frequency', p.frequency,
    'start_hour', p.start_hour,
    'next_visit_date', p.next_visit_date,
    'total_price', p.total_price,
    'estimated_hours', p.estimated_hours,
    'address', p.input_payload ->> 'address',
    'source_booking_id', p.source_booking_id,
    'services', COALESCE(
      (SELECT string_agg(s.name, ' + ' ORDER BY t.o)
       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.items) = 'array' THEN p.items ELSE '[]'::jsonb END) WITH ORDINALITY AS t(x, o)
       JOIN public.services s ON s.id::text = t.x ->> 'serviceId'),
      (SELECT s.name FROM public.services s WHERE s.id = p.service_id)),
    'provider_name', (SELECT gp.full_name FROM public.gardener_profiles gp WHERE gp.user_id = p.provider_id),
    'client_name', (SELECT NULLIF(split_part(BTRIM(COALESCE(pr.full_name, '')), ' ', 1), '') FROM public.profiles pr WHERE pr.user_id = p.client_id),
    'proposal', (
      SELECT jsonb_build_object('visit_id', v.id, 'date', v.date, 'start_hour', v.start_hour, 'expires_at', q.expires_at, 'quote_id', q.id)
      FROM public.maintenance_visits v JOIN public.booking_quotes q ON q.id = v.quote_id
      WHERE v.plan_id = p.id AND v.status = 'proposed' AND q.status = 'active' AND q.expires_at > now()
      ORDER BY v.planned_date LIMIT 1
    ),
    'visits', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('planned_date', v.planned_date, 'date', v.date, 'status', v.status, 'booking_id', v.booking_id) ORDER BY v.planned_date DESC)
      FROM (SELECT * FROM public.maintenance_visits v2 WHERE v2.plan_id = p.id ORDER BY v2.planned_date DESC LIMIT 6) v
    ), '[]'::jsonb)
  ) ORDER BY p.status, p.next_visit_date), '[]'::jsonb)
  FROM public.maintenance_plans p
  WHERE auth.uid() IS NOT NULL AND auth.uid() IN (p.client_id, p.provider_id);
$$;
REVOKE ALL ON FUNCTION public.my_maintenance_plans() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_maintenance_plans() TO authenticated;

-- El reloj de cada 15 minutos genera también las propuestas de los planes.
CREATE OR REPLACE FUNCTION public.run_booking_lifecycle_maintenance()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_url text;
  v_secret text;
  v_request_id bigint;
  v_deleted integer := 0;
BEGIN
  -- Housekeeping que sigue siendo puramente SQL.
  DELETE FROM public.booking_confirmation_tokens
  WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- F9 (GarSer Empresas): propuestas de las próximas visitas de los planes de mantenimiento.
  -- Es SQL puro (en los dos modos); los correos los manda el tick, como los demás.
  BEGIN
    PERFORM public.generate_maintenance_proposals();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'generate_maintenance_proposals: %', SQLERRM;
  END;

  v_url := public.lifecycle_tick_setting('lifecycle_tick_url');
  v_secret := public.lifecycle_tick_setting('lifecycle_tick_secret');

  -- Sin configurar, el reloj sigue haciendo lo de siempre en SQL y lo deja anotado. Preferible
  -- a fallar: caducar solicitudes y cerrar reservas no puede depender de que haya correo.
  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN jsonb_build_object(
      'mode', 'sql_only',
      'reason', 'faltan lifecycle_tick_url o lifecycle_tick_secret en Vault',
      'expired_requests', public.expire_due_booking_requests(),
      'auto_completed_bookings', public.auto_complete_due_bookings(),
      'purged_tokens', v_deleted,
      'ran_at', now()
    );
  END IF;

  -- Una sola peticion por pasada, no una por correo. `pg_net` es asincrono: devuelve el id y
  -- no bloquea la transaccion del cron.
  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-lifecycle-secret', v_secret
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 20000
  ) INTO v_request_id;

  RETURN jsonb_build_object(
    'mode', 'tick',
    'request_id', v_request_id,
    'purged_tokens', v_deleted,
    'ran_at', now()
  );
END;
$function$;
