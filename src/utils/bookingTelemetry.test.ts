// @vitest-environment jsdom
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

import { reportBookingEvent } from './bookingTelemetry'

describe('bookingTelemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    mocks.invoke.mockResolvedValue({ data: null, error: null })
    window.localStorage.removeItem('garser:booking-telemetry-debug')
    delete (window as typeof window & { __GARSER_BOOKING_TELEMETRY_DEBUG__?: boolean }).__GARSER_BOOKING_TELEMETRY_DEBUG__
  })

  it('no ensucia la consola por defecto y sigue enviando el payload al sink', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    reportBookingEvent('error', {
      event: 'booking.details_analysis_failed',
      context: { serviceId: 'svc-1' },
    })

    expect(infoSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(mocks.invoke).toHaveBeenCalledWith(
      'booking-telemetry',
      expect.objectContaining({
        body: expect.objectContaining({
          event: 'booking.details_analysis_failed',
          level: 'error',
          source: 'web-client',
        }),
      })
    )

    infoSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('sanea contexto sensible e infiere metadatos estructurados del evento', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const file = new File(['img'], 'foto privada.jpg', { type: 'image/jpeg' })

    reportBookingEvent('warn', {
      event: 'booking.photo_upload_failed',
      context: {
        service: 'lawn',
        scope: 'details_lawn',
        address: 'Calle Mayor 10',
        description: 'Jardin trasero con acceso por la derecha',
        file,
        nested: {
          authToken: 'secret-token',
          message: 'boom',
        },
      },
    })

    expect(mocks.invoke).toHaveBeenCalledWith(
      'booking-telemetry',
      expect.objectContaining({
        body: expect.objectContaining({
          event: 'booking.photo_upload_failed',
          phase: 'upload',
          status: 'failed',
          errorType: 'photo_upload_error',
          service: 'lawn',
          scope: 'details_lawn',
          context: expect.objectContaining({
            address: '[redacted]',
            description: '[redacted]',
            file: expect.objectContaining({
              kind: 'file',
              name: 'foto privada.jpg',
              type: 'image/jpeg',
            }),
            nested: expect.objectContaining({
              authToken: '[redacted]',
              message: 'boom',
            }),
          }),
        }),
      })
    )
    expect(warnSpy).not.toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it('inyecta un correlationId estable y normaliza identificadores operativos', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    reportBookingEvent('info', {
      event: 'booking.media_prepare_promoting_contract_refs',
      context: {
        bookingId: 'booking-123',
        operation_id: 'operation-456',
        user_id: 'user-789',
        serviceId: 'svc-1',
      },
    })

    expect(mocks.invoke).toHaveBeenCalledWith(
      'booking-telemetry',
      expect.objectContaining({
        body: expect.objectContaining({
          bookingId: 'booking-123',
          operationId: 'operation-456',
          userId: 'user-789',
          serviceId: 'svc-1',
          correlationId: expect.any(String),
          context: expect.objectContaining({
            bookingId: 'booking-123',
            operationId: 'operation-456',
            userId: 'user-789',
            serviceId: 'svc-1',
            correlationId: expect.any(String),
          }),
        }),
      }),
    )

    infoSpy.mockRestore()
  })

  it('reintenta el envío al sink cuando falla de forma transitoria', async () => {
    vi.useFakeTimers()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.invoke
      .mockResolvedValueOnce({ data: null, error: new Error('timeout') })
      .mockResolvedValueOnce({ data: null, error: null })

    reportBookingEvent('warn', {
      event: 'booking.photo_upload_failed',
      context: {
        scope: 'retry-test',
      },
    })

    await vi.runAllTimersAsync()

    expect(mocks.invoke).toHaveBeenCalledTimes(2)
    expect(warnSpy).not.toHaveBeenCalled()

    warnSpy.mockRestore()
    vi.useRealTimers()
  })

  it('permite activar logs de depuración de forma explícita', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    ;(window as typeof window & { __GARSER_BOOKING_TELEMETRY_DEBUG__?: boolean }).__GARSER_BOOKING_TELEMETRY_DEBUG__ = true

    reportBookingEvent('info', {
      event: 'booking.media_prepare_promoting_contract_refs',
      context: {
        bookingId: 'booking-123',
      },
    })

    expect(infoSpy).toHaveBeenCalledWith(
      '[booking-event]',
      expect.objectContaining({
        event: 'booking.media_prepare_promoting_contract_refs',
        level: 'info',
      }),
    )

    infoSpy.mockRestore()
  })
})
