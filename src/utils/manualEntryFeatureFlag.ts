/**
 * Feature flag for the manual-entry booking flow (alternativa a fotos).
 * Build-time flag, consistent with the other `VITE_*` flags in the project.
 * Off (default) ⇒ DetailsPage shows only the existing photo flow.
 */
export function isManualBookingInputEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_MANUAL_BOOKING_INPUT === 'true';
}
