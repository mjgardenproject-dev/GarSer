# Booking Operations

## Scheduler

The booking funnel now expects stale pending requests to expire automatically in production.

Run one of these production-safe options:

```sql
select public.expire_stale_booking_requests(null::uuid);
```

- Recommended cadence: every 15 minutes.
- Execution context: service role or database scheduler.
- Result: expires pending bookings older than 24 hours and releases their schedule blocks.

## Supabase Setup

- Deploy the `booking-authority` edge function before releasing the new client funnel.
- Deploy the `booking-telemetry` edge function before relying on funnel incident traces.
- Apply the latest booking migrations before shipping the frontend build.

## Storage

- `booking-photos` must remain private.
- Booking media is persisted through `booking_media` storage references plus signed URLs at read time.
