-- 1. Crear el bucket 'services-background' si no existe
INSERT INTO storage.buckets (id, name, public)
VALUES ('services-background', 'services-background', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Configurar políticas de seguridad para que las imágenes sean públicas
-- Permitir acceso público de lectura
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
CREATE POLICY "Public Access"
ON storage.objects FOR SELECT
USING ( bucket_id = 'services-background' );

-- Permitir subida de archivos a usuarios autenticados (opcional, para gestión)
DROP POLICY IF EXISTS "Authenticated Upload" ON storage.objects;
CREATE POLICY "Authenticated Upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK ( bucket_id = 'services-background' );

-- 3. Asegurar que la tabla 'service_images' existe
CREATE TABLE IF NOT EXISTS public.service_images (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    service_id UUID REFERENCES public.services(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar RLS en service_images
ALTER TABLE public.service_images ENABLE ROW LEVEL SECURITY;

-- Política de lectura pública para service_images
DROP POLICY IF EXISTS "Public Read Service Images" ON public.service_images;
CREATE POLICY "Public Read Service Images"
ON public.service_images FOR SELECT
USING (true);

-- 4. (Opcional) Script de ayuda para vincular imágenes manualmente
-- Ejecuta esto DESPUÉS de subir tus imágenes al bucket.
-- Reemplaza los nombres de archivo por los que hayas subido.

/*
-- Ejemplo para 'Corte de césped'
INSERT INTO public.service_images (service_id, image_url)
SELECT id, 'https://TU_PROYECTO.supabase.co/storage/v1/object/public/services-background/corte_cesped.jpg'
FROM public.services WHERE name = 'Corte de césped'
ON CONFLICT DO NOTHING;

-- Ejemplo para 'Poda de plantas'
INSERT INTO public.service_images (service_id, image_url)
SELECT id, 'https://TU_PROYECTO.supabase.co/storage/v1/object/public/services-background/poda_plantas.jpg'
FROM public.services WHERE name = 'Poda de plantas'
ON CONFLICT DO NOTHING;
*/
