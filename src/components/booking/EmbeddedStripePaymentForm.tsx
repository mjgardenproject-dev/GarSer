// Formulario de pago de Stripe (Payment Element) del resumen de la reserva.
//
// QA-139 / QA-134: no lanza un pago que el servidor ya no podría convertir en reserva (horario a
// punto de caducar), enseña los errores ARRIBA y a la vista, y distingue «no se ha cobrado» (el banco
// rechazó o no se llegó a pagar) de «el banco ya aceptó» (fallo posterior al comprobar la reserva).
import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { buildBookingPaymentReturnUrl, isPaymentHoldExpiringSoon } from '../../shared/bookingPaymentCore';

type EmbeddedStripePaymentFormProps = {
  attemptId: string;
  disabled?: boolean;
  onSubmittingChange: (value: boolean) => void;
  onReadyChange: (value: boolean) => void;
  onConfirmed: () => Promise<void>;
  // QA-139: hasta cuándo está guardado el horario. Si ya no da tiempo, no se lanza el pago (el
  // servidor no podría crear la reserva y la tarjeta quedaría retenida).
  holdExpiresAt?: string | null;
  onHoldExpired: () => void;
};

export type EmbeddedStripePaymentFormHandle = {
  submitPayment: () => Promise<void>;
};

const EmbeddedStripePaymentForm = React.forwardRef<EmbeddedStripePaymentFormHandle, EmbeddedStripePaymentFormProps>(({
  attemptId,
  disabled = false,
  onSubmittingChange,
  onReadyChange,
  onConfirmed,
  holdExpiresAt,
  onHoldExpired,
}, ref) => {
  const stripe = useStripe();
  const elements = useElements();
  const [submitError, setSubmitError] = useState('');
  const [holdRunningOut, setHoldRunningOut] = useState(false);
  const [authorizedButUnconfirmed, setAuthorizedButUnconfirmed] = useState(false);
  const submitErrorRef = useRef<HTMLDivElement | null>(null);

  // QA-134: el error (tarjeta rechazada, 3DS fallido) sale ARRIBA del formulario y se trae a la
  // vista; antes quedaba al final, bajo el bloque de Link, y parecía que no había pasado nada.
  useEffect(() => {
    if (!submitError && !holdRunningOut && !authorizedButUnconfirmed) return;
    submitErrorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }, [submitError, holdRunningOut, authorizedButUnconfirmed]);
  const [isElementReady, setIsElementReady] = useState(false);

  useEffect(() => {
    onReadyChange(false);
    return () => onReadyChange(false);
  }, [onReadyChange]);

  const submitPayment = async () => {
    if (disabled) {
      return;
    }
    if (!stripe || !elements) {
      setSubmitError('Stripe aun no ha terminado de cargar el formulario de pago.');
      return;
    }
    if (isPaymentHoldExpiringSoon(holdExpiresAt)) {
      setSubmitError('');
      setHoldRunningOut(true);
      onHoldExpired();
      return;
    }

    setSubmitError('');
    setAuthorizedButUnconfirmed(false);
    onSubmittingChange(true);

    // A partir de aquí el banco ya ha autorizado el importe: un fallo posterior (p. ej. de red al
    // comprobar la reserva) NO puede decir «no se te ha cobrado nada».
    let authorized = false;
    try {
      const submitted = await elements.submit();
      if (submitted.error) {
        throw new Error(submitted.error.message || 'No se pudo validar el formulario de pago.');
      }

      const result = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: buildBookingPaymentReturnUrl({
            appBaseUrl: window.location.origin,
            attemptId,
          }),
        },
        redirect: 'if_required',
      });

      if (result.error) {
        throw new Error(result.error.message || 'Stripe no ha podido confirmar el pago.');
      }

      authorized = true;
      await onConfirmed();
    } catch (error) {
      if (authorized) {
        setAuthorizedButUnconfirmed(true);
      } else {
        setSubmitError(error instanceof Error ? error.message : 'No se pudo confirmar el pago.');
      }
    } finally {
      onSubmittingChange(false);
    }
  };

  useEffect(() => {
    onReadyChange(isElementReady);
  }, [isElementReady, onReadyChange]);

  useImperativeHandle(ref, () => ({
    submitPayment,
  }), [submitPayment]);

  return (
    <div className="space-y-4">
      {authorizedButUnconfirmed ? (
        <div
          ref={submitErrorRef}
          role="alert"
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"
        >
          <p className="font-semibold">Tu banco ha aceptado el pago</p>
          <p>
            Aún no hemos podido confirmar la reserva desde aquí. No pagues otra vez: en unos minutos la verás en
            «Mis reservas» y, si no se pudiera crear, la retención de tu tarjeta se anula sola.
          </p>
        </div>
      ) : holdRunningOut ? (
        <div
          ref={submitErrorRef}
          role="alert"
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"
        >
          <p className="font-semibold">Se ha acabado el tiempo para pagar este horario</p>
          <p>No hemos hecho el pago y no se te ha cobrado nada. En unos segundos podrás elegir otro horario.</p>
        </div>
      ) : submitError ? (
        <div
          ref={submitErrorRef}
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800"
        >
          <p className="font-semibold">No se ha completado el pago</p>
          <p>{submitError}</p>
          <p className="mt-1 text-red-700">No se te ha cobrado nada. Puedes probar otra vez o con otra tarjeta.</p>
        </div>
      ) : null}

      <PaymentElement
        options={{ layout: 'tabs' }}
        onReady={() => setIsElementReady(true)}
      />
    </div>
  );
});

EmbeddedStripePaymentForm.displayName = 'EmbeddedStripePaymentForm';

export default EmbeddedStripePaymentForm;
