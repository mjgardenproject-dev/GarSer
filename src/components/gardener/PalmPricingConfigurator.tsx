import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Info, Trash2 } from 'lucide-react';
import { PalmPricingConfig, PalmSpecies, PalmCondition } from '../../types';
import { UnifiedNumericInput } from './UnifiedNumericInput';
import { useAutoSave } from '../../hooks/useAutoSave';
import SaveStatusIndicator from '../common/SaveStatusIndicator';
import { getPricingMethod } from '../../utils/hourlyPricing';

export type PalmHeight = string;

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
  condition_surcharges: { 'normal': 0, 'descuidado': '' as any, 'muy_descuidado': '' as any },
  access_difficulty: 0,
  phytosanitary: 0,
  trunk_finish: 0,
  waste_removal: { option: 'not_included', percentage: '' as any },
  minimum_price: '' as any,
  selected_species: [],
  pricing_method: 'per_quantity',
  precioPorHora: '' as any,
  yield_units_per_hour: {
    'Phoenix canariensis': { '0-4': 0, '4-10': 0, '>10': 0 },
    'Phoenix dactylifera': { '0-5': 0, '5-10': 0, '10-15': 0, '>15': 0 },
    'Washingtonia robusta/filifera': { '0-4': 0, '4-12': 0, '12-20': 0, '>20': 0 },
    'Syagrus romanzoffiana': { '0-5': 0, '5-10': 0, '>10': 0 },
    'Trachycarpus fortunei': { '0-3': 0, '3-6': 0, '>6': 0 },
    'Roystonea regia': { '0-6': 0, '>6': 0 }
  }
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
  const [showGlobalInfo, setShowGlobalInfo] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Clear global error when validation errors are resolved
  useEffect(() => {
    if (validationErrors.length === 0) {
    }
  }, [validationErrors]);
  
  const getVal = (v: any) => (v === undefined || v === null || v === '') ? ('' as any) : Number(v);
  const isInvalid = (v: any) => v === undefined || v === null || v === '';

  // Initialize config with passed value or EMPTY structure
  // Si value es undefined o le faltan claves nuevas, fusionamos con EMPTY_CONFIG
  const config = React.useMemo(() => {
    if (!value) return EMPTY_CONFIG;
    
    const condition_surcharges = { ...EMPTY_CONFIG.condition_surcharges, ...(value.condition_surcharges || {}) };
    
    // Migración de datos legados para condition_surcharges
    if (value && (value as any).condition_surcharges) {
        const legacySurcharges = (value as any).condition_surcharges;
        if ('descuidada' in legacySurcharges) {
            condition_surcharges.descuidado = legacySurcharges['descuidada'];
        }
        if ('muy_descuidada' in legacySurcharges) {
            condition_surcharges.muy_descuidado = legacySurcharges['muy_descuidada'];
        }
    }

    // Deep merge manual muy básico para asegurar que existen todas las claves nuevas
    const merged = {
        ...EMPTY_CONFIG,
        ...value,
        pricing_method: getPricingMethod(value, { allowLegacyYieldCalculation: true }),
        hourly_rate: undefined,
        precioPorHora: getVal(value.precioPorHora ?? value.hourly_rate),
        minimum_price: getVal(value.minimum_price),
        species_prices: { ...EMPTY_CONFIG.species_prices, ...value.species_prices },
        height_prices: { ...EMPTY_CONFIG.height_prices, ...value.height_prices },
        condition_surcharges: {
            normal: 0,
            descuidado: getVal(condition_surcharges.descuidado),
            muy_descuidado: getVal(condition_surcharges.muy_descuidado)
        },
        waste_removal: {
            option: value.waste_removal?.option || 'not_included',
            percentage: getVal(value.waste_removal?.percentage)
        },
        access_difficulty: value.access_difficulty ?? EMPTY_CONFIG.access_difficulty,
        phytosanitary: value.phytosanitary ?? EMPTY_CONFIG.phytosanitary,
        trunk_finish: value.trunk_finish ?? EMPTY_CONFIG.trunk_finish,
        selected_species: value.selected_species || [],
        yield_units_per_hour: value.yield_units_per_hour || EMPTY_CONFIG.yield_units_per_hour
    };
    
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
        // Configuración de nueva especie con precios 0 en todo
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

  const handlePriceChange = (species: PalmSpecies, height: PalmHeight, newPrice: number) => {
    const currentHeights = { ...(config.height_prices[species] || {}) };
    currentHeights[height] = newPrice;
    
    // Si editamos el base, actualizamos species_prices también
    const newSpeciesPrices = { ...config.species_prices };
    const isBase = SPECIES_RANGES[species] && height === SPECIES_RANGES[species][0];
    
    if (isBase) {
        newSpeciesPrices[species] = newPrice;
    }

    onChange({
      ...config,
      species_prices: newSpeciesPrices,
      height_prices: {
        ...config.height_prices,
        [species]: currentHeights
      }
    });
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

  const validateConfig = useCallback((cfg: PalmPricingConfig): string[] => {
    // Validación: Todos los campos de especies seleccionadas deben tener precio > 0
    const errors: string[] = [];
    const selected = cfg.selected_species || [];
    
    if (isInvalid(cfg.minimum_price)) {
      errors.push('minimum_price');
    }

    if (cfg.pricing_method === 'per_hour' && isInvalid(cfg.precioPorHora)) {
      errors.push('precioPorHora');
    }

    if (selected.length > 0) {
      selected.forEach(species => {
        const ranges = SPECIES_RANGES[species] || [];
        ranges.forEach(r => {
          if (isInvalid(cfg.yield_units_per_hour?.[species]?.[r])) {
            errors.push(`yield_${species}_${r}`);
          }
          if (cfg.pricing_method === 'per_quantity' && isInvalid(cfg.height_prices?.[species]?.[r])) {
            errors.push(`${species}-${r}`);
          }
        });
      });

      // Validate surcharges
      if (isInvalid(cfg.condition_surcharges['descuidado'])) {
        errors.push('surcharge-descuidado');
      }
      if (isInvalid(cfg.condition_surcharges['muy_descuidado'])) {
        errors.push('surcharge-muy_descuidado');
      }

      // Validate waste removal
      if (isInvalid(cfg.waste_removal.percentage)) {
        errors.push('waste-percentage');
      }
    }
    return errors;
  }, []);

  useEffect(() => {
    setValidationErrors(validateConfig(config));
  }, [config, validateConfig]);

  const { status } = useAutoSave({
    value: config,
    initialValue: initialConfig || EMPTY_CONFIG,
    onSave: async (val) => {
      if (onSave) {
        await onSave(val);
      }
    },
    validate: validateConfig
  });

  const renderCell = (species: PalmSpecies, height: PalmHeight) => {
     const speciesHeights = config.height_prices[species];
     const value = speciesHeights?.[height] ?? 0;
     const hasError = validationErrors.includes(`${species}-${height}`);
     return (
        <div className="w-full">
             <UnifiedNumericInput
                value={value}
                autoSelect
                onChange={(newVal) => {
                    handlePriceChange(species, height, newVal);
                    if (hasError) {
                        setValidationErrors(prev => prev.filter(err => err !== `${species}-${height}`));
                    }
                }}
                hasError={hasError}
              />
         </div>
     );
  };

  return (
    <div className="space-y-8">
      
      {/* 1. Header with Info */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div className="flex items-center justify-between w-full mb-4">
            <div className="flex items-center gap-2">
                <h3 className="font-semibold text-gray-900 text-lg flex items-center gap-2">
                    Configuración de tarifas de Poda de palmeras (IVA incluido)
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
                                    <li>El <strong>IVA está incluido</strong> en todos los precios.</li>
                                </ul>
                            </div>
                        </>
                    )}
                </div>
            </div>
            <SaveStatusIndicator status={status} />
        </div>
      </div>

      <div className="mb-8">
        <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">Precio mínimo</h4>
        <div className="flex items-center justify-between">
          <div className="pr-2">
            <span className="text-sm font-medium text-gray-900 block">Importe mínimo del servicio</span>
            <p className="text-xs text-gray-500 mt-1">Se aplica al final del cálculo del precio.</p>
          </div>
          <div className="w-full max-w-[7.5rem] shrink-0">
            <UnifiedNumericInput
              value={config.minimum_price}
              autoSelect
              onChange={(val) => onChange({ ...config, minimum_price: val })}
              hasError={validationErrors.includes('minimum_price')}
            />
          </div>
        </div>
      </div>

      <hr className="border-gray-200 my-8" />

      <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 mb-8">
        <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4">Método de Cobro</h4>
        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => onChange({ ...config, pricing_method: 'per_quantity' })}
            className={`p-3 rounded-lg border-2 text-sm font-semibold transition-all ${
              config.pricing_method === 'per_quantity'
                ? 'border-blue-600 bg-blue-50 text-blue-700'
                : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
            }`}
          >
            Por Cantidad (€/ud)
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...config, pricing_method: 'per_hour' })}
            className={`p-3 rounded-lg border-2 text-sm font-semibold transition-all ${
              config.pricing_method === 'per_hour'
                ? 'border-blue-600 bg-blue-50 text-blue-700'
                : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
            }`}
          >
            Por Hora (€/h)
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          {config.pricing_method === 'per_hour'
            ? 'El precio base de poda se calcula mediante rendimiento por especie/altura y tu tarifa horaria.'
            : 'El precio base se calcula con tus tarifas fijas por especie y altura.'}
        </p>
      </div>

      {config.pricing_method === 'per_hour' && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Precio por hora</h4>
            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded-full uppercase">Económico</span>
          </div>
          <div className="grid grid-cols-1 gap-6 p-4 bg-white border border-gray-200 rounded-xl shadow-sm">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">precioPorHora (€/h)</label>
              <div className="w-full sm:w-[7.5rem]">
                <UnifiedNumericInput
                  value={config.precioPorHora}
                  autoSelect
                  onChange={(val) => onChange({ ...config, precioPorHora: val })}
                  suffix="€/h"
                  hasError={validationErrors.includes('precioPorHora')}
                />
              </div>
              <p className="text-[10px] text-gray-500 mt-1">Tarifa económica aplicada al tiempo estimado según el rendimiento configurado.</p>
            </div>
          </div>
        </div>
      )}

      {/* Velocidad de trabajo (Obligatorio) */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Velocidad de trabajo</h4>
          <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[10px] font-bold rounded-full uppercase">Obligatorio</span>
        </div>
        
        <div className="space-y-6 p-4 bg-white border border-gray-200 rounded-xl shadow-sm">
          {/* Desktop view */}
          <div className="hidden md:block overflow-x-auto">
            <p className="text-sm font-medium text-gray-700 mb-3">Velocidad de trabajo (unidades/h):</p>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="p-2 border border-gray-200 text-left">Especie / Altura</th>
                  {Array.from(new Set(Object.values(SPECIES_RANGES).flat())).sort().map(range => (
                    <th key={range} className="p-2 border border-gray-200 text-center text-[10px] uppercase">{range}m</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PALM_SPECIES.filter(s => (config.selected_species || []).includes(s)).map(species => (
                  <tr key={species}>
                    <td className="p-2 border border-gray-200 font-medium text-[11px]">{species}</td>
                    {Array.from(new Set(Object.values(SPECIES_RANGES).flat())).sort().map(range => {
                      const isSupported = SPECIES_RANGES[species].includes(range);
                      return (
                        <td key={range} className={`p-1 border border-gray-200 ${!isSupported ? 'bg-gray-100' : ''}`}>
                          {isSupported && (
                            <UnifiedNumericInput
                              value={config.yield_units_per_hour?.[species]?.[range]}
                              autoSelect
                              suffix="ud/h"
                              onChange={(val) => {
                                const next = { ...(config.yield_units_per_hour || {}) };
                                if (!next[species]) next[species] = {};
                                next[species][range] = val;
                                onChange({ ...config, yield_units_per_hour: next });
                              }}
                              hasError={validationErrors.includes(`yield_${species}_${range}`)}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {(!config.selected_species || config.selected_species.length === 0) && (
                  <tr>
                    <td colSpan={10} className="p-4 text-center text-gray-500 italic text-xs">
                      Selecciona especies abajo para configurar su velocidad de trabajo
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile view */}
          <div className="md:hidden space-y-4">
            <p className="text-sm font-medium text-gray-700">Velocidad de trabajo (unidades/h):</p>
            {PALM_SPECIES.filter(s => (config.selected_species || []).includes(s)).map(species => (
              <div key={species} className="border border-gray-200 rounded-lg p-3 space-y-3">
                <h5 className="font-medium text-sm border-b border-gray-100 pb-2">{species}</h5>
                {Array.from(new Set(Object.values(SPECIES_RANGES).flat())).sort().map(range => {
                  const isSupported = SPECIES_RANGES[species].includes(range);
                  if (!isSupported) return null;
                  return (
                    <div key={range} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 text-xs text-gray-600">{range}m</span>
                      <div className="w-full max-w-[7.5rem] shrink-0">
                        <UnifiedNumericInput
                          value={config.yield_units_per_hour?.[species]?.[range]}
                          autoSelect
                          suffix="ud/h"
                          onChange={(val) => {
                            const next = { ...(config.yield_units_per_hour || {}) };
                            if (!next[species]) next[species] = {};
                            next[species][range] = val;
                            onChange({ ...config, yield_units_per_hour: next });
                          }}
                          hasError={validationErrors.includes(`yield_${species}_${range}`)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            {(!config.selected_species || config.selected_species.length === 0) && (
              <div className="p-4 text-center text-gray-500 italic text-xs border border-gray-200 rounded-lg">
                Selecciona especies abajo para configurar su velocidad de trabajo
              </div>
            )}
          </div>

          <p className="text-xs text-gray-500 mt-2 italic">
              Indica cuántas unidades de cada tipo puedes podar en una hora. Este valor se utiliza para calcular la duración estimada del servicio y gestionar tu calendario.
            </p>
          </div>
        </div>

      <hr className="border-gray-200 my-8" />

      {/* 1. Precios Base por Especie y Altura */}
      <div className="space-y-8">
            {/* Tabla de Especies */}
            <div>
              <div className="flex flex-col gap-1 mb-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                        {config.pricing_method === 'per_hour' ? 'Especies de palmeras activas' : 'Especies de palmeras (Precio Fijo)'}
                      </h4>
                      <span className="flex items-center gap-1 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded border border-red-200 font-semibold">
                          <AlertCircle className="w-3 h-3" />
                          Solo profesionales
                      </span>
                    </div>
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

                                {config.pricing_method === 'per_quantity' && (
                                  <div className={`grid grid-cols-1 ${speciesRanges.length === 2 ? 'md:grid-cols-2' : speciesRanges.length === 3 ? 'md:grid-cols-3' : speciesRanges.length === 4 ? 'md:grid-cols-4' : 'md:grid-cols-1'} gap-3 px-3 pb-3 border-t border-slate-100 pt-3 md:pt-0 md:gap-4 md:px-0 md:pb-0 md:border-t-0`}>
                                      {speciesRanges.map((range, idx) => (
                                          <div key={range} className={`space-y-1 md:space-y-2 ${idx < speciesRanges.length - 1 ? 'md:border-r md:border-gray-200 md:pr-2' : ''} flex flex-row items-center justify-between md:block`}>
                                              <label className="block text-[13px] leading-[1.15] text-left md:text-center font-medium text-gray-500">
                                                <span className="block">{range}m</span>
                                                <span className="block text-[11px] text-gray-400">€/palmera</span>
                                              </label>
                                              <div className="w-full min-w-[7.5rem]">
                                                  {renderCell(species, range)}
                                              </div>
                                          </div>
                                      ))}
                                  </div>
                                )}
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
          </div>
          <hr className="border-gray-200 my-8" />

      <div className="space-y-8">
        {/* 2. Suplementos por Estado */}
        <div>
          <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">
             Suplementos por estado
          </h4>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 group relative">
                <span className="text-sm font-medium text-gray-900 block">Normal</span>
                <Info className="w-4 h-4 text-gray-400 cursor-help group-hover:text-blue-500 transition-colors" />
                <div className="absolute left-0 sm:left-1/2 sm:-translate-x-1/2 bottom-full mb-2 w-[250px] sm:w-64 p-2 bg-gray-900 text-white text-xs rounded shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 text-left sm:text-center pointer-events-none">
                  Palmera con mantenimiento regular. Presenta hojas secas habituales pero no acumulación. Es una poda estándar que no requiere tiempo ni esfuerzo adicional.
                  <div className="absolute -bottom-1 left-12 sm:left-1/2 sm:-translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45"></div>
                </div>
              </div>
              <span className="text-sm font-medium text-green-600 bg-green-50 px-3 py-1 rounded-full">Sin recargo</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 group relative">
                <span className="text-sm font-medium text-gray-900 block">Descuidado</span>
                <Info className="w-4 h-4 text-gray-400 cursor-help group-hover:text-blue-500 transition-colors" />
                <div className="absolute left-0 sm:left-1/2 sm:-translate-x-1/2 bottom-full mb-2 w-[250px] sm:w-64 p-2 bg-gray-900 text-white text-xs rounded shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 text-left sm:text-center pointer-events-none">
                  Palmera con una falda (acumulación de hojas secas) de tamaño moderado. Implica una dificultad técnica y un tiempo de ejecución superiores a la poda estándar.
                  <div className="absolute -bottom-1 left-12 sm:left-1/2 sm:-translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45"></div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 text-sm font-medium">+</span>
                <div className="w-[6.5rem]">
                  <UnifiedNumericInput
                    value={config.condition_surcharges['descuidado']}
                    autoSelect
                    onChange={(val) => {
                      handleConditionSurchargeChange('descuidado', val);
                      if (validationErrors.includes('surcharge-descuidado')) {
                        setValidationErrors(prev => prev.filter(e => e !== 'surcharge-descuidado'));
                      }
                    }}
                    hasError={validationErrors.includes('surcharge-descuidado')}
                    suffix="%"
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 group relative">
                <span className="text-sm font-medium text-gray-900 block">Muy descuidado</span>
                <Info className="w-4 h-4 text-gray-400 cursor-help group-hover:text-blue-500 transition-colors" />
                <div className="absolute left-0 sm:left-1/2 sm:-translate-x-1/2 bottom-full mb-2 w-[250px] sm:w-64 p-2 bg-gray-900 text-white text-xs rounded shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 text-left sm:text-center pointer-events-none">
                  Palmera en estado de abandono notable. Presenta una falda grande y densa. Exige al podador el nivel máximo de esfuerzo y tiempo para su limpieza y preparación.
                  <div className="absolute -bottom-1 left-12 sm:left-1/2 sm:-translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45"></div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 text-sm font-medium">+</span>
                <div className="w-[6.5rem]">
                  <UnifiedNumericInput
                    value={config.condition_surcharges['muy_descuidado']}
                    autoSelect
                    onChange={(val) => {
                      handleConditionSurchargeChange('muy_descuidado', val);
                      if (validationErrors.includes('surcharge-muy_descuidado')) {
                        setValidationErrors(prev => prev.filter(err => err !== 'surcharge-muy_descuidado'));
                      }
                    }}
                    hasError={validationErrors.includes('surcharge-muy_descuidado')}
                    suffix="%"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Suplementos Adicionales */}
        <div>
          <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">
             Suplementos adicionales
          </h4>
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 pr-4">
                <span className="block text-sm font-medium text-gray-900">Dificultad de acceso</span>
                <span className="text-xs text-gray-500">Recargo por acceso bloqueado o uso necesario de grúa.</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-gray-400 text-sm font-medium">+</span>
                <div className="w-[6.5rem]">
                  <UnifiedNumericInput
                    value={config.access_difficulty}
                    autoSelect
                    onChange={(val) => onChange({ ...config, access_difficulty: val })}
                    suffix="%"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 pr-4">
                <span className="block text-sm font-medium text-gray-900">Tratamiento fitosanitario</span>
                <span className="text-xs text-gray-500">Precio fijo por palmera (ej. contra Picudo Rojo).</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-gray-400 text-sm font-medium">+</span>
                <div className="w-[6.5rem]">
                  <UnifiedNumericInput
                    value={config.phytosanitary}
                    autoSelect
                    onChange={(val) => onChange({ ...config, phytosanitary: val })}
                    suffix="€"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 pr-4">
                <span className="block text-sm font-medium text-gray-900">Acabado de tronco</span>
                <span className="text-xs text-gray-500">Incremento porcentual sobre el valor actual por cepillado o acabado estético.</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-gray-400 text-sm font-medium">+</span>
                <div className="w-[6.5rem]">
                  <UnifiedNumericInput
                    value={config.trunk_finish}
                    autoSelect
                    onChange={(val) => onChange({ ...config, trunk_finish: val })}
                    suffix="%"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 4. Retirada de Restos */}
        <div>
          <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">Gestión de Residuos</h4>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="pr-4">
                <span className="text-sm font-medium text-gray-900 block">Recargo por retirada</span>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                  Solo se cobrará al cliente si selecciona la opción de retirada de restos.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-gray-400 text-sm font-medium">+</span>
                <div className="w-[6.5rem]">
                  <UnifiedNumericInput
                    value={config.waste_removal.percentage}
                    autoSelect
                    onChange={(val) => {
                      onChange({
                          ...config,
                          waste_removal: { 
                              option: 'extra_percentage', // Forzamos siempre esta opción internamente
                              percentage: val 
                          }
                      });
                      if (validationErrors.includes('waste-percentage')) {
                          setValidationErrors(prev => prev.filter(err => err !== 'waste-percentage'));
                      }
                    }}
                    hasError={validationErrors.includes('waste-percentage')}
                    suffix="%"
                  />
                </div>
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

    </div>
  );
};

export default PalmPricingConfigurator;
