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
    
    -- Seed data migration disabled because it attempts to insert into public.gardener_profiles 
    -- and public.gardener_service_prices without the user existing in auth.users, 
    -- which violates foreign keys during db reset.
    -- Data seeding should be done in supabase/seed.sql, not in migrations.
END $$;
