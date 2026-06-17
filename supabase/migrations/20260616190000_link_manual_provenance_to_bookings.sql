-- Propagate manual-entry provenance onto the bookings row at creation time and
-- link the auditable declaration to the booking.
--
-- Implemented as triggers (not by editing confirm_booking_payment_attempt) so it:
--   * stays robust across future changes to the confirm RPC,
--   * applies to every booking-creation path that carries a quote_id,
--   * keeps the change small and reviewable.
--
-- The data already lives in booking_quotes.input_payload (dataInputMode /
-- manualDeclarationId, added to pickSerializableBookingInput). We only need to
-- copy it onto the booking and back-link the declaration.
--
-- Two triggers because of FK timing:
--   * BEFORE INSERT sets NEW.data_input_mode / NEW.manual_declaration_id.
--   * AFTER INSERT links booking_manual_declarations.booking_id (the booking row
--     must exist before the FK can reference it).

CREATE OR REPLACE FUNCTION public.set_booking_manual_provenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote_id uuid;
  v_payload jsonb;
  v_mode text;
  v_declaration uuid;
BEGIN
  IF NEW.data_input_mode IS NOT NULL AND NEW.manual_declaration_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_quote_id := NULLIF(NEW.pricing_context ->> 'quote_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_quote_id := NULL;
  END;

  IF v_quote_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT input_payload INTO v_payload FROM public.booking_quotes WHERE id = v_quote_id;
  IF v_payload IS NULL THEN
    RETURN NEW;
  END IF;

  v_mode := NULLIF(BTRIM(COALESCE(v_payload ->> 'dataInputMode', '')), '');
  IF NEW.data_input_mode IS NULL AND v_mode IN ('photos', 'manual') THEN
    NEW.data_input_mode := v_mode;
  END IF;

  IF NEW.manual_declaration_id IS NULL THEN
    BEGIN
      v_declaration := NULLIF(v_payload ->> 'manualDeclarationId', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_declaration := NULL;
    END;
    IF v_declaration IS NOT NULL THEN
      NEW.manual_declaration_id := v_declaration;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_booking_manual_declaration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.manual_declaration_id IS NOT NULL THEN
    UPDATE public.booking_manual_declarations
    SET booking_id = NEW.id
    WHERE declaration_id = NEW.manual_declaration_id
      AND booking_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_booking_manual_provenance ON public.bookings;
CREATE TRIGGER trg_set_booking_manual_provenance
BEFORE INSERT ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.set_booking_manual_provenance();

DROP TRIGGER IF EXISTS trg_link_booking_manual_declaration ON public.bookings;
CREATE TRIGGER trg_link_booking_manual_declaration
AFTER INSERT ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.link_booking_manual_declaration();
