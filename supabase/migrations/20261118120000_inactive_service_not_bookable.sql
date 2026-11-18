-- Tramo 1 · paquete 1.5 · QA-181: un servicio desactivado no se puede presupuestar ni pagar.
--
-- El fallo
--   Desactivar un servicio en Admin → Servicios solo lo ocultaba en la web (ServicesPage filtra
--   is_active). El servidor seguía ofreciendo profesionales, firmando presupuestos y dejando pagar ese
--   servicio: un borrador abierto antes de desactivarlo o una petición directa podían comprarlo.
--
-- Cómo se cierra
--   · service_is_bookable(id): la única definición de «se puede reservar» (is_active, como la web).
--   · booking_quotes: no se firma un presupuesto si su servicio, o cualquiera de los de una visita de
--     varios servicios (items[].serviceId), está desactivado.
--   · booking_payment_attempts: no se empieza a pagar un presupuesto firmado antes de desactivarlo.
--   · booking-authority (función) responde antes con un motivo claro (service_unavailable).
--   Solo al CREAR: las reservas, presupuestos e intentos que ya existen siguen su curso.

CREATE OR REPLACE FUNCTION public.service_is_bookable(p_service_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT s.is_active IS TRUE FROM public.services s WHERE s.id = p_service_id), false);
$$;

COMMENT ON FUNCTION public.service_is_bookable(uuid) IS
  'QA-181: ¿se puede presupuestar y pagar este servicio? Falso si el administrador lo ha desactivado o no existe.';

-- Los servicios de un presupuesto: el principal y los de items (visita de varios servicios).
CREATE OR REPLACE FUNCTION public.quote_service_ids(p_service_id uuid, p_items jsonb)
RETURNS uuid[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT array_agg(DISTINCT x) FROM (
    SELECT p_service_id AS x
    UNION ALL
    SELECT (e ->> 'serviceId')::uuid
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_items) = 'array' THEN p_items ELSE '[]'::jsonb END) e
    WHERE (e ->> 'serviceId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) t WHERE x IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.booking_quotes_service_bookable_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_off text;
BEGIN
  SELECT string_agg(COALESCE(s.name, x::text), ', ') INTO v_off
  FROM unnest(public.quote_service_ids(NEW.service_id, NEW.items)) x
  LEFT JOIN public.services s ON s.id = x
  WHERE NOT public.service_is_bookable(x);
  IF v_off IS NOT NULL THEN
    RAISE EXCEPTION 'service_unavailable: % ya no se puede reservar.', v_off USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_booking_quotes_service_bookable ON public.booking_quotes;
CREATE TRIGGER trg_booking_quotes_service_bookable
  BEFORE INSERT ON public.booking_quotes
  FOR EACH ROW EXECUTE FUNCTION public.booking_quotes_service_bookable_guard();

CREATE OR REPLACE FUNCTION public.booking_payment_attempts_service_bookable_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items jsonb;
  v_off text;
BEGIN
  SELECT q.items INTO v_items FROM public.booking_quotes q WHERE q.id = NEW.quote_id;
  SELECT string_agg(COALESCE(s.name, x::text), ', ') INTO v_off
  FROM unnest(public.quote_service_ids(NEW.service_id, v_items)) x
  LEFT JOIN public.services s ON s.id = x
  WHERE NOT public.service_is_bookable(x);
  IF v_off IS NOT NULL THEN
    RAISE EXCEPTION 'service_unavailable: % ya no se puede reservar.', v_off USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_booking_payment_attempts_service_bookable ON public.booking_payment_attempts;
CREATE TRIGGER trg_booking_payment_attempts_service_bookable
  BEFORE INSERT ON public.booking_payment_attempts
  FOR EACH ROW EXECUTE FUNCTION public.booking_payment_attempts_service_bookable_guard();

REVOKE ALL ON FUNCTION public.service_is_bookable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_is_bookable(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.booking_quotes_service_bookable_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booking_payment_attempts_service_bookable_guard() FROM PUBLIC, anon, authenticated;

-- El perfil público, el enlace del profesional y la búsqueda leen los servicios de esta vista: un
-- servicio desactivado deja de listarse (antes el perfil seguía ofreciéndolo). Copia de
-- 20261117140000 con ese filtro añadido; los valores antiguos que no son identificadores se dejan.
CREATE OR REPLACE VIEW public.public_gardener_directory AS
 SELECT gp.user_id,
    gp.full_name,
    gp.avatar_url,
    gp.rating,
    gp.rating_average,
    gp.rating_count,
    gp.total_reviews,
    ARRAY(
      SELECT x.service_id
      FROM unnest(
        CASE
          WHEN gp.provider_kind = 'company' THEN ARRAY(
            SELECT s.service_id
            FROM unnest(gp.services) AS s(service_id)
            WHERE EXISTS (
              SELECT 1
              FROM public.companies c
              JOIN public.company_members m ON m.company_id = c.id AND m.status = 'active' AND m.counts_as_labour
              JOIN public.company_member_services cms ON cms.member_id = m.id
              WHERE c.provider_user_id = gp.user_id
                AND cms.service_id::text = s.service_id
            )
          )
          ELSE gp.services
        END
      ) AS x(service_id)
      WHERE x.service_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         OR EXISTS (SELECT 1 FROM public.services sv WHERE sv.id::text = x.service_id AND sv.is_active IS TRUE)
    ) AS services,
    gp.max_distance,
    gp.description,
    gp.is_available,
    gp.has_phytosanitary_license,
    gp.provider_kind
   FROM public.gardener_profiles gp;

-- Solo lectura (QA-215): se repite por si esta migración se aplica sobre una base sin la anterior.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.public_gardener_directory FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_gardener_directory TO anon, authenticated;

-- El reloj de los planes de mantenimiento: copia de 20261102150000 con un único añadido (saltar los
-- planes cuyo servicio está pausado). Sin él, la comprobación de booking_quotes haría fallar la
-- pasada entera en cuanto un plan tuviera un servicio desactivado.
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
    -- QA-181: un servicio del plan que GarSer ha pausado no se propone (la base de datos ya no deja
    -- firmar su presupuesto y un error aquí pararía las propuestas de TODOS los planes). El plan no
    -- avanza: al reactivar el servicio, el bucle de abajo salta las fechas ya pasadas y sigue.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM unnest(public.quote_service_ids(v_plan.service_id, v_plan.items)) x
      WHERE NOT public.service_is_bookable(x)
    );
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
          -- Comisión de visita de plan, con la configuración de ESTE momento: queda fijada en la
          -- propuesta y es la que se cobra si el cliente la confirma.
          public.apply_commission_to_economics(
            v_plan.economic_snapshot,
            public.resolve_booking_commission(v_plan.client_id, v_plan.provider_id, NULL, true)
          ),
          v_plan.items,
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
