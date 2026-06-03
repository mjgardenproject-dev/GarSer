// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useBooking: vi.fn(),
  useAuth: vi.fn(),
  navigate: vi.fn(),
  locationSearch: '',
  setCurrentStep: vi.fn(),
  resetBooking: vi.fn(),
  setBookingData: vi.fn(),
  createAuthoritativeQuote: vi.fn(),
  isBookingAuthorityError: vi.fn((error: any) => Boolean(error?.source === 'booking-authority')),
  prepareBookingPayment: vi.fn(),
  getBookingPaymentAttemptStatus: vi.fn(),
  syncBookingPaymentAttempt: vi.fn(),
  cancelBookingPaymentAttempt: vi.fn(),
  isBookingPaymentError: vi.fn((error: unknown) => Boolean((error as { source?: string } | null)?.source === 'booking-payment')),
  reportBookingEvent: vi.fn(),
  clearBookingResumeStorage: vi.fn(),
  readBookingResumeState: vi.fn(() => ({ record: null, error: null, sourceKey: null, storage: null, fromAnonFallback: false })),
  writeBookingResumeResult: vi.fn(() => ({
    record: { nonSerializablePaths: [], ownerUserId: 'user-1', ownerScope: 'user' },
    error: null,
    storage: 'localStorage',
  })),
  parseBookingResumeRedirectParam: vi.fn(() => ({ record: null, error: null })),
  buildBookingResumeRedirectParam: vi.fn(() => 'encoded-resume'),
  claimBookingResumeForUser: vi.fn(({ record }) => record),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
  unsubscribe: vi.fn(),
  stripeSubmit: vi.fn(),
  stripeConfirmPayment: vi.fn(),
  getStripePromise: vi.fn(() => Promise.resolve({})),
}))

vi.mock('../../contexts/BookingContext', () => ({
  useBooking: () => mocks.useBooking(),
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mocks.useAuth(),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ search: mocks.locationSearch }),
}))

vi.mock('../../utils/bookingAuthorityService', () => ({
  createAuthoritativeQuote: mocks.createAuthoritativeQuote,
  isBookingAuthorityError: mocks.isBookingAuthorityError,
}))

vi.mock('../../utils/bookingPaymentService', () => ({
  prepareBookingPayment: mocks.prepareBookingPayment,
  getBookingPaymentAttemptStatus: mocks.getBookingPaymentAttemptStatus,
  syncBookingPaymentAttempt: mocks.syncBookingPaymentAttempt,
  cancelBookingPaymentAttempt: mocks.cancelBookingPaymentAttempt,
  isBookingPaymentError: mocks.isBookingPaymentError,
}))

vi.mock('../../utils/bookingTelemetry', () => ({
  reportBookingEvent: mocks.reportBookingEvent,
}))

vi.mock('../../utils/bookingResumeStorage', () => ({
  buildBookingResumeRedirectParam: mocks.buildBookingResumeRedirectParam,
  claimBookingResumeForUser: mocks.claimBookingResumeForUser,
  clearBookingResumeStorage: mocks.clearBookingResumeStorage,
  parseBookingResumeRedirectParam: mocks.parseBookingResumeRedirectParam,
  readBookingResumeState: mocks.readBookingResumeState,
  writeBookingResumeResult: mocks.writeBookingResumeResult,
}))

vi.mock('react-hot-toast', () => ({
  default: mocks.toast,
}))

vi.mock('../../lib/stripeClient', () => ({
  getStripePromise: mocks.getStripePromise,
}))

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <div data-testid="stripe-elements">{children}</div>,
  PaymentElement: ({ onReady }: { onReady?: () => void }) => {
    React.useEffect(() => {
      onReady?.()
    }, [onReady])

    return <div data-testid="payment-element">PaymentElement</div>
  },
  useStripe: () => ({ confirmPayment: mocks.stripeConfirmPayment }),
  useElements: () => ({ submit: mocks.stripeSubmit }),
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
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      signInWithOtp: vi.fn(),
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

function futureIso(minutes = 60) {
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

function createBookingData() {
  return {
    address: 'Calle Sol 4',
    serviceIds: ['svc-1'],
    description: 'Podar el jardín delantero',
    preferredDate: '2026-05-20',
    timeSlot: '09:00 - 10:00',
    providerId: 'gardener-1',
    estimatedHours: 2,
    totalPrice: 158,
    palmSpecies: '',
    photos: [],
    uploadedPhotoUrls: ['blob:jardin.jpg'],
    bookingPhotoContract: {
      schemaVersion: 'booking_photo_v1',
      items: [{ id: 'local-1', url: 'blob:jardin.jpg' }],
    },
    priceBreakdown: [{ desc: 'Servicio base', price: 158 }],
    quoteId: 'quote-1',
    quoteSignature: 'sig-1',
    quoteExpiresAt: futureIso(90),
    quotePricingVersion: 'v1',
    quoteProviderConfigVersion: 'cfg-1',
    quoteWarnings: [],
    quoteMetadata: {
      pricingContext: {
        serviceType: 'standard',
        allowsPriceChange: true,
        palmGroups: [],
      },
    },
    quoteAvailability: {
      requestedDate: '2026-05-20',
      validStartHours: [9],
      selectedSlot: {
        date: '2026-05-20',
        startHour: 9,
        startTime: '09:00:00',
        endTime: '11:00:00',
        durationHours: 2,
      },
    },
    quoteEconomics: {
      currency: 'EUR',
      taxRate: 0.21,
      serviceGrossTotal: 158,
      serviceNetSubtotal: 130.58,
      serviceTaxAmount: 27.42,
      managementFee: 19.75,
      payableNow: 19.75,
      payableLater: 158,
      lines: [],
      stripeLineItems: [],
    },
    palmGroups: [],
  }
}

function buildAuthoritativeQuote(bookingData: ReturnType<typeof createBookingData>) {
  return {
    estimatedHours: 2,
    totalPrice: 158,
    breakdown: [{ desc: 'Servicio base', price: 158 }],
    quoteId: 'quote-1',
    signature: 'sig-1',
    expiresAt: bookingData.quoteExpiresAt,
    pricingVersion: 'v1',
    providerConfigVersion: 'cfg-1',
    warnings: [],
    metadata: bookingData.quoteMetadata,
    economics: bookingData.quoteEconomics,
    availability: bookingData.quoteAvailability,
  }
}

function buildAttempt(overrides: Record<string, unknown> = {}) {
  return {
    attemptId: 'attempt-1',
    quoteId: 'quote-1',
    status: 'payment_pending',
    currency: 'eur',
    payableNowAmountCents: 1975,
    payableNowAmount: 19.75,
    serviceTotalAmountCents: 15800,
    serviceTotalAmount: 158,
    paymentIntentId: 'pi_test_123',
    paymentExpiresAt: futureIso(30),
    holdExpiresAt: futureIso(30),
    bookingId: undefined,
    retryable: false,
    terminal: false,
    lastErrorCode: undefined,
    lastErrorMessage: undefined,
    ...overrides,
  }
}

function createBookingPaymentError(overrides: Record<string, unknown> = {}) {
  return {
    source: 'booking-payment',
    name: 'BookingPaymentError',
    status: 500,
    code: 'booking_payment_failed',
    message: 'No se pudo preparar el pago seguro.',
    backendMessage: 'No se pudo preparar el pago seguro.',
    ...overrides,
  }
}

describe('ConfirmationPage embedded payment flow', () => {
  const originalLocation = window.location
  let bookingData: ReturnType<typeof createBookingData>

  beforeEach(() => {
    vi.clearAllMocks()
    bookingData = createBookingData()
    mocks.locationSearch = ''
    mocks.getBookingPaymentAttemptStatus.mockResolvedValue({ attempt: null })
    mocks.prepareBookingPayment.mockResolvedValue({
      attempt: buildAttempt(),
      clientSecret: 'pi_test_secret_123',
      publishableKey: 'pk_test_123',
    })
    mocks.syncBookingPaymentAttempt.mockResolvedValue(buildAttempt({ status: 'processing' }))
    mocks.cancelBookingPaymentAttempt.mockResolvedValue(buildAttempt({ status: 'cancelled', retryable: true, terminal: true }))
    mocks.createAuthoritativeQuote.mockResolvedValue(buildAuthoritativeQuote(bookingData))
    mocks.stripeSubmit.mockResolvedValue({})
    mocks.stripeConfirmPayment.mockResolvedValue({ paymentIntent: { id: 'pi_test_123', status: 'succeeded' } })

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        origin: 'https://garser.test',
        assign: vi.fn(),
      },
    })

    mocks.useAuth.mockReturnValue({
      user: { id: 'user-1', email: 'cliente@example.com' },
    })
    mocks.useBooking.mockReturnValue({
      bookingData,
      resetBooking: mocks.resetBooking,
      setCurrentStep: mocks.setCurrentStep,
      setBookingData: mocks.setBookingData,
    })
  })

  afterEach(() => {
    cleanup()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })
  })

  it('presenta Stripe Elements como experiencia principal', () => {
    render(<ConfirmationPage />)

    expect(screen.getByRole('button', { name: 'Continuar al pago' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Continuar al pago' })).toHaveLength(1)
    expect(screen.queryByText(/^Pago$/)).toBeNull()
    expect(screen.queryByText(/El pago se realiza dentro de esta pantalla con Stripe/)).toBeNull()
  })

  it('muestra el resumen de pago con la jerarquía económica esperada', () => {
    render(<ConfirmationPage />)

    expect(screen.getByText('Resumen de pago')).toBeTruthy()
    expect(screen.getByText('Total de la reserva')).toBeTruthy()
    expect(screen.getByText('177,75 €')).toBeTruthy()
    expect(screen.getByText('Subtotal del servicio')).toBeTruthy()
    expect(screen.getAllByText('158,00 €').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Tarifa de reserva')).toBeTruthy()
    expect(screen.getAllByText('19,75 €').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Adelanto de confirmación')).toBeTruthy()
    expect(screen.getByText('Pendiente al profesional')).toBeTruthy()
    expect(screen.getByText(/El profesional cobrará este importe al completar el servicio/)).toBeTruthy()
  })

  it('muestra la causa real cuando booking-payment devuelve slot_unavailable', async () => {
    mocks.prepareBookingPayment.mockRejectedValueOnce(
      createBookingPaymentError({
        status: 409,
        code: 'slot_unavailable',
        message: 'La franja ya no esta disponible para este presupuesto.',
        backendMessage: 'La franja ya no esta disponible para este presupuesto.',
      }),
    )

    render(<ConfirmationPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Continuar al pago' }))

    expect(await screen.findByText('Ese horario ya no está disponible')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Elegir otro horario' })).toBeTruthy()
    expect(mocks.toast.error).toHaveBeenCalledWith(
      'La franja seleccionada ya no está disponible. Elige otro horario antes de pagar.',
    )
  })

  it('mantiene la UX de presupuesto inválido cuando backend devuelve quote_expired', async () => {
    mocks.prepareBookingPayment.mockRejectedValueOnce(
      createBookingPaymentError({
        status: 409,
        code: 'quote_expired',
        message: 'El presupuesto ha caducado y debes regenerarlo antes de pagar.',
        backendMessage: 'El presupuesto ha caducado y debes regenerarlo antes de pagar.',
      }),
    )

    render(<ConfirmationPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Continuar al pago' }))

    expect(await screen.findByText('Actualiza la reserva')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Actualizar reserva' })).toBeTruthy()
    expect(mocks.toast.error).toHaveBeenCalledWith(
      'El presupuesto ha caducado o ya no es válido. Revalídalo antes de pagar.',
    )
  })

  it('evita vender un database_error 422 como si fuera un problema de presupuesto', async () => {
    mocks.prepareBookingPayment.mockRejectedValueOnce(
      createBookingPaymentError({
        status: 422,
        code: 'database_error',
        message: 'No se pudo crear el bloqueo de pago por un conflicto interno.',
        backendMessage: 'No se pudo crear el bloqueo de pago por un conflicto interno.',
      }),
    )

    render(<ConfirmationPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Continuar al pago' }))

    expect(await screen.findByText('No hemos podido abrir el pago')).toBeTruthy()
    expect(screen.queryByText('Actualiza la reserva')).toBeNull()
    expect(screen.queryByText(/Detalle backend:/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy()
    expect(mocks.toast.error).toHaveBeenCalledWith('No se pudo crear el bloqueo de pago por un conflicto interno.')
  })

  it('abre un bottom sheet de pago y renderiza Stripe Elements dentro', async () => {
    render(<ConfirmationPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Continuar al pago' }))

    await waitFor(() => {
      expect(mocks.prepareBookingPayment).toHaveBeenCalledWith({
        quoteId: 'quote-1',
        attemptId: undefined,
      })
    })

    expect(await screen.findByRole('dialog', { name: 'Pago seguro' })).toBeTruthy()
    expect(await screen.findByTestId('payment-element')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Continuar al pago' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Pagar 19,75 €' })).toBeTruthy()
  })

  it('confirma el pago inline y sincroniza el estado autoritativo', async () => {
    render(<ConfirmationPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Continuar al pago' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Pagar 19,75 €' }))

    await waitFor(() => {
      expect(mocks.stripeSubmit).toHaveBeenCalledTimes(1)
      expect(mocks.stripeConfirmPayment).toHaveBeenCalledTimes(1)
      expect(mocks.syncBookingPaymentAttempt).toHaveBeenCalledWith({ attemptId: 'attempt-1' })
    })
  })

  it('permite cerrar el pago y reabrirlo sin preparar un nuevo intento', async () => {
    render(<ConfirmationPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Continuar al pago' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar pago' }))

    expect(mocks.cancelBookingPaymentAttempt).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Pago seguro' })).toBeNull()
    expect(screen.queryByTestId('payment-element')).toBeNull()
    expect(screen.getByRole('button', { name: 'Reabrir pago' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Reabrir pago' }))

    expect(await screen.findByRole('dialog', { name: 'Pago seguro' })).toBeTruthy()
    expect(mocks.prepareBookingPayment).toHaveBeenCalledTimes(1)
  })

  it('muestra una vista final útil cuando la reserva queda confirmada', async () => {
    mocks.syncBookingPaymentAttempt.mockResolvedValueOnce(
      buildAttempt({
        status: 'booking_created',
        bookingId: 'booking-1',
        terminal: true,
      }),
    )

    render(<ConfirmationPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Continuar al pago' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Pagar 19,75 €' }))

    await waitFor(() => {
      expect(mocks.stripeSubmit).toHaveBeenCalledTimes(1)
      expect(mocks.stripeConfirmPayment).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Pago seguro' })).toBeNull()
    }, { timeout: 1500 })

    expect(await screen.findByRole('heading', { name: 'Todo ha quedado listo' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ir a mis reservas' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ir al inicio' })).toBeTruthy()
    expect(mocks.toast.success).toHaveBeenCalledWith('Pago confirmado y reserva creada correctamente')
  })

  it('rehidrata `payment_return` sin duplicar la sincronización al rerenderizar', async () => {
    mocks.locationSearch = '?payment_return=1&attempt_id=attempt-1'
    const { rerender } = render(<ConfirmationPage />)

    await waitFor(() => {
      expect(mocks.syncBookingPaymentAttempt).toHaveBeenCalledTimes(1)
    })

    rerender(<ConfirmationPage />)

    await waitFor(() => {
      expect(mocks.syncBookingPaymentAttempt).toHaveBeenCalledTimes(1)
    })
  })

  it('mantiene visible la vista final cuando el pago ya está consolidado hasta que el cliente actúe', async () => {
    mocks.locationSearch = '?payment_return=1&attempt_id=attempt-1'
    mocks.syncBookingPaymentAttempt.mockResolvedValueOnce(
      buildAttempt({
        status: 'booking_created',
        bookingId: 'booking-1',
        terminal: true,
      }),
    )

    render(<ConfirmationPage />)

    expect(await screen.findByRole('heading', { name: 'Todo ha quedado listo' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ir a mis reservas' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ir al inicio' })).toBeTruthy()
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(mocks.clearBookingResumeStorage).toHaveBeenCalled()
    expect(mocks.toast.success).toHaveBeenCalledWith('Pago confirmado y reserva creada correctamente')
  })

  it('limpia la reanudacion de reserva antes de ir al inicio tras completar el pago', async () => {
    mocks.locationSearch = '?payment_return=1&attempt_id=attempt-1'
    mocks.syncBookingPaymentAttempt.mockResolvedValueOnce(
      buildAttempt({
        status: 'booking_created',
        bookingId: 'booking-1',
        terminal: true,
      }),
    )

    render(<ConfirmationPage />)

    expect(await screen.findByRole('heading', { name: 'Todo ha quedado listo' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Ir al inicio' }))

    expect(mocks.clearBookingResumeStorage).toHaveBeenCalledWith({
      userId: 'user-1',
      includeAnonFallback: true,
      includeLegacy: true,
    })
    expect(mocks.resetBooking).toHaveBeenCalled()
    expect(mocks.navigate).toHaveBeenCalledWith('/dashboard', {
      replace: true,
      state: { skipBookingResumeRedirect: true },
    })
  })
})
