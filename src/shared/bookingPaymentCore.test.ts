import { describe, expect, it } from 'vitest'

import {
  buildAuthoritativeBookingStripeLineItems,
  buildBookingPaymentGatewaySyncEventId,
  buildBookingStripeLineItemProductCode,
  getBookingPaymentStatusCopy,
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
