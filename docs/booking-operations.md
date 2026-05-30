# Booking Operations

## Scheduler

The booking funnel now expects stale pending requests to expire automatically in production.

Create the production cron job with `pg_cron`:

```sql
select cron.schedule(
  'expire-stale-booking-requests',
  '*/15 * * * *',
  $$select public.expire_stale_booking_requests(null::uuid);$$
);
```

- Exact cadence: every 15 minutes.
- Execution context: database scheduler (`pg_cron`) calling the SQL function directly.
- Operative result: expires pending bookings older than 24 hours and releases their schedule blocks.
- Idempotent runbook: re-running the same SQL updates the existing job name in Supabase Cron.
- Dashboard alternative: `Integrations -> Cron -> Create job`, name `expire-stale-booking-requests`, schedule `*/15 * * * *`, SQL body `select public.expire_stale_booking_requests(null::uuid);`.

To inspect or remove the job later:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'expire-stale-booking-requests';
```

```sql
select cron.unschedule(jobid)
from cron.job
where jobname = 'expire-stale-booking-requests';
```

## Supabase Setup

- Deploy the `booking-authority` edge function before releasing the new client funnel.
- Deploy the new `supabase/config.toml` together with the functions so JWT verification is explicit per endpoint:
  - `booking-authority`: anonymous previews allowed, authenticated quote creation enforced in-handler.
  - `booking-payment`: platform JWT disabled, but authenticated caller plus valid `apikey` enforced in-handler.
  - `booking-payment-webhook`: platform JWT disabled, Stripe signature is mandatory.
  - `booking-telemetry`: anonymous funnel telemetry allowed only with a valid client `apikey`.
- Deploy the `booking-telemetry` edge function before relying on funnel incident traces.
- Apply the latest booking migrations before shipping the frontend build.

## Secrets

Required Edge Function secrets for the booking payment funnel:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEYS`
- `SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEYS`
- `BOOKING_APP_BASE_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Operational notes:

- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` must be loaded from the same Stripe environment.
- For production go-live, replace any test values with live credentials before enabling real traffic.
- If you want to support multiple webhook signing secrets during a rotation window, use `STRIPE_WEBHOOK_SECRETS`.
- Never put `SUPABASE_SERVICE_ROLE_KEY` in frontend env vars or any `VITE_` variable.
- If you change any `VITE_SUPABASE_*` value and test through a built frontend (`vite build` + `vite preview` or equivalent), rebuild the app completely before re-testing checkout. The browser can keep an old embedded runtime even if `.env` has already been corrected on disk.

## Production Go-Live Checklist

- Confirm all required migrations are applied remotely, including payment attempt, webhook guard and observability migrations.
- Confirm these functions are `ACTIVE` in the target project:
  - `booking-authority`
  - `booking-payment`
  - `booking-payment-webhook`
  - `booking-telemetry`
- Confirm `BOOKING_APP_BASE_URL` points to the exact public frontend origin for the target environment, without a trailing slash.
- Confirm the Stripe webhook endpoint points to:
  - `https://<project-ref>.functions.supabase.co/booking-payment-webhook`
- Subscribe at minimum to:
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `checkout.session.async_payment_failed`
  - `checkout.session.expired`
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `payment_intent.canceled`
- Verify the live webhook is separate from the test webhook and has its own signing secret.
- Verify the checkout amount charged by Stripe matches the backend-authoritative `payable_now_amount_cents`.
- Verify webhook replays do not create duplicate bookings and leave the attempt idempotent.
- Verify stale or cancelled attempts release their hold correctly.
- Verify `booking-photos` remains private.

## Smoke Test

Run a production-like smoke test in Stripe test mode before live cutover:

1. Start a fresh booking and reach confirmation with a valid authoritative quote.
2. Verify the confirmation page shows the same economic snapshot as provider selection.
3. Open Stripe Checkout and confirm the page states that payment is hosted by Stripe.
4. Complete payment with `4242 4242 4242 4242`.
5. Verify the app returns to confirmation and then reaches the confirmed booking state only after webhook validation.
6. Re-run the same scenario with:
   - Stripe cancellation
   - card decline
   - checkout expiration
7. Verify in database/logs:
   - one payment attempt per idempotent flow
   - one confirmed booking only
   - telemetry events for checkout creation, webhook processing and confirmation
   - hold release on cancel/fail/expire

## Storage

- `booking-photos` must remain private.
- Booking media is persisted through `booking_media` storage references plus signed URLs at read time.
