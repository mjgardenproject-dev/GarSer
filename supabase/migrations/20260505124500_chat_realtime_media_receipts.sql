ALTER TABLE public.chat_messages
ADD COLUMN IF NOT EXISTS image_url text,
ADD COLUMN IF NOT EXISTS read_at timestamptz,
ADD COLUMN IF NOT EXISTS read_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_booking_unread
  ON public.chat_messages(booking_id, read_at);

CREATE OR REPLACE FUNCTION public.enforce_chat_message_readonly_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.message IS DISTINCT FROM OLD.message
    OR NEW.image_url IS DISTINCT FROM OLD.image_url
    OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
    OR NEW.booking_id IS DISTINCT FROM OLD.booking_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Solo se permiten actualizaciones de estado de lectura en chat_messages.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_messages_readonly_fields ON public.chat_messages;
CREATE TRIGGER trg_chat_messages_readonly_fields
BEFORE UPDATE ON public.chat_messages
FOR EACH ROW
EXECUTE FUNCTION public.enforce_chat_message_readonly_fields();

DROP POLICY IF EXISTS "Booking participants can mark messages as read" ON public.chat_messages;
CREATE POLICY "Booking participants can mark messages as read"
  ON public.chat_messages
  FOR UPDATE
  TO authenticated
  USING (
    sender_id <> auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.id = chat_messages.booking_id
      AND (b.client_id = auth.uid() OR b.gardener_id = auth.uid())
    )
  )
  WITH CHECK (
    sender_id <> auth.uid()
    AND read_by = auth.uid()
    AND read_at IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.id = chat_messages.booking_id
      AND (b.client_id = auth.uid() OR b.gardener_id = auth.uid())
    )
  );
