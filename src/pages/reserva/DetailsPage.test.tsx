// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useBooking: vi.fn(),
  serviceName: 'Servicio general',
  // Respuesta de la consulta del nombre del servicio (sobrescribible por prueba).
  nameQuery: null as null | (() => Promise<unknown>),
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
          single: async () => (mocks.nameQuery ? mocks.nameQuery() : { data: { name: mocks.serviceName } }),
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
import { rememberServiceNames, resetServiceNameCatalog } from '../../utils/serviceNameCatalog'

describe('DetailsPage', () => {
  let contextValue: any

  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
  })

  beforeEach(() => {
    mocks.toast.error.mockReset()
    mocks.toast.success.mockReset()
    mocks.serviceName = 'Servicio general'
    mocks.nameQuery = null
    resetServiceNameCatalog()

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

  it('mientras llega el nombre del servicio no pinta la pantalla genérica de fotos (sin parpadeo)', async () => {
    let resolveName: (value: unknown) => void = () => {}
    mocks.nameQuery = () => new Promise((resolve) => { resolveName = resolve })
    render(<DetailsPage />)

    expect(screen.getByRole('status').textContent).toBe('Cargando el servicio…')
    expect(screen.queryByText('Fotos de tu jardín')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continuar' })).toBeNull()

    resolveName({ data: { name: 'Servicio general' } })
    await screen.findByText('Fotos de tu jardín')
  })

  it('si no se puede cargar el servicio, lo dice y deja reintentar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.nameQuery = async () => ({ data: null, error: new Error('red') })
    render(<DetailsPage />)

    await screen.findByText('No hemos podido cargar el servicio.')
    expect(screen.queryByText('Fotos de tu jardín')).toBeNull()
    mocks.nameQuery = null
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await screen.findByText('Fotos de tu jardín')
  })

  describe('selector fotos/manual', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_ENABLE_MANUAL_BOOKING_INPUT', 'true')
      contextValue.bookingData.serviceIds = ['svc-lawn']
      contextValue.bookingData.bookingPhotoContract = { schemaVersion: 'booking_photo_v1', items: [] }
      contextValue.bookingData.uploadedPhotoUrls = []
      // Lo deja «Servicios» al cargar el catálogo: «Detalles» lo tiene desde el primer render.
      rememberServiceNames([{ id: 'svc-lawn', name: 'Corte de césped' }])
    })

    const photoFlow = () => screen.getByText('Fotos de tu césped').closest('.hidden')

    it('al entrar, sin elegir: solo el selector, sin formulario ni «Continuar»', () => {
      render(<DetailsPage />)

      expect(screen.getByRole('radio', { name: 'Con fotos' }).getAttribute('aria-checked')).toBe('false')
      expect(screen.getByRole('radio', { name: 'Escribo los datos' }).getAttribute('aria-checked')).toBe('false')
      expect(photoFlow()).not.toBeNull()
      expect(screen.queryByRole('button', { name: 'Continuar' })).toBeNull()
      expect(screen.queryByText(/Pregunta 1 de/)).toBeNull()
    })

    it('con fotos elegido: barra con «Con fotos» marcado, el flujo de fotos y «Continuar»', () => {
      contextValue.bookingData.dataInputMode = 'photos'
      render(<DetailsPage />)

      expect(screen.getByRole('radio', { name: 'Con fotos' }).getAttribute('aria-checked')).toBe('true')
      expect(screen.getByRole('radio', { name: 'Escribo los datos' }).getAttribute('aria-checked')).toBe('false')
      expect(photoFlow()).toBeNull()
      expect(screen.getByRole('button', { name: /Continuar/ })).toBeTruthy()
    })

    it('a mano elegido: la misma barra con «Escribo los datos» marcado y el asistente', () => {
      contextValue.bookingData.dataInputMode = 'manual'
      render(<DetailsPage />)

      expect(screen.getByRole('radio', { name: 'Escribo los datos' }).getAttribute('aria-checked')).toBe('true')
      expect(screen.getByRole('radio', { name: 'Con fotos' }).getAttribute('aria-checked')).toBe('false')
      expect(screen.getByText(/Pregunta 1 de/)).toBeTruthy()
      expect(photoFlow()).not.toBeNull()
    })

    it('elegir guarda el modo; volver a tocar el ya elegido no hace nada', () => {
      contextValue.bookingData.dataInputMode = 'photos'
      render(<DetailsPage />)

      fireEvent.click(screen.getByRole('radio', { name: 'Con fotos' }))
      expect(contextValue.setBookingData).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('radio', { name: 'Escribo los datos' }))
      const update = contextValue.setBookingData.mock.calls.at(-1)[0]
      const patch = typeof update === 'function' ? update(contextValue.bookingData) : update
      expect(patch.dataInputMode).toBe('manual')
      expect(patch.servicesData['svc-lawn'].dataInputMode).toBe('manual')
    })
  })

  it('oculta resultados previos mientras una zona está analizando', () => {
    expect(shouldShowZoneAnalysisResult(true, false)).toBe(true)
    expect(shouldShowZoneAnalysisResult(true, true)).toBe(false)
    expect(shouldShowZoneAnalysisResult(false, false)).toBe(false)
    expect(shouldShowZoneAnalysisResult(false, true)).toBe(false)
  })
})
