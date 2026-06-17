-- Manual entry (alternativa a fotos): auditable consent + variable-revision trail.
--
-- 1) booking_manual_declarations: captures, at the moment of consent, exactly
--    what the client declared and accepted (who, when, which legal text version,
--    and the declared variables). Survives even if the booking is abandoned.
-- 2) booking_variable_revisions: append-only trail of client-declared vs
--    gardener-corrected variables, to analyze discrepancy patterns.
-- 3) bookings: provenance columns (data_input_mode, manual_declaration_id).
--
-- All additive and inert for the existing photo flow (rollback = ignore).

/* -------------------------------------------------------------------------- */
/* 1) Declarations                                                            */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS public.booking_manual_declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  declaration_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  service_name text,
  input_source text NOT NULL DEFAULT 'manual' CHECK (input_source = 'manual'),
  legal_text_version text NOT NULL,
  legal_text_hash text NOT NULL,
  declared_variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, declaration_id)
);

CREATE INDEX IF NOT EXISTS idx_manual_declarations_client
  ON public.booking_manual_declarations(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manual_declarations_booking
  ON public.booking_manual_declarations(booking_id);

ALTER TABLE public.booking_manual_declarations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clients read own manual declarations" ON public.booking_manual_declarations;
CREATE POLICY "Clients read own manual declarations"
  ON public.booking_manual_declarations
  FOR SELECT
  TO authenticated
  USING (client_id = auth.uid());

DROP POLICY IF EXISTS "Clients insert own manual declarations" ON public.booking_manual_declarations;
CREATE POLICY "Clients insert own manual declarations"
  ON public.booking_manual_declarations
  FOR INSERT
  TO authenticated
  WITH CHECK (client_id = auth.uid());

-- Gardeners can read the declaration attached to one of their bookings (to see
-- exactly what the client declared when they arrive on site).
DROP POLICY IF EXISTS "Gardeners read declarations of their bookings" ON public.booking_manual_declarations;
CREATE POLICY "Gardeners read declarations of their bookings"
  ON public.booking_manual_declarations
  FOR SELECT
  TO authenticated
  USING (
    booking_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = booking_manual_declarations.booking_id
      AND b.gardener_id = auth.uid()
    )
  );

/* -------------------------------------------------------------------------- */
/* 2) Variable revisions (discrepancy trail)                                  */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS public.booking_variable_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  author_role text NOT NULL CHECK (author_role IN ('client', 'gardener')),
  original_variables jsonb,
  corrected_variables jsonb,
  reason text,
  original_total_price numeric(10,2),
  proposed_total_price numeric(10,2),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_variable_revisions_booking
  ON public.booking_variable_revisions(booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_variable_revisions_author
  ON public.booking_variable_revisions(author_id, created_at DESC);

ALTER TABLE public.booking_variable_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Booking participants read variable revisions" ON public.booking_variable_revisions;
CREATE POLICY "Booking participants read variable revisions"
  ON public.booking_variable_revisions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = booking_variable_revisions.booking_id
      AND (b.client_id = auth.uid() OR b.gardener_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Gardener inserts variable revisions on own bookings" ON public.booking_variable_revisions;
CREATE POLICY "Gardener inserts variable revisions on own bookings"
  ON public.booking_variable_revisions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = booking_variable_revisions.booking_id
      AND (b.gardener_id = auth.uid() OR b.client_id = auth.uid())
    )
  );

/* -------------------------------------------------------------------------- */
/* 3) Booking provenance columns                                             */
/* -------------------------------------------------------------------------- */

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS data_input_mode text
    CHECK (data_input_mode IN ('photos', 'manual')),
  ADD COLUMN IF NOT EXISTS manual_declaration_id uuid;

CREATE INDEX IF NOT EXISTS idx_bookings_data_input_mode
  ON public.bookings(data_input_mode);

/* -------------------------------------------------------------------------- */
/* 4) RPC: link a declaration to a booking once it is created                 */
/* -------------------------------------------------------------------------- */

CREATE OR REPLACE FUNCTION public.attach_manual_declaration_to_booking(
  p_declaration_id uuid,
  p_booking_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only the owning client may link their own declaration to their own booking.
  UPDATE public.booking_manual_declarations d
  SET booking_id = p_booking_id
  WHERE d.declaration_id = p_declaration_id
    AND d.client_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = p_booking_id AND b.client_id = auth.uid()
    );

  UPDATE public.bookings b
  SET manual_declaration_id = p_declaration_id,
      data_input_mode = 'manual',
      updated_at = now()
  WHERE b.id = p_booking_id
    AND b.client_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.attach_manual_declaration_to_booking(uuid, uuid) TO authenticated;
