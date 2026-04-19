-- Migration: Rename "Poda de plantas" to "Poda de plantas y arbustos"
-- This ensures all existing gardener profiles and references use the new canonical name.

-- 1. Update the main services table
UPDATE services 
SET name = 'Poda de plantas y arbustos' 
WHERE name = 'Poda de plantas';

-- Note: The gardener JSONB configurations use internal keys (e.g. shrubConfig)
-- or reference the service_id directly via junction tables, so modifying the name 
-- in the `services` table is sufficient.
