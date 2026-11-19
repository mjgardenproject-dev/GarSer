import React from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, CalendarClock, Camera, CheckCircle2, Circle, MapPin, Share2, Users } from 'lucide-react';
import PushNotificationsCard from '../account/PushNotificationsCard';
import { useMyBookingLink } from '../../hooks/useMyBookingLink';
import { providerBookingLink, type SetupStep } from '../../shared/providerSetup';

// Final del cuestionario «Activa tu cuenta» (2026-11-11). Primero el resumen y el gesto explícito «Activar
// mi cuenta» (no se activa nada a escondidas); después, lo que dice el SERVIDOR: si ya aparece a los
// clientes o qué le falta (p. ej. el carnet en revisión), y los extras que ayudan a conseguir reservas.

export interface FinishSummary {
  zone: string | null;
  services: Array<{ name: string; ready: boolean }>;
  weeklyHours: number;
  invitations: number;
}

interface Props {
  phase: 'review' | 'done';
  firstName: string;
  summary: FinishSummary;
  /** Pasos obligatorios que aún faltan según el servidor (vacío = ya aparece). */
  pending: SetupStep[];
  providerId: string;
  /** Ya tiene foto o logo: no se le vuelve a sugerir subirla (QA-197). */
  hasPhoto?: boolean;
}

const Row: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <li className="flex gap-3 px-4 py-3">
    <span className="mt-0.5 text-emerald-700">{icon}</span>
    <div className="min-w-0">
      <p className="font-semibold text-gray-900">{title}</p>
      <div className="text-sm text-gray-700">{children}</div>
    </div>
  </li>
);

const ShareLinkButton: React.FC<{ providerId: string }> = ({ providerId }) => {
  const { state: link } = useMyBookingLink(true);
  const share = async () => {
    if (link.status !== 'ready') return;
    const url = providerBookingLink(window.location.origin, providerId, link.code);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Reserva conmigo en GarSer', url });
        return;
      } catch (error) {
        if ((error as { name?: string })?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Enlace copiado');
    } catch {
      toast.error('No se ha podido copiar el enlace');
    }
  };
  return (
    <button
      type="button"
      onClick={() => void share()}
      disabled={link.status !== 'ready'}
      className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
    >
      <Share2 className="h-5 w-5" aria-hidden="true" /> Comparte tu enlace de reserva
    </button>
  );
};

const FinishStep: React.FC<Props> = ({ phase, firstName, summary, pending, providerId, hasPhoto = false }) => {
  const navigate = useNavigate();
  const ready = summary.services.filter((s) => s.ready);

  if (phase === 'review') {
    return (
      <div>
        <h1 className="text-2xl font-bold leading-tight text-gray-900">Todo listo para activar tu cuenta</h1>
        <p className="mt-2 text-gray-700">Revisa el resumen. Al activar, tus servicios empiezan a aparecer a los clientes.</p>
        <ul className="mt-5 divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
          <Row icon={<MapPin className="h-5 w-5" aria-hidden="true" />} title="Tu zona">
            {summary.zone ?? 'Sin confirmar'}
          </Row>
          <Row icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />} title="Tus servicios">
            <ul className="mt-1 space-y-1">
              {summary.services.map((s) => (
                <li key={s.name} className="flex items-start gap-2">
                  {s.ready ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 shrink-0 text-gray-300" aria-hidden="true" />
                  )}
                  <span>
                    {s.name}
                    {!s.ready && <span className="text-gray-500"> · sin terminar (lo podrás configurar en «Mi perfil → Servicios»)</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Row>
          <Row icon={<CalendarClock className="h-5 w-5" aria-hidden="true" />} title="Tu horario">
            {summary.weeklyHours > 0 ? `${summary.weeklyHours} horas a la semana` : 'Sin horario'}
          </Row>
          <Row icon={<Users className="h-5 w-5" aria-hidden="true" />} title="Tu equipo">
            {summary.invitations > 0
              ? `${summary.invitations} ${summary.invitations === 1 ? 'invitación enviada' : 'invitaciones enviadas'}`
              : 'Sin invitaciones'}
          </Row>
        </ul>
        {ready.length === 0 && (
          <p role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Para activar tu cuenta, termina al menos un servicio (vuelve atrás con «Atrás»).
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      {pending.length === 0 ? (
        <>
          <CheckCircle2 className="h-12 w-12 text-emerald-700" aria-hidden="true" />
          <h1 className="mt-3 text-2xl font-bold leading-tight text-gray-900">¡Listo{firstName ? `, ${firstName}` : ''}!</h1>
          <p className="mt-2 text-lg text-gray-800">Ya apareces a los clientes{summary.zone ? ` (${summary.zone})` : ''}.</p>
        </>
      ) : (
        <>
          <AlertTriangle className="h-12 w-12 text-amber-600" aria-hidden="true" />
          <h1 className="mt-3 text-2xl font-bold leading-tight text-gray-900">Tu cuenta está casi lista</h1>
          <p className="mt-2 text-gray-700">Hemos activado lo que estaba completo. Para aparecer a los clientes te falta:</p>
          <ul className="mt-3 space-y-2">
            {pending.map((step) => (
              <li key={step.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="font-semibold text-gray-900">{step.title}</p>
                <p className="text-sm text-gray-700">{step.detail}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-gray-500">Para conseguir más reservas</h2>
      <div className="mt-3 space-y-3">
        <PushNotificationsCard />
        <ShareLinkButton providerId={providerId} />
        {!hasPhoto && (
          <button
            type="button"
            onClick={() => navigate('/account')}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 font-semibold text-gray-900 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
          >
            <Camera className="h-5 w-5" aria-hidden="true" /> Sube tu foto o tu logo
          </button>
        )}
      </div>
    </div>
  );
};

export default FinishStep;
