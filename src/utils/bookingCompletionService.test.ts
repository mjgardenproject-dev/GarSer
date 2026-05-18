import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: mocks.invoke,
    },
  },
}))

import { completeBookingAndCleanupMedia } from './bookingCompletionService'

describe('bookingCompletionService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invoca la Edge Function de completado con el bookingId normalizado', async () => {
    mocks.invoke.mockResolvedValue({
      data: { success: true, cleanup: { status: 'completed' } },
      error: null,
    })

    const result = await completeBookingAndCleanupMedia(' booking-1 ')

    expect(mocks.invoke).toHaveBeenCalledWith('booking-complete', {
      body: { bookingId: 'booking-1' },
    })
    expect(result.cleanup?.status).toBe('completed')
  })

  it('propaga errores de la invocación remota', async () => {
    const failure = new Error('remote_failed')
    mocks.invoke.mockResolvedValue({
      data: null,
      error: failure,
    })

    await expect(completeBookingAndCleanupMedia('booking-1')).rejects.toThrow('remote_failed')
  })
})
