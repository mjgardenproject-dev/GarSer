DO $$ 
BEGIN 
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gardener_profiles' AND table_type = 'BASE TABLE') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'gardener_profiles' AND column_name = 'rating_average') THEN
            ALTER TABLE public.gardener_profiles ADD COLUMN rating_average NUMERIC(3, 2) DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'gardener_profiles' AND column_name = 'rating_count') THEN
            ALTER TABLE public.gardener_profiles ADD COLUMN rating_count INTEGER DEFAULT 0;
        END IF;
    END IF;
END $$;
