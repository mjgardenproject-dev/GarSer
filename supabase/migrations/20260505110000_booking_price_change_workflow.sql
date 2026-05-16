-- Price change workflow for bookings with explicit client re-acceptance.
ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS price_change_status text
  CHECK (price_change_status IN ('none', 'pending_client_acceptance', 'accepted', 'rejected'))
  DEFAULT 'none',
ADD COLUMN IF NOT EXISTS proposed_total_price numeric(10,2),
ADD COLUMN IF NOT EXISTS proposed_price_reason text,
ADD COLUMN IF NOT EXISTS proposed_price_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS proposed_price_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_bookings_price_change_status
  ON public.bookings(price_change_status);
