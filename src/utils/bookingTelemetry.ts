import { supabase } from '../lib/supabase';

type BookingTelemetryLevel = 'info' | 'warn' | 'error';

interface BookingTelemetryPayload {
  event: string;
  context?: Record<string, unknown>;
}

export function reportBookingEvent(level: BookingTelemetryLevel, payload: BookingTelemetryPayload) {
  const entry = {
    ...payload,
    level,
    timestamp: new Date().toISOString(),
    path: typeof window !== 'undefined' ? window.location.pathname : undefined,
    source: 'web-client',
  };

  if (level === 'error') console.error('[booking-event]', entry);
  else if (level === 'warn') console.warn('[booking-event]', entry);
  else console.info('[booking-event]', entry);

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('garser:booking-event', { detail: entry }));
  }

  void supabase.functions.invoke('booking-telemetry', { body: entry }).catch((error: unknown) => {
    console.warn('[booking-event:sink-failed]', error);
  });
}
