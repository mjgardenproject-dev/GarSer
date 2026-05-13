CREATE TABLE IF NOT EXISTS public.booking_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  uploader_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  media_url text NOT NULL,
  media_type text NOT NULL DEFAULT 'image' CHECK (media_type IN ('image')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_media_booking_id ON public.booking_media(booking_id, created_at);

ALTER TABLE public.booking_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Booking participants can read booking media" ON public.booking_media;
CREATE POLICY "Booking participants can read booking media"
  ON public.booking_media
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.id = booking_media.booking_id
      AND (b.client_id = auth.uid() OR b.gardener_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Booking participants can insert booking media" ON public.booking_media;
CREATE POLICY "Booking participants can insert booking media"
  ON public.booking_media
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (uploader_id IS NULL OR uploader_id = auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.id = booking_media.booking_id
      AND (b.client_id = auth.uid() OR b.gardener_id = auth.uid())
    )
  );
