import React from 'react';
import { Check, Cloud, Loader2, AlertCircle } from 'lucide-react';
import { SaveStatus } from '../../hooks/useAutoSave';

interface SaveStatusIndicatorProps {
  status: SaveStatus;
  className?: string;
}

const SaveStatusIndicator: React.FC<SaveStatusIndicatorProps> = ({ status, className = "" }) => {
  if (status === 'idle') return null;

  return (
    <div className={`flex items-center gap-1.5 text-xs font-medium transition-all duration-300 ${className}`}>
      {status === 'saving' && (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
          <span className="text-gray-500">Guardando...</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <div className="flex items-center justify-center w-3.5 h-3.5 rounded-full bg-green-100">
            <Check className="w-2.5 h-2.5 text-green-600" />
          </div>
          <span className="text-green-600">Guardado</span>
        </>
      )}
      {status === 'error' && (
        <>
          <AlertCircle className="w-3.5 h-3.5 text-red-500" />
          <span className="text-red-600">Error al guardar</span>
        </>
      )}
    </div>
  );
};

export default SaveStatusIndicator;
