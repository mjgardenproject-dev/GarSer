-- Seed service images based on existing services created by migrations
INSERT INTO public.service_images (service_id, image_url)
SELECT id, 'https://hleqspdnjfswrmozjkai.supabase.co/storage/v1/object/public/service-backgrounds/corte%20de%20cesped.jpeg'
FROM public.services WHERE name ILIKE '%Corte de césped%'
ON CONFLICT (service_id) DO NOTHING;

INSERT INTO public.service_images (service_id, image_url)
SELECT id, 'https://hleqspdnjfswrmozjkai.supabase.co/storage/v1/object/public/service-backgrounds/corte%20de%20setos.jpeg'
FROM public.services WHERE name ILIKE '%Recorte de setos%' OR name ILIKE '%Poda de setos%'
ON CONFLICT (service_id) DO NOTHING;

INSERT INTO public.service_images (service_id, image_url)
SELECT id, 'https://hleqspdnjfswrmozjkai.supabase.co/storage/v1/object/public/service-backgrounds/fumigacion.jpeg'
FROM public.services WHERE name ILIKE '%Servicios fitosanitarios%' OR name ILIKE '%Tratamientos fitosanitarios%'
ON CONFLICT (service_id) DO NOTHING;

INSERT INTO public.service_images (service_id, image_url)
SELECT id, 'https://hleqspdnjfswrmozjkai.supabase.co/storage/v1/object/public/service-backgrounds/poda%20de%20arboles.avif'
FROM public.services WHERE name ILIKE '%Poda de árboles%' OR name ILIKE '%Poda de arboles%'
ON CONFLICT (service_id) DO NOTHING;

INSERT INTO public.service_images (service_id, image_url)
SELECT id, 'https://hleqspdnjfswrmozjkai.supabase.co/storage/v1/object/public/service-backgrounds/poda%20de%20plantas.jpeg'
FROM public.services WHERE name ILIKE '%Plantación%' OR name ILIKE '%Poda de plantas%'
ON CONFLICT (service_id) DO NOTHING;

