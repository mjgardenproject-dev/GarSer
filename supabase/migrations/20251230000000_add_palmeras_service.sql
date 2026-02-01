-- 1. Asegurar que existe la restricción UNIQUE en 'name' para que ON CONFLICT funcione
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'services_name_key'
    ) THEN
        ALTER TABLE public.services ADD CONSTRAINT services_name_key UNIQUE (name);
    END IF;
END $$;

-- 2. Insertar el servicio "Poda de palmeras"
INSERT INTO public.services (name, description, base_price)
VALUES (
  'Poda de palmeras',
  'Poda y limpieza de palmeras, retirada de hojas secas y frutos.',
  60
)
ON CONFLICT (name) DO NOTHING;
