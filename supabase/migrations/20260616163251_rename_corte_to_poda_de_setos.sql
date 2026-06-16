-- 1. Actualizar el CHECK constraint primero para permitir el nuevo nombre
ALTER TABLE public.services DROP CONSTRAINT IF EXISTS services_name_check;

ALTER TABLE public.services ADD CONSTRAINT services_name_check
CHECK (name IN (
    'Corte de césped',
    'Poda de setos',
    'Corte de setos',
    'Poda de árboles',
    'Poda de plantas y arbustos',
    'Servicios fitosanitarios',
    'Poda de palmeras',
    'Desbroce de malas hierbas'
));

-- 2. Actualizar el nombre del servicio
UPDATE public.services SET name = 'Poda de setos' WHERE name = 'Corte de setos';

-- 3. Restringir el CHECK constraint final
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
