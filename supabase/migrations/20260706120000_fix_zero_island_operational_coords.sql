-- Fix "null island" operational coordinates on gardener profiles.
--
-- Production bug: at least one gardener profile was saved with
-- operational_latitude = 0 AND operational_longitude = 0 (a failed geocode from
-- an older panel version). The eligibility engine treated (0,0) as valid
-- coordinates, so the haversine distance from the Gulf of Guinea to any Spanish
-- address (~4,300 km) always exceeded max_distance and the gardener was
-- silently excluded from ProvidersPage with 'outside_coverage'. Because the
-- coordinates were non-null, the booking-authority auto-geocoding repair never
-- triggered either.
--
-- 1) Null out the corrupted pair so the next booking preview re-geocodes the
--    stored address and self-heals the row.
-- 2) Harden the CHECK constraint so the (0,0) pair can never be written again.

UPDATE public.gardener_profiles
SET operational_latitude = NULL,
    operational_longitude = NULL
WHERE operational_latitude = 0
  AND operational_longitude = 0;

ALTER TABLE public.gardener_profiles
  DROP CONSTRAINT IF EXISTS gardener_profiles_operational_coordinates_check;

ALTER TABLE public.gardener_profiles
  ADD CONSTRAINT gardener_profiles_operational_coordinates_check
  CHECK (
    (
      operational_latitude IS NULL
      AND operational_longitude IS NULL
    ) OR (
      operational_latitude BETWEEN -90 AND 90
      AND operational_longitude BETWEEN -180 AND 180
      AND NOT (operational_latitude = 0 AND operational_longitude = 0)
    )
  );
