-- Add promotional flyer fields to gardener_profiles table
ALTER TABLE gardener_profiles 
ADD COLUMN IF NOT EXISTS promotional_flyer_url TEXT,
ADD COLUMN IF NOT EXISTS flyer_generated_at TIMESTAMP WITH TIME ZONE;

-- Add comment for documentation
COMMENT ON COLUMN gardener_profiles.promotional_flyer_url IS 'URL del flyer promocional generado automáticamente';
COMMENT ON COLUMN gardener_profiles.flyer_generated_at IS 'Fecha y hora de generación del flyer promocional';