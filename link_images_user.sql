-- Script para vincular las imágenes subidas a los servicios correspondientes

-- 1. Limpiar vinculaciones anteriores para estos servicios (opcional, para evitar duplicados)
-- DELETE FROM public.service_images WHERE service_id IN (SELECT id FROM public.services);

-- 2. Insertar las nuevas imágenes
-- Usamos ON CONFLICT DO NOTHING por seguridad si ya existen, aunque service_images usa UUID random por defecto.
-- Si quieres reemplazar, podrías borrar primero como en el paso 1.

-- Corte de césped
INSERT INTO public.service_images (service_id, image_url)
SELECT id, 'https://hleqspdnjfswrmozjkai.supabase.co/storage/v1/object/public/service-backgrounds/corte%20de%20cesped.jpeg'
FROM public.services 
WHERE name ILIKE '%Corte de césped%' OR name ILIKE '%Corte de cesped%';

-- Corte de setos (Corte de setos a máquina)
INSERT INTO public.service_images (service_id, image_url)
SELECT id, 'https://hleqspdnjfswrmozjkai.supabase.co/storage/v1/object/public/service-backgrounds/corte%20de%20setos.jpeg'
FROM public.services 
WHERE name ILIKE '%Corte de setos%';

-- Fumigación de plantas
INSERT INTO public.service_images (service_id, image_url)
SELECT id, 'https://hleqspdnjfswrmozjkai.supabase.co/storage/v1/object/public/service-backgrounds/fumigacion.jpeg'
FROM public.services 
WHERE name ILIKE '%Fumigación%' OR name ILIKE '%Fumigacion%';

-- Labrar y quitar malas hierbas a mano
INSERT INTO public.service_images (service_id, image_url)
SELECT id, 'https://hleqspdnjfswrmozjkai.supabase.co/storage/v1/object/public/service-backgrounds/labrar%20y%20quitar%20malas%20hierbas%20a%20mano.jpg'
FROM public.services 
WHERE name ILIKE '%Labrar%' AND name ILIKE '%malas hierbas%';

-- Poda de árboles
INSERT INTO public.service_images (service_id, image_url)
SELECT id, 'https://hleqspdnjfswrmozjkai.supabase.co/storage/v1/object/public/service-backgrounds/poda%20de%20arboles.avif'
FROM public.services 
WHERE name ILIKE '%Poda de árboles%' OR name ILIKE '%Poda de arboles%';

-- Poda de plantas
INSERT INTO public.service_images (service_id, image_url)
SELECT id, 'https://hleqspdnjfswrmozjkai.supabase.co/storage/v1/object/public/service-backgrounds/poda%20de%20plantas.jpeg'
FROM public.services 
WHERE name ILIKE '%Poda de plantas%';

-- Verificación final (opcional)
-- SELECT s.name, si.image_url FROM public.services s JOIN public.service_images si ON s.id = si.service_id;
