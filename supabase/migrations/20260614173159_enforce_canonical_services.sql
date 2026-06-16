-- 1. Actualizar nombres existentes (idempotente)
UPDATE public.services SET name = 'Poda de setos' WHERE name = 'Recorte de setos';
UPDATE public.services SET name = 'Poda de árboles' WHERE name = 'Poda de árboles y arbustos';
UPDATE public.services SET name = 'Servicios fitosanitarios' WHERE name = 'Servicios fitosanitarios y control de plagas';
UPDATE public.services SET name = 'Poda de setos' WHERE name = 'Poda de setos a máquina';

-- 2. Insertar 'Poda de plantas y arbustos' si no existe
INSERT INTO public.services (name, description)
SELECT 'Poda de plantas y arbustos', 'Poda profesional de plantas para favorecer el crecimiento y mantener la estética del jardín.'
WHERE NOT EXISTS (SELECT 1 FROM public.services WHERE name = 'Poda de plantas y arbustos');

-- 3. Eliminar service_images de servicios no canónicos
DELETE FROM public.service_images
WHERE service_id IN (
    SELECT id FROM public.services
    WHERE name NOT IN (
        'Corte de césped',
        'Poda de setos',
        'Poda de árboles',
        'Poda de plantas y arbustos',
        'Servicios fitosanitarios',
        'Poda de palmeras',
        'Desbroce de malas hierbas'
    )
);

-- 4. Eliminar dependencias en gardener_service_prices de servicios no canónicos (por seguridad)
DELETE FROM public.gardener_service_prices
WHERE service_id IN (
    SELECT id FROM public.services
    WHERE name NOT IN (
        'Corte de césped',
        'Poda de setos',
        'Poda de árboles',
        'Poda de plantas y arbustos',
        'Servicios fitosanitarios',
        'Poda de palmeras',
        'Desbroce de malas hierbas'
    )
);

-- 5. Eliminar de services los que no estén en los 7 permitidos
DELETE FROM public.services
WHERE name NOT IN (
    'Corte de césped',
    'Poda de setos',
    'Poda de árboles',
    'Poda de plantas y arbustos',
    'Servicios fitosanitarios',
    'Poda de palmeras',
    'Desbroce de malas hierbas'
);

-- 6. Añadir CHECK constraint en name para los 7 permitidos
ALTER TABLE public.services DROP CONSTRAINT IF EXISTS services_name_check;

ALTER TABLE public.services ADD CONSTRAINT services_name_check
CHECK (name IN (
    'Corte de césped',
    'Poda de setos',
    'Poda de árboles',
    'Poda de plantas y arbustos',
    'Servicios fitosanitarios',
    'Poda de palmeras',
    'Desbroce de malas hierbas'
));
