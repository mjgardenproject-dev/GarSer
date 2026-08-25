import { useMemo, useState } from 'react';
import { Calendar, MapPin, RotateCcw, User } from 'lucide-react';

import { useBooking } from '../../contexts/BookingContext';
import ServiceDetailCard from '../../components/booking/ServiceDetailCard';
import type { BookingServiceInput } from '../../utils/bookingServiceDetails';

/**
 * Resumen previo al repetir un servicio.
 *
 * Repetir dejaba al cliente directamente en la pantalla de detalles, con toda la interfaz de
 * análisis por fotos y su texto, como si estuviera empezando de cero. Lo que necesita antes es
 * justo lo contrario: una tarjeta corta que le diga qué se va a repetir, para confirmarlo de un
 * vistazo. Después ya pasa a los apartados editables.
 */

const formatPreviousDate = (iso?: string | null): string | null => {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) return null;
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }).format(parsed);
};

const RebookSummaryPage = () => {
  const { bookingData, setBookingData } = useBooking();
  const [confirmed, setConfirmed] = useState(false);

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

  const proceed = () => {
    // `rebookConfirmed` viaja en los datos de la reserva para que la pantalla de detalles no
    // vuelva a pedir la misma confirmación que el cliente acaba de dar aquí.
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

      <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl border border-gray-200 bg-white p-4">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-green-600 focus-visible:ring-2 focus-visible:ring-green-500"
        />
        <span className="text-sm text-gray-800">
          Confirmo que he comprobado el estado del jardín y que las condiciones siguen siendo
          las mismas.
        </span>
      </label>

      <button
        type="button"
        onClick={proceed}
        disabled={!confirmed}
        className="mt-4 w-full rounded-xl bg-green-600 px-4 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
      >
        Continuar
      </button>
      <p className="mt-2 text-center text-xs text-gray-500">
        En el paso siguiente puedes editar cualquier dato.
      </p>
    </div>
  );
};

export default RebookSummaryPage;
