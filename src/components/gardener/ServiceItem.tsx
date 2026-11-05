import React from 'react';
import { Settings } from 'lucide-react';
import { Service } from '../../types';
import ServiceActivateButton from './ServiceActivateButton';
import { serviceActivationState } from '../../utils/serviceActivation';

interface ServiceItemProps {
  service: Service;
  isActive: boolean;
  hasError: boolean;
  /** Su configuración es válida: se puede activar. */
  canActivate: boolean;
  onToggle: () => void;
  onConfigClick: () => void;
}

// Una fila por servicio (2026-11-05): nombre + qué le falta, el botón «Activar» (tres estados) y el
// engranaje para configurar el precio. Antes la activación era un círculo vacío sin texto: nada decía
// que primero se pone el precio (engranaje) y después se activa, y tocarlo sin precio daba un error.
const ServiceItem: React.FC<ServiceItemProps> = ({
  service,
  isActive,
  hasError,
  canActivate,
  onToggle,
  onConfigClick
}) => {
  const state = serviceActivationState(isActive, canActivate);
  const hint = hasError
    ? 'Configuración incompleta'
    : state === 'active'
      ? 'Activado: los clientes pueden reservarlo'
      : state === 'ready'
        ? 'Configurado. Falta activarlo'
        : 'Primero configura tu precio con el engranaje';

  return (
    <div
      className={`border-2 rounded-xl transition-colors duration-300 overflow-hidden ${
        hasError
          ? 'border-red-300 bg-red-50 shadow-sm'
          : isActive
            ? 'border-green-500 bg-white shadow-md ring-1 ring-green-100'
            : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      {/* Dos filas, para que en el móvil el nombre no quede en una columna estrecha:
          arriba el nombre y el engranaje; debajo, qué le falta y el botón «Activar». */}
      <div className={`space-y-3 p-4 ${isActive ? 'bg-green-50/50' : ''}`}>
        <div className="flex items-start justify-between gap-3">
          <span className={`min-w-0 flex-1 pt-2 font-bold text-base md:text-lg transition-colors ${isActive ? 'text-green-900' : 'text-gray-700'}`}>
            {service.name}
          </span>

          {/* Configure Button */}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onConfigClick();
            }}
            className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 [touch-action:manipulation]"
            aria-label={`Configurar el precio de ${service.name}`}
          >
            <Settings className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline">Configurar</span>
          </button>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className={`min-w-0 flex-1 text-sm leading-snug ${hasError ? 'text-red-600' : state === 'active' ? 'text-green-700' : 'text-gray-500'}`}>
            {hint}
          </span>
          <ServiceActivateButton state={state} serviceName={service.name} onClick={onToggle} />
        </div>
      </div>
    </div>
  );
};

export default ServiceItem;
