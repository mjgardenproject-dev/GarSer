-- Add dependencies column to services table
ALTER TABLE public.services
ADD COLUMN IF NOT EXISTS required_by_services UUID[] DEFAULT '{}'::UUID[];

-- Create an edge case validation trigger (Optional but good for DB level integrity)
-- We'll primarily handle this in the UI/frontend logic for better UX
