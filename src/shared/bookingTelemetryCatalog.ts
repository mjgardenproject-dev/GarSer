export interface BookingTelemetryDefinition {
  phase: string;
  status: string;
  requiredContext: string[];
}

export const BOOKING_TELEMETRY_TAXONOMY_VERSION = 'booking_funnel_v1';

export const BOOKING_TELEMETRY_CATALOG: Record<string, BookingTelemetryDefinition> = {
  'booking.quote_preview_loaded': {
    phase: 'quote_preview',
    status: 'succeeded',
    requiredContext: ['serviceId', 'selectedDate', 'providerCount'],
  },
  'booking.quote_preview_failed': {
    phase: 'quote_preview',
    status: 'failed',
    requiredContext: ['serviceId', 'selectedDate'],
  },
  'booking.quote_created': {
    phase: 'quote',
    status: 'succeeded',
    requiredContext: ['quoteId', 'providerId', 'serviceId'],
  },
  'booking.quote_create_failed': {
    phase: 'quote',
    status: 'failed',
    requiredContext: ['providerId', 'serviceId', 'selectedDate'],
  },
  'booking.availability_calendar_loaded': {
    phase: 'availability_calendar',
    status: 'succeeded',
    requiredContext: ['providerId', 'serviceId', 'monthDate'],
  },
  'booking.availability_calendar_failed': {
    phase: 'availability_calendar',
    status: 'failed',
    requiredContext: ['providerId', 'serviceId', 'monthDate'],
  },
  'booking.availability_hours_loaded': {
    phase: 'availability_hours',
    status: 'succeeded',
    requiredContext: ['providerId', 'serviceId', 'selectedDate'],
  },
  'booking.availability_hours_failed': {
    phase: 'availability_hours',
    status: 'failed',
    requiredContext: ['providerId', 'serviceId', 'selectedDate'],
  },
  'booking.resume_restored': {
    phase: 'resume',
    status: 'restored',
    requiredContext: ['flow', 'stage'],
  },
  'booking.resume_rejected': {
    phase: 'resume',
    status: 'rejected',
    requiredContext: ['flow', 'reason'],
  },
  'booking.resume_persist_failed': {
    phase: 'resume',
    status: 'failed',
    requiredContext: ['flow', 'stage', 'reason'],
  },
  'booking.resume_persist_degraded': {
    phase: 'resume',
    status: 'degraded',
    requiredContext: ['flow', 'stage', 'storage'],
  },
  'booking.legacy_checkout_redirected': {
    phase: 'legacy_checkout',
    status: 'redirected',
    requiredContext: ['legacySource', 'targetFlow'],
  },
  'booking.payment_checkout_created': {
    phase: 'payment_checkout',
    status: 'created',
    requiredContext: ['attemptId', 'quoteId', 'providerId', 'serviceId'],
  },
  'booking.payment_checkout_failed': {
    phase: 'payment_checkout',
    status: 'failed',
    requiredContext: ['quoteId'],
  },
  'booking.payment_request_rejected': {
    phase: 'payment_request',
    status: 'rejected',
    requiredContext: ['action', 'reason'],
  },
  'booking.payment_status_loaded': {
    phase: 'payment_status',
    status: 'succeeded',
    requiredContext: ['attemptId', 'quoteId', 'paymentStatus'],
  },
  'booking.payment_status_failed': {
    phase: 'payment_status',
    status: 'failed',
    requiredContext: ['quoteId'],
  },
  'booking.payment_attempt_cancelled': {
    phase: 'payment_cancel',
    status: 'cancelled',
    requiredContext: ['attemptId', 'quoteId'],
  },
  'booking.payment_attempt_cancel_failed': {
    phase: 'payment_cancel',
    status: 'failed',
    requiredContext: ['attemptId'],
  },
  'booking.payment_return_reconciled': {
    phase: 'payment_return',
    status: 'reconciled',
    requiredContext: ['attemptId', 'quoteId', 'paymentStatus'],
  },
  'booking.payment_return_reconcile_failed': {
    phase: 'payment_return',
    status: 'failed',
    requiredContext: ['attemptId'],
  },
  'booking.payment_webhook_processed': {
    phase: 'payment_webhook',
    status: 'processed',
    requiredContext: ['eventId', 'eventType'],
  },
  'booking.payment_webhook_rejected': {
    phase: 'payment_webhook',
    status: 'rejected',
    requiredContext: ['reason'],
  },
  'booking.payment_webhook_failed': {
    phase: 'payment_webhook',
    status: 'failed',
    requiredContext: ['eventId', 'eventType'],
  },
  'booking.payment_confirmed': {
    phase: 'payment_confirmation',
    status: 'confirmed',
    requiredContext: ['attemptId', 'bookingId', 'quoteId', 'providerId', 'serviceId'],
  },
  'booking.manual_entry_started': {
    phase: 'manual_entry',
    status: 'started',
    requiredContext: ['serviceId', 'serviceKey'],
  },
  'booking.manual_entry_step_completed': {
    phase: 'manual_entry',
    status: 'step_completed',
    requiredContext: ['serviceKey', 'stepId'],
  },
  'booking.manual_entry_abandoned': {
    phase: 'manual_entry',
    status: 'abandoned',
    requiredContext: ['serviceKey', 'stepId'],
  },
  'booking.manual_entry_consent_accepted': {
    phase: 'manual_entry',
    status: 'consent_accepted',
    requiredContext: ['serviceKey', 'legalVersion'],
  },
  'booking.manual_entry_submitted': {
    phase: 'manual_entry',
    status: 'submitted',
    requiredContext: ['serviceKey', 'itemCount'],
  },
  'booking.manual_entry_submit_failed': {
    phase: 'manual_entry',
    status: 'failed',
    requiredContext: ['serviceKey', 'reason'],
  },
  'booking.manual_validation_rejected': {
    phase: 'manual_entry',
    status: 'rejected',
    requiredContext: ['serviceKey', 'reason'],
  },
  'booking.manual_input_mode_changed': {
    phase: 'manual_entry',
    status: 'mode_changed',
    requiredContext: ['serviceKey', 'mode'],
  },
  'booking.price_discrepancy_proposed': {
    phase: 'price_discrepancy',
    status: 'proposed',
    requiredContext: ['bookingId', 'proposedTotalPrice'],
  },
  'booking.price_discrepancy_resolved': {
    phase: 'price_discrepancy',
    status: 'resolved',
    requiredContext: ['bookingId', 'resolution'],
  },
  'booking.request_responded': {
    phase: 'request_response',
    status: 'succeeded',
    requiredContext: ['bookingId', 'response'],
  },
  'booking.request_response_failed': {
    phase: 'request_response',
    status: 'failed',
    requiredContext: ['bookingId', 'response'],
  },
  'booking.requests_broadcast_created': {
    phase: 'broadcast',
    status: 'succeeded',
    requiredContext: ['operationId', 'serviceId', 'gardenerCount'],
  },
  'booking.requests_broadcast_failed': {
    phase: 'broadcast',
    status: 'failed',
    requiredContext: ['operationId', 'serviceId', 'gardenerCount'],
  },
  'booking.requests_expired': {
    phase: 'expiration',
    status: 'succeeded',
    requiredContext: ['expiredCount'],
  },
  'booking.requests_expire_failed': {
    phase: 'expiration',
    status: 'failed',
    requiredContext: ['scope'],
  },
};

export function getBookingTelemetryDefinition(event: string) {
  return BOOKING_TELEMETRY_CATALOG[event];
}

export function getMissingBookingTelemetryContext(
  event: string,
  context: Record<string, unknown>,
) {
  const definition = getBookingTelemetryDefinition(event);
  if (!definition) return [];

  return definition.requiredContext.filter((key) => {
    const value = context[key];
    if (value == null) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return false;
  });
}
