import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { useBooking } from "../../contexts/BookingContext";
import {
  MapPin,
  Calendar,
  Clock,
  User,
  Info,
  X,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getStripePromise } from '../../lib/stripeClient';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { reportBookingEvent } from '../../utils/bookingTelemetry';
import {
  buildBookingResumeRedirectParam,
  claimBookingResumeForUser,
  clearBookingResumeStorage,
  parseBookingResumeRedirectParam,
  readBookingResumeState,
  writeBookingResumeResult,
} from '../../utils/bookingResumeStorage';
import { createAuthoritativeQuote, isBookingAuthorityError } from '../../utils/bookingAuthorityService';
import {
  getBookingPaymentAttemptStatus,
  isBookingPaymentError,
  prepareBookingPayment,
  syncBookingPaymentAttempt,
} from '../../utils/bookingPaymentService';
import type {
  BookingQuoteEconomicBreakdown,
  BookingQuoteSlotSelection,
} from '../../shared/bookingQuoteCore';
import { getBookingCustomerPaymentSummary } from '../../shared/bookingQuoteCore';
import {
  buildAuthoritativeQuoteSnapshot,
  hasAuthoritativeQuoteSnapshot,
  readAuthoritativeQuoteSnapshot,
} from '../../shared/bookingAuthoritativeSnapshot';
import type { BookingPaymentAttemptSummary } from '../../shared/bookingPaymentCore';
import {
  buildBookingPaymentReturnUrl,
  getBookingPaymentStatusCopy,
  isInFlightPaymentAttemptStatus,
} from '../../shared/bookingPaymentCore';

const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 8;

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

type PaymentExperienceTone = 'blue' | 'amber' | 'red' | 'green';

type PaymentExperienceAction = {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
};

type PaymentExperienceState = {
  tone: PaymentExperienceTone;
  title: string;
  detail: string;
  instructions: string[];
  actions: PaymentExperienceAction[];
  eyebrow?: string;
  meta?: string;
};

type PreCheckoutFailureCta = 'retry' | 'refresh' | 'reload' | 'slots';

type PreCheckoutFailureState = {
  tone: Extract<PaymentExperienceTone, 'amber' | 'red'>;
  title: string;
  detail: string;
  instructions: string[];
  toastMessage: string;
  preferredCta: PreCheckoutFailureCta;
  eyebrow?: string;
  meta?: string;
};

type EmbeddedStripePaymentFormProps = {
  attemptId: string;
  amountLabel: string;
  disabled?: boolean;
  onSubmittingChange: (value: boolean) => void;
  onReadyChange: (value: boolean) => void;
  onConfirmed: () => Promise<void>;
};

type EmbeddedStripePaymentFormHandle = {
  submitPayment: () => Promise<void>;
};

const EmbeddedStripePaymentForm = React.forwardRef<EmbeddedStripePaymentFormHandle, EmbeddedStripePaymentFormProps>(({
  attemptId,
  amountLabel,
  disabled = false,
  onSubmittingChange,
  onReadyChange,
  onConfirmed,
}, ref) => {
  const stripe = useStripe();
  const elements = useElements();
  const [submitError, setSubmitError] = useState('');
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

    setSubmitError('');
    onSubmittingChange(true);

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

      await onConfirmed();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'No se pudo confirmar el pago.');
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
      <p className="text-sm text-gray-500">
        Paga {amountLabel} con tarjeta o con el metodo compatible que Stripe muestre en tu dispositivo.
      </p>

      <PaymentElement
        options={{ layout: 'tabs' }}
        onReady={() => setIsElementReady(true)}
      />

      {submitError ? (
        <div className="text-sm text-red-700" aria-live="polite">
          {submitError}
        </div>
      ) : null}
    </div>
  );
});

EmbeddedStripePaymentForm.displayName = 'EmbeddedStripePaymentForm';

const parseIsoTimestamp = (value?: string | null) => {
  const normalized = String(value || '').trim();
  if (!normalized) return null;

  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const isExpiredTimestamp = (value?: string | null) => {
  const timestamp = parseIsoTimestamp(value);
  return timestamp !== null && timestamp <= Date.now();
};

const ConfirmationPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { bookingData, resetBooking, setCurrentStep, setBookingData } = useBooking();
  const [serviceNames, setServiceNames] = useState<string[]>([]);
  const [gardenerName, setGardenerName] = useState<string>('');
  const { user } = useAuth();
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authInfo, setAuthInfo] = useState('');
  const [showOtpOption, setShowOtpOption] = useState(false);
  const [breakdown, setBreakdown] = useState<Array<{ desc: string; price: number }>>([]);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [paymentAttempt, setPaymentAttempt] = useState<BookingPaymentAttemptSummary | null>(null);
  const [paymentClientSecret, setPaymentClientSecret] = useState<string | null>(null);
  const [paymentPublishableKey, setPaymentPublishableKey] = useState<string | null>(null);
  const [isPreparingPayment, setIsPreparingPayment] = useState(false);
  const [isSubmittingInlinePayment, setIsSubmittingInlinePayment] = useState(false);
  const [isResolvingPaymentReturn, setIsResolvingPaymentReturn] = useState(false);
  const [isRefreshingQuote, setIsRefreshingQuote] = useState(false);
  const [isPaymentSheetOpen, setIsPaymentSheetOpen] = useState(false);
  const [isPaymentSheetSuccess, setIsPaymentSheetSuccess] = useState(false);
  const [isPaymentFormReady, setIsPaymentFormReady] = useState(false);
  const [preCheckoutFailure, setPreCheckoutFailure] = useState<PreCheckoutFailureState | null>(null);
  const [resumeNotice, setResumeNotice] = useState<{ title: string; detail: string } | null>(null);
  const paymentActionLockRef = useRef(false);
  const paymentReturnSyncKeyRef = useRef<string | null>(null);
  const bookingCreatedHandledRef = useRef<string | null>(null);
  const paymentFormRef = useRef<EmbeddedStripePaymentFormHandle | null>(null);
  const paymentSheetSuccessKeyRef = useRef<string | null>(null);
  const paymentSheetCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const currencyFormatter = useMemo(
    () => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    []
  );
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat('es-ES', { dateStyle: 'long' }),
    []
  );
  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }),
    []
  );
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const paymentReturnAttemptId = String(searchParams.get('attempt_id') || '').trim();
  const paymentReturnRequested = searchParams.get('payment_return') === '1';

  const formatSlotLabel = (slot: BookingQuoteSlotSelection | null | undefined) => {
    if (!slot) return 'Horario pendiente';
    return `${slot.startTime.slice(0, 5)} - ${slot.endTime.slice(0, 5)}`;
  };

  const assertAuthoritativeSnapshot = () => {
    const serviceId = bookingData.serviceIds?.[0];
    const authoritativeSnapshot = readAuthoritativeQuoteSnapshot(bookingData);
    const quoteMetadata = authoritativeSnapshot?.metadata;
    const selectedSlot = authoritativeSnapshot?.availability.selectedSlot;
    const quoteEconomics = authoritativeSnapshot?.economics;

    if (!bookingData.providerId || !serviceId) {
      throw new Error('Falta la selección del profesional o del servicio.');
    }
    if (!quoteMetadata?.pricingContext) {
      throw new Error('Falta el contexto autoritativo del presupuesto. Vuelve al paso anterior y recalcula la selección.');
    }
    if (!selectedSlot?.date || !selectedSlot.startTime || !selectedSlot.endTime) {
      throw new Error('Falta la franja autoritativa seleccionada. Vuelve al paso anterior y selecciona una hora válida.');
    }
    if (!quoteEconomics) {
      throw new Error('Falta el desglose económico autoritativo. Vuelve al paso anterior y recalcula la selección.');
    }

    return {
      serviceId,
      authoritativeSnapshot,
      quoteMetadata,
      selectedSlot,
      quoteEconomics,
    };
  };

  const authoritativeQuoteSnapshot = useMemo(() => readAuthoritativeQuoteSnapshot(bookingData), [bookingData]);
  const selectedQuoteSlot = useMemo(() => authoritativeQuoteSnapshot?.availability.selectedSlot || null, [authoritativeQuoteSnapshot]);
  const quoteEconomics: BookingQuoteEconomicBreakdown | null = useMemo(
    () => authoritativeQuoteSnapshot?.economics || null,
    [authoritativeQuoteSnapshot],
  );
  const authoritativeSnapshotReady = Boolean(
    bookingData.providerId &&
    bookingData.serviceIds?.[0] &&
    hasAuthoritativeQuoteSnapshot(bookingData)
  );
  const quoteExpiresAt = authoritativeQuoteSnapshot?.expiresAt || bookingData.quoteExpiresAt;
  const quoteExpired = authoritativeSnapshotReady && isExpiredTimestamp(quoteExpiresAt);
  const holdExpired =
    paymentAttempt?.status !== 'booking_created' &&
    Boolean(paymentAttempt?.holdExpiresAt && isExpiredTimestamp(paymentAttempt.holdExpiresAt));
  const successfulPaymentReturn = paymentReturnRequested && Boolean(paymentReturnAttemptId);

  useEffect(() => {
    if (Array.isArray(authoritativeQuoteSnapshot?.breakdown) && authoritativeQuoteSnapshot.breakdown.length > 0) {
      setBreakdown(authoritativeQuoteSnapshot.breakdown);
      return;
    }
    setBreakdown([]);
  }, [authoritativeQuoteSnapshot]);

  const persistConfirmationResume = (payload: unknown) => {
    const result = writeBookingResumeResult('confirmation', 'wizard', payload, { userId: user?.id });

    if (result.error) {
      setResumeNotice({
        title: 'Mantén esta pestaña abierta',
        detail:
          result.error === 'quota_exceeded'
            ? 'Tu navegador tiene poco espacio y puede que no recuerde esta reserva si cierras la pestaña antes de terminar.'
            : 'Si sales de esta pantalla antes de terminar, puede que tengas que repetir parte de la reserva.',
      });
      return null;
    }

    if (result.storage === 'sessionStorage') {
      setResumeNotice({
        title: 'Mantén esta pestaña abierta',
        detail:
          'Para no perder el avance, termina el pago desde esta misma pestaña y sin cambiar de navegador.',
      });
    } else if (result.record?.nonSerializablePaths.length) {
      setResumeNotice({
        title: 'Revisa las fotos si vuelves atrás',
        detail:
          'La reserva se recupera, pero algunas fotos temporales pueden perderse si sales y vuelves atrás.',
      });
    } else {
      setResumeNotice(null);
    }

    return result.record;
  };

  const reloadCurrentPage = () => {
    window.location.reload();
  };

  const handleGoToBookings = () => {
    resetBooking();
    navigate('/bookings');
  };

  const finalizeBookingCreated = (attempt: BookingPaymentAttemptSummary | null) => {
    if (!attempt?.bookingId) return;

    const dedupeKey = `${attempt.attemptId}:${attempt.bookingId}`;
    if (bookingCreatedHandledRef.current === dedupeKey) {
      return;
    }

    bookingCreatedHandledRef.current = dedupeKey;
    clearBookingResumeStorage({ userId: user?.id, flow: 'wizard', includeAnonFallback: true });
    toast.success('Pago confirmado y reserva creada correctamente');
  };

  const resolvePreCheckoutFailure = (error: unknown): PreCheckoutFailureState | null => {
    const message = error instanceof Error ? error.message.trim() : '';
    const lowerMessage = message.toLowerCase();

    if (isBookingAuthorityError(error)) {
      const status = error.status;
      const backendMessage = String(error.backendMessage || message).toLowerCase();

      if (status === 401 && backendMessage.includes('apikey no autorizada')) {
        return {
          tone: 'red',
          title: 'Recarga esta pantalla',
          detail: 'Necesitamos actualizar la reserva antes de abrir el pago.',
          instructions: [
            'Vuelve a intentarlo desde esta misma pantalla.',
          ],
          toastMessage: 'La pagina se ha quedado con una configuracion obsoleta. Recargala antes de volver a preparar el pago.',
          preferredCta: 'reload',
        };
      }

      if (status === 401 && backendMessage.includes('iniciar sesión')) {
        return {
          tone: 'amber',
          title: 'Tu sesión ha caducado',
          detail: 'Vuelve a entrar con tu cuenta para continuar con el pago.',
          instructions: [
            'Recarga esta pantalla y accede de nuevo.',
          ],
          toastMessage: 'Tu sesión ya no es válida. Recarga la página e identifícate de nuevo antes de pagar.',
          preferredCta: 'reload',
        };
      }

      if (status === 409 || backendMessage.includes('ya no está disponible')) {
        return {
          tone: 'red',
          title: 'Ese horario ya no está disponible',
          detail: 'Elige otro horario para continuar con la reserva.',
          instructions: [
            'Cambia el horario y vuelve a intentarlo.',
          ],
          toastMessage: 'La franja seleccionada ya no está disponible. Elige otro horario antes de pagar.',
          preferredCta: 'slots',
        };
      }

      if (
        status === 422 ||
        lowerMessage.includes('presupuesto') ||
        lowerMessage.includes('quote')
      ) {
        return {
          tone: 'amber',
          title: 'Actualiza la reserva',
          detail: 'Necesitamos recalcular el precio o la disponibilidad antes de abrir el pago.',
          instructions: [
            'Actualiza la reserva y revisa el resultado antes de pagar.',
          ],
          toastMessage: 'El presupuesto ha caducado o ya no es válido. Revalídalo antes de pagar.',
          preferredCta: 'refresh',
        };
      }

      return {
        tone: 'amber',
        title: 'No hemos podido actualizar la reserva',
        detail: 'Inténtalo de nuevo antes de abrir el pago.',
        instructions: [
          'Si vuelve a fallar, cambia el horario y repite la reserva.',
        ],
        toastMessage: 'No se pudo validar la reserva antes de preparar el pago. Intentalo de nuevo.',
        preferredCta: 'refresh',
      };
    }

    if (isBookingPaymentError(error)) {
      const status = error.status;
      const code = String(error.code || '').trim().toLowerCase();
      const backendMessage = String(error.backendMessage || message).trim();
      const lowerBackendMessage = backendMessage.toLowerCase();
      const isSlotUnavailableFailure =
        code === 'slot_unavailable' ||
        lowerBackendMessage.includes('ya no esta disponible') ||
        lowerBackendMessage.includes('temporalmente bloqueada') ||
        lowerBackendMessage.includes('fuera del horario permitido');
      const isQuoteValidationFailure =
        code === 'invalid_quote_state' ||
        code === 'quote_expired' ||
        lowerBackendMessage.includes('presupuesto') ||
        lowerBackendMessage.includes('quote') ||
        lowerBackendMessage.includes('caduc');

      if (status === 401 || code === 'auth_required' || lowerBackendMessage.includes('iniciar sesion')) {
        return {
          tone: 'amber',
          title: 'Tu sesión ha caducado',
          detail: 'Vuelve a acceder con tu cuenta antes de continuar con el pago.',
          instructions: [
            'Recarga esta pantalla y accede de nuevo.',
          ],
          toastMessage: 'Tu sesión ya no es válida. Recarga la página e identifícate de nuevo antes de pagar.',
          preferredCta: 'reload',
        };
      }

      if (status === 403 || code === 'quote_forbidden') {
        return {
          tone: 'red',
          title: 'Esta reserva ya no coincide con tu cuenta',
          detail: 'Recarga la pantalla y vuelve a entrar con la cuenta correcta.',
          instructions: [
            'Si has cambiado de cuenta, rehace la reserva antes de pagar.',
          ],
          toastMessage: 'La sesión activa ya no coincide con esta reserva. Recarga la página antes de pagar.',
          preferredCta: 'reload',
        };
      }

      if (isSlotUnavailableFailure) {
        return {
          tone: 'red',
          title: 'Ese horario ya no está disponible',
          detail: 'Elige otro horario para continuar con el pago.',
          instructions: [
            'Cambia el horario y vuelve a intentarlo.',
          ],
          toastMessage: 'La franja seleccionada ya no está disponible. Elige otro horario antes de pagar.',
          preferredCta: 'slots',
        };
      }

      if (isQuoteValidationFailure) {
        return {
          tone: 'amber',
          title: 'Actualiza la reserva',
          detail: 'Necesitamos recalcular el precio o la disponibilidad antes de abrir el pago.',
          instructions: [
            'Actualiza la reserva y revisa el resultado antes de pagar.',
          ],
          toastMessage: 'El presupuesto ha caducado o ya no es válido. Revalídalo antes de pagar.',
          preferredCta: 'refresh',
        };
      }

      if (status === 502 || code === 'stripe_request_failed') {
        return {
          tone: 'red',
          title: 'No hemos podido abrir el pago',
          detail: 'Ha habido un problema temporal al conectar con Stripe.',
          instructions: [
            'Inténtalo de nuevo una vez desde esta pantalla.',
          ],
          toastMessage: backendMessage || 'No se pudo preparar el pago en este momento. Intentalo de nuevo.',
          preferredCta: 'retry',
        };
      }

      return {
        tone: 'amber',
        title: 'No hemos podido abrir el pago',
        detail: 'Inténtalo de nuevo o actualiza la reserva antes de continuar.',
        instructions: [
          'Si vuelve a fallar, actualiza la reserva antes de continuar.',
        ],
        toastMessage: backendMessage || 'No se pudo preparar el pago seguro. Inténtalo de nuevo.',
        preferredCta: 'retry',
      };
    }

    if (lowerMessage.includes('presupuesto') || lowerMessage.includes('quote')) {
      return {
        tone: 'amber',
        title: 'Actualiza la reserva',
        detail: 'Necesitamos recalcular el precio o la disponibilidad antes de abrir el pago.',
        instructions: [
          'Actualiza la reserva y revisa el resultado antes de pagar.',
        ],
        toastMessage: 'El presupuesto ha caducado o ya no es válido. Revalídalo antes de pagar.',
        preferredCta: 'refresh',
      };
    }

    if (lowerMessage.includes('disponible') || lowerMessage.includes('bloqueada')) {
      return {
        tone: 'red',
        title: 'Ese horario ya no está disponible',
        detail: 'Elige otro horario para continuar con el pago.',
        instructions: [
          'Cambia el horario y vuelve a intentarlo.',
        ],
        toastMessage: message || 'La franja ya no está disponible.',
        preferredCta: 'slots',
      };
    }

    return null;
  };

  const syncAuthoritativeQuote = async () => {
    const { serviceId, selectedSlot } = assertAuthoritativeSnapshot();
    const authoritativeQuote = await createAuthoritativeQuote({
      bookingData,
      serviceId,
      providerId: bookingData.providerId || '',
      selectedDate: selectedSlot.date,
      startTime: selectedSlot.startTime,
    });

    const authoritativeQuoteSnapshot = buildAuthoritativeQuoteSnapshot({
      totalPrice: authoritativeQuote.totalPrice,
      estimatedHours: authoritativeQuote.estimatedHours,
      breakdown: authoritativeQuote.breakdown,
      warnings: authoritativeQuote.warnings,
      metadata: authoritativeQuote.metadata,
      economics: authoritativeQuote.economics,
      availability: authoritativeQuote.availability,
      quoteId: authoritativeQuote.quoteId,
      signature: authoritativeQuote.signature,
      expiresAt: authoritativeQuote.expiresAt,
      pricingVersion: authoritativeQuote.pricingVersion,
      providerConfigVersion: authoritativeQuote.providerConfigVersion,
    });
    const authoritativeSelectedSlot = authoritativeQuoteSnapshot?.availability.selectedSlot;
    if (!authoritativeQuoteSnapshot || !authoritativeSelectedSlot || !authoritativeQuote.quoteId) {
      throw new Error('La revalidación backend no devolvió un contrato de presupuesto completo.');
    }

    const nextBookingData = {
      preferredDate: authoritativeSelectedSlot.date,
      timeSlot: formatSlotLabel(authoritativeSelectedSlot),
      authoritativeQuoteSnapshot,
    };

    setBookingData(nextBookingData);
    setPreCheckoutFailure(null);
    const resumePayload = { ...bookingData, ...nextBookingData };
    persistConfirmationResume(resumePayload);

    return {
      authoritativeQuote,
      resumePayload,
    };
  };

  const handlePreparePayment = async (options?: { attemptId?: string }) => {
    if (
      paymentActionLockRef.current ||
      isPreparingPayment ||
      isSubmittingInlinePayment ||
      isRefreshingQuote ||
      isResolvingPaymentReturn
    ) {
      return;
    }

    paymentActionLockRef.current = true;
    setIsPreparingPayment(true);
    setAuthError('');
    setPreCheckoutFailure(null);

    try {
      if (!user) {
        setAuthError('Necesitas identificarte para continuar con el pago.');
        return false;
      }

      const currentQuoteId = String(bookingData.quoteId || '').trim();
      const authoritativeQuote = (
        !options?.attemptId &&
        authoritativeSnapshotReady &&
        !quoteExpired &&
        currentQuoteId
      )
        ? { quoteId: currentQuoteId }
        : (await syncAuthoritativeQuote()).authoritativeQuote;

      const payment = await prepareBookingPayment({
        quoteId: options?.attemptId ? undefined : authoritativeQuote.quoteId || '',
        attemptId: options?.attemptId,
      });

      if (payment.clientSecret) {
        await getStripePromise({ publishableKey: payment.publishableKey });
      }

      setPaymentAttempt(payment.attempt);
      setPaymentClientSecret(payment.attempt.status === 'payment_pending' ? payment.clientSecret || null : null);
      setPaymentPublishableKey(payment.publishableKey || null);
      reportBookingEvent('info', {
        event: 'booking.payment_prepared',
        context: {
          attemptId: payment.attempt.attemptId,
          quoteId: authoritativeQuote.quoteId,
          providerId: bookingData.providerId,
          serviceId: bookingData.serviceIds?.[0],
          paymentStatus: payment.attempt.status,
        },
      });

      if (payment.attempt.status === 'payment_pending' && !payment.clientSecret) {
        throw new Error('El backend ha preparado el intento, pero no ha devuelto un client secret reutilizable.');
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al preparar el pago.';
      const preStripeFailure = resolvePreCheckoutFailure(error);
      console.warn('Error preparing inline payment:', message);
      reportBookingEvent('error', {
        event: 'booking.payment_prepare_failed',
        context: {
          providerId: bookingData.providerId,
          serviceId: bookingData.serviceIds?.[0],
          preferredDate: bookingData.preferredDate,
          timeSlot: bookingData.timeSlot,
          message,
        },
      });

      if (preStripeFailure) {
        setPreCheckoutFailure(preStripeFailure);
        toast.error(preStripeFailure.toastMessage);
      } else {
        toast.error('No se pudo preparar el pago seguro. Inténtalo de nuevo.');
      }
      return false;
    } finally {
      paymentActionLockRef.current = false;
      setIsPreparingPayment(false);
    }
  };

  const handleRefreshQuote = async () => {
    setIsRefreshingQuote(true);
    setPreCheckoutFailure(null);

    try {
      await syncAuthoritativeQuote();
      setPreCheckoutFailure(null);
      toast.success('Presupuesto y franja revalidados. Ya puedes preparar el pago si todo sigue correcto.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo revalidar la reserva.';
      const preStripeFailure = resolvePreCheckoutFailure(error);
      console.warn('Error refreshing authoritative quote:', message);
      if (preStripeFailure) {
        setPreCheckoutFailure(preStripeFailure);
        toast.error(preStripeFailure.toastMessage);
      } else {
        toast.error(message);
      }
    } finally {
      setIsRefreshingQuote(false);
    }
  };

  const handleRefreshPaymentStatus = async () => {
    if (isResolvingPaymentReturn || isPreparingPayment || isSubmittingInlinePayment || isRefreshingQuote) {
      return;
    }

    setIsResolvingPaymentReturn(true);

    try {
      let latest = null as BookingPaymentAttemptSummary | null;

      if (successfulPaymentReturn && paymentReturnAttemptId) {
        if (!latest || isInFlightPaymentAttemptStatus(latest.status)) {
          latest = await resolveAttemptStatus(paymentReturnAttemptId, true, true);
        }
      } else if (paymentAttempt?.attemptId) {
        latest = await resolveAttemptStatus(paymentAttempt.attemptId, true, true);
      } else if (bookingData.quoteId) {
        const response = await getBookingPaymentAttemptStatus({ quoteId: bookingData.quoteId });
        latest = response.attempt;
      }

      setPaymentAttempt(latest);
      if (!latest || latest.status !== 'payment_pending') {
        setPaymentClientSecret(null);
        setPaymentPublishableKey(null);
      }

      if (latest?.status === 'booking_created') {
        finalizeBookingCreated(latest);
        return;
      }

      if (!latest) {
        toast.error('Todavía no hay un estado de pago verificable. Vuelve a comprobarlo en unos segundos.');
        return;
      }

      if (latest.status === 'processing' || latest.status === 'reconciliation_required') {
        toast.success('Seguimos comprobando el cobro y consolidando la reserva.');
        return;
      }

      toast.error(getBookingPaymentStatusCopy(latest.status, latest.lastErrorMessage).detail);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo actualizar el estado del pago.';
      console.warn('Error refreshing payment status:', message);
      toast.error('No se pudo actualizar el estado del pago. Recarga la página o vuelve a intentarlo en unos segundos.');
    } finally {
      setIsResolvingPaymentReturn(false);
    }
  };

  const resolveAttemptStatus = async (attemptId: string, allowPolling: boolean, syncFirst = false) => {
    let latest = null as BookingPaymentAttemptSummary | null;

    for (let index = 0; index < (allowPolling ? POLL_MAX_ATTEMPTS : 1); index += 1) {
      if (syncFirst && index === 0) {
        latest = await syncBookingPaymentAttempt({ attemptId });
      } else {
        const response = await getBookingPaymentAttemptStatus({ attemptId });
        latest = response.attempt;
      }

      if (!latest || latest.terminal || !isInFlightPaymentAttemptStatus(latest.status) || !allowPolling) {
        break;
      }

      await sleep(POLL_INTERVAL_MS);
    }

    return latest;
  };

  useEffect(() => {
    const fetchNames = async () => {
      try {
        if (Array.isArray(bookingData.serviceIds) && bookingData.serviceIds.length > 0) {
          const { data } = await supabase
            .from('services')
            .select('id,name')
            .in('id', bookingData.serviceIds);
          setServiceNames((data || []).map((s: any) => {
            if (s.name.toLowerCase().includes('fumigación') || s.name.toLowerCase().includes('fumigacion') || s.name.toLowerCase().includes('tratamientos fitosanitarios')) {
              return 'Servicios fitosanitarios';
            }
            return s.name;
          }));
        } else {
          setServiceNames([]);
        }
      } catch {
        setServiceNames([]);
      }
      try {
        if (bookingData.providerId) {
          const { data } = await supabase
            .from('gardener_profiles')
            .select('full_name')
            .eq('user_id', bookingData.providerId)
            .maybeSingle();
          setGardenerName((data as any)?.full_name || '');
        } else {
          setGardenerName('');
        }
      } catch {
        setGardenerName('');
      }
    };
    fetchNames();
  }, [bookingData.serviceIds.join(','), bookingData.providerId]);

  const displayServices = useMemo(() => {
    return serviceNames.length > 0 ? serviceNames.join(', ') : 'Servicio';
  }, [serviceNames]);
  const serviceIdsKey = bookingData.serviceIds.join(',');

  const formattedDate = useMemo(() => {
    const quoteDate = selectedQuoteSlot?.date || bookingData.preferredDate;
    if (!quoteDate) {
      return 'Fecha pendiente';
    }

    const parsed = new Date(`${quoteDate}T12:00:00`);
    return Number.isNaN(parsed.getTime()) ? quoteDate : dateFormatter.format(parsed);
  }, [selectedQuoteSlot?.date, bookingData.preferredDate, dateFormatter]);
  const buildResume = () => {
    const snapshot = {
      address: bookingData.address,
      serviceIds: bookingData.serviceIds,
      description: bookingData.description,
      preferredDate: bookingData.preferredDate,
      timeSlot: bookingData.timeSlot,
      providerId: bookingData.providerId,
      estimatedHours: bookingData.estimatedHours,
      totalPrice: bookingData.totalPrice,
      palmSpecies: bookingData.palmSpecies,
      uploadedPhotoUrls: bookingData.uploadedPhotoUrls,
      bookingPhotoContract: bookingData.bookingPhotoContract,
      priceBreakdown: bookingData.priceBreakdown,
      quoteId: bookingData.quoteId,
      quoteSignature: bookingData.quoteSignature,
      quoteExpiresAt: bookingData.quoteExpiresAt,
      quotePricingVersion: bookingData.quotePricingVersion,
      quoteProviderConfigVersion: bookingData.quoteProviderConfigVersion,
      quoteWarnings: bookingData.quoteWarnings,
      authoritativeQuoteSnapshot: authoritativeQuoteSnapshot || bookingData.authoritativeQuoteSnapshot,
    };
    return buildBookingResumeRedirectParam('confirmation', 'wizard', snapshot, { userId: user?.id });
  };
  const redirectUrl = `${window.location.origin}/reserva/confirmacion?auth=1${bookingData.serviceIds?.length ? `&resume=${buildResume()}` : ''}`;

  const handleCreateAccount = async () => {
    try {
      setAuthLoading(true);
      setAuthError('');
      setAuthInfo('');
      const { error } = await supabase.auth.signUp({
        email: authEmail.trim(),
        password: authPassword,
        options: { emailRedirectTo: redirectUrl }
      });
      if (error) {
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('already')) {
          setAuthError('Este email ya tiene una cuenta. Inicia sesión para continuar');
          setShowOtpOption(false);
        } else {
          setAuthError('No se pudo registrar. Revisa el email y la contraseña.');
        }
      } else {
        persistConfirmationResume(bookingData);
        setAuthInfo('Te hemos enviado un email para confirmar tu cuenta');
      }
    } finally {
      setAuthLoading(false);
    }
  };

  useEffect(() => {
    // Restaurar snapshot si viene en el enlace o desde almacenamiento
    const params = new URLSearchParams(location.search);
    const resume = params.get('resume');
    if (resume) {
      const parsedResume = parseBookingResumeRedirectParam<any>(resume);
      const record = parsedResume.record;
      if (record?.ownerScope === 'user' && user?.id && record.ownerUserId !== user.id) {
        setResumeNotice({
          title: 'Este enlace pertenece a otra cuenta',
          detail:
            'El navegador ha rechazado la rehidratación porque el estado de confirmación estaba ligado a otro usuario autenticado. Inicia sesión con la misma cuenta o reconstruye la reserva.',
        });
      } else if (record?.payload) {
        setBookingData(record.payload);
        persistConfirmationResume(record.payload);
      } else if (parsedResume.error) {
        setResumeNotice({
          title: 'No se ha podido recuperar el estado del retorno',
          detail:
            'El parámetro de reanudación estaba corrupto, incompleto o en una versión no soportada. Por seguridad, la pantalla ha ignorado ese estado.',
        });
      }
    }
    if (!resume) {
      const storedState = readBookingResumeState<any>({
        userId: user?.id,
        flow: 'wizard',
        allowAnonFallback: true,
      });
      const stored =
        storedState.record && storedState.fromAnonFallback && user?.id
          ? claimBookingResumeForUser({
              userId: user.id,
              record: storedState.record,
              sourceKey: storedState.sourceKey,
            }) || storedState.record
          : storedState.record;
      const json = stored?.stage === 'confirmation' ? stored.payload : null;
      if (json) {
        setBookingData(json);
        persistConfirmationResume(json);
      } else if (storedState.error === 'invalid_schema' || storedState.error === 'version_mismatch') {
        setResumeNotice({
          title: 'El estado guardado se ha descartado por seguridad',
          detail:
            'Había un snapshot incompatible, corrupto o de una versión anterior. Se ha ignorado para evitar mezclar datos entre sesiones o cuentas.',
        });
      }
    }
    // Escuchar cambio de sesión para ocultar bloque auth cuando supabase complete el redirect
    const { data: sub } = supabase.auth.onAuthStateChange((event: string, session: any) => {
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
        setAuthInfo('Sesión iniciada. Ya puedes confirmar la reserva.');
      }
    });
    return () => { sub.subscription.unsubscribe(); };
  }, [location.search, setBookingData, user?.id]);

  const handleLogin = async () => {
    try {
      setAuthLoading(true);
      setAuthError('');
      setAuthInfo('');
      const { error } = await supabase.auth.signInWithPassword({
        email: authEmail.trim(),
        password: authPassword
      });
      if (error) {
        const msg = (error.message || '').toLowerCase();
        const isInvalid = msg.includes('invalid') || msg.includes('credentials') || (error as any)?.status === 400;
        if (isInvalid) {
          // Escenario 3: contraseña incorrecta
          setAuthError('La contraseña es incorrecta');
          setShowOtpOption(true);
          return;
        }
        // Escenario potencial de usuario no existente: no crear cuenta automáticamente
        setAuthError('No existe una cuenta con este email');
        setShowOtpOption(false);
      } else {
        setAuthInfo('Sesión iniciada. Ya puedes confirmar la reserva.');
      }
    } finally {
      setAuthLoading(false);
    }
  };
  const handleOtpVerify = async () => {
    try {
      setAuthLoading(true);
      setAuthError('');
      setAuthInfo('');
      const { error } = await supabase.auth.signInWithOtp({
        email: authEmail.trim(),
        options: { emailRedirectTo: redirectUrl }
      } as any);
      if (error) {
        setAuthError('No se pudo enviar el email de verificación.');
      } else {
        persistConfirmationResume(bookingData);
        setAuthInfo('Te hemos enviado un enlace para continuar con tu reserva');
      }
    } finally {
      setAuthLoading(false);
    }
  };

  useEffect(() => {
    if (!user || !bookingData.quoteId) return;

    let disposed = false;
    const paymentReturnSyncKey =
      paymentReturnRequested && paymentReturnAttemptId ? `payment_return:${paymentReturnAttemptId}` : null;

    if (paymentReturnSyncKey) {
      if (paymentReturnSyncKeyRef.current === paymentReturnSyncKey) {
        return;
      }
      paymentReturnSyncKeyRef.current = paymentReturnSyncKey;
    } else {
      paymentReturnSyncKeyRef.current = null;
    }

    const syncPaymentState = async () => {
      if (paymentReturnRequested && paymentReturnAttemptId) {
        setIsResolvingPaymentReturn(true);
        try {
          const latest = await resolveAttemptStatus(paymentReturnAttemptId, true, true);

          if (disposed) return;
          setPaymentAttempt(latest);
          if (!latest || latest.status !== 'payment_pending') {
            setPaymentClientSecret(null);
            setPaymentPublishableKey(null);
          }

          if (latest?.status === 'booking_created' && latest.bookingId) {
            reportBookingEvent('info', {
              event: 'booking.payment_confirmed',
              context: {
                attemptId: latest.attemptId,
                bookingId: latest.bookingId,
                quoteId: latest.quoteId,
                providerId: bookingData.providerId,
                serviceId: bookingData.serviceIds?.[0],
              },
            });
            finalizeBookingCreated(latest);
            return;
          }

          if (!latest || isInFlightPaymentAttemptStatus(latest.status)) {
            return;
          }

          toast.error(getBookingPaymentStatusCopy(latest.status, latest.lastErrorMessage).detail);
        } catch (error) {
          if (!disposed) {
            const message = error instanceof Error ? error.message : 'No se pudo verificar el estado del pago.';
            console.warn('Error resolving booking payment return:', message);
            toast.error('No se pudo verificar el pago todavía. Recarga en unos segundos o reintenta desde esta pantalla.');
          }
        } finally {
          if (!disposed) {
            setIsResolvingPaymentReturn(false);
          }
        }
        return;
      }

      try {
        const latest = await getBookingPaymentAttemptStatus({ quoteId: bookingData.quoteId });
        if (!disposed) {
          setPaymentAttempt(latest.attempt);
          if (!latest.attempt || latest.attempt.status !== 'payment_pending') {
            setPaymentClientSecret(null);
            setPaymentPublishableKey(null);
          }
          if (latest.attempt?.status === 'booking_created') {
            finalizeBookingCreated(latest.attempt);
          }
        }
      } catch {
        // No bloqueamos la confirmación si no se pudo hidratar el estado del intento previo.
      }
    };

    void syncPaymentState();

    return () => {
      disposed = true;
    };
  }, [
    bookingData.providerId,
    bookingData.quoteId,
    paymentReturnAttemptId,
    paymentReturnRequested,
    serviceIdsKey,
    user,
  ]);

  const formatDateTimeLabel = (value?: string | null) => {
    const timestamp = parseIsoTimestamp(value);
    if (timestamp === null) return null;

    const parsed = new Date(timestamp);
    return `${dateFormatter.format(parsed)} a las ${timeFormatter.format(parsed)}`;
  };

  const paymentHoldLabel = useMemo(
    () => formatDateTimeLabel(paymentAttempt?.holdExpiresAt),
    [dateFormatter, paymentAttempt?.holdExpiresAt, timeFormatter]
  );
  const quoteExpiryLabel = useMemo(
    () => formatDateTimeLabel(quoteExpiresAt),
    [dateFormatter, quoteExpiresAt, timeFormatter]
  );
  const payableNowLabel = useMemo(
    () => (quoteEconomics ? currencyFormatter.format(quoteEconomics.payableNow) : 'el importe pendiente'),
    [currencyFormatter, quoteEconomics]
  );
  const customerPaymentSummary = useMemo(
    () => getBookingCustomerPaymentSummary(quoteEconomics),
    [quoteEconomics]
  );
  const showInlinePaymentForm =
    Boolean(user) &&
    Boolean(paymentClientSecret) &&
    Boolean(paymentAttempt?.attemptId) &&
    paymentAttempt?.status === 'payment_pending' &&
    !quoteExpired &&
    !holdExpired;
  const stripePromise = useMemo(
    () => (showInlinePaymentForm ? getStripePromise({ publishableKey: paymentPublishableKey }) : null),
    [paymentPublishableKey, showInlinePaymentForm]
  );
  const stripeElementsOptions = useMemo(
    () =>
      paymentClientSecret
        ? {
            clientSecret: paymentClientSecret,
            locale: 'es' as const,
            appearance: {
              variables: {
                colorPrimary: '#16a34a',
                colorText: '#111827',
                colorBackground: '#ffffff',
                colorDanger: '#dc2626',
                borderRadius: '16px',
              },
            },
          }
        : null,
    [paymentClientSecret]
  );
  const canClosePaymentSheet = !isSubmittingInlinePayment && !isResolvingPaymentReturn && !isPaymentSheetSuccess;

  const closePaymentSheet = () => {
    if (!canClosePaymentSheet) return;
    setIsPaymentSheetOpen(false);
    setIsPaymentFormReady(false);
  };

  const openPaymentSheet = async () => {
    if (showInlinePaymentForm) {
      setIsPaymentSheetOpen(true);
      return;
    }

    setIsPaymentSheetOpen(true);
    const prepared = await handlePreparePayment();
    if (!prepared) {
      setIsPaymentSheetOpen(false);
      setIsPaymentFormReady(false);
    }
  };

  useEffect(() => {
    if (!isPaymentSheetOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isPaymentSheetOpen]);

  useEffect(() => {
    if (!isPaymentSheetOpen) return;
    paymentSheetCloseButtonRef.current?.focus();
  }, [isPaymentSheetOpen]);

  useEffect(() => {
    if (!isPaymentSheetOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePaymentSheet();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPaymentSheetOpen, canClosePaymentSheet]);

  useEffect(() => {
    if (showInlinePaymentForm || !isPaymentSheetOpen || isPaymentSheetSuccess || isPreparingPayment) return;
    if (paymentAttempt?.status === 'booking_created') return;
    setIsPaymentSheetOpen(false);
    setIsPaymentFormReady(false);
  }, [isPaymentSheetOpen, isPaymentSheetSuccess, isPreparingPayment, paymentAttempt?.status, showInlinePaymentForm]);

  useEffect(() => {
    if (!isPaymentSheetOpen || paymentAttempt?.status !== 'booking_created' || !paymentAttempt?.bookingId) {
      return;
    }

    const successKey = `${paymentAttempt.attemptId}:${paymentAttempt.bookingId}`;
    if (paymentSheetSuccessKeyRef.current === successKey) {
      return;
    }
    paymentSheetSuccessKeyRef.current = successKey;
    setIsPaymentSheetSuccess(true);

    const timeoutId = window.setTimeout(() => {
      setIsPaymentSheetOpen(false);
      setIsPaymentSheetSuccess(false);
      setIsPaymentFormReady(false);
    }, 850);

    return () => window.clearTimeout(timeoutId);
  }, [isPaymentSheetOpen, paymentAttempt?.attemptId, paymentAttempt?.bookingId, paymentAttempt?.status]);

  const goBackToSlotSelection = () => setCurrentStep(3);

  const isPostPaymentSettlementPending =
    successfulPaymentReturn &&
    !isResolvingPaymentReturn &&
    paymentAttempt?.status !== 'booking_created' &&
    paymentAttempt?.status !== 'failed' &&
    paymentAttempt?.status !== 'cancelled' &&
    paymentAttempt?.status !== 'expired';

  const paymentExperience = useMemo<PaymentExperienceState>(() => {
    if (!authoritativeSnapshotReady) {
      return {
        tone: 'amber',
        eyebrow: 'Revisa tu reserva',
        title: 'Necesitamos recuperar tu selección',
        detail: 'Faltan datos de precio u horario para abrir el pago con seguridad.',
        instructions: [
          'Vuelve al paso anterior y confirma de nuevo el horario.',
        ],
        actions: [
          {
            label: 'Elegir otro horario',
            onClick: goBackToSlotSelection,
            variant: 'primary',
          },
        ],
      };
    }

    if (!user) {
      return {
        tone: 'blue',
        eyebrow: 'Acceso seguro',
        title: 'Inicia sesión para pagar',
        detail: 'Primero confirma tu cuenta. Después abriremos aquí mismo el formulario seguro de Stripe.',
        instructions: [
          'No se realiza ningún cargo hasta que confirmes el pago.',
        ],
        actions: [],
      };
    }

    if (preCheckoutFailure) {
      const action: PaymentExperienceAction =
        preCheckoutFailure.preferredCta === 'reload'
          ? {
              label: 'Recargar pantalla',
              onClick: reloadCurrentPage,
              variant: 'primary',
            }
          : preCheckoutFailure.preferredCta === 'slots'
            ? {
                label: 'Elegir otro horario',
                onClick: goBackToSlotSelection,
                variant: 'primary',
              }
            : preCheckoutFailure.preferredCta === 'retry'
              ? {
                  label: 'Reintentar',
                  onClick: () => void openPaymentSheet(),
                  variant: 'primary',
                  disabled: isPreparingPayment,
                }
              : {
                  label: 'Actualizar reserva',
                  onClick: handleRefreshQuote,
                  variant: 'primary',
                  disabled: isRefreshingQuote,
                };

      return {
        tone: preCheckoutFailure.tone,
        eyebrow: preCheckoutFailure.tone === 'red' ? 'No se pudo continuar' : 'Antes de pagar',
        title: preCheckoutFailure.title,
        detail: preCheckoutFailure.detail,
        instructions: preCheckoutFailure.instructions.slice(0, 2),
        actions: [action],
      };
    }

    if (quoteExpired) {
      return {
        tone: 'red',
        eyebrow: 'Reserva caducada',
        title: 'Actualiza la reserva antes de pagar',
        detail: 'El precio o el horario han dejado de estar vigentes y debemos recalcularlos.',
        instructions: [
          'Si el horario ya no encaja, vuelve a elegir otro antes de continuar.',
        ],
        actions: [
          {
            label: 'Actualizar reserva',
            onClick: handleRefreshQuote,
            variant: 'primary',
            disabled: isRefreshingQuote,
          },
        ],
      };
    }

    if (isResolvingPaymentReturn) {
      return {
        tone: 'blue',
        eyebrow: 'Comprobando pago',
        title: 'Estamos confirmando tu reserva',
        detail: 'Espera unos segundos mientras validamos el cobro y cerramos la reserva.',
        instructions: [
          'Mantén esta pantalla abierta hasta ver el resultado final.',
        ],
        actions: [],
      };
    }

    if (paymentAttempt?.status === 'booking_created') {
      return {
        tone: 'green',
        eyebrow: 'Reserva confirmada',
        title: 'Pago completado correctamente',
        detail: 'Tu reserva ya está creada y no depende de esta pantalla.',
        instructions: [
          'Puedes revisar el detalle cuando quieras en tus reservas.',
        ],
        actions: [
          {
            label: 'Ver mis reservas',
            onClick: handleGoToBookings,
            variant: 'primary',
          },
        ],
      };
    }

    if (isPostPaymentSettlementPending) {
      return {
        tone: 'blue',
        eyebrow: 'Pago recibido',
        title: 'Estamos terminando de confirmar la reserva',
        detail: 'Tu banco ya ha respondido. Solo falta que el sistema cierre la reserva.',
        instructions: [
          'No repitas el pago mientras este estado siga pendiente.',
        ],
        actions: [
          {
            label: 'Actualizar estado',
            onClick: handleRefreshPaymentStatus,
            variant: 'primary',
            disabled: isResolvingPaymentReturn,
          },
        ],
      };
    }

    if (paymentAttempt?.status === 'cancelled') {
      return {
        tone: 'amber',
        eyebrow: 'Pago cancelado',
        title: 'No se ha realizado ningún cargo',
        detail: 'Tu reserva sigue pendiente. Si quieres continuar, vuelve a abrir el formulario de pago.',
        instructions: [
          paymentHoldLabel
            ? `Hazlo antes del ${paymentHoldLabel} si quieres mantener este horario.`
            : 'Hazlo cuanto antes si quieres mantener este horario.',
        ],
        actions: [
          {
            label: 'Abrir pago de nuevo',
            onClick: () => void openPaymentSheet(),
            variant: 'primary',
            disabled: isPreparingPayment,
          },
        ],
      };
    }

    if (paymentAttempt?.status === 'failed') {
      return {
        tone: 'red',
        eyebrow: 'Pago fallido',
        title: 'No hemos podido completar el cobro',
        detail: 'Revisa tu metodo de pago y vuelve a intentarlo si el horario sigue disponible.',
        instructions: [
          holdExpired
            ? 'El horario ya ha caducado. Elige uno nuevo antes de pagar.'
            : 'Si todo sigue correcto, puedes abrir de nuevo el formulario de pago.',
        ],
        actions: [
          {
            label: holdExpired ? 'Elegir otro horario' : 'Abrir pago de nuevo',
            onClick: holdExpired ? goBackToSlotSelection : () => void openPaymentSheet(),
            variant: 'primary',
            disabled: isPreparingPayment,
          },
        ],
      };
    }

    if (paymentAttempt?.status === 'expired' || holdExpired) {
      return {
        tone: 'red',
        eyebrow: 'Tiempo agotado',
        title: 'El horario ya no está retenido',
        detail: 'Necesitamos comprobar otra vez el precio y la disponibilidad antes de continuar.',
        instructions: [
          'Si este horario ya no encaja, vuelve a elegir otro.',
        ],
        actions: [
          {
            label: 'Actualizar reserva',
            onClick: handleRefreshQuote,
            variant: 'primary',
            disabled: isRefreshingQuote,
          },
        ],
      };
    }

    if (paymentAttempt?.status === 'processing') {
      return {
        tone: 'blue',
        eyebrow: 'Pago en proceso',
        title: 'Estamos confirmando tu pago',
        detail: 'Tu banco ya está procesando la operación. No cierres esta pantalla.',
        instructions: [
          'Te avisaremos aquí mismo cuando la reserva quede confirmada.',
        ],
        actions: [],
      };
    }

    if (showInlinePaymentForm) {
      return {
        tone: 'blue',
        eyebrow: 'Pago seguro con Stripe',
        title: 'Completa tu pago',
        detail: 'Introduce tu tarjeta o el metodo disponible. Si tu banco pide un paso extra, volverás aquí al terminar.',
        instructions: [
          'No cierres esta pestaña hasta ver la confirmación final.',
          paymentHoldLabel
            ? `Tu horario queda retenido hasta el ${paymentHoldLabel}.`
            : 'Tu horario queda retenido mientras completas el pago.',
        ],
        actions: [],
      };
    }

    return {
      tone: 'blue',
      eyebrow: 'Pago seguro con Stripe',
      title: 'Todo listo para pagar',
      detail: 'Abriremos aquí mismo el formulario de Stripe para que pagues sin salir de GarSer.',
      instructions: [
        'Revisa servicio, horario e importe antes de continuar.',
        paymentHoldLabel
          ? `Si continúas ahora, el horario quedará retenido hasta el ${paymentHoldLabel}.`
          : 'Cuando continúes, retendremos el horario mientras completas el pago.',
      ],
      actions: [
        {
          label: 'Continuar al pago',
          onClick: () => void openPaymentSheet(),
          variant: 'primary',
          disabled: isPreparingPayment,
        },
      ],
    };
  }, [
    authoritativeSnapshotReady,
    goBackToSlotSelection,
    handleGoToBookings,
    handleRefreshPaymentStatus,
    handleRefreshQuote,
    holdExpired,
    isPreparingPayment,
    isRefreshingQuote,
    isResolvingPaymentReturn,
    isSubmittingInlinePayment,
    paymentAttempt?.bookingId,
    paymentAttempt?.status,
    paymentAttempt?.attemptId,
    paymentHoldLabel,
    preCheckoutFailure,
    quoteExpired,
    showInlinePaymentForm,
    user,
    preCheckoutFailure,
    openPaymentSheet,
  ]);

  const paymentExperienceStyles = {
    blue: {
      card: 'border-blue-200 bg-blue-50',
      badge: 'bg-blue-100 text-blue-900',
      icon: 'text-blue-700',
      title: 'text-blue-950',
      detail: 'text-blue-900',
      list: 'text-blue-900',
      meta: 'text-blue-800',
    },
    amber: {
      card: 'border-amber-200 bg-amber-50',
      badge: 'bg-amber-100 text-amber-900',
      icon: 'text-amber-700',
      title: 'text-amber-950',
      detail: 'text-amber-900',
      list: 'text-amber-900',
      meta: 'text-amber-800',
    },
    red: {
      card: 'border-red-200 bg-red-50',
      badge: 'bg-red-100 text-red-900',
      icon: 'text-red-700',
      title: 'text-red-950',
      detail: 'text-red-900',
      list: 'text-red-900',
      meta: 'text-red-800',
    },
    green: {
      card: 'border-emerald-200 bg-emerald-50',
      badge: 'bg-emerald-100 text-emerald-900',
      icon: 'text-emerald-700',
      title: 'text-emerald-950',
      detail: 'text-emerald-900',
      list: 'text-emerald-900',
      meta: 'text-emerald-800',
    },
  } as const;

  const paymentExperienceStyle = paymentExperienceStyles[paymentExperience.tone];
  const paymentExperienceIcon =
    paymentExperience.tone === 'green' ? (
      <CheckCircle2 aria-hidden="true" className={`h-5 w-5 flex-shrink-0 ${paymentExperienceStyle.icon}`} />
    ) : (
      <AlertTriangle aria-hidden="true" className={`h-5 w-5 flex-shrink-0 ${paymentExperienceStyle.icon}`} />
    );

  const primaryFooterAction =
    paymentExperience.actions.find((action) => action.variant === 'primary') ||
    paymentExperience.actions[0] ||
    null;
  const showPaymentSheetPayAction = isPaymentSheetOpen && showInlinePaymentForm && Boolean(paymentAttempt?.attemptId);
  const showInlinePaymentStatus =
    Boolean(preCheckoutFailure) ||
    quoteExpired ||
    isResolvingPaymentReturn ||
    paymentAttempt?.status === 'booking_created' ||
    paymentAttempt?.status === 'processing' ||
    paymentAttempt?.status === 'failed' ||
    paymentAttempt?.status === 'cancelled' ||
    paymentAttempt?.status === 'expired' ||
    holdExpired ||
    isPostPaymentSettlementPending;
  const paymentActionLabel = primaryFooterAction?.label
    || (isResolvingPaymentReturn
      ? 'Comprobando pago…'
      : paymentAttempt?.status === 'processing' || isPostPaymentSettlementPending
        ? 'Esperando confirmación del cobro'
        : paymentAttempt?.status === 'booking_created'
          ? 'Reserva creada'
          : 'Acción no disponible');
  const footerActionLabel = isPaymentSheetSuccess
    ? 'Reserva completada'
    : showPaymentSheetPayAction
      ? `Pagar ${payableNowLabel}`
      : isPreparingPayment && isPaymentSheetOpen
        ? 'Preparando pago…'
      : isSubmittingInlinePayment
        ? 'Procesando pago…'
        : paymentActionLabel;
  const ctaDisabled =
    (showPaymentSheetPayAction ? !isPaymentFormReady : (!primaryFooterAction || Boolean(primaryFooterAction.disabled))) ||
    isPreparingPayment ||
    isSubmittingInlinePayment ||
    isRefreshingQuote ||
    isResolvingPaymentReturn ||
    isPaymentSheetSuccess;
  const ctaOnClick = showPaymentSheetPayAction
    ? () => void paymentFormRef.current?.submitPayment()
    : (primaryFooterAction?.onClick || (() => undefined));
  const showStickyFooter =
    Boolean(user) &&
    paymentAttempt?.status !== 'booking_created' &&
    !isPaymentSheetOpen &&
    (Boolean(primaryFooterAction) || showPaymentSheetPayAction || isPaymentSheetOpen);

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-lg px-4 py-4 pb-32 sm:pb-36" id="confirmation-main">
        <div className="mb-3 flex justify-start">
          <button
            type="button"
            onClick={() => setCurrentStep(3)}
            aria-label="Volver al paso de selección de jardinero"
            className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 [touch-action:manipulation]"
          >
            Cambiar horario
          </button>
        </div>

        {resumeNotice ? (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3" aria-live="polite">
            <div className="flex items-start gap-3">
              <Info aria-hidden="true" className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-700" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-amber-900">{resumeNotice.title}</p>
                <p className="mt-1 text-sm text-amber-800">{resumeNotice.detail}</p>
              </div>
              <button
                type="button"
                onClick={() => setResumeNotice(null)}
                aria-label="Cerrar aviso de reanudación"
                className="rounded-lg p-1 text-amber-700 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : null}

        {!authoritativeSnapshotReady && (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" aria-live="polite">
            No hemos podido recuperar bien el precio o el horario. Vuelve atrás y confirma la reserva de nuevo.
          </div>
        )}

        <div className="mb-4 rounded-3xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-base font-semibold text-gray-900">Resumen de la reserva</h2>

          {/* Location */}
          <div className="flex items-start space-x-3 mb-3">
            <MapPin aria-hidden="true" className="w-5 h-5 text-gray-400 mt-0.5" />
            <div>
              <p className="font-medium text-gray-900">Ubicación</p>
              <p className="text-sm text-gray-600">{bookingData.address}</p>
            </div>
          </div>

          {/* Services */}
          <div className="flex items-start space-x-3 mb-3">
            <Calendar aria-hidden="true" className="w-5 h-5 text-gray-400 mt-0.5" />
            <div>
              <p className="font-medium text-gray-900">Servicios</p>
              <p className="text-sm text-gray-600">{displayServices}</p>
            </div>
          </div>

          {/* Date & Time */}
          <div className="flex items-start space-x-3 mb-3">
            <Clock aria-hidden="true" className="w-5 h-5 text-gray-400 mt-0.5" />
            <div>
              <p className="font-medium text-gray-900">Fecha y hora</p>
              <p className="text-sm text-gray-600">
                {formattedDate} a las {formatSlotLabel(selectedQuoteSlot)}
              </p>
            </div>
          </div>

          {/* Provider */}
          <div className="flex items-start space-x-3 mb-3">
            <User aria-hidden="true" className="w-5 h-5 text-gray-400 mt-0.5" />
            <div>
              <p className="font-medium text-gray-900">Jardinero</p>
              <p className="text-sm text-gray-600">{gardenerName || 'Jardinero'}</p>
            </div>
          </div>

          

          {/* Description */}
          {bookingData.description && (
            <div className="flex items-start space-x-3 mb-4">
              <Calendar aria-hidden="true" className="w-5 h-5 text-gray-400 mt-0.5" />
              <div>
                <p className="font-medium text-gray-900">Descripción</p>
                <p className="text-sm text-gray-600">{bookingData.description}</p>
              </div>
            </div>
          )}

          {/* Breakdown Toggle */}
          {breakdown.length > 0 && (
             <div className="mb-4">
                 <button
                     type="button"
                     onClick={() => setShowBreakdown(!showBreakdown)}
                    aria-expanded={showBreakdown}
                    aria-controls="booking-breakdown-panel"
                     className="text-xs font-medium text-green-600 underline hover:text-green-700 flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 [touch-action:manipulation]"
                 >
                     {showBreakdown ? 'Ocultar desglose' : 'Ver desglose detallado'}
                 </button>
                 {showBreakdown && (
                     <div id="booking-breakdown-panel" className="mt-2 bg-gray-50 rounded-lg p-3 space-y-2 border border-gray-100">
                         {breakdown.map((item, i) => (
                             <div key={i} className="flex justify-between text-xs">
                                 <span className="text-gray-600 truncate mr-2">{item.desc}</span>
                                <span className="font-medium text-gray-900 whitespace-nowrap">{currencyFormatter.format(item.price)}</span>
                             </div>
                         ))}
                     </div>
                 )}
             </div>
          )}

          {/* Divider */}
          <div className="border-t border-gray-200 pt-4">
            <div className="space-y-5">
              <div>
                <p className="text-sm font-semibold text-gray-900">Resumen de pago</p>
                <div className="mt-3">
                  <p className="text-sm font-medium text-gray-500">Total de la reserva</p>
                  <p className="mt-1 text-[2rem] font-bold leading-none text-gray-950 tabular-nums">
                    {customerPaymentSummary ? currencyFormatter.format(customerPaymentSummary.reservationTotal) : 'Pendiente'}
                  </p>
                </div>
              </div>

              <div className="space-y-3 border-b border-gray-100 pb-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-gray-500">Subtotal del servicio</span>
                  <span className="text-sm font-medium text-gray-600 tabular-nums">
                    {customerPaymentSummary ? currencyFormatter.format(customerPaymentSummary.serviceSubtotal) : 'Pendiente'}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-gray-500">Tarifa de reserva</span>
                  <span className="text-sm font-medium text-gray-600 tabular-nums">
                    {customerPaymentSummary ? currencyFormatter.format(customerPaymentSummary.reservationFee) : 'Pendiente'}
                  </span>
                </div>
              </div>

              <div className="flex items-end justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-gray-900 text-balance">Adelanto de confirmación</p>
                </div>
                <p className="text-[1.75rem] font-bold leading-none text-green-600 tabular-nums">
                  {customerPaymentSummary ? currencyFormatter.format(customerPaymentSummary.confirmationDeposit) : 'Pendiente'}
                </p>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <div className="flex items-end justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-gray-900 text-balance">Pendiente al profesional</p>
                    <p className="mt-2 max-w-[22rem] text-xs leading-5 text-gray-500">
                      El profesional cobrará este importe al completar el servicio de la manera que acordéis.
                    </p>
                  </div>
                  <p className="text-[1.375rem] font-semibold leading-none text-gray-900 tabular-nums">
                    {customerPaymentSummary ? currencyFormatter.format(customerPaymentSummary.pendingToProfessional) : 'Pendiente'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {!user && (
          <div className="mb-4 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-3">
              <h2 className="text-base font-semibold text-gray-900">Accede para continuar</h2>
              <p className="mt-1 text-sm text-gray-600">
                Usa tu cuenta para abrir el pago seguro y guardar la reserva correctamente.
              </p>
            </div>
            <div className="space-y-3">
              <div>
                <label htmlFor="booking-auth-email" className="mb-1 block text-sm font-medium text-gray-700">Correo electrónico</label>
                <input
                  id="booking-auth-email"
                  type="email"
                  name="email"
                  autoComplete="email"
                  spellCheck={false}
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="tu@email.com…"
                  className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                />
              </div>
              <div>
                <label htmlFor="booking-auth-password" className="mb-1 block text-sm font-medium text-gray-700">Contraseña</label>
                <input
                  id="booking-auth-password"
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="Tu contraseña…"
                  className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                />
              </div>
              {authError && <div className="rounded-2xl bg-red-50 px-3 py-2 text-sm text-red-700" aria-live="polite">{authError}</div>}
              {authInfo && <div className="rounded-2xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700" aria-live="polite">{authInfo}</div>}
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={handleLogin}
                  disabled={authLoading || !authEmail || !authPassword}
                  className="flex-1 rounded-2xl bg-green-600 px-4 py-3 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 [touch-action:manipulation]"
                >
                  Iniciar sesión
                </button>
                <button
                  type="button"
                  onClick={handleCreateAccount}
                  disabled={authLoading || !authEmail || !authPassword}
                  className="flex-1 rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 [touch-action:manipulation]"
                >
                  Crear cuenta
                </button>
              </div>
              {showOtpOption && (
                <div className="flex items-center justify-start">
                  <button
                    type="button"
                    onClick={handleOtpVerify}
                    disabled={authLoading || !authEmail}
                    className="text-sm text-gray-700 underline hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 [touch-action:manipulation]"
                  >
                    Recibir enlace de acceso
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {showInlinePaymentStatus ? (
          <div className={`mb-4 rounded-2xl border p-4 ${paymentExperienceStyle.card}`} aria-live="polite">
            <div className="flex items-start gap-3">
              {paymentExperienceIcon}
              <div className="min-w-0 flex-1">
                {paymentExperience.eyebrow ? (
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${paymentExperienceStyle.badge}`}>
                    {paymentExperience.eyebrow}
                  </span>
                ) : null}
                <p className={`mt-2 text-sm font-semibold ${paymentExperienceStyle.title}`}>{paymentExperience.title}</p>
                <p className={`mt-1 text-sm ${paymentExperienceStyle.detail}`}>{paymentExperience.detail}</p>
              </div>
            </div>
          </div>
        ) : null}

        {(quoteExpiryLabel || paymentHoldLabel) && (
          <div className="mb-4 rounded-2xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
            {paymentHoldLabel ? (
              <p>Horario retenido hasta el {paymentHoldLabel}.</p>
            ) : null}
            {quoteExpiryLabel ? (
              <p className={paymentHoldLabel ? 'mt-1' : ''}>Precio vigente hasta el {quoteExpiryLabel}.</p>
            ) : null}
          </div>
        )}
      </main>

      {showStickyFooter ? (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 pt-3 pb-[calc(0.875rem+env(safe-area-inset-bottom))] z-50">
          <div className="mx-auto max-w-lg">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Pagas ahora</p>
                <p className="text-2xl font-semibold text-gray-900 tabular-nums">{payableNowLabel}</p>
              </div>
              <p className="max-w-[12rem] text-right text-xs text-gray-500">
                Pago seguro con Stripe dentro de GarSer
              </p>
            </div>
            <button
              type="button"
              onClick={ctaOnClick}
              disabled={ctaDisabled}
              aria-haspopup={showPaymentSheetPayAction ? undefined : 'dialog'}
              aria-expanded={isPaymentSheetOpen}
              className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-4 px-6 rounded-2xl font-semibold text-lg shadow-lg hover:shadow-xl hover:scale-[1.02] motion-reduce:transform-none transition-transform duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 [touch-action:manipulation]"
            >
              {isPaymentSheetSuccess ? (
                <div className="flex items-center justify-center gap-2" aria-live="polite" role="status">
                  <CheckCircle2 aria-hidden="true" className="h-5 w-5" />
                  {footerActionLabel}
                </div>
              ) : isPreparingPayment || isRefreshingQuote || isResolvingPaymentReturn || isSubmittingInlinePayment ? (
                <div className="flex items-center justify-center" aria-live="polite" role="status">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                  {footerActionLabel}
                </div>
              ) : (
                footerActionLabel
              )}
            </button>
          </div>
        </div>
      ) : null}

      {isPaymentSheetOpen ? (
        <>
          <button
            type="button"
            aria-label="Cerrar ventana de pago"
            onClick={closePaymentSheet}
            className="fixed inset-0 z-40 bg-gray-950/20 backdrop-blur-[2px]"
          />
          <div className="fixed inset-x-0 bottom-0 top-[8vh] z-50 overflow-x-hidden">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="payment-sheet-title"
              className="mx-auto flex h-full max-w-lg flex-col overflow-hidden rounded-t-[32px] bg-white shadow-2xl overscroll-contain transition-[opacity,transform] duration-300 motion-reduce:transition-none motion-reduce:transform-none sm:mt-4 sm:h-[calc(92vh-1rem)] sm:rounded-[32px]"
            >
              <div className="flex justify-center px-5 pt-3">
                <span aria-hidden="true" className="h-1.5 w-12 rounded-full bg-gray-300" />
              </div>

              <div className="flex items-start justify-between gap-4 px-5 pb-2 pt-3">
                <div className="min-w-0">
                  <p id="payment-sheet-title" className="text-lg font-semibold text-gray-950 text-balance">
                    Pago seguro
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    Confirma el adelanto sin salir de GarSer.
                  </p>
                </div>
                <button
                  ref={paymentSheetCloseButtonRef}
                  type="button"
                  onClick={closePaymentSheet}
                  aria-label="Cerrar pago"
                  disabled={!canClosePaymentSheet}
                  className="rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
                >
                  <X aria-hidden="true" className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 pb-6 pt-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Pagas ahora</p>
                  <p className="mt-1 text-3xl font-bold leading-none text-gray-950 tabular-nums">{payableNowLabel}</p>
                </div>

                {isPreparingPayment && !showInlinePaymentForm ? (
                  <div className="flex min-h-[14rem] items-center">
                    <div className="flex items-center gap-3 text-sm text-gray-600" aria-live="polite" role="status">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-green-600" />
                      Estamos preparando el formulario seguro de pago…
                    </div>
                  </div>
                ) : null}

                {showInlinePaymentForm && stripePromise && stripeElementsOptions && paymentAttempt?.attemptId ? (
                  <div className="mt-6">
                    <Elements key={paymentClientSecret || 'stripe-elements'} stripe={stripePromise} options={stripeElementsOptions}>
                      <EmbeddedStripePaymentForm
                        ref={paymentFormRef}
                        attemptId={paymentAttempt.attemptId}
                        amountLabel={payableNowLabel}
                        disabled={isPreparingPayment || isResolvingPaymentReturn || isPaymentSheetSuccess}
                        onReadyChange={setIsPaymentFormReady}
                        onSubmittingChange={setIsSubmittingInlinePayment}
                        onConfirmed={async () => {
                          const latest = await resolveAttemptStatus(paymentAttempt.attemptId, true, true);
                          setPaymentAttempt(latest);
                          if (!latest || latest.status !== 'payment_pending') {
                            setPaymentClientSecret(null);
                            setPaymentPublishableKey(null);
                          }

                          if (latest?.status === 'booking_created') {
                            finalizeBookingCreated(latest);
                            return;
                          }

                          if (latest?.status === 'processing') {
                            toast.success('Pago confirmado por Stripe. Estamos consolidando la reserva.');
                            return;
                          }

                          if (latest?.status && latest.status !== 'payment_pending') {
                            toast.error(getBookingPaymentStatusCopy(latest.status, latest.lastErrorMessage).detail);
                          }
                        }}
                      />
                    </Elements>
                  </div>
                ) : null}
              </div>

              <div className="border-t border-gray-100 bg-white px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
                <div className="mb-3 flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Pagas ahora</p>
                    <p className="mt-1 text-2xl font-semibold text-gray-950 tabular-nums">{payableNowLabel}</p>
                  </div>
                  <p className="max-w-[10rem] text-right text-xs leading-5 text-gray-500">
                    Pago seguro dentro de GarSer
                  </p>
                </div>

                <button
                  type="button"
                  onClick={ctaOnClick}
                  disabled={ctaDisabled}
                  className="w-full rounded-2xl bg-gradient-to-r from-green-600 to-emerald-600 px-6 py-4 text-lg font-semibold text-white shadow-lg transition-transform duration-200 hover:scale-[1.01] hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 [touch-action:manipulation]"
                >
                  {isPaymentSheetSuccess ? (
                    <div className="flex items-center justify-center gap-2" aria-live="polite" role="status">
                      <CheckCircle2 aria-hidden="true" className="h-5 w-5" />
                      {footerActionLabel}
                    </div>
                  ) : isPreparingPayment || isRefreshingQuote || isResolvingPaymentReturn || isSubmittingInlinePayment ? (
                    <div className="flex items-center justify-center" aria-live="polite" role="status">
                      <div className="mr-2 h-5 w-5 animate-spin rounded-full border-b-2 border-white" />
                      {footerActionLabel}
                    </div>
                  ) : (
                    footerActionLabel
                  )}
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};

export default ConfirmationPage;
