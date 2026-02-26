import React, { useState } from 'react';
import { Info, AlertCircle, Trash2 } from 'lucide-react';

export type ShrubType = 
  | 'Arbustos ornamentales' 
  | 'Trepadoras' 
  | 'Rosales y plantas florales' 
  | 'Cactus y suculentas grandes';

export type ShrubSize = 'Pequeño (hasta 1m)' | 'Mediano (1-2.5m)' | 'Grande (>2.5m)';

export interface ShrubPricingConfig {
  species_prices: Record<string, Partial<Record<ShrubSize, number>>>; 
  waste_removal: {
      percentage: number;
  };
  condition_multipliers: {
    normal: number;
    neglected: number;
    overgrown: number;
  };
  selected_types?: ShrubType[];
}

const SHRUB_TYPES: ShrubType[] = [
  'Arbustos ornamentales',
  'Trepadoras',
  'Rosales y plantas florales',
  'Cactus y suculentas grandes'
];

const EMPTY_CONFIG: ShrubPricingConfig = {
  species_prices: {},
  waste_removal: { percentage: 0 },
  condition_multipliers: {
    normal: 0,
    neglected: 15,
    overgrown: 30
  },
  selected_types: []
};

interface Props {
  value?: ShrubPricingConfig;
  onChange: (config: ShrubPricingConfig) => void;
  onSave?: (config: ShrubPricingConfig) => Promise<void>;
}

const ShrubPricingConfigurator: React.FC<Props> = ({ value, onChange, onSave }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [showGlobalInfo, setShowGlobalInfo] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showGlobalError, setShowGlobalError] = useState(false);

  // Initialize config
  const config = React.useMemo(() => {
    if (!value) return EMPTY_CONFIG;
    return {
        ...EMPTY_CONFIG,
        ...value,
        species_prices: { ...EMPTY_CONFIG.species_prices, ...value.species_prices },
        waste_removal: { ...EMPTY_CONFIG.waste_removal, ...value.waste_removal },
        condition_multipliers: { ...EMPTY_CONFIG.condition_multipliers, ...(value.condition_multipliers || {}) },
        selected_types: value.selected_types || []
    };
  }, [value]);

  const activeTypes = SHRUB_TYPES.filter(s => config.selected_types?.includes(s));
  const availableTypes = SHRUB_TYPES.filter(s => !config.selected_types?.includes(s));

  const addType = (type: ShrubType) => {
    const currentSelected = config.selected_types || [];
    if (!currentSelected.includes(type)) {
        onChange({
            ...config,
            selected_types: [...currentSelected, type]
        });
    }
  };

  const removeType = (type: ShrubType) => {
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

  const handlePriceChange = (type: ShrubType, size: ShrubSize, newPrice: number) => {
    const currentPrices = { ...(config.species_prices[type] || {}) };
    currentPrices[size] = newPrice;
    
    onChange({
      ...config,
      species_prices: {
        ...config.species_prices,
        [type]: currentPrices
      }
    });
  };

  const handleConditionChange = (key: keyof ShrubPricingConfig['condition_multipliers'], val: number) => {
    onChange({
      ...config,
      condition_multipliers: {
        ...config.condition_multipliers,
        [key]: val
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

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    // Validations
    const errors: string[] = [];
    // Only validate currently supported types that are selected
    const activeTypesToValidate = SHRUB_TYPES.filter(s => config.selected_types?.includes(s));
    
    activeTypesToValidate.forEach(type => {
        const sizes: ShrubSize[] = ['Pequeño (hasta 1m)', 'Mediano (1-2.5m)', 'Grande (>2.5m)'];
        sizes.forEach(s => {
             // @ts-ignore
            if (!config.species_prices[type]?.[s] || config.species_prices[type]?.[s] <= 0) {
                errors.push(`${type}-${s}`);
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
        // Clean up config before saving: remove unsupported types to sanitize DB
        const cleanConfig = {
            ...config,
            selected_types: activeTypesToValidate
        };
        await onSave(cleanConfig);
      } catch (error) {
        console.error('Error saving shrub config:', error);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const renderPriceInput = (type: ShrubType, size: ShrubSize) => {
     // @ts-ignore
     const val = config.species_prices[type]?.[size] ?? 0;
     const hasError = validationErrors.includes(`${type}-${size}`);

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
                    handlePriceChange(type, size, parseFloat(e.target.value) || 0);
                    if (hasError) {
                        setValidationErrors(prev => prev.filter(err => err !== `${type}-${size}`));
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
                Configuración de poda de plantas (IVA incluido)
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
                                <li>Precios por <strong>unidad</strong> (planta).</li>
                                <li>Variación según tamaño.</li>
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
            <h4 className="font-bold text-gray-800 text-sm uppercase tracking-wide">Tipos de Planta</h4>
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
                            addType(e.target.value as ShrubType);
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
            <div className="md:col-span-3 text-center">Pequeño <span className="text-xs font-normal text-gray-500 block">(hasta 1m)</span></div>
            <div className="md:col-span-3 text-center">Mediano <span className="text-xs font-normal text-gray-500 block">(1-2.5m)</span></div>
            <div className="md:col-span-2 text-center">Grande <span className="text-xs font-normal text-gray-500 block">(&gt;2.5m)</span></div>
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
                                <label className="block text-[10px] text-center font-medium text-gray-500 md:hidden truncate">Pequeño</label>
                                {renderPriceInput(type, 'Pequeño (hasta 1m)')}
                            </div>
                            <div className="space-y-1 md:space-y-0 md:col-span-3 border-r border-gray-200">
                                <label className="block text-[10px] text-center font-medium text-gray-500 md:hidden truncate">Mediano</label>
                                {renderPriceInput(type, 'Mediano (1-2.5m)')}
                            </div>
                            <div className="space-y-1 md:space-y-0 md:col-span-2">
                                <label className="block text-[10px] text-center font-medium text-gray-500 md:hidden truncate">Grande</label>
                                {renderPriceInput(type, 'Grande (>2.5m)')}
                            </div>
                        </div>

                        {/* Desktop Delete */}
                        <div className="hidden md:flex md:col-span-1 justify-center">
                            <button
                              type="button"
                              onClick={() => removeType(type)}
                              className="text-gray-400 hover:text-red-500 transition-colors"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                      </div>
                    </div>
                ))}
            </div>
        ) : (
            <div className="p-8 text-center text-gray-500 bg-gray-50">
                <p className="mb-2 font-medium">No hay tipos seleccionados.</p>
                <p className="text-sm">Añade uno para empezar.</p>
            </div>
        )}
      </div>

      {/* Surcharges Section */}
      <div className="space-y-8 mt-8">
          
          {/* Condition Multipliers */}
          <div className="pt-6 border-t border-gray-100">
            <h4 className="font-bold text-gray-900 mb-4 text-lg">
               Suplementos por estado
            </h4>
            <div className="space-y-1 divide-y divide-gray-100">
              {/* Normal */}
              <div className="flex items-center justify-between py-3">
                 <div className="pr-4">
                    <span className="text-gray-700 font-medium block">Normal</span>
                    <p className="text-xs text-gray-500 mt-1">planta saludable, pocas ramas secas, fácil de podar</p>
                 </div>
                 <span className="text-gray-500 text-sm bg-gray-50 px-3 py-1 rounded-full border border-gray-100 shrink-0">Sin recargo</span>
              </div>

              {/* Descuidado */}
              <div className="flex items-center justify-between py-3">
                 <div className="pr-4">
                    <span className="text-gray-700 font-medium block">Descuidada</span>
                    <p className="text-xs text-gray-500 mt-1">algunas ramas secas, follaje denso, tallos desordenados</p>
                 </div>
                 <div className="flex items-center gap-2 shrink-0">
                     <span className="text-gray-400 text-sm font-medium">+</span>
                     <input
                       type="number"
                       min="0"
                       className="w-20 h-10 px-3 border border-gray-300 rounded-lg text-right text-base sm:text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all"
                       value={config.condition_multipliers.neglected}
                       onChange={(e) => handleConditionChange('neglected', parseFloat(e.target.value) || 0)}
                     />
                     <span className="text-gray-500 text-sm font-medium w-4">%</span>
                 </div>
              </div>

              {/* Muy Descuidado */}
              <div className="flex items-center justify-between py-3">
                 <div className="pr-4">
                    <span className="text-gray-700 font-medium block">Muy Descuidada</span>
                    <p className="text-xs text-gray-500 mt-1">ramas secas, densidad alta, crecimiento descontrolado</p>
                 </div>
                 <div className="flex items-center gap-2 shrink-0">
                     <span className="text-gray-400 text-sm font-medium">+</span>
                     <input
                       type="number"
                       min="0"
                       className="w-20 h-10 px-3 border border-gray-300 rounded-lg text-right text-base sm:text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all"
                       value={config.condition_multipliers.overgrown}
                       onChange={(e) => handleConditionChange('overgrown', parseFloat(e.target.value) || 0)}
                     />
                     <span className="text-gray-500 text-sm font-medium w-4">%</span>
                 </div>
              </div>
            </div>
          </div>

          {/* Waste Removal Only */}
          <div className="pt-6 border-t border-gray-100">
            <h4 className="font-bold text-gray-900 mb-4 text-lg">Retirada de restos</h4>
            <div className="space-y-1">
              <div className="flex items-center justify-between py-2">
                <div className="pr-4">
                  <span className="text-gray-700 font-medium block">Recargo por retirada</span>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                    Solo se cobrará al cliente si selecciona la opción de retirada de restos.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-gray-400 text-sm font-medium">+</span>
                  <input
                    type="number"
                    min="0"
                    className="w-20 h-10 px-3 border border-gray-300 rounded-lg text-right text-base sm:text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all"
                    value={config.waste_removal.percentage === 0 ? '' : config.waste_removal.percentage}
                    placeholder={config.waste_removal.percentage === 0 ? '-' : ''}
                    onChange={(e) => handleWasteChange(parseFloat(e.target.value) || 0)}
                  />
                  <span className="text-gray-500 text-sm font-medium w-4">%</span>
                </div>
              </div>
            </div>
          </div>
      </div>

      {/* Resumen Informativo Final */}
      <div className="mt-6 pt-4 border-t border-gray-100 text-xs text-gray-500 text-center">
        <p>Estas tarifas se usan como base para generar presupuestos automáticos en la plataforma.</p>
        <p>Pueden ajustarse posteriormente en cada servicio individual.</p>
      </div>

      {/* Global Error */}
      {showGlobalError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
            <div>
                <h4 className="text-sm font-semibold text-red-800">Faltan precios por configurar</h4>
                <p className="text-sm text-red-600 mt-1">
                    Asegúrate de rellenar todos los campos de precio para los tipos seleccionados.
                </p>
            </div>
        </div>
      )}

      {/* Save Button */}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end pt-4 border-t border-gray-100 gap-3">
        <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className={`flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-sm text-sm font-medium w-full sm:w-auto ${isSaving ? 'opacity-70 cursor-not-allowed' : ''}`}
        >
            {isSaving ? (
                <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                    Guardando...
                </>
            ) : (
                'Guardar configuración de plantas'
            )}
        </button>
      </div>
    </div>
  );
};

export default ShrubPricingConfigurator;
