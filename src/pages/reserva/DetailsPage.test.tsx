// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useBooking: vi.fn(),
  serviceName: 'Servicio general',
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('../../contexts/BookingContext', () => ({
  useBooking: () => mocks.useBooking(),
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false }),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { name: mocks.serviceName },
          }),
        }),
      }),
    }),
  },
}))

vi.mock('../../utils/aiPricingEstimator', () => ({
  estimateWorkWithAI: vi.fn(),
  calculatePalmHours: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({
  default: mocks.toast,
}))

vi.mock('../../components/shared/AnalysisLoadingAnimation', () => ({
  AnalysisLoadingAnimation: () => <div>loading</div>,
}))

vi.mock('../../components/shared/AnalysisFailedCard', () => ({
  AnalysisFailedCard: () => <div>failed</div>,
}))

vi.mock('../../components/shared/ZonePhotoGallery', () => ({
  buildZonePhotoRemovalConfirmation: () => ({
    title: 'Eliminar foto',
    message: 'Eliminar foto',
    confirmLabel: 'Eliminar',
    cancelLabel: 'Cancelar',
    tone: 'danger',
  }),
  ZonePhotoGallery: () => <div>zone-gallery</div>,
}))

vi.mock('../../components/shared/ZoneActionButton', () => ({
  ZoneActionButton: () => <button type="button">accion-zona</button>,
}))

vi.mock('../../components/shared/ServiceResultCard', () => ({
  ServiceResultCard: () => <div>service-result</div>,
}))

import DetailsPage, { shouldShowZoneAnalysisResult } from './DetailsPage'

describe('DetailsPage', () => {
  let contextValue: any

  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    mocks.toast.error.mockReset()
    mocks.toast.success.mockReset()
    mocks.serviceName = 'Servicio general'

    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
    })

    contextValue = {
      bookingData: {
        address: 'Calle Sol 4',
        serviceIds: ['svc-generic'],
        photos: [],
        bookingPhotoContract: {
          schemaVersion: 'booking_photo_v1',
          items: [
            {
              id: 'storage:booking-photos:bookings/client-1/booking-1/canonical.jpg',
              url: 'https://cdn.example.com/canonical.jpg',
              storageBucket: 'booking-photos',
              storagePath: 'bookings/client-1/booking-1/canonical.jpg',
            },
          ],
        },
        uploadedPhotoUrls: ['https://legacy.example.com/stale.jpg'],
        description: '',
        preferredDate: '',
        timeSlot: '',
        providerId: '',
        estimatedHours: 0,
        totalPrice: 0,
        aiQuantity: 0,
        aiUnit: '',
        aiDifficulty: 1,
        aiTasks: [],
        lawnZones: [],
        palmGroups: [],
        hedgeZones: [],
        treeGroups: [],
        shrubGroups: [],
        phytosanitaryZones: [],
        weedingZones: [],
        wasteRemoval: true,
        isAnalyzing: false,
        servicesData: {},
      },
      setBookingData: vi.fn(),
      saveProgress: vi.fn(),
      setCurrentStep: vi.fn(),
      updateServiceData: vi.fn(),
      switchToService: vi.fn(),
      resumeWarning: null,
      clearResumeWarning: vi.fn(),
    }

    mocks.useBooking.mockReturnValue(contextValue)
  })

  it('renderiza las fotos principales desde el contrato canónico y no desde urls legacy obsoletas', async () => {
    render(<DetailsPage />)

    await screen.findByText('Fotos de tu jardín')

    const image = screen.getByAltText('Foto 1') as HTMLImageElement
    expect(image.getAttribute('src')).toBe('https://cdn.example.com/canonical.jpg')
  })

  it('descarta urls legacy http obsoletas cuando ya existe contrato canónico', async () => {
    render(<DetailsPage />)

    await screen.findByText('Fotos de tu jardín')

    expect(screen.getByText('1/5')).toBeTruthy()
    expect(document.querySelector('img[src="https://legacy.example.com/stale.jpg"]')).toBeNull()
    expect(contextValue.setBookingData).not.toHaveBeenCalled()
  })

  it('oculta resultados previos mientras una zona está analizando', () => {
    expect(shouldShowZoneAnalysisResult(true, false)).toBe(true)
    expect(shouldShowZoneAnalysisResult(true, true)).toBe(false)
    expect(shouldShowZoneAnalysisResult(false, false)).toBe(false)
    expect(shouldShowZoneAnalysisResult(false, true)).toBe(false)
  })
})
