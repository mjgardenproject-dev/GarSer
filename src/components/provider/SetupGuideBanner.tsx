import React, { useMemo, useRef } from 'react';
import { ArrowRight, CheckCircle2, ListChecks } from 'lucide-react';
import { useProviderSetupStatus } from '../../hooks/useProviderSetupStatus';
import { buildProviderSetupSteps, type SetupStepId } from '../../shared/providerSetup';

/**
 * Franja «Paso X de N» al llegar a una pantalla desde «Completa tu cuenta» (2026-11-05). Quien entra a
 * Servicios, Zona u Horario con la cuenta a medias ve ARRIBA en qué paso está, qué tiene que hacer ahí
 * y, al terminarlo, un botón «Siguiente paso». Se actualiza sola al guardar (SETUP_CHANGED_EVENT).
 * Sin nada obligatorio pendiente (o en un paso que no es de esta pantalla), no sale.
 *
 * `onBack` vuelve al panel, donde la guía ya señala el paso que toca ahora.
 */
interface Props {
  stepId: Extract<SetupStepId, 'services' | 'coverage' | 'schedule'>;
  onBack: () => void;
  className?: string;
}

const SetupGuideBanner: React.FC<Props> = ({ stepId, onBack, className = '' }) => {
  const { status } = useProviderSetupStatus();
  const summary = useMemo(() => (status ? buildProviderSetupSteps(status) : null), [status]);
  // ¿Se ha estado guiando en esta visita? Si el último paso obligatorio se acaba de completar aquí, se
  // celebra en vez de desaparecer sin más.
  const wasGuiding = useRef(false);

  if (!status || !summary || summary.suspended) return null;
  if (summary.allRequiredDone) {
    if (!wasGuiding.current) return null;
    return (
      <section role="status" aria-label="Primeros pasos" className={`rounded-xl border border-emerald-200 bg-emerald-50 p-4 ${className}`}>
        <p className="flex items-start gap-2 font-semibold text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
          <span>¡Todo listo! Ya has completado los pasos obligatorios.</span>
        </p>
        <button
          type="button"
          onClick={onBack}
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 [touch-action:manipulation]"
        >
          Volver al panel <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </section>
    );
  }
  // El horario de una empresa es el de su equipo: no se guía desde esta pantalla.
  if (stepId === 'schedule' && status.provider_kind === 'company') return null;
  const index = summary.required.findIndex((step) => step.id === stepId);
  if (index === -1) return null;
  const step = summary.required[index];
  wasGuiding.current = true;
  const position = `Paso ${index + 1} de ${summary.required.length}`;

  if (step.state === 'done') {
    const next = summary.nextStep;
    return (
      <section role="status" aria-label="Primeros pasos" className={`rounded-xl border border-emerald-200 bg-emerald-50 p-4 ${className}`}>
        <p className="flex items-start gap-2 font-semibold text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
          <span>¡Hecho! {step.title} está completo.</span>
        </p>
        {next && (
          <button
            type="button"
            onClick={onBack}
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 [touch-action:manipulation]"
          >
            Siguiente paso: {next.title} <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </section>
    );
  }

  return (
    <section aria-label="Primeros pasos" className={`rounded-xl border border-emerald-200 bg-emerald-50 p-4 ${className}`}>
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-700">
        <ListChecks className="h-4 w-4" aria-hidden="true" /> Primeros pasos · {position}
      </p>
      <p className="mt-1 font-semibold text-gray-900">{step.title}</p>
      {step.howTo && step.howTo.length > 0 && (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-800 marker:font-bold marker:text-emerald-700">
          {step.howTo.map((action) => <li key={action}>{action}</li>)}
        </ol>
      )}
      <button
        type="button"
        onClick={onBack}
        className="mt-2 inline-flex min-h-11 items-center rounded text-sm font-semibold text-emerald-800 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [touch-action:manipulation]"
      >
        Volver a los primeros pasos
      </button>
    </section>
  );
};

export default SetupGuideBanner;
