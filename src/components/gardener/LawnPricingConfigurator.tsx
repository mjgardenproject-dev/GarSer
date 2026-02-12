import React, { useState, useEffect } from 'react';
import { Info, AlertCircle, Trash2, Check } from 'lucide-react';

export type LawnSpecies = 
  | 'Bermuda (fina o gramilla)' 
  | 'Gramón (Kikuyu, San Agustín o similares)' 
  | 'Dichondra (oreja de ratón o similares)' 
  | 'Césped Mixto (Festuca/Raygrass)';

export type LawnRange = '0-50' | '50-200' | '200+';

export interface LawnPricingConfig {
  species_prices: Record<string, Partial<Record<LawnRange, number>>>; 
  condition_surcharges: {
      descuidado: number;
      muy_descuidado: number;
  };
  waste_removal: {
      percentage: number;
  };
  selected_species?: LawnSpecies[];
}

const LAWN_SPECIES: LawnSpecies[] = [
  'Bermuda (fina o gramilla)',
  'Gramón (Kikuyu, San Agustín o similares)',
  'Dichondra (oreja de ratón o similares)',
  'Césped Mixto (Festuca/Raygrass)'
];

const EMPTY_CONFIG: LawnPricingConfig = {
  species_prices: {},
  condition_surcharges: { descuidado: 20, muy_descuidado: 50 },
  waste_removal: { percentage: 0 },
  selected_species: []
};

interface Props {
  value?: LawnPricingConfig;
  onChange: (config: LawnPricingConfig) => void;
  onSave?: (config: LawnPricingConfig) => Promise<void>;
}

const LawnPricingConfigurator: React.FC<Props> = ({ value, onChange, onSave }) => {
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
        condition_surcharges: { ...EMPTY_CONFIG.condition_surcharges, ...value.condition_surcharges },
        waste_removal: { ...EMPTY_CONFIG.waste_removal, ...value.waste_removal },
        selected_species: value.selected_species || []
    };
  }, [value]);

  const activeSpecies = LAWN_SPECIES.filter(s => config.selected_species?.includes(s));
  const availableSpecies = LAWN_SPECIES.filter(s => !config.selected_species?.includes(s));

  const addSpecies = (species: LawnSpecies) => {
    const currentSelected = config.selected_species || [];
    if (!currentSelected.includes(species)) {
        onChange({
            ...config,
            selected_species: [...currentSelected, species]
        });
    }
  };

  const removeSpecies = (species: LawnSpecies) => {
      const currentSelected = config.selected_species || [];
      onChange({
          ...config,
          selected_species: currentSelected.filter(s => s !== species),
      });
  };

  const handlePriceChange = (species: LawnSpecies, range: LawnRange, newPrice: number) => {
    const currentPrices = { ...(config.species_prices[species] || {}) };
    currentPrices[range] = newPrice;
    
    onChange({
      ...config,
      species_prices: {
        ...config.species_prices,
        [species]: currentPrices
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

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    // Validations
    const errors: string[] = [];
    const selected = config.selected_species || [];
    
    selected.forEach(species => {
        const ranges: LawnRange[] = ['0-50', '50-200', '200+'];
        ranges.forEach(r => {
             // @ts-ignore
            if (!config.species_prices[species]?.[r] || config.species_prices[species]?.[r] <= 0) {
                errors.push(`${species}-${r}`);
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
        console.error('Error saving lawn config:', error);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const renderPriceInput = (species: LawnSpecies, range: LawnRange, placeholder: string) => {
     // @ts-ignore
     const val = config.species_prices[species]?.[range] ?? 0;
     const hasError = validationErrors.includes(`${species}-${range}`);

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
                    handlePriceChange(species, range, parseFloat(e.target.value) || 0);
                    if (hasError) {
                        setValidationErrors(prev => prev.filter(err => err !== `${species}-${range}`));
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
                Configuración de tarifas por especie (IVA incluido)
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
                                <li>Los precios son por m² (excepto rango 0-50m² que puede ser fijo).</li>
                                <li>Los precios <strong>no incluyen la retirada de restos</strong> (se configura abajo).</li>
                                <li>El <strong>IVA está incluido</strong>.</li>
                            </ul>
                        </div>
                    </>
                )}
            </div>
        </div>
      </div>

      {/* Selector de Especies */}
      <div className="flex flex-col gap-1 mb-4">
         <div className="flex items-center gap-2">
            <h4 className="font-bold text-gray-800 text-sm uppercase tracking-wide">Especies de Césped</h4>
         </div>
         <p className="text-sm text-gray-500 italic">
            Selecciona las variedades con las que trabajas habitualmente.
         </p>
         
         <div className="mt-2 flex items-center gap-2">
            <div className="relative inline-block w-full sm:w-64">
                <select
                    className="w-full h-10 pl-3 pr-8 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                    onChange={(e) => {
                        if (e.target.value) {
                            addSpecies(e.target.value as LawnSpecies);
                            e.target.value = '';
                        }
                    }}
                    defaultValue=""
                >
                    <option value="" disabled>Añadir especie...</option>
                    {availableSpecies.map(s => (
                        <option key={s} value={s}>{s}</option>
                    ))}
                </select>
            </div>
         </div>
      </div>

      {/* Tabla de Precios */}
      <div className="-mx-4 md:mx-0 md:border md:rounded-xl md:overflow-hidden md:shadow-sm md:bg-white border-y border-gray-200">
        {/* Desktop Header - Visible only on md+ */}
        <div className="hidden md:grid md:grid-cols-12 gap-4 bg-gray-50 p-4 border-b text-sm font-semibold text-gray-700 items-center">
            <div className="md:col-span-3">Especie</div>
            <div className="md:col-span-3 text-center">0–50 m² <span className="text-xs font-normal text-gray-500 block">(Precio Fijo/Min)</span></div>
            <div className="md:col-span-3 text-center">50–200 m² <span className="text-xs font-normal text-gray-500 block">(Precio / m²)</span></div>
            <div className="md:col-span-2 text-center">&gt;200 m² <span className="text-xs font-normal text-gray-500 block">(Precio / m²)</span></div>
            <div className="md:col-span-1"></div>
        </div>

        {/* Content */}
        {activeSpecies.length > 0 ? (
            <div className="divide-y divide-gray-100">
                {activeSpecies.map((species) => (
                    <div key={species} className="pt-4 pb-0 px-0 md:p-4 hover:bg-gray-50 transition-colors">
                      <div className="flex flex-col md:grid md:grid-cols-12 md:gap-4 md:items-center">
                        
                        {/* Species Name Row (Mobile: Top, Desktop: Left) */}
                        <div className="flex justify-between items-start md:items-center mb-3 px-4 md:mb-0 md:px-0 md:col-span-3">
                            <span className="font-bold text-gray-800 text-sm md:text-sm md:font-medium md:text-gray-700 flex-1 pr-4">{species}</span>
                            <button
                              type="button"
                              onClick={() => removeSpecies(species)}
                              className="text-red-500 p-2 bg-red-50 rounded-lg md:hidden flex-shrink-0"
                              title="Eliminar especie"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Inputs Grid (Mobile: 3 cols below name, Desktop: Inline) */}
                        <div className="grid grid-cols-3 md:grid-cols-8 md:col-span-8 gap-0 md:gap-4 border-t border-gray-100 md:border-t-0">
                            <div className="space-y-1 md:space-y-0 md:col-span-3 border-r border-gray-200">
                                <label className="block text-[10px] text-center font-medium text-gray-500 md:hidden truncate">0-50 m²</label>
                                {renderPriceInput(species, '0-50', 'Fijo')}
                            </div>
                            <div className="space-y-1 md:space-y-0 md:col-span-3 border-r border-gray-200">
                                <label className="block text-[10px] text-center font-medium text-gray-500 md:hidden truncate">50-200 m²</label>
                                {renderPriceInput(species, '50-200', '/m²')}
                            </div>
                            <div className="space-y-1 md:space-y-0 md:col-span-2">
                                <label className="block text-[10px] text-center font-medium text-gray-500 md:hidden truncate">&gt;200 m²</label>
                                {renderPriceInput(species, '200+', '/m²')}
                            </div>
                        </div>

                        {/* Desktop Delete Action */}
                        <div className="hidden md:flex md:col-span-1 justify-center">
                            <button
                              type="button"
                              onClick={() => removeSpecies(species)}
                              className="text-gray-400 hover:text-red-500 transition-colors"
                              title="Eliminar especie"
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
                <p className="mb-2 font-medium">No hay especies seleccionadas.</p>
                <p className="text-sm">Usa el desplegable de arriba para añadir una.</p>
            </div>
        )}
      </div>

      {/* Surcharges Section (Copied style from StandardServiceConfig/PalmPricingConfigurator) */}
      <div className="border-t border-gray-200 pt-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Condition Surcharges */}
            <div>
              <h4 className="font-bold text-gray-800 text-xs uppercase tracking-wide mb-3">Suplementos por estado</h4>
              <div className="space-y-3 bg-gray-50 p-4 rounded-lg border border-gray-100">
                <div className="flex items-center justify-between">
                  <span className="text-gray-700 text-sm font-medium">Descuidado</span>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-sm font-medium">+</span>
                    <input
                      type="number"
                      min="0"
                      className="w-16 h-9 px-2 border border-gray-300 rounded-lg text-right text-sm focus:ring-2 focus:ring-green-500"
                      value={config.condition_surcharges.descuidado === 0 ? '' : config.condition_surcharges.descuidado}
                      placeholder={config.condition_surcharges.descuidado === 0 ? '-' : ''}
                      onChange={(e) => handleSurchargeChange('descuidado', parseFloat(e.target.value) || 0)}
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
                      className="w-16 h-9 px-2 border border-gray-300 rounded-lg text-right text-sm focus:ring-2 focus:ring-green-500"
                      value={config.condition_surcharges.muy_descuidado === 0 ? '' : config.condition_surcharges.muy_descuidado}
                      placeholder={config.condition_surcharges.muy_descuidado === 0 ? '-' : ''}
                      onChange={(e) => handleSurchargeChange('muy_descuidado', parseFloat(e.target.value) || 0)}
                    />
                    <span className="text-gray-500 text-sm font-medium w-4">%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Waste Removal */}
            <div>
              <h4 className="font-bold text-gray-800 text-xs uppercase tracking-wide mb-3">Recargo por retirada</h4>
              <div className="space-y-3 bg-gray-50 p-4 rounded-lg border border-gray-100 h-full">
                <div className="flex items-center justify-between h-full">
                  <div className="pr-2">
                    <span className="text-gray-700 text-sm font-medium block">Retirada de restos</span>
                    <p className="text-xs text-gray-500 mt-1">Incremento si el cliente lo solicita</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-sm font-medium">+</span>
                    <input
                      type="number"
                      min="0"
                      className="w-16 h-9 px-2 border border-gray-300 rounded-lg text-right text-sm focus:ring-2 focus:ring-green-500"
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
      </div>

      {/* Global Error */}
      {showGlobalError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
            <div>
                <h4 className="text-sm font-semibold text-red-800">Faltan precios por configurar</h4>
                <p className="text-sm text-red-600 mt-1">
                    Asegúrate de rellenar todos los campos de precio para las especies seleccionadas. 
                    Los precios deben ser mayores a 0.
                </p>
            </div>
        </div>
      )}

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

export default LawnPricingConfigurator;