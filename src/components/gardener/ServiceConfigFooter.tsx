import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Save, AlertTriangle, AlertCircle } from 'lucide-react';

interface ServiceConfigFooterProps {
  onSave: () => void;
  onReset: () => void;
  isDirty: boolean;
  isSaving?: boolean;
  resetTitle?: string;
  resetDescription?: string;
  hasErrors?: boolean;
}

const ServiceConfigFooter: React.FC<ServiceConfigFooterProps> = ({
  onSave,
  onReset,
  isDirty,
  isSaving = false,
  resetTitle = '¿Restablecer configuración?',
  resetDescription = 'Se eliminarán todas las tarifas configuradas. Esta acción es irreversible.',
  hasErrors = false
}) => {
  const [showResetModal, setShowResetModal] = useState(false);

  const confirmReset = () => {
    setShowResetModal(false);
    onReset();
  };

  return (
    <>
      <div className="sticky bottom-3 space-y-2 mt-6">
        {hasErrors && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-3 mb-3 shadow-sm animate-in fade-in slide-in-from-bottom-2">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-semibold text-red-800">Faltan campos obligatorios</h4>
              <p className="text-xs text-red-600 mt-1 leading-relaxed">
                Completa todas las casillas marcadas en rojo antes de guardar. 
                Recuerda que si un recargo o tarifa es gratuito, debes introducir un 0 explícitamente.
              </p>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={!isDirty || isSaving}
          className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors ${
            !isDirty || isSaving
              ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
              : 'bg-green-600 text-white hover:bg-green-700'
          }`}
        >
          <Save className="w-4 h-4" />
          {isSaving ? 'GUARDANDO...' : 'GUARDAR TARIFAS'}
        </button>
        <button
          type="button"
          onClick={() => setShowResetModal(true)}
          disabled={isSaving}
          className="w-full py-2.5 rounded-xl font-semibold text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
        >
          Restablecer
        </button>
      </div>

      {showResetModal &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 animate-in fade-in zoom-in duration-200 max-h-[90vh] overflow-y-auto">
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mb-4">
                  <AlertTriangle className="w-6 h-6 text-yellow-600" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2 text-center">{resetTitle}</h3>
                <p className="text-gray-500 text-center mb-6 text-sm">
                  {resetDescription}
                </p>
                <div className="flex flex-col gap-3 w-full">
                  <button
                    type="button"
                    onClick={confirmReset}
                    className="w-full bg-gradient-to-r from-red-600 to-red-700 text-white py-3 px-4 rounded-xl font-bold shadow-lg shadow-red-600/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center"
                  >
                    Confirmar
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowResetModal(false)}
                    className="w-full bg-gray-100 text-gray-700 py-3 px-4 rounded-xl font-bold hover:bg-gray-200 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export default ServiceConfigFooter;
