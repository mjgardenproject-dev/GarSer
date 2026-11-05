import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Ban, CheckCircle2, ChevronDown, Circle, Clock, Lock, Megaphone, Share2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useProviderSetupStatus } from '../../hooks/useProviderSetupStatus';
import { useMyBookingLink } from '../../hooks/useMyBookingLink';
import { usePublicBillingTerms } from '../../hooks/usePublicBillingTerms';
import { ownClientsLine } from '../../config/billingCopy';
import {
  buildProviderSetupSteps,
  providerBookingLink,
  type ProviderSetupSummary,
  type SetupStep,
  type SetupStepService,
  type SetupStepState,
  type SetupTarget,
} from '../../shared/providerSetup';
import ServiceActivateButton from '../gardener/ServiceActivateButton';
import { setServiceActive } from '../../utils/serviceActivation';

// Completar la cuenta profesional (2026-10-20): lo que le falta a un jardinero o a una empresa para
// aparecer a los clientes, calculado en el servidor con las mismas reglas que «Profesionales». Con
// todo lo obligatorio hecho se reduce a una tarjeta pequeña que se puede cerrar; si algo deja de
// estar bien (carnet caducado, agenda vacía…), vuelve sola.

const DISMISS_PREFIX = 'garser:provider-setup:dismissed:';

function readDismissed(providerId: string): boolean {
  try {
    return localStorage.getItem(DISMISS_PREFIX + providerId) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(providerId: string, value: boolean) {
  try {
    if (value) localStorage.setItem(DISMISS_PREFIX + providerId, '1');
    else localStorage.removeItem(DISMISS_PREFIX + providerId);
  } catch {
    // Sin almacenamiento (navegación privada): simplemente no se recuerda que la cerró.
  }
}

const STATE_LABEL: Record<SetupStepState, string> = {
  done: 'Hecho',
  todo: 'Pendiente',
  review: 'En revisión',
  warning: 'Necesita atención',
  blocked: 'Falta un paso anterior',
};

const StateIcon: React.FC<{ state: SetupStepState }> = ({ state }) => {
  const common = 'mt-0.5 h-5 w-5 shrink-0';
  const icon = {
    done: <CheckCircle2 className={`${common} text-emerald-600`} aria-hidden="true" />,
    todo: <Circle className={`${common} text-gray-300`} aria-hidden="true" />,
    review: <Clock className={`${common} text-blue-600`} aria-hidden="true" />,
    warning: <AlertTriangle className={`${common} text-amber-600`} aria-hidden="true" />,
    blocked: <Lock className={`${common} text-gray-300`} aria-hidden="true" />,
  }[state];
  return (
    <>
      {icon}
      <span className="sr-only">{STATE_LABEL[state]}: </span>
    </>
  );
};

/**
 * La lista de pasos. Sin `onNavigate` (el admin) no lleva botones.
 *
 * `guided` (el panel del profesional, 2026-11-05): UN paso a la vez. El que toca ahora va abierto, con
 * «Qué tienes que hacer» en pasos numerados; los demás pendientes quedan en una línea («Ver cómo») y los
 * hechos, discretos. Antes estaban todos abiertos a la vez, cada uno con su párrafo y su botón.
 */
export const SetupStepList: React.FC<{
  steps: SetupStep[];
  nextStepId?: string | null;
  onNavigate?: (target: SetupTarget) => void;
  /** Activar o desactivar un servicio desde el propio paso. Sin él (el admin), no hay botones. */
  onActivateService?: (service: SetupStepService) => void;
  busyServiceId?: string | null;
  guided?: boolean;
  label: string;
}> = ({ steps, nextStepId, onNavigate, onActivateService, busyServiceId = null, guided = false, label }) => {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <ol className="space-y-1" aria-label={label}>
      {steps.map((step, index) => {
        const isNext = step.id === nextStepId;
        const pending = step.state === 'todo' || step.state === 'warning';
        const collapsed = guided && pending && !isNext && openId !== step.id;
        const showCta = Boolean(onNavigate && step.cta && step.state !== 'done' && step.state !== 'blocked');

        if (collapsed) {
          return (
            <li key={step.id} className="flex items-center gap-3 rounded-xl px-3 py-1">
              <StateIcon state={step.state} />
              <p className="min-w-0 flex-1 font-semibold text-gray-900">{step.title}</p>
              <button
                type="button"
                onClick={() => setOpenId(step.id)}
                aria-expanded={false}
                aria-label={`Ver cómo hacer: ${step.title}`}
                className="inline-flex min-h-11 shrink-0 items-center rounded text-sm font-semibold text-emerald-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 [touch-action:manipulation]"
              >
                Ver cómo
              </button>
            </li>
          );
        }

        // Un paso hecho, en guiado: dos líneas (título + resumen en una), para que el que toca ahora
        // quede a la vista sin tener que bajar por todo lo ya completado.
        if (guided && step.state === 'done') {
          return (
            <li key={step.id} className="flex gap-3 rounded-xl px-3 py-1.5">
              <StateIcon state={step.state} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-500">{step.title}</p>
                <p className="truncate text-sm text-gray-500" title={step.detail}>{step.detail}</p>
              </div>
            </li>
          );
        }

        return (
          <li
            key={step.id}
            className={`flex gap-3 rounded-xl px-3 py-3 ${isNext ? 'bg-emerald-50 ring-1 ring-emerald-200' : ''}`}
            aria-current={isNext ? 'step' : undefined}
          >
            <StateIcon state={step.state} />
            <div className="min-w-0 flex-1">
              {guided && isNext && (
                <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Paso {index + 1} de {steps.length} · ahora</p>
              )}
              <p className={`font-semibold ${step.state === 'done' || step.state === 'blocked' ? 'text-gray-500' : 'text-gray-900'}`}>
                {step.title}
              </p>
              <p className="mt-0.5 text-sm text-gray-600">{step.detail}</p>
              {guided && pending && step.howTo && step.howTo.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Qué tienes que hacer</p>
                  <ol className="mt-1.5 list-decimal space-y-1.5 pl-5 text-sm text-gray-800 marker:font-bold marker:text-emerald-700">
                    {step.howTo.map((action) => <li key={action}>{action}</li>)}
                  </ol>
                </div>
              )}
              {onActivateService && step.services && step.services.length > 0 && (
                <ul className="mt-3 space-y-2" aria-label="Tus servicios">
                  {step.services.map((service) => (
                    <li key={service.id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2">
                      <span className="min-w-0 flex-1 text-sm font-medium text-gray-900">{service.name}</span>
                      <ServiceActivateButton
                        state={service.state}
                        serviceName={service.name}
                        busy={busyServiceId === service.id}
                        onClick={() => onActivateService(service)}
                      />
                    </li>
                  ))}
                </ul>
              )}
              {showCta && step.cta && (
                isNext ? (
                  <button
                    type="button"
                    onClick={() => onNavigate?.(step.cta!.target)}
                    className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 [touch-action:manipulation]"
                  >
                    {step.cta.label}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onNavigate?.(step.cta!.target)}
                    className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-emerald-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded [touch-action:manipulation]"
                  >
                    {step.cta.label}
                  </button>
                )
              )}
              {guided && pending && !isNext && openId === step.id && (
                <button
                  type="button"
                  onClick={() => setOpenId(null)}
                  aria-expanded
                  className="mt-1 inline-flex min-h-11 items-center rounded text-sm font-semibold text-gray-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 [touch-action:manipulation]"
                >
                  Ocultar
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
};

const ShareLink: React.FC<{ providerId: string; onMarketing: () => void }> = ({ providerId, onMarketing }) => {
  // Qué decirle sobre los gastos de gestión de sus clientes sale de los ajustes vigentes.
  const billingTerms = usePublicBillingTerms();
  // El enlace lleva la clave personal del profesional: hasta que se tiene, no se puede compartir.
  const { state: link } = useMyBookingLink(true);
  const share = async () => {
    if (link.status !== 'ready') return;
    const url = providerBookingLink(window.location.origin, providerId, link.code);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Reserva conmigo en GarSer', url });
        return;
      } catch (error) {
        // Cerrar el menú de compartir no es un error; cualquier otro fallo, se copia el enlace.
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
    <div className="mt-4 flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-gray-700">
        <span className="font-semibold text-gray-900">Comparte tu enlace de reserva.</span>{' '}
        {ownClientsLine(billingTerms)}
      </p>
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => void share()}
          disabled={link.status !== 'ready'}
          className="disabled:cursor-not-allowed disabled:opacity-60 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-900 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 [touch-action:manipulation]"
        >
          <Share2 className="h-4 w-4" aria-hidden="true" /> Compartir enlace
        </button>
        {/* Marketing: el flyer, tarjetas, vinilo… todo con su QR. */}
        <button
          type="button"
          onClick={onMarketing}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 [touch-action:manipulation]"
        >
          <Megaphone className="h-4 w-4" aria-hidden="true" /> Crear mi flyer
        </button>
      </div>
    </div>
  );
};

const HEADLINE_STYLE: Record<ProviderSetupSummary['headline']['tone'], { icon: React.ReactNode; title: string }> = {
  danger: { icon: <Ban className="h-6 w-6 shrink-0 text-red-600" aria-hidden="true" />, title: 'text-red-800' },
  warning: { icon: <AlertTriangle className="h-6 w-6 shrink-0 text-amber-600" aria-hidden="true" />, title: 'text-gray-900' },
  info: { icon: <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" aria-hidden="true" />, title: 'text-gray-900' },
  success: { icon: <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" aria-hidden="true" />, title: 'text-emerald-900' },
};

const Extras: React.FC<{
  steps: SetupStep[];
  open: boolean;
  onToggle: () => void;
  onNavigate: (target: SetupTarget) => void;
  pending: number;
}> = ({ steps, open, onToggle, onNavigate, pending }) => (
  <div className="mt-4 border-t border-gray-100 pt-3">
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg text-left text-sm font-semibold text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
    >
      <span>
        Para conseguir más reservas
        <span className="ml-1 font-normal text-gray-500">({pending === 0 ? 'todo hecho' : `${pending} ${pending === 1 ? 'pendiente' : 'pendientes'}`})</span>
      </span>
      <ChevronDown className={`h-5 w-5 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
    </button>
    {open && <SetupStepList steps={steps} onNavigate={onNavigate} label="Pasos recomendados" />}
  </div>
);

const ProviderSetupChecklist: React.FC<{
  onNavigate: (target: SetupTarget) => void;
  className?: string;
  /** El estado ya cargado por quien la monta (el panel lo comparte para decidir el orden). Sin él, lo pide ella. */
  setup?: ReturnType<typeof useProviderSetupStatus>;
}> = ({
  onNavigate,
  className = '',
  setup,
}) => {
  const own = useProviderSetupStatus({ enabled: !setup });
  const { status, loading, error, refresh } = setup ?? own;
  const summary = useMemo(() => (status ? buildProviderSetupSteps(status) : null), [status]);
  const [dismissed, setDismissed] = useState(false);
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [busyServiceId, setBusyServiceId] = useState<string | null>(null);

  // Activar/desactivar un servicio sin salir de la ayuda. Si todavía no se puede (falta el precio),
  // no se hace nada a medias: se explica y se lleva a configurarlo.
  const handleService = async (service: SetupStepService) => {
    if (!status) return;
    if (service.state === 'locked') {
      toast(`Primero configura el precio de ${service.name}.`, { icon: 'ℹ️' });
      onNavigate({ kind: 'profile', tab: 'services' });
      return;
    }
    const activate = service.state !== 'active';
    setBusyServiceId(service.id);
    try {
      await setServiceActive(status.provider_id, service.id, activate);
      toast.success(`${service.name} ${activate ? 'activado' : 'desactivado'}`);
      await refresh();
    } catch (activationError) {
      console.error('No se ha podido cambiar el servicio:', activationError);
      toast.error('No se ha podido cambiar el servicio. Inténtalo de nuevo.');
    } finally {
      setBusyServiceId(null);
    }
  };

  // Cerrada solo mientras lo obligatorio siga hecho. Si algo se rompe, se olvida que la cerró.
  useEffect(() => {
    if (!status || !summary) return;
    if (summary.allRequiredDone) {
      setDismissed(readDismissed(status.provider_id));
    } else {
      writeDismissed(status.provider_id, false);
      setDismissed(false);
    }
  }, [status, summary]);

  if (!status || !summary) {
    if (loading) {
      return (
        <div className={`rounded-2xl border border-gray-200 bg-white p-4 sm:p-6 ${className}`} aria-busy="true" aria-label="Comprobando tu cuenta">
          <div className="h-4 w-40 animate-pulse rounded bg-gray-100" />
          <div className="mt-3 h-6 w-3/4 animate-pulse rounded bg-gray-100" />
          <div className="mt-4 h-2 w-full animate-pulse rounded-full bg-gray-100" />
        </div>
      );
    }
    if (error) {
      return (
        <div className={`rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700 ${className}`} role="status">
          No hemos podido comprobar si apareces a los clientes.{' '}
          <button type="button" onClick={() => void refresh()} className="font-semibold text-emerald-700 underline">
            Reintentar
          </button>
        </div>
      );
    }
    return null;
  }

  const recommendedPending = summary.recommended.filter((s) => s.state !== 'done').length;
  const headline = HEADLINE_STYLE[summary.headline.tone];

  if (summary.allRequiredDone) {
    if (dismissed) return null;
    return (
      <section aria-labelledby="provider-setup-title" className={`rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-6 ${className}`}>
        <div className="flex items-start gap-3">
          {headline.icon}
          <div className="min-w-0 flex-1">
            <h2 id="provider-setup-title" className={`text-lg font-bold ${headline.title}`}>{summary.headline.title}</h2>
            <p className="mt-0.5 text-sm text-emerald-900">{summary.headline.detail}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              writeDismissed(status.provider_id, true);
              setDismissed(true);
            }}
            aria-label="Cerrar"
            className="-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-emerald-900 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {summary.share.show && <ShareLink providerId={status.provider_id} onMarketing={() => onNavigate({ kind: 'marketing' })} />}
        {recommendedPending > 0 && (
          <Extras steps={summary.recommended} open={extrasOpen} onToggle={() => setExtrasOpen((v) => !v)} onNavigate={onNavigate} pending={recommendedPending} />
        )}
      </section>
    );
  }

  const percent = summary.requiredTotal > 0 ? Math.round((summary.requiredDone / summary.requiredTotal) * 100) : 0;

  return (
    <section aria-labelledby="provider-setup-title" className={`rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6 ${className}`}>
      <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Completa tu cuenta profesional</p>
      <div className="mt-2 flex items-start gap-3">
        {headline.icon}
        <div className="min-w-0">
          <h2 id="provider-setup-title" className={`text-lg font-bold ${headline.title}`}>{summary.headline.title}</h2>
          <p className="mt-0.5 text-sm text-gray-600">{summary.headline.detail}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <div
          role="progressbar"
          aria-label="Pasos para aparecer a los clientes"
          aria-valuemin={0}
          aria-valuemax={summary.requiredTotal}
          aria-valuenow={summary.requiredDone}
          className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100"
        >
          <div className="h-full rounded-full bg-emerald-600 transition-[width] duration-500" style={{ width: `${percent}%` }} />
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-700">
          {summary.requiredDone} de {summary.requiredTotal}
        </span>
      </div>

      <div className="mt-3 -mx-3">
        <SetupStepList
          steps={summary.required}
          nextStepId={summary.nextStep?.id}
          onNavigate={onNavigate}
          onActivateService={(service) => void handleService(service)}
          busyServiceId={busyServiceId}
          guided
          label="Pasos para aparecer a los clientes"
        />
      </div>

      {summary.share.show && <ShareLink providerId={status.provider_id} onMarketing={() => onNavigate({ kind: 'marketing' })} />}

      <Extras
        steps={summary.recommended}
        open={extrasOpen}
        onToggle={() => setExtrasOpen((v) => !v)}
        onNavigate={onNavigate}
        pending={recommendedPending}
      />
    </section>
  );
};

export default ProviderSetupChecklist;
