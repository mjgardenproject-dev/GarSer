import { describe, expect, it } from 'vitest'

import {
  attemptRequiresStripePayment,
  buildAuthoritativeBookingStripeLineItems,
  buildBookingNoPaymentEventId,
  buildBookingPaymentGatewaySyncEventId,
  buildBookingStripeLineItemProductCode,
  getBookingPaymentStatusCopy,
  getUnbookedPaymentCopy,
  isPaymentHoldExpiringSoon,
  paymentStatusNeedsExplanation,
  validateBookingStripeMetadataIntegrity,
} from './bookingPaymentCore'

describe('bookingPaymentCore Stripe integrity', () => {
  it('usa un line item fallback cuando el snapshot no trae items de Stripe', () => {
    const result = buildAuthoritativeBookingStripeLineItems({
      stripeLineItems: [],
      payableNowAmountCents: 1500,
    })

    expect(result).toEqual([
      {
        label: 'Gastos de gestion',
        unitAmountCents: 1500,
        quantity: 1,
      },
    ])
  })

  it('normaliza line items autoritativos y exige que cuadren con el importe del intento', () => {
    const result = buildAuthoritativeBookingStripeLineItems({
      stripeLineItems: [
        { label: 'Gastos de gestion', unitAmount: 10, quantity: 1 },
        { label: 'Suplemento', unitAmount: 2.5, quantity: 2 },
      ],
      payableNowAmountCents: 1500,
    })

    expect(result).toEqual([
      {
        label: 'Gastos de gestion',
        unitAmountCents: 1000,
        quantity: 1,
      },
      {
        label: 'Suplemento',
        unitAmountCents: 250,
        quantity: 2,
      },
    ])
  })

  it('rechaza snapshots economicos cuyo total de Stripe no coincide con el importe autoritativo', () => {
    expect(() =>
      buildAuthoritativeBookingStripeLineItems({
        stripeLineItems: [
          { label: 'Gastos de gestion', unitAmount: 9.99, quantity: 1 },
        ],
        payableNowAmountCents: 1500,
      })
    ).toThrow('El snapshot economico no cuadra con el importe autoritativo del intento de pago.')
  })

  it('acepta metadata completa y binding coherente del payment intent', () => {
    const result = validateBookingStripeMetadataIntegrity({
      expected: {
        attemptId: 'attempt-1',
        quoteId: 'quote-1',
        quoteSignature: 'sig-1',
        clientId: 'client-1',
        gardenerId: 'gardener-1',
        serviceId: 'service-1',
        payableNowAmountCents: 1500,
        paymentIntentId: 'pi_test_123',
      },
      metadata: {
        attempt_id: 'attempt-1',
        quote_id: 'quote-1',
        quote_signature: 'sig-1',
        client_id: 'client-1',
        gardener_id: 'gardener-1',
        service_id: 'service-1',
        payable_now_amount_cents: '1500',
      },
      paymentIntentId: 'pi_test_123',
    })

    expect(result.ok).toBe(true)
  })

  it('marca metadata incompleta cuando falta un identificador obligatorio', () => {
    const result = validateBookingStripeMetadataIntegrity({
      expected: {
        attemptId: 'attempt-1',
        quoteId: 'quote-1',
        quoteSignature: 'sig-1',
        clientId: 'client-1',
        gardenerId: 'gardener-1',
        serviceId: 'service-1',
        payableNowAmountCents: 1500,
      },
      metadata: {
        attempt_id: 'attempt-1',
        quote_id: 'quote-1',
        client_id: 'client-1',
        gardener_id: 'gardener-1',
        service_id: 'service-1',
        payable_now_amount_cents: '1500',
      },
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('stripe_metadata_incomplete')
  })

  it('detecta cuando Stripe devuelve un payment intent enlazado a otro intento', () => {
    const result = validateBookingStripeMetadataIntegrity({
      expected: {
        attemptId: 'attempt-1',
        quoteId: 'quote-1',
        quoteSignature: 'sig-1',
        clientId: 'client-1',
        gardenerId: 'gardener-1',
        serviceId: 'service-1',
        payableNowAmountCents: 1500,
        paymentIntentId: 'pi_test_123',
      },
      metadata: {
        attempt_id: 'attempt-1',
        quote_id: 'quote-1',
        quote_signature: 'sig-1',
        client_id: 'client-1',
        gardener_id: 'gardener-1',
        service_id: 'service-1',
        payable_now_amount_cents: '1500',
      },
      paymentIntentId: 'pi_test_other',
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('stripe_payment_intent_binding_mismatch')
  })

  it('construye un identificador de sincronizacion determinista usando el payment intent cuando existe', () => {
    expect(
      buildBookingPaymentGatewaySyncEventId({
        attemptId: 'attempt-1',
        paymentIntentId: 'pi_test_123',
      })
    ).toBe('client_sync:attempt-1:payment_intent:pi_test_123')
  })

  it('cae al attempt cuando no hay payment intent enlazado', () => {
    expect(
      buildBookingPaymentGatewaySyncEventId({
        attemptId: 'attempt-1',
      })
    ).toBe('client_sync:attempt-1:attempt')
  })

  it('genera product_code cortos y estables para Stripe line items', () => {
    expect(buildBookingStripeLineItemProductCode(0)).toBe('bkln1')
    expect(buildBookingStripeLineItemProductCode(9)).toBe('bkln10')
    expect(buildBookingStripeLineItemProductCode(999999999)).toHaveLength(12)
  })

  it('explica el estado payment_pending con copy orientado a formulario embebido', () => {
    expect(getBookingPaymentStatusCopy('payment_pending')).toEqual({
      title: 'Pago pendiente',
      detail: 'La franja queda retenida durante 30 minutos mientras completas el pago.',
    })
  })
})

// Lanzamiento (2026-10): reservas sin gastos de gestión, sin pasar por Stripe.
describe('attemptRequiresStripePayment', () => {
  it('0 € exactos no pasan por Stripe; un importe positivo sí', () => {
    expect(attemptRequiresStripePayment(0)).toBe(false)
    expect(attemptRequiresStripePayment(1975)).toBe(true)
  })

  it('un importe raro es un error, nunca «gratis»', () => {
    expect(() => attemptRequiresStripePayment(-1)).toThrow()
    expect(() => attemptRequiresStripePayment(12.5)).toThrow()
    expect(() => attemptRequiresStripePayment(undefined)).toThrow()
    expect(() => attemptRequiresStripePayment('abc')).toThrow()
  })

  it('el evento de confirmación sin pago es estable por intento (idempotente)', () => {
    expect(buildBookingNoPaymentEventId('att-1')).toBe('no_payment:att-1')
  })
})

// QA-139: un pago que acaba SIN reserva (hueco caducado u ocupado mientras pagaba) tiene que decir
// qué ha pasado y que no se cobra nada, nunca «Pago en revisión» ni el mensaje de otro estado.
describe('pago sin reserva (QA-139)', () => {
  it('hueco caducado: explica el tiempo y que no se cobra nada', () => {
    const copy = getUnbookedPaymentCopy('hold_unavailable_after_payment', '9,00 €')
    expect(copy.kind).toBe('time_expired')
    expect(copy.title).toBe('Se acabó el tiempo para este horario')
    expect(copy.moneyLine).toContain('No se te ha cobrado nada')
    expect(copy.moneyLine).toContain('9,00 €')
    expect(copy.canChooseAnotherSlot).toBe(true)
  })

  it('hueco ocupado mientras pagaba', () => {
    for (const code of ['availability_conflict_after_payment', 'conflicting_hold_after_payment']) {
      const copy = getUnbookedPaymentCopy(code, '9,00 €')
      expect(copy.kind).toBe('slot_taken')
      expect(copy.title).toBe('Ese horario se ha ocupado mientras pagabas')
      expect(copy.moneyLine).toContain('No se te ha cobrado nada')
    }
  })

  it('PaymentIntent que no cuadra: no promete la anulación ni invita a pagar otra vez', () => {
    const copy = getUnbookedPaymentCopy('stripe_metadata_mismatch', '9,00 €')
    expect(copy.kind).toBe('review')
    expect(copy.moneyLine).not.toContain('No se te ha cobrado nada')
    expect(copy.moneyLine).toContain('No repitas el pago')
    expect(copy.canChooseAnotherSlot).toBe(false)
  })

  it('cualquier otro motivo: no se ha podido crear la reserva', () => {
    const copy = getUnbookedPaymentCopy('booking_creation_failed', '9,00 €')
    expect(copy.kind).toBe('generic')
    expect(copy.title).toBe('No hemos podido crear la reserva')
    expect(copy.moneyLine).toContain('No se te ha cobrado nada')
    expect(getUnbookedPaymentCopy(undefined, '9,00 €').kind).toBe('generic')
  })

  it('el estado en revisión usa ese texto y no el mensaje guardado de otro estado', () => {
    const copy = getBookingPaymentStatusCopy(
      'reconciliation_required',
      'El tiempo del pago ha expirado. Puedes reintentarlo.',
      'hold_unavailable_after_payment',
    )
    expect(copy.title).toBe('Se acabó el tiempo para este horario')
    expect(copy.detail).not.toContain('Puedes reintentarlo')
  })
})

describe('pagar con el horario a punto de caducar (QA-139)', () => {
  const now = Date.parse('2026-11-17T10:00:00Z')
  it('bloquea el pago si quedan menos de 20 segundos o ya ha caducado', () => {
    expect(isPaymentHoldExpiringSoon('2026-11-17T10:00:10Z', now)).toBe(true)
    expect(isPaymentHoldExpiringSoon('2026-11-17T09:59:00Z', now)).toBe(true)
  })
  it('deja pagar con margen suficiente o sin fecha conocida', () => {
    expect(isPaymentHoldExpiringSoon('2026-11-17T10:05:00Z', now)).toBe(false)
    expect(isPaymentHoldExpiringSoon(undefined, now)).toBe(false)
    expect(isPaymentHoldExpiringSoon('no-es-fecha', now)).toBe(false)
  })
})

describe('qué estados explica la tarjeta del resumen (QA-139)', () => {
  it('«sin reserva» se explica, igual que fallido, cancelado, caducado y en proceso', () => {
    for (const status of ['reconciliation_required', 'failed', 'cancelled', 'expired', 'processing']) {
      expect(paymentStatusNeedsExplanation(status)).toBe(true)
    }
  })
  it('no hace falta tarjeta antes de pagar ni con la reserva hecha', () => {
    for (const status of ['created', 'payment_pending', 'booking_created', undefined]) {
      expect(paymentStatusNeedsExplanation(status)).toBe(false)
    }
  })
})
