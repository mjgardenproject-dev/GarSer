-- Inserción del nuevo servicio "Desbroce de malas hierbas"
INSERT INTO public.services (name, description, base_price, price_per_hour)
VALUES (
    'Desbroce de malas hierbas',
    'Limpieza y desbroce de terrenos con maleza, matorrales y malas hierbas.',
    45,
    30
)
ON CONFLICT (name) DO UPDATE 
SET description = EXCLUDED.description,
    base_price = EXCLUDED.base_price,
    price_per_hour = EXCLUDED.price_per_hour;
