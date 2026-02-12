import React, { useState, useEffect } from 'react';
import { Info, AlertTriangle } from 'lucide-react';

export interface StandardPricingConfig {
  condition_surcharges: {
      descuidado: number;
      muy_descuidado: number;
  };
  waste_removal: {
      percentage: number;
  };
}

const EMPTY_CONFIG: StandardPricingConfig = {
  condition_surcharges: { descuidado: 20, muy_descuidado: 50 },
  waste_removal: { percentage: 0 }
};

interface StandardServiceConfigProps {
  value?: StandardPricingConfig;
  onChange: (config: StandardPricingConfig) => void;
  onSave: (config: StandardPricingConfig) => Promise<void>;
}

const StandardServiceConfig: React.FC<StandardServiceConfigProps> = ({ value, onChange, onSave }) => {
  const [config, setConfig] = useState<StandardPricingConfig>(value || EMPTY_CONFIG);
  const [isSaving, setIsSaving] = useState(false);
  const [showGlobalInfo, setShowGlobalInfo] = useState(false);

  // Sync with prop value
  useEffect(() => {
    if (value) {
      setConfig(value);
    }
  }, [value]);

  const handleChange = (newConfig: StandardPricingConfig) => {
    setConfig(newConfig);
    onChange(newConfig);
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      await onSave(config);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header with Info */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 text-sm">
                Configuración de Recargos
            </h3>
            <div className="relative">
                <button 
                    type="button"
                    onClick={() => setShowGlobalInfo(!showGlobalInfo)}
                    className="text-gray-400 hover:text-blue-500 transition-colors"
                >
                    <Info className="w-4 h-4" />
                </button>
                {showGlobalInfo && (
                    <>
                        <div className="fixed inset-0 z-40 bg-black/20 md:hidden" onClick={() => setShowGlobalInfo(false)} />
                        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90vw] max-w-xs p-6 bg-white rounded-xl shadow-xl border border-gray-100 text-sm text-gray-600 md:absolute md:top-8 md:left-0 md:translate-x-0 md:translate-y-0 md:w-64 md:p-4 md:shadow-lg md:border-blue-100 md:rounded-lg">
                            <p>Define los porcentajes de incremento sobre el precio base según el estado del jardín y si se incluye la retirada de restos.</p>
                        </div>
                    </>
                )}
            </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 1. Recargos por Estado */}
        <div>
          <h4 className="font-bold text-gray-800 text-xs uppercase tracking-wide mb-3">Estado del Jardín</h4>
          <div className="space-y-3 bg-gray-50 p-4 rounded-lg border border-gray-100">
            
            <div className="flex items-center justify-between">
              <span className="text-gray-700 text-sm font-medium">Descuidado</span>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 text-sm font-medium">+</span>
                <input
                  type="number"
                  min="0"
                  max="500"
                  className="w-16 h-9 px-2 border border-gray-300 rounded-lg text-right text-sm focus:ring-2 focus:ring-green-500"
                  value={config.condition_surcharges.descuidado}
                  onChange={(e) => handleChange({
                    ...config,
                    condition_surcharges: {
                        ...config.condition_surcharges,
                        descuidado: Number(e.target.value)
                    }
                  })}
                />
                <span className="text-gray-500 text-sm font-medium w-4">%</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-gray-700 text-sm font-medium">Muy Descuidado</span>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 text-sm font-medium">+</span>
                <input
                  type="number"
                  min="0"
                  max="500"
                  className="w-16 h-9 px-2 border border-gray-300 rounded-lg text-right text-sm focus:ring-2 focus:ring-green-500"
                  value={config.condition_surcharges.muy_descuidado}
                  onChange={(e) => handleChange({
                    ...config,
                    condition_surcharges: {
                        ...config.condition_surcharges,
                        muy_descuidado: Number(e.target.value)
                    }
                  })}
                />
                <span className="text-gray-500 text-sm font-medium w-4">%</span>
              </div>
            </div>

          </div>
        </div>

        {/* 2. Retirada de Restos */}
        <div>
          <h4 className="font-bold text-gray-800 text-xs uppercase tracking-wide mb-3">Retirada de Restos</h4>
          <div className="space-y-3 bg-gray-50 p-4 rounded-lg border border-gray-100 h-full">
            <div className="flex items-center justify-between h-full">
              <div className="pr-2">
                <span className="text-gray-700 text-sm font-medium block">Recargo por retirada</span>
                <p className="text-xs text-gray-500 mt-1">Se aplica si el cliente lo solicita.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 text-sm font-medium">+</span>
                <input
                  type="number"
                  min="0"
                  max="500"
                  className="w-16 h-9 px-2 border border-gray-300 rounded-lg text-right text-sm focus:ring-2 focus:ring-green-500"
                  value={config.waste_removal.percentage}
                  onChange={(e) => handleChange({
                    ...config,
                    waste_removal: {
                        percentage: Number(e.target.value)
                    }
                  })}
                />
                <span className="text-gray-500 text-sm font-medium w-4">%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end pt-4 border-t border-gray-100">
        <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg shadow-sm disabled:opacity-50 transition-colors font-medium text-sm"
        >
            {isSaving ? (
                <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                    Guardando...
                </>
            ) : (
                'Guardar configuración'
            )}
        </button>
      </div>
    </div>
  );
};

export default StandardServiceConfig;
