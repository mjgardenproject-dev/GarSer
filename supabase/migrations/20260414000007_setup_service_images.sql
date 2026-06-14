-- 1. Crear el bucket 'service-backgrounds'
INSERT INTO storage.buckets (id, name, public)
VALUES ('service-backgrounds', 'service-backgrounds', true)
ON CONFLICT (id) DO NOTHING;

-- Permitir acceso público de lectura
DROP POLICY IF EXISTS "Public Access Service Backgrounds" ON storage.objects;
CREATE POLICY "Public Access Service Backgrounds"
ON storage.objects FOR SELECT
USING ( bucket_id = 'service-backgrounds' );

-- Permitir subida a autenticados
DROP POLICY IF EXISTS "Authenticated Upload Service Backgrounds" ON storage.objects;
CREATE POLICY "Authenticated Upload Service Backgrounds"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK ( bucket_id = 'service-backgrounds' );

-- 2. Asegurar que la tabla 'service_images' existe
CREATE TABLE IF NOT EXISTS public.service_images (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    service_id UUID REFERENCES public.services(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT service_images_service_id_key UNIQUE (service_id)
);

ALTER TABLE public.service_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Read Service Images" ON public.service_images;
CREATE POLICY "Public Read Service Images"
ON public.service_images FOR SELECT
USING (true);

-- 3. Vincular imágenes (Opcional, pero lo metemos para que recupere el estado que tenía)
-- Corte de césped
INSERT INTO public.service_images (service_id, image_url)
SELECT id, 'https://hleqspdnjfswrmozjkai.supabase.co/storage/v1/object/public/service-backgrounds/corte%20de%20cesped.jpeg'
FROM public.services 
WHERE name ILIKE '%Corte de césped%' OR name ILIKE '%Corte de cesped%'
ON CONFLICT (service_id) DO NOTHING;

-- Corte de setos
INSERT INTO public.service_images (service_id, image_url)
SELECT id, 'https://hleqspdnjfswrmozjkai.supabase.co/storage/v1/object/public/service-backgrounds/corte%20de%20setos.jpeg'
FROM public.services 
WHERE name ILIKE '%Corte de setos%'
ON CONFLICT (service_id) DO NOTHING;

-- Tratamientos fitosanitarios
INSERT INTO public.service_images (service_id, image_url)
SELECT id, 'https://hleqspdnjfswrmozjkai.supabase.co/storage/v1/object/public/service-backgrounds/fumigacion.jpeg'
FROM public.services 
WHERE name ILIKE '%Tratamientos fitosanitarios%'
ON CONFLICT (service_id) DO NOTHING;

-- Poda de árboles
INSERT INTO public.service_images (service_id, image_url)
SELECT id, 'https://hleqspdnjfswrmozjkai.supabase.co/storage/v1/object/public/service-backgrounds/poda%20de%20arboles.avif'
FROM public.services 
WHERE name ILIKE '%Poda de árboles%' OR name ILIKE '%Poda de arboles%'
ON CONFLICT (service_id) DO NOTHING;

-- Poda de plantas
INSERT INTO public.service_images (service_id, image_url)
SELECT id, 'https://hleqspdnjfswrmozjkai.supabase.co/storage/v1/object/public/service-backgrounds/poda%20de%20plantas.jpeg'
FROM public.services 
WHERE name ILIKE '%Poda de plantas%'
ON CONFLICT (service_id) DO NOTHING;
