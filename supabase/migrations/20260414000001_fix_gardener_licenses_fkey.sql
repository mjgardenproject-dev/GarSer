-- Create a foreign key relationship between gardener_licenses and gardener_profiles if it doesn't exist
ALTER TABLE public.gardener_licenses 
DROP CONSTRAINT IF EXISTS gardener_licenses_gardener_id_fkey_profiles;

ALTER TABLE public.gardener_licenses
ADD CONSTRAINT gardener_licenses_gardener_id_fkey_profiles 
FOREIGN KEY (gardener_id) 
REFERENCES public.gardener_profiles(user_id) 
ON DELETE CASCADE;
