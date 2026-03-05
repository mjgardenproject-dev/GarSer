import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Info, AlertCircle, AlertTriangle, Trash2 } from 'lucide-react';
import { deepEqual } from '../../utils/deepEqual';
import ServiceConfigFooter from './ServiceConfigFooter';

export type HedgeType = 
  | 'Conífera (Ciprés/Tuya)' 
  | 'Laurel/Hoja ancha' 
  | 'Hiedra/Trepandora' 
  | 'Seto Mixto/Otro';

export type HedgeHeight = '<1m' | '1-2m' | '>2m';

export interface HedgePricingConfig {
  species_prices: Record<string, Partial<Record<HedgeHeight, number>>>; 
  condition_surcharges: {
      descuidado: number;
      muy_descuidado: number;
  };
  waste_removal: {
      percentage: number;
  };
  selected_types?: HedgeType[];
}

const HEDGE_TYPES: HedgeType[] = [
  'Conífera (Ciprés/Tuya)',
  'Laurel/Hoja ancha',
  'Hiedra/Trepandora',
  'Seto Mixto/Otro'
];

const EMPTY_CONFIG: HedgePricingConfig = {
  species_prices: {},
  condition_surcharges: { descuidado: 20, muy_descuidado: 50 },
  waste_removal: { percentage: 0 },
  selected_types: []
};

interface Props {
  value?: HedgePricingConfig;
  initialConfig?: HedgePricingConfig;
  onChange: (config: HedgePricingConfig) => void;
  onSave?: (config: HedgePricingConfig) => Promise<void>;
}

const HedgePricingConfigurator: React.FC<Props> = ({ value, initialConfig, onChange, onSave }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [showGlobalInfo, setShowGlobalInfo] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showGlobalError, setShowGlobalError] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);

  // Initialize config
  const config = React.useMemo(() => {
    if (!value) return EMPTY_CONFIG;
    return {
        ...EMPTY_CONFIG,
        ...value,
        species_prices: { ...EMPTY_CONFIG.species_prices, ...value.species_prices },
        condition_surcharges: { 
            ...EMPTY_CONFIG.condition_surcharges, 
            ...(value.condition_surcharges || {})
        },
        waste_removal: { ...EMPTY_CONFIG.waste_removal, ...value.waste_removal },
        selected_types: value.selected_types || []
    };
  }, [value]);

  // Determine if dirty
  const isDirty = useMemo(() => {
    const baseToCompare = initialConfig || EMPTY_CONFIG;
    const processedBase = {
        ...EMPTY_CONFIG,
        ...baseToCompare,
        species_prices: { ...EMPTY_CONFIG.species_prices, ...baseToCompare.species_prices },
        condition_surcharges: { 
            ...EMPTY_CONFIG.condition_surcharges, 
            ...(baseToCompare.condition_surcharges || {})
        },
        waste_removal: { ...EMPTY_CONFIG.waste_removal, ...baseToCompare.waste_removal },
        selected_types: baseToCompare.selected_types || []
    };
    return !deepEqual(config, processedBase);
  }, [config, initialConfig]);

  const handleReset = () => {
    setShowResetModal(true);
  };

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
        console.error('Error resetting hedge config:', error);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const cancelReset = () => {
    setShowResetModal(false);
  };

  const activeTypes = HEDGE_TYPES.filter(s => config.selected_types?.includes(s));
  const availableTypes = HEDGE_TYPES.filter(s => !config.selected_types?.includes(s));

  const addType = (type: HedgeType) => {
    const currentSelected = config.selected_types || [];
    if (!currentSelected.includes(type)) {
        onChange({
            ...config,
            selected_types: [...currentSelected, type]
        });
    }
  };

  const removeType = (type: HedgeType) => {
      const currentSelected = config.selected_types || [];
      const newSpeciesPrices = { ...config.species_prices };
      if (newSpeciesPrices[type]) {
          delete newSpeciesPrices[type];
      }

      onChange({
          ...config,
          selected_types: currentSelected.filter(s => s !== type),
          species_prices: newSpeciesPrices
      });
  };

  const handlePriceChange = (type: HedgeType, range: HedgeHeight, newPrice: number) => {
    const currentPrices = { ...(config.species_prices[type] || {}) };
    currentPrices[range] = newPrice;
    
    onChange({
      ...config,
      species_prices: {
        ...config.species_prices,
        [type]: currentPrices
      }
    });
  };

  const handleSurchargeChange = (type: 'descuidado' | 'muy_descuidado', val: number) => {
      onChange({
          ...config,
          condition_surcharges: {
              ...config.condition_surcharges,
              [type]: val
          }
      });
  };

  const handleWasteChange = (val: number) => {
      onChange({
          ...config,
          waste_removal: {
              percentage: val
          }
      });
  };

  const handleSave = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    
    // Validations
    const errors: string[] = [];
    const selected = config.selected_types || [];
    
    selected.forEach(type => {
        const ranges: HedgeHeight[] = ['<1m', '1-2m', '>2m'];
        ranges.forEach(r => {
             // @ts-ignore
            if (!config.species_prices[type]?.[r] || config.species_prices[type]?.[r] <= 0) {
                errors.push(`${type}-${r}`);
            }
        });
    });

    if (errors.length > 0) {
        setValidationErrors(errors);
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
        console.error('Error saving hedge config:', error);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const renderPriceInput = (type: HedgeType, range: HedgeHeight) => {
     // @ts-ignore
     const val = config.species_prices[type]?.[range] ?? 0;
     const hasError = validationErrors.includes(`${type}-${range}`);

     return (
         <div className="relative w-full h-full">
             <input
                type="number"
                min="0"
                step="0.01"
                className={`w-full h-10 md:h-10 pl-3 pr-8 text-right text-base sm:text-sm transition-all md:border md:rounded-lg md:shadow-sm border-0 rounded-none focus:ring-2 focus:ring-green-500 focus:ring-inset focus:border-green-500 ${hasError ? 'md:border-red-500 bg-red-50' : (val > 0 ? 'bg-white md:border-gray-300' : 'bg-gray-50 md:border-gray-200')}`}
                value={val === 0 ? '' : val}
                placeholder={val === 0 ? '-' : ''}
                onChange={(e) => {
                    handlePriceChange(type, range, parseFloat(e.target.value) || 0);
                    if (hasError) {
                        setValidationErrors(prev => prev.filter(err => err !== `${type}-${range}`));
                    }
                }}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium">€</span>
         </div>
     );
  };

  return (
    <div className="space-y-8">
      {/* Header Info */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 text-lg">
                Configuración de setos (IVA incluido)
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
                                <li>Precios por <strong>metro lineal</strong> de longitud.</li>
                                <li>Se multiplica por la altura para obtener el volumen aproximado implícito.</li>
                                <li>El <strong>IVA está incluido</strong>.</li>
                            </ul>
                        </div>
                    </>
                )}
            </div>
        </div>
      </div>

      {/* Selector de Tipos */}
      <div className="flex flex-col gap-1 mb-4">
         <div className="flex items-center gap-2">
            <h4 className="font-bold text-gray-800 text-sm uppercase tracking-wide">Tipos de Seto</h4>
         </div>
         <p className="text-sm text-gray-500 italic">
            Selecciona los tipos que trabajas.
         </p>
         
         <div className="mt-2 flex items-center gap-2">
            <div className="relative inline-block w-full sm:w-64">
                <select
                    className="w-full h-10 pl-3 pr-8 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                    onChange={(e) => {
                        if (e.target.value) {
                            addType(e.target.value as HedgeType);
                            e.target.value = '';
                        }
                    }}
                    defaultValue=""
                >
                    <option value="" disabled>Añadir tipo...</option>
                    {availableTypes.map(s => (
                        <option key={s} value={s}>{s}</option>
                    ))}
                </select>
            </div>
         </div>
      </div>

      {/* Tabla de Precios */}
      <div className="-mx-4 md:mx-0 md:border md:rounded-xl md:overflow-hidden md:shadow-sm md:bg-white border-y border-gray-200">
        {/* Desktop Header */}
        <div className="hidden md:grid md:grid-cols-12 gap-4 bg-gray-50 p-4 border-b text-sm font-semibold text-gray-700 items-center">
            <div className="md:col-span-3">Tipo</div>
            <div className="md:col-span-3 text-center">&lt;1m Altura <span className="text-xs font-normal text-gray-500 block">(€ / metro lineal)</span></div>
            <div className="md:col-span-3 text-center">1–2m Altura <span className="text-xs font-normal text-gray-500 block">(€ / metro lineal)</span></div>
            <div className="md:col-span-2 text-center">&gt;2m Altura <span className="text-xs font-normal text-gray-500 block">(€ / metro lineal)</span></div>
            <div className="md:col-span-1"></div>
        </div>

        {/* Content */}
        {activeTypes.length > 0 ? (
            <div className="divide-y divide-gray-100">
                {activeTypes.map((type) => (
                    <div key={type} className="pt-4 pb-0 px-0 md:p-4 hover:bg-gray-50 transition-colors">
                      <div className="flex flex-col md:grid md:grid-cols-12 md:gap-4 md:items-center">
                        
                        {/* Type Name */}
                        <div className="flex justify-between items-start md:items-center mb-3 px-4 md:mb-0 md:px-0 md:col-span-3">
                            <span className="font-bold text-gray-800 text-sm md:text-sm md:font-medium md:text-gray-700 flex-1 pr-4">{type}</span>
                            <button
                              type="button"
                              onClick={() => removeType(type)}
                              className="text-red-500 p-2 bg-red-50 rounded-lg md:hidden flex-shrink-0"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Inputs Grid */}
                        <div className="grid grid-cols-3 md:grid-cols-8 md:col-span-8 gap-0 md:gap-4 border-t border-gray-100 md:border-t-0">
                            <div className="space-y-1 md:space-y-0 md:col-span-3 border-r border-gray-200">
                                <label className="block text-[10px] text-center font-medium text-gray-500 md:hidden truncate">&lt;1m</label>
                                {renderPriceInput(type, '<1m')}
                            </div>
                            <div className="space-y-1 md:space-y-0 md:col-span-3 border-r border-gray-200">
                                <label className="block text-[10px] text-center font-medium text-gray-500 md:hidden truncate">1-2m</label>
                                {renderPriceInput(type, '1-2m')}
                            </div>
                            <div className="space-y-1 md:space-y-0 md:col-span-2">
                                <label className="block text-[10px] text-center font-medium text-gray-500 md:hidden truncate">&gt;2m</label>
                                {renderPriceInput(type, '>2m')}
                            </div>
                        </div>

                        {/* Desktop Delete */}
                        <div className="hidden md:flex md:col-span-1 justify-center">
                            <button
                              type="button"
                              onClick={() => removeType(type)}
                              className="text-gray-400 hover:text-red-500 transition-colors"
                            >
                                <Trash2 className="w-5 h-5" />
                            </button>
                        </div>
                      </div>
                    </div>
                ))}
            </div>
        ) : (
            <div className="p-8 text-center text-gray-500">
                Selecciona los tipos de setos que trabajas arriba.
            </div>
        )}
      </div>

      {/* Sección Suplementos por Estado */}
      <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 bg-gray-50">
          <h4 className="font-semibold text-gray-900">Suplementos por Estado</h4>
          <p className="text-xs text-gray-500 mt-1">
            Incremento porcentual según el estado de conservación del seto.
          </p>
        </div>
        <div className="divide-y divide-gray-100">
          {/* Normal */}
          <div className="p-4 flex items-center justify-between">
            <div>
              <span className="block text-sm font-medium text-gray-900">Normal</span>
              <span className="text-xs text-gray-500">Mantenimiento regular, forma definida.</span>
            </div>
            <div className="text-sm font-medium text-green-600 bg-green-50 px-3 py-1 rounded-full">
              Sin recargo
            </div>
          </div>

          {/* Descuidado */}
          <div className="p-4 flex items-center justify-between">
            <div>
              <span className="block text-sm font-medium text-gray-900">Descuidado</span>
              <span className="text-xs text-gray-500">Pérdida de forma, brotes largos.</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-400 font-medium">+</span>
              <div className="relative w-24">
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={config.condition_surcharges?.descuidado || 0}
                  onChange={(e) => handleSurchargeChange('descuidado', parseFloat(e.target.value) || 0)}
                  className="w-full pl-3 pr-8 py-1.5 border border-gray-300 rounded-lg text-right focus:ring-2 focus:ring-green-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium">%</span>
              </div>
            </div>
          </div>

          {/* Muy Descuidado */}
          <div className="p-4 flex items-center justify-between">
            <div>
              <span className="block text-sm font-medium text-gray-900">Muy Descuidado</span>
              <span className="text-xs text-gray-500">Deformado, invasivo, ramas gruesas.</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-400 font-medium">+</span>
              <div className="relative w-24">
                <input
                  type="number"
                  min="0"
                  max="200"
                  value={config.condition_surcharges?.muy_descuidado || 0}
                  onChange={(e) => handleSurchargeChange('muy_descuidado', parseFloat(e.target.value) || 0)}
                  className="w-full pl-3 pr-8 py-1.5 border border-gray-300 rounded-lg text-right focus:ring-2 focus:ring-green-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium">%</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Sección Gestión de Residuos */}
      <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 bg-gray-50">
          <h4 className="font-semibold text-gray-900">Gestión de Residuos</h4>
          <p className="text-xs text-gray-500 mt-1">
            Recargo opcional si el cliente solicita la retirada de restos.
          </p>
        </div>
        <div className="p-5 flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">
            Recargo por retirada
          </label>
          <div className="relative w-32">
            <input
              type="number"
              min="0"
              max="100"
              value={config.waste_removal?.percentage || 0}
              onChange={(e) => handleWasteChange(parseFloat(e.target.value) || 0)}
              className="w-full pl-3 pr-8 py-2 border border-gray-300 rounded-lg text-right focus:ring-2 focus:ring-green-500"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">%</span>
          </div>
        </div>
      </section>

      {/* Global Error Banner */}
      {showGlobalError && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-red-50 text-red-700 px-6 py-3 rounded-full shadow-xl border border-red-200 flex items-center gap-3 animate-bounce-short">
              <AlertCircle className="w-5 h-5" />
              <span className="font-medium">
                  Revisa los campos marcados en rojo.
              </span>
          </div>
      )}

      {/* Save Button */}
      <ServiceConfigFooter 
        onSave={() => handleSave()} 
        onReset={handleReset} 
        isDirty={isDirty} 
        isSaving={isSaving} 
      />

      {/* Reset Confirmation Modal */}
      {showResetModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 animate-in fade-in zoom-in duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mb-4">
                <AlertTriangle className="w-6 h-6 text-yellow-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2 text-center">
                ¿Restablecer configuración?
              </h3>
              <p className="text-gray-500 text-center mb-6 text-sm">
                Se eliminarán todos los precios, tipos y recargos configurados para el corte de setos. Esta acción es irreversible.
              </p>
              <div className="flex flex-col gap-3 w-full">
                <button
                  onClick={confirmReset}
                  className="w-full bg-gradient-to-r from-red-600 to-red-700 text-white py-3 px-4 rounded-xl font-bold shadow-lg shadow-red-600/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center"
                >
                  Confirmar
                </button>
                <button
                  onClick={cancelReset}
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
    </div>
  );
};

export default HedgePricingConfigurator;