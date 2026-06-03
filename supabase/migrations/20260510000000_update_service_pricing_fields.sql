-- Migration: update_service_pricing_fields
-- Renombrar price_per_hour a hourly_rate y añadir pricing_method en la tabla services

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'services'
      AND column_name = 'price_per_hour'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'services'
      AND column_name = 'hourly_rate'
  ) THEN
    ALTER TABLE public.services RENAME COLUMN price_per_hour TO hourly_rate;
  END IF;
END
$$;

ALTER TABLE public.services ADD COLUMN IF NOT EXISTS pricing_method text CHECK (pricing_method IN ('per_hour', 'per_quantity')) DEFAULT 'per_quantity';

-- Actualizar servicios existentes con un valor por defecto sensato
UPDATE public.services SET pricing_method = 'per_hour' WHERE name ILIKE '%poda de plantas%';
UPDATE public.services SET pricing_method = 'per_quantity' WHERE pricing_method IS NULL;
