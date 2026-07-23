-- Chat: cursor de lectura por usuario + overview agregado.
--
-- Problema que resuelve:
--   · El marcado de leídos por UPDATE sobre chat_messages (read_at/read_by) no funciona
--     con los mensajes de sistema (sender_id NULL no matchea sender_id <> auth.uid())
--     y solo puede registrar UN lector.
--   · La lista de chats hacía 2 queries por reserva (último mensaje + count de no leídos).
--
-- Diseño nuevo:
--   · chat_thread_reads: un cursor last_read_at por (booking, usuario). No leído =
--     mensaje posterior a mi cursor y no enviado por mí (los de sistema cuentan).
--     El recibo "Leído" del emisor = cursor del otro participante >= created_at del mensaje.
--   · chat_overview(): último mensaje + nº de no leídos de TODOS los hilos del usuario
--     autenticado en una sola llamada (SECURITY INVOKER: la RLS de chat_messages limita
--     a los hilos donde participa).
--   Las columnas legacy read_at/read_by se conservan por compatibilidad pero dejan de usarse.

CREATE TABLE IF NOT EXISTS public.chat_thread_reads (
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (booking_id, user_id)
);

ALTER TABLE public.chat_thread_reads ENABLE ROW LEVEL SECURITY;

-- Los participantes de la reserva ven los cursores del hilo (necesario para el "Leído")
DROP POLICY IF EXISTS "Participants can view thread reads" ON public.chat_thread_reads;
CREATE POLICY "Participants can view thread reads"
  ON public.chat_thread_reads
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = chat_thread_reads.booking_id
        AND (b.client_id = auth.uid() OR b.gardener_id = auth.uid())
    )
  );

-- Cada usuario solo escribe SU cursor, y solo en hilos donde participa
DROP POLICY IF EXISTS "Users can insert own read cursor" ON public.chat_thread_reads;
CREATE POLICY "Users can insert own read cursor"
  ON public.chat_thread_reads
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = chat_thread_reads.booking_id
        AND (b.client_id = auth.uid() OR b.gardener_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update own read cursor" ON public.chat_thread_reads;
CREATE POLICY "Users can update own read cursor"
  ON public.chat_thread_reads
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = chat_thread_reads.booking_id
        AND (b.client_id = auth.uid() OR b.gardener_id = auth.uid())
    )
  );

-- Realtime para recibos de lectura en vivo (idempotente)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_thread_reads;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

-- Índice para el conteo de no leídos por hilo
CREATE INDEX IF NOT EXISTS idx_chat_messages_booking_created
  ON public.chat_messages(booking_id, created_at);

-- Overview del chat del usuario autenticado (una sola llamada para toda la lista)
CREATE OR REPLACE FUNCTION public.chat_overview()
RETURNS TABLE (
  booking_id uuid,
  last_message text,
  last_message_type text,
  last_message_has_image boolean,
  last_message_at timestamptz,
  unread_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    m.booking_id,
    (array_agg(m.message ORDER BY m.created_at DESC))[1] AS last_message,
    (array_agg(COALESCE(m.message_type, 'user') ORDER BY m.created_at DESC))[1] AS last_message_type,
    (array_agg((m.image_url IS NOT NULL) ORDER BY m.created_at DESC))[1] AS last_message_has_image,
    max(m.created_at) AS last_message_at,
    count(*) FILTER (
      WHERE m.sender_id IS DISTINCT FROM auth.uid()
        AND m.created_at > COALESCE(r.last_read_at, '-infinity'::timestamptz)
    ) AS unread_count
  FROM public.chat_messages m
  LEFT JOIN public.chat_thread_reads r
    ON r.booking_id = m.booking_id AND r.user_id = auth.uid()
  GROUP BY m.booking_id, r.last_read_at
$$;
