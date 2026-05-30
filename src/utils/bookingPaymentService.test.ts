import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}))

vi.mock('./bookingTelemetry', () => ({
  reportBookingEvent: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: invokeMock,
    },
  },
}))

import {
  BookingPaymentError,
  cancelBookingPaymentAttempt,
  getBookingPaymentAttemptStatus,
  prepareBookingPayment,
  syncBookingPaymentAttempt,
} from './bookingPaymentService'

function createFunctionsHttpError(status: number, body: Record<string, unknown> | string) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  const headers =
    typeof body === 'string'
      ? { 'Content-Type': 'text/plain' }
      : { 'Content-Type': 'application/json' }

  return Object.assign(new Error('Edge Function returned a non-2xx status code'), {
    name: 'FunctionsHttpError',
    context: new Response(payload, { status, headers }),
  })
}

describe('bookingPaymentService', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('prepara el pago server-side usando solo quoteId', async () => {
    invokeMock.mockResolvedValueOnce({
      data: {
        clientSecret: 'pi_test_secret_123',
        publishableKey: 'pk_test_123',
        attempt: {
          attemptId: 'attempt-1',
          quoteId: 'quote-1',
          status: 'payment_pending',
          currency: 'eur',
          payableNowAmountCents: 1500,
          serviceTotalAmountCents: 12000,
          retryable: false,
          terminal: false,
        },
      },
      error: null,
    })

    const result = await prepareBookingPayment({
      quoteId: 'quote-1',
    })

    expect(invokeMock).toHaveBeenCalledWith('booking-payment', {
      body: {
        action: 'prepare_payment',
        quoteId: 'quote-1',
        attemptId: undefined,
      },
    })
    expect(result.attempt.payableNowAmount).toBe(15)
    expect(result.clientSecret).toBe('pi_test_secret_123')
    expect(result.publishableKey).toBe('pk_test_123')
  })

  it('normaliza el estado del intento al consultar retry o expiración', async () => {
    invokeMock.mockResolvedValueOnce({
      data: {
        attempt: {
          attemptId: 'attempt-1',
          quoteId: 'quote-1',
          status: 'expired',
          currency: 'eur',
          payableNowAmountCents: 1500,
          serviceTotalAmountCents: 12000,
          retryable: true,
          terminal: true,
          lastErrorMessage: 'El tiempo del pago ha expirado. Puedes reintentarlo.',
        },
      },
      error: null,
    })

    const result = await getBookingPaymentAttemptStatus({ attemptId: 'attempt-1' })

    expect(invokeMock).toHaveBeenCalledWith('booking-payment', {
      body: {
        action: 'get_attempt_status',
        attemptId: 'attempt-1',
        quoteId: undefined,
      },
    })
    expect(result.attempt?.status).toBe('expired')
    expect(result.attempt?.retryable).toBe(true)
  })

  it('propaga la cancelación explícita del intento', async () => {
    invokeMock.mockResolvedValueOnce({
      data: {
        attempt: {
          attemptId: 'attempt-1',
          quoteId: 'quote-1',
          status: 'cancelled',
          currency: 'eur',
          payableNowAmountCents: 1500,
          serviceTotalAmountCents: 12000,
          retryable: true,
          terminal: true,
        },
      },
      error: null,
    })

    const result = await cancelBookingPaymentAttempt({ attemptId: 'attempt-1' })

    expect(invokeMock).toHaveBeenCalledWith('booking-payment', {
      body: {
        action: 'cancel_attempt',
        attemptId: 'attempt-1',
      },
    })
    expect(result.status).toBe('cancelled')
    expect(result.retryable).toBe(true)
  })

  it('preserva status, code y mensaje backend real cuando booking-payment falla al preparar el pago', async () => {
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: createFunctionsHttpError(502, {
        error: 'Stripe devolvio un error al procesar el pago.',
        code: 'stripe_request_failed',
      }),
    })

    await expect(
      prepareBookingPayment({
        quoteId: 'quote-1',
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<BookingPaymentError>>({
        name: 'BookingPaymentError',
        source: 'booking-payment',
        status: 502,
        code: 'stripe_request_failed',
        backendMessage: 'Stripe devolvio un error al procesar el pago.',
        message: 'Stripe devolvio un error al procesar el pago.',
      }),
    )
  })

  it('extrae mensajes descriptivos desde payloads JSON anidados y evita mostrar [object Object]', async () => {
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('[object Object]'), {
        name: 'FunctionsHttpError',
        context: new Response(
          JSON.stringify({
            error: {
              message: 'La conciliacion del pago ha fallado por un estado invalido del intento.',
              code: 'invalid_attempt_state',
            },
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      }),
    })

    await expect(
      syncBookingPaymentAttempt({
        attemptId: 'attempt-1',
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<BookingPaymentError>>({
        name: 'BookingPaymentError',
        source: 'booking-payment',
        status: 500,
        message: 'La conciliacion del pago ha fallado por un estado invalido del intento.',
        backendMessage: 'La conciliacion del pago ha fallado por un estado invalido del intento.',
      }),
    )
  })

  it('sincroniza el estado del intento server-side usando attemptId', async () => {
    invokeMock.mockResolvedValueOnce({
      data: {
        attempt: {
          attemptId: 'attempt-1',
          quoteId: 'quote-1',
          status: 'booking_created',
          currency: 'eur',
          payableNowAmountCents: 1500,
          serviceTotalAmountCents: 12000,
          retryable: false,
          terminal: true,
          bookingId: 'booking-1',
        },
      },
      error: null,
    })

    const result = await syncBookingPaymentAttempt({
      attemptId: 'attempt-1',
    })

    expect(invokeMock).toHaveBeenCalledWith('booking-payment', {
      body: {
        action: 'sync_payment_state',
        attemptId: 'attempt-1',
      },
    })
    expect(result.status).toBe('booking_created')
    expect(result.bookingId).toBe('booking-1')
  })
})
