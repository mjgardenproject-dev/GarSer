-- Migración para el sistema de verificación de licencias fitosanitarias

-- 1. Extender gardener_profiles
ALTER TABLE public.gardener_profiles
ADD COLUMN IF NOT EXISTS has_phytosanitary_license BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS license_verification_status TEXT CHECK (license_verification_status IN ('pending', 'approved', 'rejected')) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS license_verified_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS license_expires_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Crear tabla privada gardener_licenses
CREATE TABLE IF NOT EXISTS public.gardener_licenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gardener_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    license_number TEXT,
    document_url TEXT NOT NULL,
    status TEXT CHECK (status IN ('pending', 'approved', 'rejected', 'replaced')) DEFAULT 'pending',
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES auth.users(id),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Habilitar RLS en gardener_licenses
ALTER TABLE public.gardener_licenses ENABLE ROW LEVEL SECURITY;

-- 3. Políticas RLS para gardener_licenses
-- SELECT: Propietario o Admin
CREATE POLICY "Gardeners can read own licenses"
ON public.gardener_licenses
FOR SELECT
TO authenticated
USING (auth.uid() = gardener_id);

CREATE POLICY "Admins can read all licenses"
ON public.gardener_licenses
FOR SELECT
TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- INSERT: Solo Propietario
CREATE POLICY "Gardeners can insert own licenses"
ON public.gardener_licenses
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = gardener_id);

-- UPDATE: Solo Admin (para aprobar/rechazar)
CREATE POLICY "Admins can update licenses"
ON public.gardener_licenses
FOR UPDATE
TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- 4. Crear bucket private_licenses
INSERT INTO storage.buckets (id, name, public) 
VALUES ('private_licenses', 'private_licenses', false)
ON CONFLICT (id) DO NOTHING;

-- 5. Políticas RLS para el bucket private_licenses
-- Permitir a los jardineros subir (INSERT) sus propios archivos
CREATE POLICY "Gardeners can upload own licenses"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'private_licenses' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Permitir a los jardineros leer (SELECT) sus propios archivos
CREATE POLICY "Gardeners can read own licenses"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'private_licenses' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Permitir a los Admins leer (SELECT) todos los archivos del bucket
CREATE POLICY "Admins can read all licenses"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'private_licenses' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- Permitir a los Admins actualizar (UPDATE) todos los archivos del bucket
CREATE POLICY "Admins can update all licenses"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'private_licenses' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- Permitir a los Admins borrar (DELETE) todos los archivos del bucket
CREATE POLICY "Admins can delete all licenses"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'private_licenses' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- Trigger o función para manejar la regla "SOLO puede existir UNA licencia activa por jardinero"
CREATE OR REPLACE FUNCTION public.handle_new_gardener_license()
RETURNS TRIGGER AS $$
BEGIN
    -- Al insertar una nueva licencia en estado pending, 
    -- si había licencias anteriores en estado pending o rejected, las marcamos como replaced.
    UPDATE public.gardener_licenses
    SET status = 'replaced'
    WHERE gardener_id = NEW.gardener_id
      AND id != NEW.id;
      
    -- Actualizar el estado en el perfil
    UPDATE public.gardener_profiles
    SET license_verification_status = 'pending'
    WHERE user_id = NEW.gardener_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_new_gardener_license ON public.gardener_licenses;
CREATE TRIGGER on_new_gardener_license
    AFTER INSERT ON public.gardener_licenses
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_gardener_license();
