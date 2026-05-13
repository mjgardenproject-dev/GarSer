import React from 'react';
import { Settings, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Service } from '../../types';

interface ServiceItemProps {
  service: Service;
  isActive: boolean;
  hasError: boolean;
  onToggle: () => void;
  onConfigClick: () => void;
}

const ServiceItem: React.FC<ServiceItemProps> = ({
  service,
  isActive,
  hasError,
  onToggle,
  onConfigClick
}) => {
  return (
    <div 
      className={`border-2 rounded-xl transition-colors duration-300 overflow-hidden ${
        hasError 
          ? 'border-red-300 bg-red-50 shadow-sm' 
          : isActive 
            ? 'border-green-500 bg-white shadow-md ring-1 ring-green-100' 
            : 'border-gray-200 bg-white hover:border-gray-300 opacity-90 hover:opacity-100'
      }`}
    >
      <div className={`flex items-center justify-between p-4 ${isActive ? 'bg-green-50/50' : ''}`}>
        <div className="flex items-center gap-4 flex-1">
          {/* Checkbox / Toggle */}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggle();
            }}
            className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
              isActive 
                ? 'bg-green-500 border-green-500 text-white focus-visible:ring-green-500' 
                : hasError
                  ? 'bg-white border-red-400 text-red-500 focus-visible:ring-red-500'
                  : 'bg-white border-gray-300 text-transparent hover:border-gray-400 focus-visible:ring-gray-400'
            }`}
            aria-label={`Activar servicio ${service.name}`}
          >
            {isActive && <CheckCircle2 className="w-4 h-4" />}
            {!isActive && hasError && <AlertCircle className="w-4 h-4" />}
          </button>

          {/* Service Name */}
          <div className="flex flex-col">
            <span className={`font-bold text-base md:text-lg transition-colors ${
              isActive ? 'text-green-900' : 'text-gray-700'
            }`}>
              {service.name}
            </span>
            <span className={`text-xs font-medium ${
               hasError ? 'text-red-600' : (isActive ? 'text-green-600' : 'text-gray-400')
            }`}>
              {hasError 
                ? 'Configuración incompleta' 
                : isActive 
                  ? 'Activo' 
                  : 'Inactivo'}
            </span>
          </div>
        </div>

        {/* Configure Button */}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onConfigClick();
          }}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
          aria-label="Configurar servicio"
        >
          <Settings className="w-4 h-4" />
          <span className="hidden sm:inline">Configurar</span>
        </button>
      </div>
    </div>
  );
};

export default ServiceItem;
