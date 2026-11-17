// @vitest-environment jsdom
import React, { createRef } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import EmbeddedStripePaymentForm, { type EmbeddedStripePaymentFormHandle } from './EmbeddedStripePaymentForm';

const stripeMocks = vi.hoisted(() => ({
  confirmPayment: vi.fn(),
  submit: vi.fn(),
}));

vi.mock('@stripe/react-stripe-js', () => ({
  useStripe: () => ({ confirmPayment: stripeMocks.confirmPayment }),
  useElements: () => ({ submit: stripeMocks.submit }),
  PaymentElement: ({ onReady }: { onReady?: () => void }) => {
    React.useEffect(() => onReady?.(), [onReady]);
    return <div data-testid="payment-element" />;
  },
}));

function renderForm(overrides: Partial<React.ComponentProps<typeof EmbeddedStripePaymentForm>> = {}) {
  const ref = createRef<EmbeddedStripePaymentFormHandle>();
  const props = {
    attemptId: 'attempt-1',
    onSubmittingChange: vi.fn(),
    onReadyChange: vi.fn(),
    onConfirmed: vi.fn().mockResolvedValue(undefined),
    onHoldExpired: vi.fn(),
    holdExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    ...overrides,
  };
  render(<EmbeddedStripePaymentForm ref={ref} {...props} />);
  const pay = () => act(async () => { await ref.current?.submitPayment(); });
  return { props, pay };
}

describe('EmbeddedStripePaymentForm (QA-139 / QA-134)', () => {
  beforeEach(() => {
    stripeMocks.submit.mockResolvedValue({});
    stripeMocks.confirmPayment.mockResolvedValue({});
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('con el horario a punto de caducar NO lanza el pago y lo explica', async () => {
    const { props, pay } = renderForm({ holdExpiresAt: new Date(Date.now() + 5_000).toISOString() });
    await pay();
    expect(stripeMocks.confirmPayment).not.toHaveBeenCalled();
    expect(props.onHoldExpired).toHaveBeenCalledTimes(1);
    expect(props.onSubmittingChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Se ha acabado el tiempo para pagar este horario');
  });

  it('tarjeta rechazada: el error sale ARRIBA del formulario y dice que no se ha cobrado', async () => {
    stripeMocks.confirmPayment.mockResolvedValue({ error: { message: 'Tu tarjeta ha sido rechazada.' } });
    const { props, pay } = renderForm();
    await pay();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('No se ha completado el pago');
    expect(alert.textContent).toContain('Tu tarjeta ha sido rechazada.');
    expect(alert.textContent).toContain('No se te ha cobrado nada');
    expect(props.onConfirmed).not.toHaveBeenCalled();
    // Arriba: el aviso va antes que el formulario de Stripe en el documento.
    const element = screen.getByTestId('payment-element');
    expect(alert.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('si el banco ya aceptó y falla lo de después, NUNCA dice «no se te ha cobrado nada»', async () => {
    const { pay } = renderForm({ onConfirmed: vi.fn().mockRejectedValue(new Error('Failed to fetch')) });
    await pay();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Tu banco ha aceptado el pago');
    expect(alert.textContent).toContain('No pagues otra vez');
    expect(alert.textContent).not.toContain('No se te ha cobrado nada');
  });

  it('pago correcto: confirma y avisa al resumen, sin mensajes de error', async () => {
    const { props, pay } = renderForm();
    await pay();
    expect(stripeMocks.confirmPayment).toHaveBeenCalledTimes(1);
    expect(props.onConfirmed).toHaveBeenCalledTimes(1);
    expect(props.onSubmittingChange).toHaveBeenNthCalledWith(1, true);
    expect(props.onSubmittingChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
