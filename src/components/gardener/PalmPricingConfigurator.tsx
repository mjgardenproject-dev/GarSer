import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, AlertTriangle, Info, Check, Trash2 } from 'lucide-react';
import { deepEqual } from '../../utils/deepEqual';
import ServiceConfigFooter from './ServiceConfigFooter';

// Tipos para la configuración de palmeras
export type PalmSpecies = 
  | 'Phoenix canariensis'
  | 'Phoenix dactylifera'
  | 'Washingtonia robusta/filifera'
  | 'Syagrus romanzoffiana'
  | 'Trachycarpus fortunei'
  | 'Roystonea regia';

export type PalmHeight = string;
export type PalmCondition = 'normal' | 'descuidado' | 'muy_descuidado';
export type WasteRemovalOption = 'included' | 'extra_percentage' | 'not_included' | 'extra_fixed';

export interface PalmPricingConfig {
  species_prices: Record<PalmSpecies, number>; 
  height_prices: Record<PalmSpecies, Record<string, number>>; 
  condition_surcharges: Record<PalmCondition, number>; 
  access_difficulty: number;
  phytosanitary: number;
  trunk_finish: number;
  waste_removal: {
    option: WasteRemovalOption;
    fixed_price?: number;
    percentage?: number;
  };
  minimum_price: number;
  selected_species?: PalmSpecies[];
}

export const SPECIES_RANGES: Record<PalmSpecies, string[]> = {
  'Phoenix canariensis': ['0-4', '4-10', '>10'],
  'Phoenix dactylifera': ['0-5', '5-10', '10-15', '>15'],
  'Washingtonia robusta/filifera': ['0-4', '4-12', '12-20', '>20'],
  'Syagrus romanzoffiana': ['0-5', '5-10', '>10'],
  'Trachycarpus fortunei': ['0-3', '3-6', '>6'],
  'Roystonea regia': ['0-6', '>6']
};

const EMPTY_CONFIG: PalmPricingConfig = {
  species_prices: {
    'Phoenix canariensis': 0,
    'Phoenix dactylifera': 0,
    'Washingtonia robusta/filifera': 0,
    'Syagrus romanzoffiana': 0,
    'Trachycarpus fortunei': 0,
    'Roystonea regia': 0
  },
  height_prices: {
    'Phoenix canariensis': { '0-4': 0, '4-10': 0, '>10': 0 },
    'Phoenix dactylifera': { '0-5': 0, '5-10': 0, '10-15': 0, '>15': 0 },
    'Washingtonia robusta/filifera': { '0-4': 0, '4-12': 0, '12-20': 0, '>20': 0 },
    'Syagrus romanzoffiana': { '0-5': 0, '5-10': 0, '>10': 0 },
    'Trachycarpus fortunei': { '0-3': 0, '3-6': 0, '>6': 0 },
    'Roystonea regia': { '0-6': 0, '>6': 0 }
  },
  condition_surcharges: { 'normal': 0, 'descuidado': 20, 'muy_descuidado': 50 },
  access_difficulty: 0,
  phytosanitary: 0,
  trunk_finish: 0,
  waste_removal: { option: 'not_included', percentage: 0 },
  minimum_price: 0,
  selected_species: []
};

const PALM_SPECIES: PalmSpecies[] = [
  'Phoenix canariensis',
  'Phoenix dactylifera',
  'Washingtonia robusta/filifera',
  'Syagrus romanzoffiana',
  'Trachycarpus fortunei',
  'Roystonea regia'
];

interface Props {
  value?: PalmPricingConfig;
  initialConfig?: PalmPricingConfig;
  onChange: (config: PalmPricingConfig) => void;
  onSave?: (config: PalmPricingConfig) => Promise<void>;
}

const PalmPricingConfigurator: React.FC<Props> = ({ value, initialConfig, onChange, onSave }) => {
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
        access_difficulty: value.access_difficulty ?? EMPTY_CONFIG.access_difficulty,
        phytosanitary: value.phytosanitary ?? EMPTY_CONFIG.phytosanitary,
        trunk_finish: value.trunk_finish ?? EMPTY_CONFIG.trunk_finish,
        selected_species: value.selected_species || []
    };
    
    // Migración de datos legados para condition_surcharges
    if (value && (value as any).condition_surcharges) {
        const legacySurcharges = (value as any).condition_surcharges;
        if ('descuidada' in legacySurcharges) {
            merged.condition_surcharges.descuidado = legacySurcharges['descuidada'];
        }
        if ('muy_descuidada' in legacySurcharges) {
            merged.condition_surcharges.muy_descuidado = legacySurcharges['muy_descuidada'];
        }
    }
    
    // Si selected_species es undefined (no existe en la config entrante), intentamos poblarlo
    // Solo para migración de datos antiguos que no tengan este campo.
    // Si es un array vacío [], respetamos la decisión del usuario de borrar todo.
    if (value && value.selected_species === undefined) {
        const detectedSpecies: PalmSpecies[] = [];
        Object.entries(merged.species_prices).forEach(([species, price]) => {
            if ((price as number) > 0) detectedSpecies.push(species as PalmSpecies);
        });
        if (detectedSpecies.length > 0) {
            merged.selected_species = detectedSpecies;
        }
    }
    
    return merged;
  }, [value]);

  // Derived state for active species in each category
  const activePalms = PALM_SPECIES.filter(s => config.selected_species?.includes(s));
  
  // Available species to add
  const availablePalms = PALM_SPECIES.filter(s => !config.selected_species?.includes(s));

  const addSpecies = (species: PalmSpecies) => {
    const currentSelected = config.selected_species || [];
    if (!currentSelected.includes(species)) {
        onChange({
            ...config,
            selected_species: [...currentSelected, species],
            species_prices: {
                ...config.species_prices,
                [species]: 0
            },
            height_prices: {
                ...config.height_prices,
                [species]: {}
            }
        });
    }
  };

  const removeSpecies = (species: PalmSpecies) => {
      const currentSelected = config.selected_species || [];
      
      // Create fresh copies of price objects
      const newSpeciesPrices = { ...config.species_prices };
      const newHeightPrices = { ...config.height_prices };
      
      // Delete prices for this species
      if (newSpeciesPrices[species] !== undefined) delete newSpeciesPrices[species];
      if (newHeightPrices[species] !== undefined) delete newHeightPrices[species];

      onChange({
          ...config,
          selected_species: currentSelected.filter(s => s !== species),
          species_prices: newSpeciesPrices,
          height_prices: newHeightPrices
      });
  };

  // Helper to identify groups
  const getMultipliers = (species: PalmSpecies): Record<string, number> => {
    // Palms
    if (['Phoenix canariensis', 'Phoenix dactylifera', 'Washingtonia robusta/filifera', 'Roystonea regia', 'Trachycarpus fortunei'].includes(species)) {
      return { '5-12': 1.30, '12-20': 1.70, '20+': 2.00 }; // +30%, +70%, +100% sobre base (0-5)
    }
    if (species === 'Syagrus romanzoffiana') {
      return { '5-12': 1.25, '12-20': 1.60, '20+': 2.00 }; // +25%, +60%, +100%
    }
    
    return {};
  };

  const calculateSuggestion = (species: PalmSpecies, height: PalmHeight, basePrice: number) => {
    if (!basePrice || basePrice <= 0) return 0;
    const m = getMultipliers(species);
    const multiplier = m[height] || 1;
    if (multiplier === 1) return 0; // Si no hay multiplicador definido, no sugerir nada
    return Math.round(basePrice * multiplier);
  };

  const handlePriceChange = (species: PalmSpecies, height: PalmHeight, newPrice: number) => {
    const currentHeights = { ...(config.height_prices[species] || {}) };
    currentHeights[height] = newPrice;
    
    // Si editamos el base, actualizamos species_prices también
    const newSpeciesPrices = { ...config.species_prices };
    const isBase = SPECIES_RANGES[species] && height === SPECIES_RANGES[species][0];
    
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

  // Determine if dirty
  const isDirty = useMemo(() => {
    // Si no hay configuración inicial guardada, comparamos con la vacía
    // Pero si initialConfig es undefined, puede significar que no se ha cargado aún o que no existe.
    // Asumiremos que si se pasa initialConfig, se usa. Si es undefined, se asume EMPTY.
    const baseToCompare = initialConfig || EMPTY_CONFIG;

    // Procesar igual que config para normalizar
    const processedBase = {
        ...EMPTY_CONFIG,
        ...baseToCompare,
        species_prices: { ...EMPTY_CONFIG.species_prices, ...baseToCompare.species_prices },
        height_prices: { ...EMPTY_CONFIG.height_prices, ...baseToCompare.height_prices },
        condition_surcharges: { ...EMPTY_CONFIG.condition_surcharges, ...baseToCompare.condition_surcharges },
        waste_removal: { ...EMPTY_CONFIG.waste_removal, ...baseToCompare.waste_removal },
        access_difficulty: baseToCompare.access_difficulty ?? EMPTY_CONFIG.access_difficulty,
        phytosanitary: baseToCompare.phytosanitary ?? EMPTY_CONFIG.phytosanitary,
        trunk_finish: baseToCompare.trunk_finish ?? EMPTY_CONFIG.trunk_finish,
        selected_species: baseToCompare.selected_species || []
    };
    
    // Misma lógica de migración para selected_species
    if (baseToCompare.selected_species === undefined) {
        const detectedSpecies: PalmSpecies[] = [];
        Object.entries(processedBase.species_prices).forEach(([species, price]) => {
            if ((price as number) > 0) detectedSpecies.push(species as PalmSpecies);
        });
        if (detectedSpecies.length > 0) {
            processedBase.selected_species = detectedSpecies;
        }
    }

    return !deepEqual(config, processedBase);
  }, [config, initialConfig]);

  const handleSave = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    
    // Validación: Todos los campos de especies seleccionadas deben tener precio > 0
    const errors: string[] = [];
    const selected = config.selected_species || [];
    
    if (selected.length === 0) {
        // Permitir guardar vacío? O exigir al menos una especie si el servicio está activo?
        // Asumiremos que si no hay especies, está ok (servicio sin configurar detalles)
    } else {
        selected.forEach(species => {
            const isPalm = PALM_SPECIES.includes(species);
            
            // Check base prices or specific heights
            if (isPalm) {
                const heights = SPECIES_RANGES[species] || [];
                const speciesHeights = config.height_prices[species];
                heights.forEach(h => {
                    if (!speciesHeights?.[h] || speciesHeights[h] <= 0) {
                        errors.push(`${species}-${h}`);
                    }
                });
            }
        });

        // Validate surcharges
        if (config.condition_surcharges['descuidado'] <= 0) {
            errors.push('surcharge-descuidado');
        }
        if (config.condition_surcharges['muy_descuidado'] <= 0) {
            errors.push('surcharge-muy_descuidado');
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

    if (!config.minimum_price || config.minimum_price <= 0) {
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
     const speciesHeights = config.height_prices[species];
     const value = speciesHeights?.[height] ?? 0;
     const hasError = validationErrors.includes(`${species}-${height}`);
     
     // Calculate suggestion
     const isTouched = touchedCells[`${species}-${height}`];
     // Sugerencia solo si: activado, no tocado, valor es 0, y hay precio base
     const suggestion = (showSuggestions && !isTouched && value === 0 && basePrice > 0) 
        ? calculateSuggestion(species, height, basePrice) 
        : null;

     if (suggestion && suggestion > 0) {
         return (
             <div className={`relative flex items-center justify-between md:justify-center w-full h-11 rounded-lg border border-blue-200 bg-blue-50/70 px-3 ${hasError ? 'ring-2 ring-red-500' : 'md:border-blue-100'}`}>
                 <span 
                    className="text-blue-600 font-medium cursor-pointer hover:text-blue-800 text-[17px] md:text-sm"
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
        <div className="relative w-full">
             <input
                type="number"
                min="0"
            className={`w-full h-11 md:h-11 pl-[1px] pr-6 text-right text-[17px] md:text-sm transition-all border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 ${hasError ? 'border-red-400 bg-red-50 md:border-red-500' : (value > 0 ? 'border-slate-200 bg-white md:border-gray-300' : 'border-slate-200 bg-slate-50 md:border-gray-200')}`}
                value={value === 0 ? '' : value}
                placeholder={value === 0 ? '-' : ''}
                onChange={(e) => {
                    handlePriceChange(species, height, Number(e.target.value));
                    if (hasError) {
                        setValidationErrors(prev => prev.filter(err => err !== `${species}-${height}`));
                    }
                }}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 leading-none text-gray-400 text-sm font-medium">€</span>
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
                onChange={(e) => onChange({ ...config, minimum_price: parseFloat(e.target.value) || 0 })}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium">€</span>
            </div>
          </div>
        </div>
      </div>

      {/* 1. Precios Base por Especie y Altura */}
      <div className="space-y-8">
        {/* Tabla de Especies */}
        <div>
          <div className="flex flex-col gap-1 mb-4">
             <div className="flex items-center gap-2">
                <h4 className="font-bold text-gray-800 text-sm uppercase tracking-wide">Especies de palmeras</h4>
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
                        <option value="" disabled>Añadir especie...</option>
                        {availablePalms.map(s => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                </div>
             </div>
          </div>
          
          <div className="-mx-1 rounded-xl border border-slate-200 bg-white shadow-sm md:mx-0 md:border md:rounded-xl md:overflow-hidden md:shadow-sm md:bg-white">
            {/* Content */}
            {activePalms.length > 0 ? (
                <div className="divide-y divide-slate-100">
                    {activePalms.map((species) => {
                       const speciesRanges = SPECIES_RANGES[species] || [];
                       const p0_5 = config.height_prices[species]?.[speciesRanges[0]] ?? 0;
                       return (
                        <div key={species} className="pt-3 pb-2 md:p-4 hover:bg-gray-50 transition-colors">
                          <div className="flex flex-col md:gap-4">
                            
                            {/* Species Name Row */}
                            <div className="flex justify-between items-center mb-3 px-4 md:mb-0 md:px-0">
                                <div className="flex flex-col">
                                    <span className="font-bold text-gray-800 text-sm md:text-sm md:font-medium md:text-gray-700">{species}</span>
                                    {species === 'Roystonea regia' && (
                                        <span className="text-xs text-amber-600 mt-0.5">
                                            Especie de tronco liso (prohibido uso de espuelas). Su precio suele calcularse en base al alquiler de plataforma elevadora.
                                        </span>
                                    )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeSpecies(species)}
                                  className="text-red-500 p-2 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                                  title="Eliminar especie"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>

                            {/* Inputs Grid */}
                            <div className="grid gap-1 px-1 pb-1 border-t border-slate-100 pt-2 md:pt-0 md:gap-4 md:px-0 md:pb-0 md:border-t-0" style={{ gridTemplateColumns: `repeat(${speciesRanges.length}, minmax(0, 1fr))` }}>
                                {speciesRanges.map((range, idx) => (
                                    <div key={range} className={`space-y-1 md:space-y-2 ${idx < speciesRanges.length - 1 ? 'md:border-r md:border-gray-200 pr-2' : ''}`}>
                                        <label className="block text-[11px] md:text-[13px] leading-[1.15] text-center font-medium text-gray-500">
                                          <span className="block">{range}m</span>
                                          <span className="block text-[10px] md:text-[11px] text-gray-400">€/palmera</span>
                                        </label>
                                        {renderCell(species, range, idx === 0 ? 0 : p0_5)}
                                    </div>
                                ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
            ) : (
                <div className="p-8 text-center text-gray-500 bg-gray-50">
                    <p className="mb-2 font-medium">No hay especies de palmeras seleccionadas.</p>
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
              <div className="flex items-center gap-2 group relative">
                <span className="text-gray-700 font-medium">Normal</span>
                <Info className="w-4 h-4 text-gray-400 cursor-help group-hover:text-blue-500 transition-colors" />
                <div className="absolute left-0 sm:left-1/2 sm:-translate-x-1/2 bottom-full mb-2 w-[250px] sm:w-64 p-2 bg-gray-900 text-white text-xs rounded shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 text-left sm:text-center pointer-events-none">
                  Palmera con mantenimiento regular. Presenta hojas secas habituales pero no acumulación. Es una poda estándar que no requiere tiempo ni esfuerzo adicional.
                  <div className="absolute -bottom-1 left-12 sm:left-1/2 sm:-translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45"></div>
                </div>
              </div>
              <span className="text-gray-500 text-sm bg-gray-50 px-3 py-1 rounded-full border border-gray-100">Sin recargo</span>
            </div>
            <div className="flex items-center justify-between py-3">
              <div className="flex items-center gap-2 group relative">
                <span className="text-gray-700 font-medium">Descuidado</span>
                <Info className="w-4 h-4 text-gray-400 cursor-help group-hover:text-blue-500 transition-colors" />
                <div className="absolute left-0 sm:left-1/2 sm:-translate-x-1/2 bottom-full mb-2 w-[250px] sm:w-64 p-2 bg-gray-900 text-white text-xs rounded shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 text-left sm:text-center pointer-events-none">
                  Palmera con una falda (acumulación de hojas secas) de tamaño moderado. Implica una dificultad técnica y un tiempo de ejecución superiores a la poda estándar.
                  <div className="absolute -bottom-1 left-12 sm:left-1/2 sm:-translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45"></div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 text-sm font-medium">+</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  className={`w-20 h-10 px-3 border rounded-lg text-right text-base sm:text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all ${validationErrors.includes('surcharge-descuidado') ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                  value={config.condition_surcharges['descuidado'] === 0 ? '' : config.condition_surcharges['descuidado']}
                  placeholder="-"
                  onChange={(e) => {
                      handleConditionSurchargeChange('descuidado', Number(e.target.value));
                      if (validationErrors.includes('surcharge-descuidado')) {
                          setValidationErrors(prev => prev.filter(err => err !== 'surcharge-descuidado'));
                      }
                  }}
                />
                <span className="text-gray-500 text-sm font-medium w-4">%</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-3">
              <div className="flex items-center gap-2 group relative">
                <span className="text-gray-700 font-medium">Muy descuidado</span>
                <Info className="w-4 h-4 text-gray-400 cursor-help group-hover:text-blue-500 transition-colors" />
                <div className="absolute left-0 sm:left-1/2 sm:-translate-x-1/2 bottom-full mb-2 w-[250px] sm:w-64 p-2 bg-gray-900 text-white text-xs rounded shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 text-left sm:text-center pointer-events-none">
                  Palmera en estado de abandono notable. Presenta una falda grande y densa. Exige al podador el nivel máximo de esfuerzo y tiempo para su limpieza y preparación.
                  <div className="absolute -bottom-1 left-12 sm:left-1/2 sm:-translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45"></div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 text-sm font-medium">+</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  className={`w-20 h-10 px-3 border rounded-lg text-right text-base sm:text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all ${validationErrors.includes('surcharge-muy_descuidado') ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                  value={config.condition_surcharges['muy_descuidado'] === 0 ? '' : config.condition_surcharges['muy_descuidado']}
                  placeholder="-"
                  onChange={(e) => {
                      handleConditionSurchargeChange('muy_descuidado', Number(e.target.value));
                      if (validationErrors.includes('surcharge-muy_descuidado')) {
                          setValidationErrors(prev => prev.filter(err => err !== 'surcharge-muy_descuidado'));
                      }
                  }}
                />
                <span className="text-gray-500 text-sm font-medium w-4">%</span>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Suplementos Adicionales */}
        <div className="pt-6 border-t border-gray-100">
          <h4 className="font-bold text-gray-900 mb-4 text-lg">Suplementos adicionales</h4>
          <div className="space-y-1 divide-y divide-gray-100">
            <div className="flex items-center justify-between py-3 gap-3">
              <div className="min-w-0 pr-4">
                <span className="block text-sm font-medium text-gray-900">Dificultad de acceso</span>
                <span className="text-xs text-gray-500">Recargo por acceso bloqueado o uso necesario de grúa.</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-gray-400 text-sm font-medium">+</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  className="w-20 h-10 px-3 border border-gray-300 rounded-lg text-right text-base sm:text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all"
                  value={config.access_difficulty === 0 ? '' : config.access_difficulty}
                  placeholder="-"
                  onChange={(e) => onChange({ ...config, access_difficulty: Number(e.target.value) })}
                />
                <span className="text-gray-500 text-sm font-medium w-4">%</span>
              </div>
            </div>

            <div className="flex items-center justify-between py-3 gap-3">
              <div className="min-w-0 pr-4">
                <span className="block text-sm font-medium text-gray-900">Tratamiento fitosanitario</span>
                <span className="text-xs text-gray-500">Precio fijo por palmera (ej. contra Picudo Rojo).</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-gray-400 text-sm font-medium">+</span>
                <input
                  type="number"
                  min="0"
                  className="w-20 h-10 px-3 border border-gray-300 rounded-lg text-right text-base sm:text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all"
                  value={config.phytosanitary === 0 ? '' : config.phytosanitary}
                  placeholder="-"
                  onChange={(e) => onChange({ ...config, phytosanitary: Number(e.target.value) })}
                />
                <span className="text-gray-500 text-sm font-medium w-4">€</span>
              </div>
            </div>

            <div className="flex items-center justify-between py-3 gap-3">
              <div className="min-w-0 pr-4">
                <span className="block text-sm font-medium text-gray-900">Acabado de tronco</span>
                <span className="text-xs text-gray-500">Incremento porcentual sobre el valor actual por cepillado o acabado estético.</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-gray-400 text-sm font-medium">+</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  className="w-20 h-10 px-3 border border-gray-300 rounded-lg text-right text-base sm:text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all"
                  value={config.trunk_finish === 0 ? '' : config.trunk_finish}
                  placeholder="-"
                  onChange={(e) => onChange({ ...config, trunk_finish: Number(e.target.value) })}
                />
                <span className="text-gray-500 text-sm font-medium w-4">%</span>
              </div>
            </div>
          </div>
        </div>

        {/* 4. Retirada de Restos */}
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

      <ServiceConfigFooter 
        onSave={() => handleSave()} 
        onReset={handleReset} 
        isDirty={isDirty} 
        isSaving={isSaving} 
      />
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
