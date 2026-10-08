// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useBooking: vi.fn(),
  fetchServices: vi.fn(),
}))

vi.mock('../../contexts/BookingContext', () => ({
  useBooking: () => mocks.useBooking(),
}))

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: null }),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'services') {
        return {
          select: () => ({
            eq: () => ({
              order: () => mocks.fetchServices(),
            }),
          }),
        }
      }

      if (table === 'service_images') {
        return {
          select: async () => ({ data: [] }),
        }
      }

      return {
        select: async () => ({ data: [] }),
      }
    },
  },
}))

vi.mock('../../utils/marketingAssets', () => ({
  getMarketingAssetUrl: (slot: string) => `https://cdn.example.com/${slot}.webp`,
}))

import ServicesPage from './ServicesPage'
import { getKnownServiceName, resetServiceNameCatalog } from '../../utils/serviceNameCatalog'

describe('ServicesPage', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    vi.clearAllMocks()

    mocks.useBooking.mockReturnValue({
      bookingData: {
        serviceIds: [],
      },
      setBookingData: vi.fn(),
      saveProgress: vi.fn(),
      setCurrentStep: vi.fn(),
    })
  })

  it('limita los reintentos manuales cuando el catalogo falla repetidamente', async () => {
    mocks.fetchServices.mockResolvedValue({
      data: null,
      error: new Error('fetch failed'),
    })

    render(<ServicesPage />)

    expect(await screen.findByText('No se ha podido cargar el catálogo.')).toBeTruthy()

    for (let index = 0; index < 3; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: /Reintentar carga/i }))
      await screen.findByText('No se ha podido cargar el catálogo.')
    }

    await waitFor(() => {
      const exhaustedButton = screen.getByRole('button', { name: 'Reintentos agotados' })
      expect(exhaustedButton).toHaveProperty('disabled', true)
    })
  })

  it('muestra placeholder si falla la imagen canonica de marketing del servicio', async () => {
    mocks.fetchServices.mockResolvedValue({
      data: [
        {
          id: 'svc-1',
          name: 'Corte de césped',
          image_url: 'https://bad.example/service.jpg',
          image_id: null,
        },
      ],
      error: null,
    })

    const { container } = render(<ServicesPage />)

    await screen.findByRole('button', { name: 'Seleccionar Corte de césped' })

    const image = container.querySelector('img')
    expect(image).toBeTruthy()
    fireEvent.error(image as HTMLImageElement)

    expect(await screen.findByText('Imagen no disponible')).toBeTruthy()
  })

  it('deja los nombres para «Detalles» y, al cambiar de servicio, olvida el modo de entrada del anterior', async () => {
    resetServiceNameCatalog()
    const context = {
      bookingData: { serviceIds: ['svc-old'], dataInputMode: 'manual', manualDeclarationId: 'decl-1' },
      setBookingData: vi.fn(),
      saveProgress: vi.fn(),
      setCurrentStep: vi.fn(),
    }
    mocks.useBooking.mockReturnValue(context)
    mocks.fetchServices.mockResolvedValue({
      data: [
        { id: 'svc-old', name: 'Corte de césped', image_url: null, image_id: null },
        { id: 'svc-fito', name: 'Fumigación y tratamientos', image_url: null, image_id: null },
      ],
      error: null,
    })

    render(<ServicesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Seleccionar Servicios fitosanitarios' }))
    fireEvent.click(screen.getByRole('button', { name: 'Seleccionar Corte de césped' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continuar a los detalles del servicio' }))

    expect(getKnownServiceName('svc-fito')).toBe('Servicios fitosanitarios')
    expect(context.setBookingData).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceIds: ['svc-fito'],
        dataInputMode: undefined,
        manualDeclarationId: undefined,
        manualConsent: undefined,
      }),
    )
    expect(context.setCurrentStep).toHaveBeenCalledWith(2)
  })
})
