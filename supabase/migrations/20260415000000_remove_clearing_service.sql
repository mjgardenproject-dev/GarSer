-- Eliminación completa del servicio "Labrar y quitar malas hierbas a mano"
-- Esto elimina sus imágenes asociadas, los precios configurados por los jardineros y finalmente el servicio.

-- 1. Eliminar imágenes asociadas al servicio (si la tabla existe)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'service_images') THEN
        DELETE FROM public.service_images
        WHERE service_id IN (
            SELECT id FROM public.services WHERE name = 'Labrar y quitar malas hierbas a mano'
        );
    END IF;
END $$;

-- 2. Eliminar configuraciones de precios de jardineros asociadas al servicio
DELETE FROM public.gardener_service_prices
WHERE service_id IN (
    SELECT id FROM public.services WHERE name = 'Labrar y quitar malas hierbas a mano'
);

-- 3. Finalmente, eliminar el servicio de la tabla principal
DELETE FROM public.services
WHERE name = 'Labrar y quitar malas hierbas a mano';
