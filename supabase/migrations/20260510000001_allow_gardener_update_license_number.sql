-- Allow gardeners to update their own license number while it's pending or rejected
-- This enables the auto-save feature for the license number field

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'gardener_licenses' 
        AND policyname = 'Gardeners can update own license number'
    ) THEN
        CREATE POLICY "Gardeners can update own license number"
        ON public.gardener_licenses
        FOR UPDATE
        TO authenticated
        USING (auth.uid() = gardener_id AND status IN ('pending', 'rejected'))
        WITH CHECK (auth.uid() = gardener_id AND status IN ('pending', 'rejected'));
    END IF;
END $$;
