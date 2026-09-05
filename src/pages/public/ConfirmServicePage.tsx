import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock, AlertTriangle, XCircle, Loader2, MessageCircle } from 'lucide-react';

/**
 * Página pública del enlace de un clic del correo de confirmación.
 *
 * Sin sesión a propósito. El enlace del email apunta AQUÍ y no directamente a la edge
 * function: los escáneres de correo (Outlook Safe Links, antivirus corporativos) hacen GET a
 * todos los enlaces de un email antes de que el humano lo abra, y un GET que confirmara la
 * reserva se consumiría solo. Esta página es HTML inerte para el escáner — el POST que de
 * verdad confirma lo dispara React al montarse, y los escáneres no ejecutan JavaScript. Sigue
 * siendo un solo clic humano: pulsar el enlace del correo.
 */

type Outcome =
  | 'loading' | 'confirmed' | 'already_used' | 'already_completed'
  | 'incident_open' | 'not_confirmable' | 'expired' | 'invalid';

interface Result {
  bookingId?: string | null;
  serviceName?: string | null;
  gardenerFirstName?: string | null;
  date?: string | null;
  autoCompleted?: boolean;
}

const formatDate = (iso?: string | null): string | null => {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) return null;
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }).format(parsed);
};

const ConfirmServicePage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('t');
  const attempted = useRef(false);

  const [outcome, setOutcome] = useState<Outcome>('loading');
  const [result, setResult] = useState<Result>({});

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    if (!token) {
      setOutcome('invalid');
      return;
    }

    (async () => {
      try {
        const base = import.meta.env.VITE_SUPABASE_URL as string;
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
        const response = await fetch(`${base}/functions/v1/booking-confirm-service`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: anonKey },
          body: JSON.stringify({ token }),
        });
        const data = await response.json();
        setResult(data);
        setOutcome((data?.outcome as Outcome) || 'invalid');
      } catch {
        setOutcome('invalid');
      }
    })();
  }, [token]);

  const service = result.serviceName || 'tu servicio';
  const gardener = result.gardenerFirstName || 'el profesional';
  const date = formatDate(result.date);

  const content: Record<Exclude<Outcome, 'loading'>, { icon: JSX.Element; title: string; body: string }> = {
    confirmed: {
      icon: <CheckCircle2 className="w-12 h-12 text-green-600" aria-hidden="true" />,
      title: '¡Gracias! Servicio confirmado',
      body: `Has confirmado que ${gardener} hizo el trabajo de ${service}${date ? ` el ${date}` : ''}. Ya puedes dejar tu valoración.`,
    },
    // Un segundo clic sobre el mismo enlace pinta como éxito, no como error: es exactamente
    // el mismo sí de siempre, y un duplicado de correo no puede parecer un fallo.
    already_used: {
      icon: <CheckCircle2 className="w-12 h-12 text-green-600" aria-hidden="true" />,
      title: 'Ya lo habías confirmado',
      body: `Este servicio ya quedó confirmado. Gracias de todas formas.`,
    },
    already_completed: {
      icon: <CheckCircle2 className="w-12 h-12 text-green-600" aria-hidden="true" />,
      title: 'Este servicio ya está cerrado',
      body: result.autoCompleted
        ? 'Como no respondiste a tiempo, se dio por completado automáticamente. Si algo no fue bien, todavía puedes abrir una incidencia desde la app.'
        : 'Esta reserva ya se completó.',
    },
    incident_open: {
      icon: <Clock className="w-12 h-12 text-amber-500" aria-hidden="true" />,
      title: 'Tienes una incidencia en revisión',
      body: 'Ya nos avisaste de un problema con este servicio y lo estamos revisando. Te escribiremos en cuanto tengamos una respuesta.',
    },
    not_confirmable: {
      icon: <AlertTriangle className="w-12 h-12 text-amber-500" aria-hidden="true" />,
      title: 'Esta reserva ya no admite confirmación',
      body: 'Puede que se cancelara o que ya se resolviera de otra forma. Entra en la app para ver el estado real.',
    },
    expired: {
      icon: <Clock className="w-12 h-12 text-amber-500" aria-hidden="true" />,
      title: 'El plazo para confirmar ha pasado',
      body: 'Como no respondiste a tiempo, el servicio se dio por completado. ¿Algo no fue bien? Todavía puedes abrir una incidencia desde la app.',
    },
    invalid: {
      icon: <XCircle className="w-12 h-12 text-gray-400" aria-hidden="true" />,
      title: 'Este enlace no es válido',
      body: 'Puede que haya caducado o que el correo no fuera el más reciente. Entra en la app para ver tus reservas.',
    },
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-sm text-center">
        <div className="mb-3 flex items-center justify-center">
          <span className="text-xl font-extrabold text-green-600">GarSer</span>
        </div>

        {outcome === 'loading' ? (
          <div className="py-8">
            <Loader2 className="w-8 h-8 text-green-600 mx-auto animate-spin" aria-hidden="true" />
            <p className="mt-3 text-sm text-gray-500">Confirmando…</p>
          </div>
        ) : (
          <>
            <div className="flex justify-center mb-3">{content[outcome].icon}</div>
            <h1 className="text-lg font-semibold text-gray-900">{content[outcome].title}</h1>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">{content[outcome].body}</p>

            <div className="mt-6 space-y-2">
              <button
                type="button"
                onClick={() => navigate('/bookings')}
                className="w-full rounded-xl bg-green-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
              >
                Ver mis reservas
              </button>
              {(outcome === 'not_confirmable' || outcome === 'expired' || outcome === 'invalid' || outcome === 'already_completed') && (
                <button
                  type="button"
                  onClick={() => navigate(result.bookingId ? `/incidencias/${result.bookingId}` : '/bookings')}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                >
                  <MessageCircle className="w-4 h-4" aria-hidden="true" />
                  Abrir una incidencia
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ConfirmServicePage;
