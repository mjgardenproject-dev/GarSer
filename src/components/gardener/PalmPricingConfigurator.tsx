import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Save, Check, Plus, Trash2, RefreshCw, AlertTriangle, Info, ChevronDown, ChevronRight } from 'lucide-react';

// Tipos para la configuración de palmeras
export type PalmSpecies = 
  | 'Phoenix (datilera o canaria)' 
  | 'Washingtonia' 
  | 'Roystonea regia (cubana)' 
  | 'Syagrus romanzoffiana (cocotera)' 
  | 'Livistona' 
  | 'Kentia (palmito)'
  | 'Phoenix roebelenii(pigmea)'
  | 'cycas revoluta (falsa palmera)';

export type PalmHeight = '0-4' | '4-8' | '8-12' | '12+' | '0-5' | '5-12' | '12-20' | '20+' | '0-2' | '2+';
export type PalmCondition = 'normal' | 'descuidada' | 'muy_descuidada';
export type WasteRemovalOption = 'included' | 'extra_percentage' | 'not_included' | 'extra_fixed'; // Kept extra_fixed for backward compatibility just in case

export interface PalmPricingConfig {
  species_prices: Record<PalmSpecies, number>; 
  height_prices: Record<PalmSpecies, Partial<Record<PalmHeight, number>>>; 
  condition_surcharges: Record<PalmCondition, number>; 
  waste_removal: {
    option: WasteRemovalOption;
    fixed_price?: number; // Deprecated in favor of percentage, but kept for type safety
    percentage?: number; // New field for percentage surcharge
  };
  selected_species?: PalmSpecies[]; // New field to track user selection
}

// Valores por defecto SOLO para inicializar estructura, NO para mostrar valores si no existen
const EMPTY_CONFIG: PalmPricingConfig = {
  species_prices: {
    'Phoenix (datilera o canaria)': 0, 
    'Washingtonia': 0, 
    'Roystonea regia (cubana)': 0, 
    'Syagrus romanzoffiana (cocotera)': 0, 
    'Livistona': 0, 
    'Kentia (palmito)': 0,
    'Phoenix roebelenii(pigmea)': 0,
    'cycas revoluta (falsa palmera)': 0
  },
  height_prices: {
    'Phoenix (datilera o canaria)': { '0-5': 0, '5-12': 0, '12-20': 0, '20+': 0 },
    'Washingtonia': { '0-5': 0, '5-12': 0, '12-20': 0, '20+': 0 },
    'Roystonea regia (cubana)': { '0-5': 0, '5-12': 0, '12-20': 0, '20+': 0 },
    'Syagrus romanzoffiana (cocotera)': { '0-5': 0, '5-12': 0, '12-20': 0, '20+': 0 },
    'Livistona': { '0-2': 0, '2+': 0 },
    'Kentia (palmito)': { '0-2': 0, '2+': 0 },
    'Phoenix roebelenii(pigmea)': { '0-2': 0, '2+': 0 },
    'cycas revoluta (falsa palmera)': { '0-2': 0 }
  },
  condition_surcharges: { 'normal': 0, 'descuidada': 20, 'muy_descuidada': 50 },
  waste_removal: { option: 'not_included', percentage: 0 }, // Default changed to not_included as requested "Eliminar opción Incluida en precio base" logic
  selected_species: [] // Default empty
};

const LARGE_PALMS: PalmSpecies[] = [
  'Phoenix (datilera o canaria)',
  'Washingtonia',
  'Roystonea regia (cubana)',
  'Syagrus romanzoffiana (cocotera)'
];

const SMALL_PALMS: PalmSpecies[] = [
  'Livistona',
  'Kentia (palmito)',
  'Phoenix roebelenii(pigmea)',
  'cycas revoluta (falsa palmera)'
];

interface Props {
  value?: PalmPricingConfig;
  onChange: (config: PalmPricingConfig) => void;
  onSave?: (config: PalmPricingConfig) => Promise<void>;
}

const PalmPricingConfigurator: React.FC<Props> = ({ value, onChange, onSave }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showGlobalInfo, setShowGlobalInfo] = useState(false);
  const [touchedCells, setTouchedCells] = useState<Record<string, boolean>>({});
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showGlobalError, setShowGlobalError] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);

  // Clear global error when validation errors are resolved
  useEffect(() => {
    if (validationErrors.length === 0) {
      setShowGlobalError(false);
    }
  }, [validationErrors]);
  
  // Initialize config with passed value or EMPTY structure
  // Si value es undefined o le faltan claves nuevas, fusionamos con EMPTY_CONFIG
  const config = React.useMemo(() => {
    if (!value) return EMPTY_CONFIG;
    // Deep merge manual muy básico para asegurar que existen todas las claves nuevas
    const merged = {
        ...EMPTY_CONFIG,
        ...value,
        species_prices: { ...EMPTY_CONFIG.species_prices, ...value.species_prices },
        height_prices: { ...EMPTY_CONFIG.height_prices, ...value.height_prices },
        condition_surcharges: { ...EMPTY_CONFIG.condition_surcharges, ...value.condition_surcharges },
        waste_removal: { ...EMPTY_CONFIG.waste_removal, ...value.waste_removal },
        selected_species: value.selected_species || []
    };
    
    // Si selected_species es undefined (no existe en la config entrante), intentamos poblarlo
    // Solo para migración de datos antiguos que no tengan este campo.
    // Si es un array vacío [], respetamos la decisión del usuario de borrar todo.
    if (value && value.selected_species === undefined) {
        const detectedSpecies: PalmSpecies[] = [];
        Object.entries(merged.species_prices).forEach(([species, price]) => {
            if (price > 0) detectedSpecies.push(species as PalmSpecies);
        });
        if (detectedSpecies.length > 0) {
            merged.selected_species = detectedSpecies;
        }
    }
    
    return merged;
  }, [value]);

  // Derived state for active species in each category
  const activeLargePalms = LARGE_PALMS.filter(s => config.selected_species?.includes(s));
  const activeSmallPalms = SMALL_PALMS.filter(s => config.selected_species?.includes(s));
  
  // Available species to add
  const availableLargePalms = LARGE_PALMS.filter(s => !config.selected_species?.includes(s));
  const availableSmallPalms = SMALL_PALMS.filter(s => !config.selected_species?.includes(s));

  const addSpecies = (species: PalmSpecies) => {
    const currentSelected = config.selected_species || [];
    if (!currentSelected.includes(species)) {
        onChange({
            ...config,
            selected_species: [...currentSelected, species]
        });
    }
  };

  const removeSpecies = (species: PalmSpecies) => {
      const currentSelected = config.selected_species || [];
      onChange({
          ...config,
          selected_species: currentSelected.filter(s => s !== species),
          // Opcional: Resetear precios al eliminar? Mejor no, por si fue error.
      });
  };

  // Helper to identify groups
  const getMultipliers = (species: PalmSpecies) => {
    // Large Palms
    if (['Phoenix (datilera o canaria)', 'Washingtonia', 'Roystonea regia (cubana)'].includes(species)) {
      return { '5-12': 1.30, '12-20': 1.70, '20+': 2.00 }; // +30%, +70%, +100% sobre base (0-5)
    }
    if (species === 'Syagrus romanzoffiana (cocotera)') {
      return { '5-12': 1.25, '12-20': 1.60, '20+': 2.00 }; // +25%, +60%, +100%
    }
    
    // Small Palms
    // Livistona, Kentia, Phoenix roebelenii
    if (['Livistona', 'Kentia (palmito)', 'Phoenix roebelenii(pigmea)'].includes(species)) {
        return { '2+': 1.30 }; // +30%
    }
    
    return {};
  };

  const calculateSuggestion = (species: PalmSpecies, height: PalmHeight, basePrice: number) => {
    if (!basePrice || basePrice <= 0) return 0;
    const m = getMultipliers(species);
    // @ts-ignore
    const multiplier = m[height] || 1;
    if (multiplier === 1) return 0; // Si no hay multiplicador definido, no sugerir nada
    return Math.round(basePrice * multiplier);
  };

  const handlePriceChange = (species: PalmSpecies, height: PalmHeight, newPrice: number) => {
    const currentHeights = { ...(config.height_prices[species] || {}) };
    currentHeights[height] = newPrice;
    
    // Si editamos el base, actualizamos species_prices también
    const newSpeciesPrices = { ...config.species_prices };
    const isBase = height === '0-5' || height === '0-2';
    
    if (isBase) {
        newSpeciesPrices[species] = newPrice;
    }

    // Marcar celda como tocada para no volver a mostrar sugerencia
    setTouchedCells(prev => ({
      ...prev,
      [`${species}-${height}`]: true
    }));

    onChange({
      ...config,
      species_prices: newSpeciesPrices,
      height_prices: {
        ...config.height_prices,
        [species]: currentHeights
      }
    });
  };

  const applySuggestion = (species: PalmSpecies, height: PalmHeight, suggestedPrice: number) => {
    handlePriceChange(species, height, suggestedPrice);
  };

  const handleConditionSurchargeChange = (condition: PalmCondition, percentage: number) => {
    onChange({
      ...config,
      condition_surcharges: {
        ...config.condition_surcharges,
        [condition]: percentage
      }
    });
  };

  const handleReset = () => {
    setShowResetModal(true);
  };

  const confirmReset = async () => {
    setShowResetModal(false);
    onChange(EMPTY_CONFIG);
    setValidationErrors([]);
    setShowGlobalError(false);
    setTouchedCells({});
    
    // Si tenemos función de guardado, sincronizamos con DB inmediatamente
    if (onSave) {
      try {
        setIsSaving(true);
        await onSave(EMPTY_CONFIG);
      } catch (error) {
        console.error('Error al resetear en DB:', error);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const cancelReset = () => {
    setShowResetModal(false);
  };

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    // Validación: Todos los campos de especies seleccionadas deben tener precio > 0
    const errors: string[] = [];
    const selected = config.selected_species || [];
    
    if (selected.length === 0) {
        // Permitir guardar vacío? O exigir al menos una especie si el servicio está activo?
        // Asumiremos que si no hay especies, está ok (servicio sin configurar detalles)
    } else {
        selected.forEach(species => {
            const isLarge = LARGE_PALMS.includes(species);
            const isSmall = SMALL_PALMS.includes(species);
            const isCycas = species === 'cycas revoluta (falsa palmera)';
            
            // Check base prices or specific heights
            if (isLarge) {
                const heights: PalmHeight[] = ['0-5', '5-12', '12-20', '20+'];
                heights.forEach(h => {
                    // @ts-ignore
                    if (!config.height_prices[species]?.[h] || config.height_prices[species]?.[h] <= 0) {
                        errors.push(`${species}-${h}`);
                    }
                });
            } else if (isSmall) {
                 // @ts-ignore
                if (!config.height_prices[species]?.['0-2'] || config.height_prices[species]?.['0-2'] <= 0) {
                     errors.push(`${species}-0-2`);
                }
                if (!isCycas) {
                    // @ts-ignore
                    if (!config.height_prices[species]?.['2+'] || config.height_prices[species]?.['2+'] <= 0) {
                        errors.push(`${species}-2+`);
                    }
                }
            }
        });

        // Validate surcharges
        if (config.condition_surcharges['descuidada'] <= 0) {
            errors.push('surcharge-descuidada');
        }
        if (config.condition_surcharges['muy_descuidada'] <= 0) {
            errors.push('surcharge-muy_descuidada');
        }

        // Validate waste removal
        if (!config.waste_removal.percentage || config.waste_removal.percentage <= 0) {
            errors.push('waste-percentage');
        }
    }

    if (errors.length > 0) {
        setValidationErrors(errors);
        setShowGlobalError(true);
        return;
    }
    
    // Limpiar errores si pasa validación
    setValidationErrors([]);
    setShowGlobalError(false);

    if (!onSave) {
      return;
    }
    try {
      setIsSaving(true);
      await onSave(config);
    } catch (error) {
      console.error('Error saving palm config:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const renderCell = (species: PalmSpecies, height: PalmHeight, basePrice: number) => {
     // Get current value
     // @ts-ignore
     const value = config.height_prices[species]?.[height] ?? 0;
     const hasError = validationErrors.includes(`${species}-${height}`);
     
     // Calculate suggestion
     const isTouched = touchedCells[`${species}-${height}`];
     // Sugerencia solo si: activado, no tocado, valor es 0, y hay precio base
     const suggestion = (showSuggestions && !isTouched && value === 0 && basePrice > 0) 
        ? calculateSuggestion(species, height, basePrice) 
        : null;

     if (suggestion && suggestion > 0) {
         return (
             <div className={`relative flex items-center justify-between md:justify-center w-full h-11 px-3 bg-blue-50/50 md:border md:rounded-lg border-0 rounded-none ${hasError ? 'ring-2 ring-red-500' : 'md:border-blue-100'}`}>
                 <span 
                    className="text-blue-600 font-medium cursor-pointer hover:text-blue-800 text-base sm:text-sm"
                    onClick={(e) => {
                        e.stopPropagation();
                        handlePriceChange(species, height, suggestion);
                    }}
                 >
                     {suggestion} €
                 </span>
                 <button
                     type="button"
                     onClick={() => applySuggestion(species, height, suggestion)}
                     className="p-1.5 bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 transition-colors ml-2"
                     title="Aceptar sugerencia"
                 >
                     <Check className="w-4 h-4" />
                 </button>
             </div>
         );
     }
     return (
         <div className="relative w-full h-full">
             <input
                type="number"
                min="0"
                className={`w-full h-full md:h-11 pl-3 pr-8 text-right text-base sm:text-sm transition-all md:border md:rounded-lg md:shadow-sm border-0 rounded-none focus:ring-2 focus:ring-green-500 focus:ring-inset focus:border-green-500 ${hasError ? 'md:border-red-500 bg-red-50' : (value > 0 ? 'bg-white md:border-gray-300' : 'bg-gray-50 md:border-gray-200')}`}
                value={value === 0 ? '' : value}
                placeholder={value === 0 ? '-' : ''}
                onChange={(e) => {
                    handlePriceChange(species, height, Number(e.target.value));
                    if (hasError) {
                        setValidationErrors(prev => prev.filter(err => err !== `${species}-${height}`));
                    }
                }}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium">€</span>
         </div>
     );
  };

  return (
    <div className="space-y-8">
      
      {/* 1. Header with Info */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 text-lg">
                Configuración de tarifas base por especie y altura (IVA incluido)
            </h3>
            <div className="relative">
                <button 
                    type="button"
                    onClick={() => setShowGlobalInfo(!showGlobalInfo)}
                    className="text-gray-400 hover:text-blue-500 transition-colors"
                >
                    <Info className="w-5 h-5" />
                </button>
                {/* Info Tooltip/Popover */}
                {showGlobalInfo && (
                    <>
                        <div className="fixed inset-0 z-40 bg-black/20 md:hidden" onClick={() => setShowGlobalInfo(false)} />
                        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90vw] max-w-xs p-6 bg-white rounded-xl shadow-xl border border-gray-100 text-sm text-gray-600 md:absolute md:top-8 md:left-0 md:translate-x-0 md:translate-y-0 md:w-64 md:p-4 md:shadow-lg md:border-blue-100 md:rounded-lg">
                            <ul className="list-disc pl-4 space-y-2">
                                <li>Los precios mostrados son <strong>base por palmera</strong>.</li>
                                <li>Los precios <strong>no incluyen la retirada de restos</strong>.</li>
                                <li>El <strong>IVA está incluido</strong>.</li>
                            </ul>
                        </div>
                    </>
                )}
            </div>
        </div>
        
        {/* Switch Sugerencias */}
        <div className="flex items-center justify-between w-full md:w-auto gap-3 bg-gray-50 p-3 rounded-lg md:bg-transparent md:p-0 border border-gray-100 md:border-0">
            <span className="text-sm font-medium text-gray-700">Mostrar sugerencias de precios</span>
            <button
                type="button"
                onClick={() => setShowSuggestions(!showSuggestions)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${showSuggestions ? 'bg-green-600' : 'bg-gray-200'}`}
            >
                <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${showSuggestions ? 'translate-x-6' : 'translate-x-1'}`}
                />
            </button>
        </div>
      </div>

      {/* 1. Precios Base por Especie y Altura */}
      <div className="space-y-8">
        {/* Tabla de Especies Grandes */}
        <div>
          <div className="flex flex-col gap-1 mb-4">
             <div className="flex items-center gap-2">
                <h4 className="font-bold text-gray-800 text-sm uppercase tracking-wide">Especies Grandes</h4>
                <span className="flex items-center gap-1 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded border border-red-200 font-semibold">
                    <AlertCircle className="w-3 h-3" />
                    Solo profesionales
                </span>
             </div>
             <p className="text-sm text-gray-500 italic">
                Son palmeras que normalmente requieren trepa o medios especiales. Solo para jardineros especializados.
             </p>
             
             {/* Selector para añadir especie */}
             <div className="mt-2 flex items-center gap-2">
                <div className="relative inline-block w-full sm:w-64">
                    <select
                        className="w-full h-10 pl-3 pr-8 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                        onChange={(e) => {
                            if (e.target.value) {
                                addSpecies(e.target.value as PalmSpecies);
                                e.target.value = ''; // Reset select
                            }
                        }}
                        defaultValue=""
                    >
                        <option value="" disabled>Añadir especie grande...</option>
                        {availableLargePalms.map(s => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                </div>
             </div>
          </div>
          
          <div className="-mx-4 md:mx-0 md:border md:rounded-xl md:overflow-hidden md:shadow-sm md:bg-white border-y border-gray-200">
            {/* Desktop Header - Visible only on md+ */}
            <div className="hidden md:grid md:grid-cols-12 gap-4 bg-gray-50 p-4 border-b text-sm font-semibold text-gray-700 items-center">
                <div className="md:col-span-3">Especie</div>
                <div className="md:col-span-2 text-center">0–5 m</div>
                <div className="md:col-span-2 text-center">&gt;5–12 m</div>
                <div className="md:col-span-2 text-center">&gt;12–20 m</div>
                <div className="md:col-span-2 text-center">&gt;20 m</div>
                <div className="md:col-span-1"></div>
            </div>

            {/* Content */}
            {activeLargePalms.length > 0 ? (
                <div className="divide-y divide-gray-100">
                    {activeLargePalms.map((species) => {
                       const p0_5 = config.height_prices[species]?.['0-5'] ?? 0;
                       return (
                        <div key={species} className="pt-4 pb-0 px-0 md:p-4 hover:bg-gray-50 transition-colors">
                          <div className="flex flex-col md:grid md:grid-cols-12 md:gap-4 md:items-center">
                            
                            {/* Species Name Row (Mobile: Top, Desktop: Left) */}
                            <div className="flex justify-between items-center mb-3 px-4 md:mb-0 md:px-0 md:col-span-3">
                                <span className="font-bold text-gray-800 text-sm md:text-sm md:font-medium md:text-gray-700">{species}</span>
                                <button
                                  type="button"
                                  onClick={() => removeSpecies(species)}
                                  className="text-red-500 p-2 bg-red-50 rounded-lg md:hidden"
                                  title="Eliminar especie"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>

                            {/* Inputs Grid (Mobile: 4 cols below name, Desktop: Inline) */}
                            <div className="grid grid-cols-4 md:grid-cols-8 md:col-span-8 gap-0 md:gap-4 border-t border-gray-100 md:border-t-0">
                                <div className="space-y-1 md:space-y-0 md:col-span-2 border-r border-gray-200">
                                    <label className="block text-[10px] text-center font-medium text-gray-500 md:hidden truncate">0-5m</label>
                                    {renderCell(species, '0-5', 0)}
                                </div>
                                <div className="space-y-1 md:space-y-0 md:col-span-2 border-r border-gray-200">
                                    <label className="block text-[10px] text-center font-medium text-gray-500 md:hidden truncate">5-12m</label>
                                    {renderCell(species, '5-12', p0_5)}
                                </div>
                                <div className="space-y-1 md:space-y-0 md:col-span-2 border-r border-gray-200">
                                    <label className="block text-[10px] text-center font-medium text-gray-500 md:hidden truncate">12-20m</label>
                                    {renderCell(species, '12-20', p0_5)}
                                </div>
                                <div className="space-y-1 md:space-y-0 md:col-span-2">
                                    <label className="block text-[10px] text-center font-medium text-gray-500 md:hidden truncate">&gt;20m</label>
                                    {renderCell(species, '20+', p0_5)}
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
                      );
                    })}
                </div>
            ) : (
                <div className="p-8 text-center text-gray-500 bg-gray-50">
                    <p className="mb-2 font-medium">No hay especies grandes seleccionadas.</p>
                    <p className="text-sm">Usa el desplegable de arriba para añadir una.</p>
                </div>
            )}
          </div>
        </div>

        {/* Tabla de Especies Pequeñas */}
        <div>
          <div className="mb-3">
              <h4 className="font-bold text-gray-800 text-sm uppercase tracking-wide">Especies Pequeñas</h4>
              <p className="text-sm text-gray-500 italic">
                Son palmeras o plantas grandes que se trabajan desde suelo o escalera.
              </p>
              
              {/* Selector para añadir especie */}
              <div className="mt-2 flex items-center gap-2">
                 <div className="relative inline-block w-full sm:w-64">
                     <select
                         className="w-full h-10 pl-3 pr-8 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                         onChange={(e) => {
                             if (e.target.value) {
                                 addSpecies(e.target.value as PalmSpecies);
                                 e.target.value = ''; // Reset select
                             }
                         }}
                         defaultValue=""
                     >
                         <option value="" disabled>Añadir especie pequeña...</option>
                         {availableSmallPalms.map(s => (
                             <option key={s} value={s}>{s}</option>
                         ))}
                     </select>
                 </div>
              </div>
          </div>

          <div className="-mx-4 md:mx-0 md:border md:rounded-xl md:overflow-hidden md:shadow-sm md:bg-white border-y border-gray-200">
             {/* Desktop Header - Visible only on md+ */}
             <div className="hidden md:grid md:grid-cols-12 gap-4 bg-gray-50 p-4 border-b text-sm font-semibold text-gray-700 items-center">
                <div className="md:col-span-6">Especie</div>
                <div className="md:col-span-2 text-center">0–2 m</div>
                <div className="md:col-span-2 text-center">&gt;2 m</div>
                <div className="md:col-span-2"></div>
             </div>

             {/* Content */}
             {activeSmallPalms.length > 0 ? (
                 <div className="divide-y divide-gray-100">
                    {activeSmallPalms.map((species) => {
                       const p0_2 = config.height_prices[species]?.['0-2'] ?? 0;
                       const isCycas = species === 'cycas revoluta (falsa palmera)';

                       return (
                        <div key={species} className="pt-4 pb-0 px-0 md:p-4 hover:bg-gray-50 transition-colors">
                          <div className="flex flex-col md:grid md:grid-cols-12 md:gap-4 md:items-center">
                            
                            {/* Species Row (Mobile: Top, Desktop: Left) */}
                            <div className="flex justify-between items-center mb-3 px-4 md:mb-0 md:px-0 md:col-span-6">
                                <span className="font-bold text-gray-800 text-sm md:text-sm md:font-medium md:text-gray-700">{species}</span>
                                <button
                                  type="button"
                                  onClick={() => removeSpecies(species)}
                                  className="text-red-500 p-2 bg-red-50 rounded-lg md:hidden"
                                  title="Eliminar especie"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>

                            {/* Inputs Grid (Mobile: 2 cols, Desktop: Inline) */}
                            <div className="grid grid-cols-2 md:grid-cols-4 md:col-span-4 gap-0 md:gap-4 border-t border-gray-100 md:border-t-0">
                                <div className="space-y-1 md:space-y-0 md:col-span-2 border-r border-gray-200">
                                    <label className="block text-xs text-center font-medium text-gray-500 md:hidden">0-2m</label>
                                    {renderCell(species, '0-2', 0)}
                                </div>
                                <div className="space-y-1 md:space-y-0 md:col-span-2">
                                    <label className="block text-xs text-center font-medium text-gray-500 md:hidden">&gt;2m</label>
                                    {isCycas ? (
                                        <div className="h-full md:h-11 flex items-center justify-center bg-gray-50 md:rounded-lg md:border border-0 md:border-gray-200 text-gray-400 text-sm italic">
                                            N/A
                                        </div>
                                    ) : (
                                        renderCell(species, '2+', p0_2)
                                    )}
                                </div>
                            </div>

                            {/* Desktop Delete */}
                            <div className="hidden md:flex md:col-span-2 justify-center">
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
                      );
                    })}
                 </div>
             ) : (
                <div className="p-8 text-center text-gray-500 bg-gray-50">
                    <p className="mb-2 font-medium">No hay especies pequeñas seleccionadas.</p>
                    <p className="text-sm">Usa el desplegable de arriba para añadir una.</p>
                </div>
             )}
          </div>
        </div>
        
        <p className="text-xs text-gray-500">* Activa las sugerencias para ver precios recomendados basados en el precio base.</p>
      </div>

      <div className="space-y-8 mt-8">
        {/* 2. Suplementos por Estado */}
        <div className="pt-6 border-t border-gray-100">
          <h4 className="font-bold text-gray-900 mb-4 text-lg">
             Suplementos por estado
          </h4>
          <div className="space-y-1 divide-y divide-gray-100">
            <div className="flex items-center justify-between py-3">
              <span className="text-gray-700 font-medium">Normal</span>
              <span className="text-gray-500 text-sm bg-gray-50 px-3 py-1 rounded-full border border-gray-100">Sin recargo</span>
            </div>
            <div className="flex items-center justify-between py-3">
              <span className="text-gray-700 font-medium">Descuidada</span>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 text-sm font-medium">+</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  className={`w-20 h-10 px-3 border rounded-lg text-right text-base sm:text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all ${validationErrors.includes('surcharge-descuidada') ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                  value={config.condition_surcharges['descuidada'] === 0 ? '' : config.condition_surcharges['descuidada']}
                  placeholder="-"
                  onChange={(e) => {
                      handleConditionSurchargeChange('descuidada', Number(e.target.value));
                      if (validationErrors.includes('surcharge-descuidada')) {
                          setValidationErrors(prev => prev.filter(err => err !== 'surcharge-descuidada'));
                      }
                  }}
                />
                <span className="text-gray-500 text-sm font-medium w-4">%</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-3">
              <span className="text-gray-700 font-medium">Muy Descuidada</span>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 text-sm font-medium">+</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  className={`w-20 h-10 px-3 border rounded-lg text-right text-base sm:text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all ${validationErrors.includes('surcharge-muy_descuidada') ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                  value={config.condition_surcharges['muy_descuidada'] === 0 ? '' : config.condition_surcharges['muy_descuidada']}
                  placeholder="-"
                  onChange={(e) => {
                      handleConditionSurchargeChange('muy_descuidada', Number(e.target.value));
                      if (validationErrors.includes('surcharge-muy_descuidada')) {
                          setValidationErrors(prev => prev.filter(err => err !== 'surcharge-muy_descuidada'));
                      }
                  }}
                />
                <span className="text-gray-500 text-sm font-medium w-4">%</span>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Retirada de Restos */}
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
                  max="100"
                  className={`w-20 h-10 px-3 border rounded-lg text-right text-base sm:text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all ${validationErrors.includes('waste-percentage') ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                  value={config.waste_removal.percentage === 0 ? '' : config.waste_removal.percentage}
                  placeholder="-"
                  onChange={(e) => {
                    onChange({
                        ...config,
                        waste_removal: { 
                            option: 'extra_percentage', // Forzamos siempre esta opción internamente
                            percentage: Number(e.target.value) 
                        }
                    });
                    if (validationErrors.includes('waste-percentage')) {
                        setValidationErrors(prev => prev.filter(err => err !== 'waste-percentage'));
                    }
                  }}
                />
                <span className="text-gray-500 text-sm font-medium w-4">%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* 6. Resumen Informativo Final */}
      <div className="mt-6 pt-4 border-t border-gray-100 text-xs text-gray-500 text-center">
        <p>Estas tarifas se usan como base para generar presupuestos automáticos en la plataforma.</p>
        <p>Pueden ajustarse posteriormente en cada servicio individual.</p>
      </div>

      {showGlobalError && (
        <div className="mt-4 p-4 bg-red-50 border-l-4 border-red-500 rounded-r-md flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
            <div>
                <h4 className="text-sm font-semibold text-red-800">Faltan campos por configurar</h4>
                <p className="text-sm text-red-700 mt-1">
                    Por favor, rellena todos los campos marcados en rojo. Asegúrate de completar los precios de especies, suplementos y retirada de restos.
                </p>
            </div>
        </div>
      )}

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end pt-4 border-t border-gray-100 gap-3">
        <button
          type="button"
          onClick={handleReset}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors shadow-sm text-sm font-medium w-full sm:w-auto"
        >
          <RefreshCw className="w-4 h-4" />
          Restablecer datos
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className={`flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-sm text-sm font-medium w-full sm:w-auto ${isSaving ? 'opacity-70 cursor-not-allowed' : ''}`}
        >
          <Save className="w-4 h-4" />
          {isSaving ? 'Guardando...' : 'Guardar configuración de palmeras'}
        </button>
      </div>
      {/* Modal de confirmación de restablecimiento */}
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
                Se eliminarán todos los precios, especies y recargos configurados para la poda de palmeras. Esta acción afectará también a la base de datos.
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

export default PalmPricingConfigurator;
