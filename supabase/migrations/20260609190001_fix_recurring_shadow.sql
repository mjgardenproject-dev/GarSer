-- Fix generate_recurring_slots shadow variable warning
-- Removes shadowed variable h

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
  -- h integer; -- Removed to fix shadowed variable warning
  start_h integer;
  end_h integer;
BEGIN
  SELECT *
  INTO setting
  FROM public.recurring_availability_settings
  WHERE gardener_id = target_gardener_id;

  IF NOT FOUND THEN
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
      end_h := EXTRACT(HOUR FROM rule.end_time);

      FOR h IN start_h .. (end_h - 1) LOOP
        INSERT INTO public.availability_blocks (
          gardener_id,
          date,
          hour_block,
          is_available
        ) VALUES (
          target_gardener_id,
          iter_date,
          h,
          true
        )
        ON CONFLICT (gardener_id, date, hour_block) DO UPDATE
        SET is_available = EXCLUDED.is_available,
            updated_at = now();

        INSERT INTO public.availability (
          gardener_id,
          date,
          start_time,
          end_time,
          is_available
        ) VALUES (
          target_gardener_id,
          iter_date,
          make_time(h, 0, 0),
          (make_time(h, 0, 0) + interval '1 hour')::time,
          true
        )
        ON CONFLICT (gardener_id, date, start_time) DO UPDATE
        SET end_time = EXCLUDED.end_time,
            is_available = EXCLUDED.is_available;
      END LOOP;
    END LOOP;

    iter_date := iter_date + 1;
  END LOOP;

  UPDATE public.recurring_availability_settings
  SET last_generated_date = end_date
  WHERE gardener_id = target_gardener_id;
END;
$$;
