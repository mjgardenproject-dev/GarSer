-- Inserción idempotente del servicio "Desbroce de malas hierbas"
DO $$
DECLARE
  v_has_hourly_rate boolean;
  v_has_price_per_hour boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'services'
      AND column_name = 'hourly_rate'
  ) INTO v_has_hourly_rate;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'services'
      AND column_name = 'price_per_hour'
  ) INTO v_has_price_per_hour;

  IF EXISTS (
    SELECT 1
    FROM public.services
    WHERE name = 'Desbroce de malas hierbas'
  ) THEN
    IF v_has_hourly_rate THEN
      UPDATE public.services
      SET description = 'Limpieza y desbroce de terrenos con maleza, matorrales y malas hierbas.',
          hourly_rate = 30
      WHERE name = 'Desbroce de malas hierbas';
    ELSIF v_has_price_per_hour THEN
      UPDATE public.services
      SET description = 'Limpieza y desbroce de terrenos con maleza, matorrales y malas hierbas.',
          price_per_hour = 30
      WHERE name = 'Desbroce de malas hierbas';
    ELSE
      UPDATE public.services
      SET description = 'Limpieza y desbroce de terrenos con maleza, matorrales y malas hierbas.'
      WHERE name = 'Desbroce de malas hierbas';
    END IF;
  ELSE
    IF v_has_hourly_rate THEN
      INSERT INTO public.services (name, description, hourly_rate)
      VALUES (
        'Desbroce de malas hierbas',
        'Limpieza y desbroce de terrenos con maleza, matorrales y malas hierbas.',
        30
      );
    ELSIF v_has_price_per_hour THEN
      INSERT INTO public.services (name, description, price_per_hour)
      VALUES (
        'Desbroce de malas hierbas',
        'Limpieza y desbroce de terrenos con maleza, matorrales y malas hierbas.',
        30
      );
    ELSE
      INSERT INTO public.services (name, description)
      VALUES (
        'Desbroce de malas hierbas',
        'Limpieza y desbroce de terrenos con maleza, matorrales y malas hierbas.'
      );
    END IF;
  END IF;
END
$$;
