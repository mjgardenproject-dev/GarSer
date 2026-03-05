import React from 'react';
import { Check, Trash2, Loader2 } from 'lucide-react';

interface ServiceConfigFooterProps {
  onSave: () => void;
  onReset: () => void;
  isDirty: boolean;
  isValid?: boolean; // Optional, can be handled inside onSave too, but good for disabling
  isSaving?: boolean;
}

const ServiceConfigFooter: React.FC<ServiceConfigFooterProps> = ({
  onSave,
  onReset,
  isDirty,
  isSaving = false
}) => {
  return (
    <div className="mt-8 space-y-4 pt-6 border-t border-gray-100">
      {/* Save Button - Only visible if dirty */}
      {isDirty && (
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium shadow-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {isSaving ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Check className="w-5 h-5" />
          )}
          {isSaving ? 'Guardando...' : 'Guardar tarifas'}
        </button>
      )}

      {/* Reset Button - Always visible */}
      <button
        type="button"
        onClick={onReset}
        disabled={isSaving}
        className="w-full py-3 px-4 bg-white border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
      >
        <Trash2 className="w-4 h-4" />
        Restablecer tarifas
      </button>
    </div>
  );
};

export default ServiceConfigFooter;
