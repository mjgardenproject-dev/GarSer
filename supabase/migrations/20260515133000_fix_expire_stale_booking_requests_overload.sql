-- Remove the obsolete zero-argument overload to avoid ambiguous resolution
-- against the hardened signature expire_stale_booking_requests(uuid DEFAULT NULL).
DROP FUNCTION IF EXISTS public.expire_stale_booking_requests();
