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
DO $$
DECLARE
  v_has_hourly_rate boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'services'
      AND column_name = 'hourly_rate'
  ) INTO v_has_hourly_rate;

  IF EXISTS (
    SELECT 1
    FROM public.services
    WHERE name = 'Poda de palmeras'
  ) THEN
    IF v_has_hourly_rate THEN
      UPDATE public.services
      SET description = 'Poda y limpieza de palmeras, retirada de hojas secas y frutos.',
          hourly_rate = COALESCE(hourly_rate, 60)
      WHERE name = 'Poda de palmeras';
    ELSE
      UPDATE public.services
      SET description = 'Poda y limpieza de palmeras, retirada de hojas secas y frutos.'
      WHERE name = 'Poda de palmeras';
    END IF;
  ELSE
    IF v_has_hourly_rate THEN
      INSERT INTO public.services (name, description, hourly_rate)
      VALUES (
        'Poda de palmeras',
        'Poda y limpieza de palmeras, retirada de hojas secas y frutos.',
        60
      );
    ELSE
      INSERT INTO public.services (name, description)
      VALUES (
        'Poda de palmeras',
        'Poda y limpieza de palmeras, retirada de hojas secas y frutos.'
      );
    END IF;
  END IF;
END
$$;
