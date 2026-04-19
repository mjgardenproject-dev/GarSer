import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Info, AlertCircle, AlertTriangle, Trash2 } from 'lucide-react';
import { deepEqual } from '../../utils/deepEqual';
import ServiceConfigFooter from './ServiceConfigFooter';

export type ShrubSize = 'pequeñas' | 'medianas' | 'grandes';

export interface ShrubPricingConfig {
  prices_per_m2: {
    pequeñas: number;
    medianas: number;
    grandes: number;
  };
  waste_removal: {
    percentage: number;
  };
  minimum_price: number;
}

const EMPTY_CONFIG: ShrubPricingConfig = {
  prices_per_m2: { pequeñas: 0, medianas: 0, grandes: 0 },
  waste_removal: { percentage: 0 },
  minimum_price: 0
};

interface Props {
  value?: ShrubPricingConfig;
  initialConfig?: ShrubPricingConfig;
  onChange: (config: ShrubPricingConfig) => void;
  onSave?: (config: ShrubPricingConfig) => Promise<void>;
}

const ShrubPricingConfigurator: React.FC<Props> = ({ value, initialConfig, onChange, onSave }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [showGlobalInfo, setShowGlobalInfo] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showGlobalError, setShowGlobalError] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);

  // Initialize config safely (handling legacy configs)
  const config = React.useMemo(() => {
    if (!value) return EMPTY_CONFIG;
    
    // Check if it's a legacy config (has species_prices instead of prices_per_m2)
    const isLegacy = !value.prices_per_m2 && ('species_prices' in value);
    
    if (isLegacy) {
      return {
        ...EMPTY_CONFIG,
        waste_removal: value.waste_removal || EMPTY_CONFIG.waste_removal,
        minimum_price: value.minimum_price || EMPTY_CONFIG.minimum_price
      };
    }

    return {
      ...EMPTY_CONFIG,
      ...value,
      prices_per_m2: { ...EMPTY_CONFIG.prices_per_m2, ...(value.prices_per_m2 || {}) },
      waste_removal: { ...EMPTY_CONFIG.waste_removal, ...(value.waste_removal || {}) }
    };
  }, [value]);

  // Determine if dirty
  const isDirty = useMemo(() => {
    const baseToCompare = initialConfig || EMPTY_CONFIG;
    const isLegacyBase = !baseToCompare.prices_per_m2 && ('species_prices' in baseToCompare);
    
    const processedBase = isLegacyBase ? EMPTY_CONFIG : {
      ...EMPTY_CONFIG,
      ...baseToCompare,
      prices_per_m2: { ...EMPTY_CONFIG.prices_per_m2, ...(baseToCompare.prices_per_m2 || {}) },
      waste_removal: { ...EMPTY_CONFIG.waste_removal, ...(baseToCompare.waste_removal || {}) }
    };
    return !deepEqual(config, processedBase);
  }, [config, initialConfig]);

  const handleReset = () => setShowResetModal(true);
  const cancelReset = () => setShowResetModal(false);

  const confirmReset = async () => {
    setShowResetModal(false);
    onChange(EMPTY_CONFIG);
    setValidationErrors([]);
    setShowGlobalError(false);
    
    if (onSave) {
      try {
        setIsSaving(true);
        await onSave(EMPTY_CONFIG);
      } catch (error) {
        console.error('Error resetting shrub config:', error);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const handlePriceChange = (size: ShrubSize, newPrice: number) => {
    onChange({
      ...config,
      prices_per_m2: {
        ...config.prices_per_m2,
        [size]: newPrice
      }
    });
  };

  const handleWasteChange = (val: number) => {
    onChange({
      ...config,
      waste_removal: { percentage: val }
    });
  };

  const handleMinimumPriceChange = (val: number) => {
    onChange({
      ...config,
      minimum_price: val
    });
  };

  const handleSave = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    
    // Validations
    const errors: string[] = [];
    const sizes: ShrubSize[] = ['pequeñas', 'medianas', 'grandes'];
    
    sizes.forEach(s => {
      if (!config.prices_per_m2[s] || config.prices_per_m2[s] <= 0) {
        errors.push(s);
      }
    });

    if (errors.length > 0) {
        setValidationErrors(errors);
        setShowGlobalError(true);
        return;
    }

    if (!config.minimum_price || config.minimum_price <= 0) {
        setShowGlobalError(true);
        return;
    }
    
    setValidationErrors([]);
    setShowGlobalError(false);

    if (onSave) {
      try {
        setIsSaving(true);
        await onSave(config);
      } catch (error) {
        console.error('Error saving shrub config:', error);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const renderPriceInput = (size: ShrubSize) => {
     const val = config.prices_per_m2[size] || 0;
     const hasError = validationErrors.includes(size);

     return (
        <div className="relative w-full">
             <input
                type="number"
                min="0"
                step="0.01"
              className={`w-full h-11 md:h-10 pl-[1px] pr-6 text-right text-[17px] md:text-sm transition-all border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 ${hasError ? 'border-red-400 bg-red-50 md:border-red-500' : (val > 0 ? 'border-slate-200 bg-white md:border-gray-300' : 'border-slate-200 bg-slate-50 md:border-gray-200')}`}
                value={val === 0 ? '' : val}
                placeholder={val === 0 ? '-' : ''}
                onChange={(e) => {
                    handlePriceChange(size, parseFloat(e.target.value) || 0);
                    if (hasError) {
                        setValidationErrors(prev => prev.filter(err => err !== size));
                    }
                }}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 leading-none text-gray-400 text-sm font-medium">€</span>
         </div>
     );
  };

  return (
    <div className="space-y-8">
      {/* Header Info */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 text-lg">
                Configuración de poda de plantas y arbustos (IVA incluido)
            </h3>
            <div className="relative">
                <button 
                    type="button"
                    onClick={() => setShowGlobalInfo(!showGlobalInfo)}
                    className="text-gray-400 hover:text-blue-500 transition-colors"
                >
                    <Info className="w-5 h-5" />
                </button>
                {showGlobalInfo && (
                    <>
                        <div className="fixed inset-0 z-40 bg-black/20 md:hidden" onClick={() => setShowGlobalInfo(false)} />
                        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90vw] max-w-xs p-6 bg-white rounded-xl shadow-xl border border-gray-100 text-sm text-gray-600 md:absolute md:top-8 md:left-0 md:translate-x-0 md:translate-y-0 md:w-64 md:p-4 md:shadow-lg md:border-blue-100 md:rounded-lg">
                            <ul className="list-disc pl-4 space-y-2">
                                <li>Precios por <strong>metro cuadrado (m²)</strong>.</li>
                                <li>Variación según el tamaño dominante de las plantas.</li>
                                <li>El <strong>IVA está incluido</strong>.</li>
                            </ul>
                        </div>
                    </>
                )}
            </div>
        </div>
      </div>

      <div>
        <h4 className="font-bold text-gray-800 text-xs uppercase tracking-wide mb-3">Precio mínimo</h4>
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
          <div className="flex items-center justify-between">
            <div className="pr-2">
              <span className="text-gray-700 text-sm font-medium block">Importe mínimo del servicio</span>
              <p className="text-xs text-gray-500 mt-1">Se aplica al final del cálculo del precio.</p>
            </div>
            <div className="relative w-24">
              <input
                type="number"
                min="0"
                step="0.01"
                className={`w-full h-9 pl-3 pr-7 border rounded-lg text-right text-[17px] md:text-sm focus:ring-2 focus:ring-green-500 ${config.minimum_price > 0 ? 'border-gray-300' : 'border-red-300 bg-red-50'}`}
                value={config.minimum_price === 0 ? '' : config.minimum_price}
                placeholder={config.minimum_price === 0 ? '-' : ''}
                onChange={(e) => handleMinimumPriceChange(parseFloat(e.target.value) || 0)}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium">€</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabla de Precios por m2 */}
      <div className="-mx-1 rounded-xl border border-slate-200 bg-white shadow-sm md:mx-0 md:border md:rounded-xl md:overflow-hidden md:shadow-sm md:bg-white">
        {/* Desktop Header */}
        <div className="hidden md:grid md:grid-cols-3 gap-4 bg-gray-50 p-4 border-b text-sm font-semibold text-gray-700 items-center">
            <div className="text-center">Pequeñas <span className="text-xs font-normal text-gray-500 block">(0-1m)</span></div>
            <div className="text-center">Medianas <span className="text-xs font-normal text-gray-500 block">(1-2m)</span></div>
            <div className="text-center">Grandes <span className="text-xs font-normal text-gray-500 block">(2-3m)</span></div>
        </div>

        {/* Content */}
        <div className="p-4">
            <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1 md:space-y-0">
                    <label className="block text-[11px] leading-[1.15] text-center font-medium text-gray-500 md:hidden mb-2">
                        <span className="block text-gray-700">Pequeñas <br/><span className="text-[10px] text-gray-400 font-normal">(0-1m)</span></span>
                        <span className="block text-[10px] text-gray-400 mt-0.5">€/m²</span>
                    </label>
                    {renderPriceInput('pequeñas')}
                </div>
                <div className="space-y-1 md:space-y-0">
                    <label className="block text-[11px] leading-[1.15] text-center font-medium text-gray-500 md:hidden mb-2">
                        <span className="block text-gray-700">Medianas <br/><span className="text-[10px] text-gray-400 font-normal">(1-2m)</span></span>
                        <span className="block text-[10px] text-gray-400 mt-0.5">€/m²</span>
                    </label>
                    {renderPriceInput('medianas')}
                </div>
                <div className="space-y-1 md:space-y-0">
                    <label className="block text-[11px] leading-[1.15] text-center font-medium text-gray-500 md:hidden mb-2">
                        <span className="block text-gray-700">Grandes <br/><span className="text-[10px] text-gray-400 font-normal">(2-3m)</span></span>
                        <span className="block text-[10px] text-gray-400 mt-0.5">€/m²</span>
                    </label>
                    {renderPriceInput('grandes')}
                </div>
            </div>
        </div>
      </div>

      {/* Retirada de restos */}
      <div>
        <h4 className="font-bold text-gray-800 text-xs uppercase tracking-wide mb-3">Retirada de restos</h4>
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
            <div className="flex items-center justify-between">
                <div className="pr-4">
                    <span className="text-sm font-medium text-gray-700 block">Recargo por retirada</span>
                    <span className="text-xs text-gray-500 mt-1 block">Incremento sobre el total si el cliente lo solicita.</span>
                </div>
                <div className="relative w-20 flex-shrink-0">
                    <input
                        type="number"
                        min="0"
                        className="w-full h-9 pl-2 pr-6 border border-gray-300 rounded-lg text-right text-[17px] md:text-sm focus:ring-2 focus:ring-green-500"
                        value={config.waste_removal.percentage}
                        onChange={(e) => handleWasteChange(parseInt(e.target.value) || 0)}
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm">%</span>
                </div>
            </div>
        </div>
      </div>

      {showGlobalError && (
        <div className="flex items-center gap-2 p-3 text-red-700 bg-red-50 rounded-lg border border-red-100">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm">Por favor, completa todos los precios de los tamaños (pequeñas, medianas, grandes) y el precio mínimo.</span>
        </div>
      )}

      {/* Footer */}
      <ServiceConfigFooter
          isDirty={isDirty}
          isSaving={isSaving}
          onReset={handleReset}
          onSave={handleSave}
      />

      {/* Modal de Reset */}
      {showResetModal && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-0">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={cancelReset} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4 mx-auto">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-center text-gray-900 mb-2">
                ¿Resetear configuración?
              </h3>
              <p className="text-center text-gray-500 text-sm mb-6">
                Se eliminarán todos los precios por m² y recargos configurados para la poda de plantas. Esta acción es irreversible.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={cancelReset}
                  className="w-full px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmReset}
                  disabled={isSaving}
                  className="w-full px-4 py-2.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {isSaving ? 'Reseteando...' : 'Sí, resetear'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default ShrubPricingConfigurator;