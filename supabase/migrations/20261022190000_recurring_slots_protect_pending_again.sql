-- Re-aplica un fix que se verificó en vivo el 2026-09-13 (commit local
-- 42c5519, rama claude/heuristic-roentgen-de7608) y que nunca llegó a
-- main: quedó en un worktree aparte y la migración
-- 20260925130000_empresas_f5_team_schedules.sql — escrita después, pero
-- sobre la versión de la función previa al fix — reintrodujo el mismo bug
-- al tocar generate_recurring_slots() por otro motivo (F5, Empresas).
--
-- Bug: el paso de "re-protección" de generate_recurring_slots() solo
-- blinda reservas con status IN ('confirmed', 'in_progress') — y
-- 'in_progress' no es un valor válido de bookings.status desde
-- 20260806120000_booking_lifecycle_foundation (la máquina de estados pasa
-- de 'pending' a 'confirmed' directamente). Secuencia real que corrompe
-- availability/availability_blocks:
--   1) Un cliente paga por Stripe. confirm_booking_payment_attempt() crea
--      la reserva en status = 'pending' (el jardinero aún no ha
--      respondido), inserta booking_blocks y marca is_available = false
--      en las horas correspondientes.
--   2) Antes de que el jardinero responda, generate_recurring_slots(...)
--      se ejecuta para ese jardinero — algo tan normal como guardar su
--      plantilla semanal. Borra y regenera todas las horas futuras como
--      "libres", y solo re-protege las de reservas 'confirmed'/
--      'in_progress'. Las de la reserva 'pending' quedan liberadas.
--   3) Cuando el jardinero acepta, reserve_booking_schedule() ve que ya
--      existen booking_blocks para esa reserva y no vuelve a tocar
--      availability_blocks — la corrupción no se cura sola, y el selector
--      de horario puede ofrecer esa hora a un segundo cliente.
--
-- Fix: una reserva 'pending' ya tiene capacidad real reservada en
-- booking_blocks y debe protegerse igual que una 'confirmed'. Se mantiene
-- intacta la exclusión de F5 (NOT EXISTS booking_blocks): esas reservas ya
-- las protege protect_sold_availability() por persona asignada, y
-- aplicarles este filtro también cerraría de más las horas del dueño de
-- una empresa.

CREATE OR REPLACE FUNCTION public.generate_recurring_slots(target_gardener_id uuid, force_regenerate boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  setting RECORD;
  rule RECORD;
  current_date_val date := CURRENT_DATE;
  start_date date;
  end_date date;
  iter_date date;
  day_idx integer;
  start_h integer;
  end_h integer;
  slot_hour integer;
  template_count integer;
BEGIN
  SELECT *
  INTO setting
  FROM public.recurring_availability_settings
  WHERE gardener_id = target_gardener_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Guard: never let an empty template destroy availability or move the
  -- watermark. Without recurring rules there is nothing to generate, and the
  -- destructive DELETE below would erase manual availability with no
  -- replacement.
  SELECT count(*) INTO template_count
  FROM public.recurring_schedules
  WHERE gardener_id = target_gardener_id;

  IF template_count = 0 THEN
    RETURN;
  END IF;

  end_date := current_date_val + (setting.weeks_to_maintain * 7);

  IF force_regenerate THEN
    start_date := current_date_val;

    DELETE FROM public.availability
    WHERE gardener_id = target_gardener_id
      AND date >= start_date;

    DELETE FROM public.availability_blocks
    WHERE gardener_id = target_gardener_id
      AND date >= start_date;
  ELSE
    IF setting.last_generated_date IS NULL THEN
      start_date := current_date_val;
    ELSE
      start_date := GREATEST(current_date_val, setting.last_generated_date + 1);
    END IF;
  END IF;

  IF start_date > end_date THEN
    RETURN;
  END IF;

  -- Generate availability slots from recurring schedule rules.
  iter_date := start_date;
  WHILE iter_date <= end_date LOOP
    day_idx := EXTRACT(DOW FROM iter_date);

    FOR rule IN
      SELECT *
      FROM public.recurring_schedules
      WHERE gardener_id = target_gardener_id
        AND day_of_week = day_idx
    LOOP
      start_h := EXTRACT(HOUR FROM rule.start_time);
      end_h   := EXTRACT(HOUR FROM rule.end_time);

      FOR slot_hour IN start_h .. (end_h - 1) LOOP
        INSERT INTO public.availability_blocks (
          gardener_id, date, hour_block, is_available
        ) VALUES (
          target_gardener_id, iter_date, slot_hour, true
        )
        ON CONFLICT (gardener_id, date, hour_block) DO UPDATE
          SET is_available = EXCLUDED.is_available,
              updated_at   = now();

        INSERT INTO public.availability (
          gardener_id, date, start_time, end_time, is_available
        ) VALUES (
          target_gardener_id,
          iter_date,
          make_time(slot_hour, 0, 0),
          (make_time(slot_hour, 0, 0) + interval '1 hour')::time,
          true
        )
        ON CONFLICT (gardener_id, date, start_time) DO UPDATE
          SET end_time     = EXCLUDED.end_time,
              is_available = EXCLUDED.is_available;
      END LOOP;
    END LOOP;

    iter_date := iter_date + 1;
  END LOOP;

  -- Re-protect slots that belong to a booking that already holds real
  -- capacity. 'pending' means paid-and-awaiting-gardener-response: it already
  -- has booking_blocks rows and must never be shown as available again.
  UPDATE public.availability av
  SET is_available = false
  WHERE av.gardener_id = target_gardener_id
    AND av.date >= start_date
    AND av.date <= end_date
    AND EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.gardener_id = target_gardener_id
        AND b.date::date    = av.date
        AND b.status        IN ('pending', 'confirmed')
        -- F5 (GarSer Empresas): solo reservas antiguas sin agenda por persona. Las que tienen
        -- booking_blocks las protege protect_sold_availability() por la persona que va; sin
        -- este filtro, al dueño de una empresa que trabaja se le cerraban las horas de TODOS
        -- los trabajos de su empresa (b.gardener_id es la empresa, que es su misma cuenta).
        AND NOT EXISTS (SELECT 1 FROM public.booking_blocks bb WHERE bb.booking_id = b.id)
        AND av.start_time  >= b.start_time::time
        AND av.start_time   < (b.start_time::time + (b.duration_hours || ' hours')::interval)::time
    );

  UPDATE public.availability_blocks ab
  SET is_available = false
  WHERE ab.gardener_id = target_gardener_id
    AND ab.date >= start_date
    AND ab.date <= end_date
    AND EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.gardener_id   = target_gardener_id
        AND b.date::date     = ab.date
        AND b.status         IN ('pending', 'confirmed')
        AND NOT EXISTS (SELECT 1 FROM public.booking_blocks bb WHERE bb.booking_id = b.id)
        AND ab.hour_block   >= EXTRACT(HOUR FROM b.start_time::time)::int
        AND ab.hour_block    < (EXTRACT(HOUR FROM b.start_time::time)::int + b.duration_hours)
    );

  UPDATE public.recurring_availability_settings
  SET last_generated_date = end_date
  WHERE gardener_id = target_gardener_id;
END;
$function$;

-- Reparación única: cura cualquier fila de availability/availability_blocks
-- que este bug haya dejado como is_available = true para una reserva que
-- hoy sigue 'pending' o 'confirmed' en una fecha futura. Mismo alcance que
-- la función (date >= CURRENT_DATE) y misma exclusión de F5.
UPDATE public.availability_blocks ab
SET is_available = false
WHERE ab.date >= CURRENT_DATE
  AND EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.gardener_id = ab.gardener_id
      AND b.date::date    = ab.date
      AND b.status        IN ('pending', 'confirmed')
      AND NOT EXISTS (SELECT 1 FROM public.booking_blocks bb WHERE bb.booking_id = b.id)
      AND ab.hour_block  >= EXTRACT(HOUR FROM b.start_time::time)::int
      AND ab.hour_block   < (EXTRACT(HOUR FROM b.start_time::time)::int + b.duration_hours)
  );

UPDATE public.availability av
SET is_available = false
WHERE av.date >= CURRENT_DATE
  AND EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.gardener_id = av.gardener_id
      AND b.date::date    = av.date
      AND b.status        IN ('pending', 'confirmed')
      AND NOT EXISTS (SELECT 1 FROM public.booking_blocks bb WHERE bb.booking_id = b.id)
      AND av.start_time  >= b.start_time::time
      AND av.start_time   < (b.start_time::time + (b.duration_hours || ' hours')::interval)::time
  );
