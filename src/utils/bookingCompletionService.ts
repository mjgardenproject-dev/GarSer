import { supabase } from '../lib/supabase'

export interface BookingCompletionCleanupSummary {
  status: 'completed' | 'skipped' | 'failed'
  deletedRows: number
  attemptedObjectCount: number
  deletedObjectCount: number
  warning?: string
}

export async function completeBookingAndCleanupMedia(bookingId: string) {
  const normalizedBookingId = String(bookingId || '').trim()
  if (!normalizedBookingId) {
    throw new Error('Falta el identificador de la reserva.')
  }

  const { data, error } = await supabase.functions.invoke('booking-complete', {
    body: { bookingId: normalizedBookingId },
  })

  if (error) {
    throw error
  }

  return (data || {}) as {
    success?: boolean
    bookingId?: string
    cleanup?: BookingCompletionCleanupSummary
  }
}
