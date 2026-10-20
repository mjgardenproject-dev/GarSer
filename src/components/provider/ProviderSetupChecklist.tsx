import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Ban, CheckCircle2, ChevronDown, Circle, Clock, Lock, Share2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useProviderSetupStatus } from '../../hooks/useProviderSetupStatus';
import {
  buildProviderSetupSteps,
  providerBookingLink,
  type ProviderSetupSummary,
  type SetupStep,
  type SetupStepState,
  type SetupTarget,
} from '../../shared/providerSetup';

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

/** La lista de pasos. Sin `onNavigate` (el admin) no lleva botones. */
export const SetupStepList: React.FC<{
  steps: SetupStep[];
  nextStepId?: string | null;
  onNavigate?: (target: SetupTarget) => void;
  label: string;
}> = ({ steps, nextStepId, onNavigate, label }) => (
  <ol className="space-y-1" aria-label={label}>
    {steps.map((step) => {
      const isNext = step.id === nextStepId;
      const showCta = Boolean(onNavigate && step.cta && step.state !== 'done' && step.state !== 'blocked');
      return (
        <li
          key={step.id}
          className={`flex gap-3 rounded-xl px-3 py-3 ${isNext ? 'bg-emerald-50 ring-1 ring-emerald-200' : ''}`}
          aria-current={isNext ? 'step' : undefined}
        >
          <StateIcon state={step.state} />
          <div className="min-w-0 flex-1">
            <p className={`font-semibold ${step.state === 'done' || step.state === 'blocked' ? 'text-gray-500' : 'text-gray-900'}`}>
              {step.title}
            </p>
            <p className="mt-0.5 text-sm text-gray-600">{step.detail}</p>
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
          </div>
        </li>
      );
    })}
  </ol>
);

const ShareLink: React.FC<{ providerId: string; feeWaiver: boolean }> = ({ providerId, feeWaiver }) => {
  const share = async () => {
    const url = providerBookingLink(window.location.origin, providerId);
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
        {feeWaiver ? 'Tus clientes reservan contigo sin gastos de gestión.' : 'Tus clientes reservan directamente contigo.'}
      </p>
      <button
        type="button"
        onClick={() => void share()}
        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-900 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 [touch-action:manipulation]"
      >
        <Share2 className="h-4 w-4" aria-hidden="true" /> Compartir enlace
      </button>
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

const ProviderSetupChecklist: React.FC<{ onNavigate: (target: SetupTarget) => void; className?: string }> = ({
  onNavigate,
  className = '',
}) => {
  const { status, loading, error, refresh } = useProviderSetupStatus();
  const summary = useMemo(() => (status ? buildProviderSetupSteps(status) : null), [status]);
  const [dismissed, setDismissed] = useState(false);
  const [extrasOpen, setExtrasOpen] = useState(false);

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
        {summary.share.show && <ShareLink providerId={status.provider_id} feeWaiver={summary.share.feeWaiver} />}
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
          label="Pasos para aparecer a los clientes"
        />
      </div>

      {summary.share.show && <ShareLink providerId={status.provider_id} feeWaiver={summary.share.feeWaiver} />}

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
