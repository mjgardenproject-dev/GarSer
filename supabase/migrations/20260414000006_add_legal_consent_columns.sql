-- Add explicit columns for legal terms acceptance and document integrity
ALTER TABLE public.gardener_licenses
ADD COLUMN IF NOT EXISTS terms_accepted BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS document_hash TEXT;

-- Update existing records to reflect terms acceptance since it was required in the UI
UPDATE public.gardener_licenses
SET terms_accepted = true,
    terms_accepted_at = created_at
WHERE terms_accepted IS false;
