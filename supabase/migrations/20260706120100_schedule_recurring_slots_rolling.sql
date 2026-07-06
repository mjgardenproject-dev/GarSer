-- Keep the recurring availability horizon rolling without gardener logins.
--
-- generate_recurring_slots() was only invoked from the gardener panel, so a
-- gardener who did not open their panel for weeks_to_maintain weeks ran out of
-- generated availability and silently disappeared from ProvidersPage with
-- 'no_reservable_availability' for any date past last_generated_date.
--
-- A daily pg_cron job tops up the rolling window for every gardener that has a
-- non-empty recurring template. generate_recurring_slots(gardener, false)
-- already implements the watermark logic (start = last_generated_date + 1,
-- end = today + weeks_to_maintain * 7) and re-protects confirmed bookings, so
-- the daily run only appends missing days and never touches existing data.

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'roll-recurring-availability') THEN
    PERFORM cron.unschedule('roll-recurring-availability');
  END IF;
END
$$;

SELECT cron.schedule(
  'roll-recurring-availability',
  '15 3 * * *',
  $$
  DO $body$
  DECLARE
    g uuid;
  BEGIN
    FOR g IN
      SELECT s.gardener_id
      FROM public.recurring_availability_settings s
      WHERE EXISTS (
        SELECT 1
        FROM public.recurring_schedules r
        WHERE r.gardener_id = s.gardener_id
      )
    LOOP
      PERFORM public.generate_recurring_slots(g, false);
    END LOOP;
  END
  $body$;
  $$
);
