CREATE TABLE IF NOT EXISTS public.booking_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE CASCADE,
  date date NOT NULL,
  hour_block integer NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(booking_id, date, hour_block)
);

CREATE INDEX IF NOT EXISTS idx_booking_blocks_booking
  ON public.booking_blocks(booking_id);

ALTER TABLE public.booking_blocks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'booking_blocks'
      AND policyname = 'Usuarios pueden ver bloques de sus reservas'
  ) THEN
    CREATE POLICY "Usuarios pueden ver bloques de sus reservas"
      ON public.booking_blocks
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.bookings b
          WHERE b.id = booking_id
            AND (b.client_id = auth.uid() OR b.gardener_id = auth.uid())
        )
      );
  END IF;
END
$$;
