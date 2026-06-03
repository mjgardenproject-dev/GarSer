-- Refactor elegibilidad providers backend-first:
-- - elimina services.base_price
-- - proyecta gardener_profiles.services desde gardener_service_prices
-- - añade coordenadas operativas y columnas persistidas para quotes
-- - refuerza índices parciales alineados con providers/availability/checkout

ALTER TABLE public.services
  DROP COLUMN IF EXISTS base_price;

ALTER TABLE public.gardener_profiles
  ADD COLUMN IF NOT EXISTS operational_latitude numeric(9, 6),
  ADD COLUMN IF NOT EXISTS operational_longitude numeric(9, 6);

ALTER TABLE public.booking_quotes
  ADD COLUMN IF NOT EXISTS client_latitude numeric(9, 6),
  ADD COLUMN IF NOT EXISTS client_longitude numeric(9, 6),
  ADD COLUMN IF NOT EXISTS provider_latitude numeric(9, 6),
  ADD COLUMN IF NOT EXISTS provider_longitude numeric(9, 6);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS client_latitude numeric(9, 6),
  ADD COLUMN IF NOT EXISTS client_longitude numeric(9, 6),
  ADD COLUMN IF NOT EXISTS provider_latitude numeric(9, 6),
  ADD COLUMN IF NOT EXISTS provider_longitude numeric(9, 6);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'gardener_profiles_operational_coordinates_check'
      AND conrelid = 'public.gardener_profiles'::regclass
  ) THEN
    ALTER TABLE public.gardener_profiles
      ADD CONSTRAINT gardener_profiles_operational_coordinates_check
      CHECK (
        (
          operational_latitude IS NULL
          AND operational_longitude IS NULL
        ) OR (
          operational_latitude BETWEEN -90 AND 90
          AND operational_longitude BETWEEN -180 AND 180
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'booking_quotes_client_coordinates_check'
      AND conrelid = 'public.booking_quotes'::regclass
  ) THEN
    ALTER TABLE public.booking_quotes
      ADD CONSTRAINT booking_quotes_client_coordinates_check
      CHECK (
        (
          client_latitude IS NULL
          AND client_longitude IS NULL
        ) OR (
          client_latitude BETWEEN -90 AND 90
          AND client_longitude BETWEEN -180 AND 180
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'booking_quotes_provider_coordinates_check'
      AND conrelid = 'public.booking_quotes'::regclass
  ) THEN
    ALTER TABLE public.booking_quotes
      ADD CONSTRAINT booking_quotes_provider_coordinates_check
      CHECK (
        (
          provider_latitude IS NULL
          AND provider_longitude IS NULL
        ) OR (
          provider_latitude BETWEEN -90 AND 90
          AND provider_longitude BETWEEN -180 AND 180
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bookings_client_coordinates_check'
      AND conrelid = 'public.bookings'::regclass
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_client_coordinates_check
      CHECK (
        (
          client_latitude IS NULL
          AND client_longitude IS NULL
        ) OR (
          client_latitude BETWEEN -90 AND 90
          AND client_longitude BETWEEN -180 AND 180
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bookings_provider_coordinates_check'
      AND conrelid = 'public.bookings'::regclass
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_provider_coordinates_check
      CHECK (
        (
          provider_latitude IS NULL
          AND provider_longitude IS NULL
        ) OR (
          provider_latitude BETWEEN -90 AND 90
          AND provider_longitude BETWEEN -180 AND 180
        )
      );
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS gardener_service_prices_gardener_service_uidx
  ON public.gardener_service_prices (gardener_id, service_id);

CREATE INDEX IF NOT EXISTS gardener_service_prices_active_service_idx
  ON public.gardener_service_prices (service_id, gardener_id)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS availability_active_provider_date_time_idx
  ON public.availability (gardener_id, date, start_time)
  WHERE is_available = true;

CREATE INDEX IF NOT EXISTS booking_quotes_active_slot_idx
  ON public.booking_quotes (gardener_id, service_id, selected_date, selected_start_time)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS gardener_profiles_operational_coordinates_idx
  ON public.gardener_profiles (user_id, max_distance)
  WHERE operational_latitude IS NOT NULL
    AND operational_longitude IS NOT NULL;

UPDATE public.gardener_service_prices
SET active = false
WHERE active = true
  AND COALESCE(additional_config, '{}'::jsonb) = '{}'::jsonb;

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.sync_gardener_profile_services_projection(
  p_gardener_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, private
AS $$
  WITH target_gardeners AS (
    SELECT DISTINCT gardener_id
    FROM public.gardener_service_prices
    WHERE p_gardener_id IS NULL OR gardener_id = p_gardener_id
    UNION
    SELECT user_id
    FROM public.gardener_profiles
    WHERE p_gardener_id IS NULL OR user_id = p_gardener_id
  ),
  projected AS (
    SELECT
      tg.gardener_id,
      COALESCE(
        ARRAY(
          SELECT gsp.service_id::text
          FROM public.gardener_service_prices AS gsp
          WHERE gsp.gardener_id = tg.gardener_id
            AND gsp.active = true
            AND COALESCE(gsp.additional_config, '{}'::jsonb) <> '{}'::jsonb
          ORDER BY gsp.service_id::text
        ),
        ARRAY[]::text[]
      ) AS projected_services
    FROM target_gardeners AS tg
  )
  UPDATE public.gardener_profiles AS gp
  SET services = projected.projected_services
  FROM projected
  WHERE gp.user_id = projected.gardener_id;
$$;

CREATE OR REPLACE FUNCTION private.trg_sync_gardener_profile_services_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_gardener_id uuid;
BEGIN
  v_gardener_id := COALESCE(NEW.gardener_id, OLD.gardener_id);
  PERFORM private.sync_gardener_profile_services_projection(v_gardener_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS sync_gardener_profile_services_projection
  ON public.gardener_service_prices;

CREATE TRIGGER sync_gardener_profile_services_projection
AFTER INSERT OR UPDATE OR DELETE
ON public.gardener_service_prices
FOR EACH ROW
EXECUTE FUNCTION private.trg_sync_gardener_profile_services_projection();

SELECT private.sync_gardener_profile_services_projection();
