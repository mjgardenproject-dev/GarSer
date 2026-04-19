-- Eliminación completa del servicio "Labrar y quitar malas hierbas a mano"
-- Esto elimina sus imágenes asociadas, los precios configurados por los jardineros y finalmente el servicio.

-- 1. Eliminar imágenes asociadas al servicio
DELETE FROM public.service_images
WHERE service_id IN (
    SELECT id FROM public.services WHERE name = 'Labrar y quitar malas hierbas a mano'
);

-- 2. Eliminar configuraciones de precios de jardineros asociadas al servicio
DELETE FROM public.gardener_service_prices
WHERE service_id IN (
    SELECT id FROM public.services WHERE name = 'Labrar y quitar malas hierbas a mano'
);

-- 3. Finalmente, eliminar el servicio de la tabla principal
DELETE FROM public.services
WHERE name = 'Labrar y quitar malas hierbas a mano';
