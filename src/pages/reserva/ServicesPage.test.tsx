// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import ServicesPage from './ServicesPage'

describe('ServicesPage', () => {
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

  it('degrada desde imagen alternativa a placeholder si la imagen sigue fallando', async () => {
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

    expect(await screen.findByText('Imagen alternativa')).toBeTruthy()

    const fallbackImage = container.querySelector('img')
    expect(fallbackImage).toBeTruthy()
    fireEvent.error(fallbackImage as HTMLImageElement)

    expect(await screen.findByText('Imagen no disponible')).toBeTruthy()
  })
})
