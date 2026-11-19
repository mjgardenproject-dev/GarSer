import React from 'react';
import { Check, ShieldCheck } from 'lucide-react';
import { ACTIVATION_SERVICES, type ActivationServiceName } from '../../activation/serviceCatalog';

// Paso 2 del cuestionario: «¿Qué servicios hace tu empresa?». Se marcan varios; después hay un sub-paso
// de tarifas por cada uno. Salen marcados los del alta y los que ya tenía configurados.

interface Props {
  isCompany: boolean;
  selected: readonly ActivationServiceName[];
  onToggle: (name: ActivationServiceName) => void;
}

const ServicesStep: React.FC<Props> = ({ isCompany, selected, onToggle }) => (
  <div>
    <h1 className="text-2xl font-bold leading-tight text-gray-900">
      ¿Qué servicios hace {isCompany ? 'tu empresa' : 'tu negocio'}?
    </h1>
    <p className="mt-2 text-gray-700">Marca todos los que ofreces. Después te preguntamos cuánto cobras por cada uno.</p>
    <ul className="mt-5 space-y-2">
      {ACTIVATION_SERVICES.map((service) => {
        const checked = selected.includes(service.name);
        return (
          <li key={service.name}>
            <button
              type="button"
              role="checkbox"
              aria-checked={checked}
              onClick={() => onToggle(service.name)}
              className={`flex min-h-16 w-full items-center gap-3 rounded-2xl border-2 p-3 text-left [touch-action:manipulation] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                checked ? 'border-emerald-700 bg-emerald-50' : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 ${
                  checked ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-gray-300 bg-white'
                }`}
                aria-hidden="true"
              >
                {checked && <Check className="h-4 w-4" strokeWidth={3} />}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-gray-900">{service.name}</span>
                <span className="block text-sm text-gray-600">{service.blurb}</span>
                {service.needsLicense && (
                  <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-amber-800">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Necesita carnet de aplicador
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  </div>
);

export default ServicesStep;
