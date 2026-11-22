-- La visita de un plan de mantenimiento no cae en un hueco en el que el CLIENTE ya tiene otra reserva
-- (FASE 4, paquete 1.17, QA-127, 2026-11-19).
--
-- Antes: maintenance_find_slot solo miraba si el PROFESIONAL del plan tenía hueco. Un cliente con una reserva
-- con otra persona el mismo día y hora recibía la propuesta de visita igualmente; confirmándola se
-- quedaba con dos reservas a la vez, cada una con su cobro, y ni la propuesta ni la confirmación avisaban.
--
-- Qué hace:
--   · client_slot_is_busy(cliente, día, hora, horas, plan a ignorar): ¿tiene el cliente en ese tramo una reserva
--     viva (pendiente, confirmada o en disputa), un pago en curso (retención activa) u otra visita propuesta
--     de otro de sus planes?
--   · maintenance_find_slot salta los huecos en los que ese cliente está ocupado y sigue con la siguiente hora
--     preferida u otro de los tres días que ya probaba.
--
-- Vuelta atrás: reponer maintenance_find_slot desde 20260926140000_empresas_f9_maintenance_plans.sql y borrar
-- client_slot_is_busy.

CREATE OR REPLACE FUNCTION public.client_slot_is_busy(
  p_client uuid,
  p_date date,
  p_hour integer,
  p_hours integer,
  p_ignore_plan uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH c AS (
    SELECT (p_date + make_time(p_hour, 0, 0)) AS s,
           (p_date + make_time(LEAST(p_hour + GREATEST(p_hours, 1), 23), 0, 0)) AS e
  )
  SELECT
    -- Reservas vivas del cliente (de cualquier profesional). Una de varios días ocupa de su primer día al último.
    EXISTS (
      SELECT 1 FROM public.bookings b, c
      WHERE b.client_id = p_client
        AND b.status IN ('pending', 'confirmed', 'disputed')
        AND (b.date + b.start_time) < c.e
        AND (COALESCE(b.end_date, b.date) + COALESCE(b.end_time, b.start_time + make_interval(hours => COALESCE(b.duration_hours, 1)::int))) > c.s
    )
    -- Un pago en curso suyo (retención del hueco todavía activa).
    OR EXISTS (
      SELECT 1 FROM public.booking_schedule_holds h, c
      WHERE h.client_id = p_client
        AND h.status = 'active'
        AND h.expires_at > now()
        AND (h.selected_date + h.selected_start_time) < c.e
        AND (h.selected_date + h.selected_start_time + make_interval(hours => GREATEST(COALESCE(h.duration_hours, 1), 1)::int)) > c.s
    )
    -- Otra visita ya propuesta de otro plan del mismo cliente.
    OR EXISTS (
      SELECT 1 FROM public.maintenance_visits v
      JOIN public.maintenance_plans pl ON pl.id = v.plan_id, c
      WHERE pl.client_id = p_client
        AND v.status = 'proposed'
        AND v.plan_id IS DISTINCT FROM p_ignore_plan
        AND v.date = p_date
        AND v.start_hour IS NOT NULL
        AND (v.date + make_time(v.start_hour, 0, 0)) < c.e
        AND (v.date + make_time(LEAST(v.start_hour + GREATEST(CEIL(pl.estimated_hours)::int, 1), 23), 0, 0)) > c.s
    );
$$;
REVOKE ALL ON FUNCTION public.client_slot_is_busy(uuid, date, integer, integer, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.maintenance_find_slot(p_plan_id uuid, p_date date)
 RETURNS TABLE(slot_date date, slot_hour integer, first_day_hours integer, end_date date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        -- QA-127: si el cliente ya tiene otra cosa en ese tramo, se prueba otra hora u otro día.
        CONTINUE WHEN public.client_slot_is_busy(v_plan.client_id, v_day, h, v_max + 1 - h, v_plan.id);
        RETURN QUERY SELECT v_day, h, v_max + 1 - h, NULLIF(v_last, v_day);
        RETURN;
      END IF;
    END LOOP;
  END LOOP;
END;
$function$;
