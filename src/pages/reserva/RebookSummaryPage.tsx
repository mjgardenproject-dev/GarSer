import { useMemo } from 'react';
import { Calendar, MapPin, Pencil, RotateCcw, User } from 'lucide-react';

import { useBooking } from '../../contexts/BookingContext';
import ServiceDetailCard from '../../components/booking/ServiceDetailCard';
import { buildConsentRecord } from '../../shared/manualEntry/legalCopy';
import type { BookingServiceInput } from '../../utils/bookingServiceDetails';

/**
 * Resumen previo al repetir un servicio.
 *
 * Repetir dejaba al cliente directamente en la pantalla de detalles, con toda la interfaz de
 * análisis por fotos y su texto, como si estuviera empezando de cero. Lo que necesita antes es
 * justo lo contrario: una tarjeta corta que le diga qué se va a repetir.
 *
 * Y si la da por buena, **no tiene que ver nada más**: se va directo a elegir profesional. El
 * paso por la pantalla de detalles solo tiene sentido para quien viene a cambiar algo, así que
 * es una salida aparte y no el camino obligatorio de todos.
 */

const formatPreviousDate = (iso?: string | null): string | null => {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) return null;
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }).format(parsed);
};

const RebookSummaryPage = () => {
  const { bookingData, setBookingData, setCurrentStep } = useBooking();

  // El payload guardado no distingue entre lo que describe el trabajo y lo que solo sirve para
  // pintar este resumen, así que se lee con un tipado laxo en vez de ensuciar BookingData.
  const source = bookingData as unknown as {
    address?: string;
    rebookSourceDate?: string;
    rebookSourceService?: string;
    rebookSourceGardener?: string;
    dataInputMode?: string;
  };

  const previousDate = useMemo(() => formatPreviousDate(source.rebookSourceDate), [source.rebookSourceDate]);

  /**
   * Sello de aceptación de ESTA reserva.
   *
   * Al saltarse la pantalla de detalles no se pasa por `handleManualSubmit`, que es quien
   * normalmente acuña el consentimiento. Sin esto viajaría al presupuesto el de la reserva
   * anterior, con su `acceptedAt` de hace meses: el campo estaría, pero como prueba de que el
   * cliente aceptó estas condiciones hoy no valdría nada. Las respuestas declaradas sí se
   * conservan, que es lo que describe el trabajo.
   */
  const freshConsent = () => {
    const previous = (bookingData as { manualConsent?: { declaredVariables?: unknown } }).manualConsent;
    return { ...buildConsentRecord(), declaredVariables: previous?.declaredVariables };
  };

  /** Los datos valen tal cual: a elegir profesional, sin pasar por detalles. */
  const confirmAndContinue = () => {
    setBookingData({
      rebookReviewPending: false,
      rebookConfirmed: true,
      manualConsent: freshConsent(),
    } as never);
    setCurrentStep(3);
  };

  /** Quiere cambiar algo: a la pantalla de detalles, con el asistente ya en su resumen. */
  const editDetails = () => {
    setBookingData({ rebookReviewPending: false, rebookConfirmed: true } as never);
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      {/* `pr-24` en móvil: el botón flotante de salir del funnel vive en la esquina superior
          derecha y sin este hueco el título le queda pegado. */}
      <div className="mb-6 flex items-start gap-2.5 pr-24 sm:pr-0">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-green-100">
          <RotateCcw className="h-4 w-4 text-green-700" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">
            Repetir este servicio
          </h1>
          <p className="text-sm text-gray-600">Revisa el resumen y sigue para ajustar lo que haga falta.</p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900">
          {source.rebookSourceService || 'Servicio'}
        </h2>

        <dl className="mt-3 space-y-2 text-sm">
          {source.rebookSourceGardener && (
            <div className="flex items-start gap-2 text-gray-700">
              <User className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
              <dd className="min-w-0 break-words">con {source.rebookSourceGardener}</dd>
            </div>
          )}
          {previousDate && (
            <div className="flex items-start gap-2 text-gray-700">
              <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
              <dd className="min-w-0 break-words">Lo contrataste el {previousDate}</dd>
            </div>
          )}
          {source.address && (
            <div className="flex items-start gap-2 text-gray-700">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
              <dd className="min-w-0 break-words">{source.address}</dd>
            </div>
          )}
        </dl>

        {/* El mismo desglose que ve el profesional en su panel, sin la etiqueta de procedencia:
            aquí el cliente está leyendo lo que declaró él mismo. */}
        <ServiceDetailCard
          className="mt-4"
          title="Lo que se va a repetir"
          sourceLabel={null}
          dataInputMode={source.dataInputMode}
          serviceInput={bookingData as unknown as BookingServiceInput}
        />

        <p className="mt-4 text-sm text-gray-600">
          El precio se calcula de nuevo con las tarifas actuales de cada profesional, así que
          puede no coincidir con el de la vez anterior.
        </p>
      </div>

      {/* Antes había aquí una casilla obligatoria de "confirmo el estado del jardín" y un solo
          botón. Sobraba: pulsar el botón que dice "confirmar" ES la confirmación, y la
          declaración de veracidad ya se pide una vez, junto a los datos, en el asistente. */}
      <div className="mt-4 space-y-2">
        <button
          type="button"
          onClick={confirmAndContinue}
          className="w-full rounded-xl bg-green-600 px-4 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
        >
          Confirmar y ver profesionales
        </button>
        <button
          type="button"
          onClick={editDetails}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
        >
          <Pencil className="w-4 h-4" aria-hidden="true" />
          Editar los datos
        </button>
      </div>
    </div>
  );
};

export default RebookSummaryPage;
