import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { formatEuro } from '../shared/bookingAmounts';
import { fetchProfileNames } from '../utils/profileNames';
import {
  BLOCKING_INCIDENT_KINDS,
  INCIDENT_KIND_OPTIONS,
  reportBookingIncident,
  type IncidentKind,
} from '../utils/bookingIncidentService';

/**
 * Parte de incidencia del cliente.
 *
 * El cliente NO puede marcar directamente "el servicio no se hizo": aquí describe lo que pasó
 * y lo revisa un administrador. Es deliberado — sin ese filtro, cualquiera podría reclamar un
 * reembolso sin verificación, y un profesional real necesita poder dar su versión antes de que
 * le devuelvan dinero en su contra o le penalicen la nota.
 */

interface BookingSummary {
  id: string;
  service_name: string | null;
  gardener_name: string | null;
  date: string;
  start_time: string | null;
  management_fee: number | null;
}

const formatDate = (iso: string) => {
  try {
    return format(parseISO(iso), "EEEE, d 'de' MMMM 'de' yyyy", { locale: es });
  } catch {
    return iso;
  }
};

const BookingIncidentPage = () => {
  const { bookingId } = useParams<{ bookingId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [booking, setBooking] = useState<BookingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<IncidentKind | null>(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!bookingId || !user?.id) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('bookings')
        .select('id, date, start_time, management_fee, gardener_id, services(name)')
        .eq('id', bookingId)
        .eq('client_id', user.id)
        .maybeSingle();

      if (error || !data) {
        setBooking(null);
        setLoading(false);
        return;
      }

      const names = data.gardener_id ? await fetchProfileNames([data.gardener_id]) : {};
      const gardenerName = data.gardener_id ? names[data.gardener_id]?.full_name || null : null;

      setBooking({
        id: data.id,
        service_name: (data.services as { name?: string } | null)?.name || null,
        gardener_name: gardenerName,
        date: data.date,
        start_time: data.start_time,
        management_fee: data.management_fee,
      });
      setLoading(false);
    })();
  }, [bookingId, user?.id]);

  const isBlocking = kind ? BLOCKING_INCIDENT_KINDS.includes(kind) : false;
  const selectedOption = INCIDENT_KIND_OPTIONS.find((option) => option.kind === kind);
  const canSubmit = kind !== null && description.trim().length >= 10 && !submitting;

  const submit = async () => {
    if (!bookingId || !kind || description.trim().length < 10) return;
    setSubmitting(true);
    try {
      await reportBookingIncident(bookingId, kind, description.trim());
      toast.success('Hemos recibido tu incidencia. Te avisaremos por email.');
      navigate('/bookings');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo enviar la incidencia.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600" aria-label="Cargando" />
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10 text-center">
        <p className="text-sm text-gray-600">No hemos encontrado esta reserva.</p>
        <button
          type="button"
          onClick={() => navigate('/bookings')}
          className="mt-4 text-sm font-semibold text-green-700 underline hover:text-green-800"
        >
          Ver mis reservas
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-4 sm:px-6 sm:py-6 pb-28 sm:pb-6">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-6 inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        Volver
      </button>

      <h1 className="text-2xl font-semibold tracking-tight text-gray-900 mb-1">Reportar una incidencia</h1>
      <p className="text-sm text-gray-600 mb-4">
        Lo revisamos y te avisamos por email. Esta reserva no se cerrará mientras la estemos mirando.
      </p>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm mb-6">
        <p className="font-semibold text-gray-900 break-words">{booking.service_name || 'Servicio'}</p>
        {booking.gardener_name && <p className="text-sm text-gray-600 truncate">con {booking.gardener_name}</p>}
        <p className="text-sm text-gray-500 mt-1">{formatDate(booking.date)}</p>
      </div>

      <fieldset className="space-y-2 mb-4">
        <legend className="text-sm font-semibold text-gray-700 mb-2">¿Qué ha pasado?</legend>
        {INCIDENT_KIND_OPTIONS.map((option) => (
          <label
            key={option.kind}
            className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
              kind === option.kind ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-white hover:bg-gray-50'
            }`}
          >
            <input
              type="radio"
              name="incident-kind"
              value={option.kind}
              checked={kind === option.kind}
              onChange={() => setKind(option.kind)}
              className="mt-0.5 h-4 w-4 shrink-0 text-green-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
            />
            <span className="text-sm text-gray-800">{option.label}</span>
          </label>
        ))}
      </fieldset>

      {selectedOption?.hint && (
        <p className="mb-4 rounded-xl bg-amber-50 border border-amber-100 px-3 py-2.5 text-xs text-amber-800">
          {selectedOption.hint}
          {isBlocking && booking.management_fee ? ` (${formatEuro(booking.management_fee)})` : ''}
        </p>
      )}

      <div className="mb-2">
        <label htmlFor="incident-description" className="block text-sm font-medium text-gray-700 mb-2">
          Cuéntanos qué pasó
        </label>
        <textarea
          id="incident-description"
          value={description}
          onChange={(event) => setDescription(event.target.value.slice(0, 2000))}
          rows={5}
          placeholder="Descríbelo con el detalle que puedas: fecha, lo que esperabas y lo que ocurrió."
          className="w-full p-3 border border-gray-300 rounded-lg text-base sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
        />
        <p className="mt-1 text-xs text-gray-500">{description.length}/2000 · mínimo 10 caracteres</p>
      </div>

      <div className="mb-6 rounded-xl bg-gray-50 border border-gray-200 p-3">
        <p className="text-xs font-semibold text-gray-600 mb-1">Qué pasa ahora</p>
        <p className="text-xs text-gray-600 leading-relaxed">
          La revisamos y te escribimos por email. Si procede una devolución, tu banco puede
          tardar entre 3 y 5 días hábiles en reflejarla.
        </p>
      </div>

      <div className="fixed inset-x-0 bottom-0 sm:static bg-white sm:bg-transparent border-t sm:border-0 border-gray-200 p-4 sm:p-0">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
        >
          <MessageCircle className="w-4 h-4" aria-hidden="true" />
          {submitting ? 'Enviando…' : 'Enviar incidencia'}
        </button>
      </div>
    </div>
  );
};

export default BookingIncidentPage;
