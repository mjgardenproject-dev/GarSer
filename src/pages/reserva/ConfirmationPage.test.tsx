// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useBooking: vi.fn(),
  useAuth: vi.fn(),
  navigate: vi.fn(),
  setCurrentStep: vi.fn(),
  resetBooking: vi.fn(),
  setBookingData: vi.fn(),
  prepareBookingMediaForPersistence: vi.fn(),
  persistBookingMedia: vi.fn(),
  createAtomicBooking: vi.fn(),
  createAuthoritativeQuote: vi.fn(),
  reportBookingEvent: vi.fn(),
  clearBookingResumeStorage: vi.fn(),
  readAnyBookingResume: vi.fn(() => null),
  writeBookingResume: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
  unsubscribe: vi.fn(),
}))

vi.mock('../../contexts/BookingContext', () => ({
  useBooking: () => mocks.useBooking(),
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mocks.useAuth(),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ search: '' }),
}))

vi.mock('../../utils/bookingMediaService', () => ({
  prepareBookingMediaForPersistence: mocks.prepareBookingMediaForPersistence,
  persistBookingMedia: mocks.persistBookingMedia,
}))

vi.mock('../../utils/bookingAtomicService', () => ({
  createAtomicBooking: mocks.createAtomicBooking,
}))

vi.mock('../../utils/bookingAuthorityService', () => ({
  createAuthoritativeQuote: mocks.createAuthoritativeQuote,
}))

vi.mock('../../utils/bookingTelemetry', () => ({
  reportBookingEvent: mocks.reportBookingEvent,
}))

vi.mock('../../utils/bookingResumeStorage', () => ({
  clearBookingResumeStorage: mocks.clearBookingResumeStorage,
  readAnyBookingResume: mocks.readAnyBookingResume,
  writeBookingResume: mocks.writeBookingResume,
}))

vi.mock('react-hot-toast', () => ({
  default: mocks.toast,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => {
        if (table === 'services') {
          return {
            in: async () => ({
              data: [{ id: 'svc-1', name: 'Corte de césped' }],
            }),
          }
        }

        if (table === 'gardener_profiles') {
          return {
            eq: () => ({
              maybeSingle: async () => ({
                data: { full_name: 'Jardinero Test' },
              }),
            }),
          }
        }

        return {
          in: async () => ({ data: [] }),
          eq: () => ({
            maybeSingle: async () => ({ data: null }),
          }),
        }
      },
    }),
    auth: {
      onAuthStateChange: () => ({
        data: {
          subscription: {
            unsubscribe: mocks.unsubscribe,
          },
        },
      }),
    },
  },
}))

import ConfirmationPage from './ConfirmationPage'

describe('ConfirmationPage', () => {
  const photoFile = new File(['img'], 'jardin.jpg', { type: 'image/jpeg' })
  const bookingData = {
    address: 'Calle Sol 4',
    serviceIds: ['svc-1'],
    description: 'Podar el jardín delantero',
    preferredDate: '2026-05-20',
    timeSlot: '09:00 - 10:00',
    providerId: 'gardener-1',
    estimatedHours: 2,
    totalPrice: 120,
    palmSpecies: '',
    photos: [photoFile],
    uploadedPhotoUrls: ['blob:jardin.jpg'],
    bookingPhotoContract: {
      schemaVersion: 'booking_photo_v1',
      items: [
        {
          id: 'local-1',
          url: 'blob:jardin.jpg',
        },
      ],
    },
    priceBreakdown: [{ desc: 'Servicio base', price: 120 }],
    quoteId: 'quote-1',
    quoteSignature: 'sig-1',
    quoteExpiresAt: '2026-05-20T10:00:00Z',
    quotePricingVersion: 'v1',
    quoteProviderConfigVersion: 'cfg-1',
    quoteWarnings: [],
    quoteMetadata: {},
    palmGroups: [],
  }

  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()

    mocks.useAuth.mockReturnValue({
      user: { id: 'user-1', email: 'cliente@example.com' },
    })
    mocks.useBooking.mockReturnValue({
      bookingData,
      resetBooking: mocks.resetBooking,
      setCurrentStep: mocks.setCurrentStep,
      setBookingData: mocks.setBookingData,
    })
    mocks.createAuthoritativeQuote.mockResolvedValue({
      estimatedHours: 2,
      totalPrice: 120,
      breakdown: [{ desc: 'Servicio base', price: 120 }],
      quoteId: 'quote-1',
      signature: 'sig-1',
      expiresAt: '2026-05-20T10:00:00Z',
      pricingVersion: 'v1',
      providerConfigVersion: 'cfg-1',
      warnings: [],
      metadata: {},
    })
    mocks.prepareBookingMediaForPersistence.mockResolvedValue([
      {
        storageBucket: 'booking-photos',
        storagePath: 'bookings/user-1/booking-1/photo.jpg',
      },
    ])
    mocks.createAtomicBooking.mockResolvedValue({
      booking_id: 'booking-1',
    })
    mocks.persistBookingMedia.mockResolvedValue(undefined)
  })

  it('promueve las fotos del contrato y persiste los medios definitivos al confirmar', async () => {
    render(<ConfirmationPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar reserva' }))

    await waitFor(() => {
      expect(mocks.prepareBookingMediaForPersistence).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'user-1',
          bookingId: expect.any(String),
          operationId: expect.any(String),
          localFiles: [photoFile],
          contractLike: bookingData,
          telemetryContext: expect.objectContaining({
            scope: 'booking_confirmation',
            providerId: 'gardener-1',
            serviceId: 'svc-1',
          }),
        }),
      )
    })

    await waitFor(() => {
      expect(mocks.persistBookingMedia).toHaveBeenCalledWith({
        bookingId: 'booking-1',
        uploaderId: 'user-1',
        mediaItems: [
          {
            storageBucket: 'booking-photos',
            storagePath: 'bookings/user-1/booking-1/photo.jpg',
          },
        ],
      })
    })

    expect(mocks.toast.success).toHaveBeenCalledWith('Reserva creada correctamente')
    expect(mocks.navigate).toHaveBeenCalledWith('/bookings')
  })

  it('registra telemetría estructurada si falla la persistencia de medios sin abortar la reserva', async () => {
    mocks.persistBookingMedia.mockRejectedValue(new Error('storage down'))

    render(<ConfirmationPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar reserva' }))

    await waitFor(() => {
      expect(mocks.reportBookingEvent).toHaveBeenCalledWith(
        'warn',
        expect.objectContaining({
          event: 'booking.media_persist_failed',
          context: expect.objectContaining({
            bookingId: 'booking-1',
            providerId: 'gardener-1',
            serviceId: 'svc-1',
          }),
        }),
      )
    })

    expect(mocks.toast.success).toHaveBeenCalledWith('Reserva creada correctamente')
    expect(mocks.navigate).toHaveBeenCalledWith('/bookings')
  })
})
