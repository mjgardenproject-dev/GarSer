-- Ensure we have a test gardener user
-- Note: Inserting into auth.users is restricted in some environments, but we'll try to ensure a profile exists.
-- If auth.users insertion fails or is not possible, this migration assumes a user with this UUID exists or will be created.
-- For local development with Supabase, this usually works.

DO $$
DECLARE
    v_user_id UUID := '00000000-0000-0000-0000-000000000001';
    v_service_id UUID;
BEGIN
    -- 1. Create a dummy user in auth.users if possible (This part is tricky in migrations, often skipped or done via seed.ts)
    -- We will try to insert into gardener_profiles directly. If it fails due to FK, the user must ensure the auth user exists.
    -- However, for the sake of this task, we assume we can insert into gardener_profiles if we are superuser or if constraints allow.
    
    -- Attempt to insert profile. If auth.users FK prevents it, this block will fail. 
    -- In a real scenario, we'd use a seed script. Here we try our best with SQL.
    INSERT INTO public.gardener_profiles (user_id, full_name, description)
    VALUES (v_user_id, 'Jardinero Test Palmeras', 'Especialista en palmeras')
    ON CONFLICT (user_id) DO UPDATE 
    SET full_name = 'Jardinero Test Palmeras';

    -- 2. Get the service ID
    SELECT id INTO v_service_id FROM public.services WHERE name = 'Poda de palmeras';

    IF v_service_id IS NOT NULL THEN
        -- 3. Insert/Update price config
        INSERT INTO public.gardener_service_prices (
            gardener_id, 
            service_id, 
            unit_type, 
            price_per_unit, 
            additional_config, 
            active
        )
        VALUES (
            v_user_id,
            v_service_id,
            'count',
            10.00, -- Base price for fallback
            '{
                "selected_species": ["Washingtonia"],
                "species_prices": { 
                    "Washingtonia": 10,
                    "Trachycarpus fortunei": 10
                },
                "height_prices": {
                    "Washingtonia": {
                        "0-5": 10,
                        "5-12": 10,
                        "12-20": 10,
                        "20+": 10
                    },
                    "Trachycarpus fortunei": {
                        "0-5": 10,
                        "5-12": 10,
                        "12-20": 10,
                        "20+": 10
                    }
                },
                "condition_surcharges": {
                    "normal": 0,
                    "descuidada": 30,
                    "muy_descuidada": 50
                },
                "waste_removal": {
                    "option": "extra_percentage",
                    "percentage": 20
                }
            }'::jsonb,
            true
        )
        ON CONFLICT (gardener_id, service_id) 
        DO UPDATE SET 
            additional_config = EXCLUDED.additional_config,
            price_per_unit = 10.00,
            active = true;
    END IF;
END $$;
