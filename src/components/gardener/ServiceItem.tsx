import React from 'react';
import { ChevronDown, ChevronUp, AlertCircle, CheckCircle2, Circle } from 'lucide-react';
import { Service } from '../../types';

interface ServiceItemProps {
  service: Service;
  isActive: boolean;
  isExpanded: boolean;
  hasError: boolean;
  onToggle: () => void;
  onExpand: () => void;
  children: React.ReactNode;
}

const ServiceItem: React.FC<ServiceItemProps> = ({
  service,
  isActive,
  isExpanded,
  hasError,
  onToggle,
  onExpand,
  children
}) => {
  return (
    <div 
      className={`border-2 rounded-xl transition-all duration-300 overflow-hidden ${
        hasError 
          ? 'border-red-300 bg-red-50 shadow-sm' 
          : isActive 
            ? 'border-green-500 bg-white shadow-md ring-1 ring-green-100' 
            : 'border-gray-200 bg-white hover:border-gray-300 opacity-90 hover:opacity-100'
      }`}
    >
      {/* Compact Card Header */}
      <div className={`flex items-center justify-between p-4 ${isActive ? 'bg-green-50/50' : ''}`}>
        <div className="flex items-center gap-4 flex-1">
          {/* Checkbox / Toggle */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              isActive 
                ? 'bg-green-500 border-green-500 text-white focus:ring-green-500' 
                : hasError
                  ? 'bg-white border-red-400 text-red-500 focus:ring-red-500'
                  : 'bg-white border-gray-300 text-transparent hover:border-gray-400 focus:ring-gray-400'
            }`}
            aria-label={`Activar servicio ${service.name}`}
          >
            {isActive && <CheckCircle2 className="w-4 h-4" />}
            {!isActive && hasError && <AlertCircle className="w-4 h-4" />}
          </button>

          {/* Service Name */}
          <div className="flex flex-col cursor-pointer" onClick={onExpand}>
            <span className={`font-bold text-base md:text-lg transition-colors ${
              isActive ? 'text-green-900' : 'text-gray-700'
            }`}>
              {service.name}
            </span>
            {/* Optional: Show status text */}
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

        {/* Expand/Collapse Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onExpand();
          }}
          className={`p-2 rounded-full transition-colors focus:outline-none ${
            isExpanded 
              ? 'bg-gray-100 text-gray-800' 
              : 'hover:bg-gray-100 text-gray-500'
          }`}
          aria-label={isExpanded ? "Ocultar configuración" : "Ver configuración"}
        >
          {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
      </div>

      {/* Accordion Content */}
      <div 
        className={`transition-all duration-300 ease-in-out border-t border-gray-100 bg-white ${
          isExpanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0 overflow-hidden'
        }`}
      >
        <div className="p-4 md:p-6">
           {/* If has error, show banner */}
           {hasError && (
             <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3 animate-in slide-in-from-top-2">
               <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
               <div>
                 <h4 className="font-semibold text-red-800 text-sm">No se puede activar el servicio</h4>
                 <p className="text-red-700 text-sm mt-1">
                   La configuración de precios está incompleta o contiene errores. 
                   Por favor, revisa los campos marcados y guarda los cambios para activar el servicio.
                 </p>
               </div>
             </div>
           )}
           
           {children}
        </div>
      </div>
    </div>
  );
};

export default ServiceItem;
