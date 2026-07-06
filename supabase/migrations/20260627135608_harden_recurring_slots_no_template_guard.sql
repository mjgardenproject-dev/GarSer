-- Harden generate_recurring_slots so it can never silently destroy a gardener's
-- availability, and so lazy maintenance can never get permanently stuck.
--
-- Two production bugs were observed:
--
--  1) Destructive empty template: when a gardener has NO rows in
--     recurring_schedules (e.g. they opened the "fixed schedule" tab and saved
--     with no day/hour selected), a force_regenerate run DELETED every future
--     availability row and re-inserted nothing — wiping any manual weekly
--     availability they had set. The gardener then disappears from search.
--
--  2) Stuck watermark: the same empty run still advanced
--     last_generated_date to (CURRENT_DATE + weeks*7). Because non-forced
--     maintenance starts at last_generated_date + 1, the rolling window could
--     never be back-filled afterwards even once a real schedule existed.
--
-- Fix: if the gardener has no recurring template rows, do NOTHING (no delete,
-- no watermark change). "No template" must never destroy existing availability.
-- A gardener who wants to remove specific availability uses the weekly tab; a
-- real template (>=1 row) keeps the previous delete+regenerate+reprotect flow.

CREATE OR REPLACE FUNCTION public.generate_recurring_slots(
  target_gardener_id uuid,
  force_regenerate boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
AS $$
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

  -- Re-protect slots that belong to confirmed / in-progress bookings.
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
        AND b.status        IN ('confirmed', 'in_progress')
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
        AND b.status         IN ('confirmed', 'in_progress')
        AND ab.hour_block   >= EXTRACT(HOUR FROM b.start_time::time)::int
        AND ab.hour_block    < (EXTRACT(HOUR FROM b.start_time::time)::int + b.duration_hours)
    );

  UPDATE public.recurring_availability_settings
  SET last_generated_date = end_date
  WHERE gardener_id = target_gardener_id;
END;
$$;

-- One-off repair for gardeners already broken by the previous behaviour:
-- they have a recurring template (>=1 row) but ZERO future availability
-- (their slots were wiped, or a stuck watermark stopped generation). Reset the
-- watermark and regenerate ONLY for these. Gardeners that already have future
-- availability are left untouched, so no one-off exceptions are clobbered.
DO $$
DECLARE
  g uuid;
BEGIN
  FOR g IN
    SELECT s.gardener_id
    FROM public.recurring_availability_settings s
    WHERE EXISTS (
      SELECT 1 FROM public.recurring_schedules r
      WHERE r.gardener_id = s.gardener_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.availability a
      WHERE a.gardener_id = s.gardener_id
        AND a.date >= CURRENT_DATE
        AND a.is_available = true
    )
  LOOP
    UPDATE public.recurring_availability_settings
    SET last_generated_date = NULL
    WHERE gardener_id = g;
    PERFORM public.generate_recurring_slots(g, true);
  END LOOP;
END;
$$;
