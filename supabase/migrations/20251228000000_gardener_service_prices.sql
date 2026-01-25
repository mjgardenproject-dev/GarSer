CREATE TABLE IF NOT EXISTS public.gardener_service_prices (
    gardener_id UUID NOT NULL REFERENCES public.gardener_profiles(user_id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    unit_type TEXT NOT NULL CHECK (unit_type IN ('area', 'count')),
    price_per_unit NUMERIC(10, 2) NOT NULL CHECK (price_per_unit >= 0),
    currency TEXT NOT NULL DEFAULT 'EUR',
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (gardener_id, service_id)
);

DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'services' AND column_name = 'measurement') THEN
        ALTER TABLE public.services ADD COLUMN measurement TEXT CHECK (measurement IN ('area', 'count'));
    END IF;
END $$;

UPDATE public.services SET measurement = 'area' WHERE name ILIKE '%cesped%' OR name ILIKE '%césped%' OR name ILIKE '%seto%' OR name ILIKE '%hierba%' OR name ILIKE '%maleza%' OR name ILIKE '%labrado%';
UPDATE public.services SET measurement = 'count' WHERE name ILIKE '%poda%' OR name ILIKE '%arbol%' OR name ILIKE '%árbol%' OR name ILIKE '%planta%' OR name ILIKE '%fumig%';

ALTER TABLE public.gardener_service_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Gardeners can manage their own prices" ON public.gardener_service_prices;
CREATE POLICY "Gardeners can manage their own prices"
    ON public.gardener_service_prices
    FOR ALL
    USING (auth.uid() = gardener_id)
    WITH CHECK (auth.uid() = gardener_id);

DROP POLICY IF EXISTS "Public can view active prices" ON public.gardener_service_prices;
CREATE POLICY "Public can view active prices"
    ON public.gardener_service_prices
    FOR SELECT
    USING (active = true);

DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.gardener_profiles;
CREATE POLICY "Profiles are viewable by everyone"
    ON public.gardener_profiles
    FOR SELECT
    USING (true);
