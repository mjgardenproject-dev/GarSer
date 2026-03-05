import React from 'react';
import { AlertTriangle, Save, X, RotateCcw } from 'lucide-react';
import { createPortal } from 'react-dom';

interface UnsavedChangesModalProps {
  isOpen: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
  serviceName: string;
}

const UnsavedChangesModal: React.FC<UnsavedChangesModalProps> = ({ 
  isOpen, 
  onSave, 
  onDiscard, 
  onCancel,
  serviceName
}) => {
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 transform transition-all scale-100">
        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mb-4">
            <AlertTriangle className="w-6 h-6 text-yellow-600" />
          </div>
          
          <h3 className="text-xl font-bold text-gray-900 mb-2">
            Tienes cambios sin guardar
          </h3>
          
          <p className="text-gray-500 mb-6 text-sm leading-relaxed">
            Estás a punto de cerrar la configuración de <strong>{serviceName}</strong>. 
            ¿Qué quieres hacer con los cambios que has realizado?
          </p>

          <div className="flex flex-col gap-3 w-full">
            {/* Primary Action: Save */}
            <button
              onClick={onSave}
              className="w-full bg-green-600 text-white py-3 px-4 rounded-xl font-bold shadow-lg shadow-green-600/20 hover:bg-green-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <Save className="w-5 h-5" />
              Guardar y continuar
            </button>

            {/* Destructive Action: Discard */}
            <button
              onClick={onDiscard}
              className="w-full bg-white text-red-600 border border-red-200 py-3 px-4 rounded-xl font-bold hover:bg-red-50 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-5 h-5" />
              Descartar cambios
            </button>

            {/* Cancel Action */}
            <button
              onClick={onCancel}
              className="w-full text-gray-500 py-2 px-4 rounded-xl font-medium hover:bg-gray-100 transition-colors flex items-center justify-center gap-2 mt-1"
            >
              <X className="w-5 h-5" />
              Seguir editando
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default UnsavedChangesModal;
