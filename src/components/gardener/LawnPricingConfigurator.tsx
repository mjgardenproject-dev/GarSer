import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Info, AlertCircle, AlertTriangle } from 'lucide-react';
import { deepEqual } from '../../utils/deepEqual';
import { LawnPricingConfig, LawnSpecies, LawnRange } from '../../types';
import { UnifiedNumericInput } from './UnifiedNumericInput';
import { useAutoSave } from '../../hooks/useAutoSave';
import SaveStatusIndicator from '../common/SaveStatusIndicator';
import ServicePricePreview from './ServicePricePreview';

type LegacyLawnRange = '0-50' | '50-200' | '200+';

const EMPTY_CONFIG: LawnPricingConfig = {
  price_per_m2: '' as any,
  condition_surcharges: { descuidado: '' as any, muy_descuidado: '' as any },
  waste_removal: { percentage: '' as any },
  minimum_price: '' as any,
  selected_species: [],
  species_prices: {},
  pricing_method: 'per_quantity',
  hourly_rate: '' as any,
  yield_m2_per_hour: '' as any
};

const getVal = (v: any) => (v === undefined || v === null || v === '') ? ('' as any) : Number(v);
const isInvalid = (v: any) => v === undefined || v === null || v === '';

interface Props {
  value?: LawnPricingConfig;
  initialConfig?: LawnPricingConfig;
  onChange: (config: LawnPricingConfig) => void;
  onSave?: (config: LawnPricingConfig) => Promise<void>;
}

const LawnPricingConfigurator: React.FC<Props> = ({ value, initialConfig, onChange, onSave }) => {
  const [showGlobalInfo, setShowGlobalInfo] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const normalizeConfig = (incoming?: LawnPricingConfig): LawnPricingConfig => {
    if (!incoming) return EMPTY_CONFIG;

    const next: LawnPricingConfig = {
      ...EMPTY_CONFIG,
      ...incoming,
      selected_species: incoming.selected_species || [],
      species_prices: incoming.species_prices || {}
    };

    let price_per_m2 = incoming.price_per_m2 || 0;

    if (!price_per_m2 && incoming.surface_prices) {
      const legacyPrice = incoming.surface_prices['0-50'] || incoming.surface_prices['51-150'] || incoming.surface_prices['151-400'] || incoming.surface_prices['400+'] || 0;
      price_per_m2 = Number(legacyPrice);
    }

    if (!price_per_m2 && next.species_prices) {
      const candidateFromSelected = (next.selected_species || []).find(s => next.species_prices?.[s]);
      const candidateFallback = Object.keys(next.species_prices)[0];
      const legacyKey = candidateFromSelected || candidateFallback;
      const legacy = legacyKey ? next.species_prices?.[legacyKey] : undefined;
      if (legacy) {
        price_per_m2 = Number(legacy['0-50'] || legacy['50-200'] || legacy['200+'] || 0);
      }
    }

    return {
      ...next,
      price_per_m2: price_per_m2 > 0 ? price_per_m2 : getVal(incoming.price_per_m2),
      minimum_price: getVal(incoming.minimum_price),
      condition_surcharges: {
        descuidado: getVal(incoming.condition_surcharges?.descuidado),
        muy_descuidado: getVal(incoming.condition_surcharges?.muy_descuidado)
      },
      waste_removal: { percentage: getVal(incoming.waste_removal?.percentage) }
    };
  };

  const config = useMemo(() => normalizeConfig(value), [value]);

  const handlePriceChange = (newPrice: number) => {
    onChange({
      ...config,
      price_per_m2: newPrice
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

  const handleMinimumPriceChange = (val: number) => {
      onChange({
          ...config,
          minimum_price: val
      });
  };

  const validateConfig = useCallback((cfg: LawnPricingConfig): string[] => {
    const errors: string[] = [];
    if (cfg.pricing_method === 'per_hour') {
      if (isInvalid(cfg.hourly_rate)) errors.push('hourly_rate');
    } else {
      if (isInvalid(cfg.price_per_m2)) errors.push('price_per_m2');
    }
    // Yield is always mandatory
    if (isInvalid(cfg.yield_m2_per_hour)) errors.push('yield_m2_per_hour');
    
    if (isInvalid(cfg.minimum_price)) errors.push('minimum_price');
    if (isInvalid(cfg.condition_surcharges?.descuidado)) errors.push('descuidado');
    if (isInvalid(cfg.condition_surcharges?.muy_descuidado)) errors.push('muy_descuidado');
    if (isInvalid(cfg.waste_removal?.percentage)) errors.push('waste_removal');
    return errors;
  }, []);

  useEffect(() => {
    setValidationErrors(validateConfig(config));
  }, [config, validateConfig]);

  const { status } = useAutoSave({
    value: config,
    initialValue: normalizeConfig(initialConfig),
    onSave: async (val) => {
      if (onSave) {
        await onSave(val);
      }
    },
    validate: validateConfig
  });

  return (
    <div className="space-y-8">
      {/* Header Info */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-8">
        <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
                <h3 className="font-semibold text-gray-900 text-lg flex items-center gap-2">
                    Configuración de tarifas de Corte de césped (IVA incluido)
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
                                    <li>El precio es por m².</li>
                                    <li>Los precios <strong>no incluyen la retirada de restos</strong> (se configura abajo).</li>
                                    <li>El <strong>IVA está incluido</strong>.</li>
                                </ul>
                            </div>
                        </>
                    )}
                </div>
            </div>
            <SaveStatusIndicator status={status} />
        </div>
      </div>

      {/* Método de Cobro */}
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
            Por Cantidad (€/m²)
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
            ? 'El precio se calculará multiplicando las horas estimadas por tu tarifa horaria.' 
            : 'El precio se calculará multiplicando los m² analizados por tu tarifa unitaria.'}
        </p>
      </div>

      {/* Velocidad de trabajo (Obligatorio) */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Velocidad de trabajo</h4>
          <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[10px] font-bold rounded-full uppercase">Obligatorio</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 bg-white border border-gray-200 rounded-xl shadow-sm">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Velocidad de trabajo (m²/h)</label>
            <div className="w-32">
              <UnifiedNumericInput
                value={config.yield_m2_per_hour}
                autoSelect
                onChange={(val) => onChange({ ...config, yield_m2_per_hour: val })}
                suffix="m²/h"
                hasError={validationErrors.includes('yield_m2_per_hour')}
              />
            </div>
            <p className="text-[10px] text-gray-500 mt-1">¿Cuántos m² puedes cortar en una hora?</p>
          </div>
          
          {config.pricing_method === 'per_hour' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Precio por Hora (€/h)</label>
              <div className="w-32">
                <UnifiedNumericInput
                  value={config.hourly_rate}
                  autoSelect
                  onChange={(val) => onChange({ ...config, hourly_rate: val })}
                  suffix="€/h"
                  hasError={validationErrors.includes('hourly_rate')}
                />
              </div>
            </div>
          )}

          {config.pricing_method === 'per_hour' && config.hourly_rate && config.yield_m2_per_hour && config.yield_m2_per_hour > 0 && (
            <div className="md:col-span-2 p-3 bg-blue-50 rounded-lg border border-dashed border-blue-200">
              <p className="text-xs text-blue-800">
                <span className="font-semibold">Nota:</span> Con este rendimiento y precio por hora, tu tarifa equivalente es de <span className="font-bold">{(config.hourly_rate / config.yield_m2_per_hour).toFixed(2)}€/m²</span>.
              </p>
            </div>
          )}
        </div>
      </div>

      <hr className="border-gray-200 my-8" />

      {config.pricing_method === 'per_quantity' && (
        <>
          <div>
            <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">Tarifa por m² (Precio Fijo)</h4>
            <div className="flex items-center justify-between">
              <div className="pr-2">
                <span className="text-sm font-medium text-gray-900 block">Precio por m²</span>
              </div>
              <div className="w-24">
                <UnifiedNumericInput
                  value={config.price_per_m2}
                  autoSelect
                  onChange={(val) => {
                    handlePriceChange(val);
                    if (validationErrors.includes('price_per_m2')) {
                      setValidationErrors(prev => prev.filter(err => err !== 'price_per_m2'));
                    }
                  }}
                  hasError={validationErrors.includes('price_per_m2')}
                />
              </div>
            </div>
          </div>
          <hr className="border-gray-200 my-8" />
        </>
      )}

      {/* Surcharges Section (Copied style from StandardServiceConfig/PalmPricingConfigurator) */}
      <div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Condition Surcharges */}
            <div>
              <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">Suplementos por estado</h4>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900 block">Descuidado</span>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-sm font-medium">+</span>
                    <div className="w-20">
                      <UnifiedNumericInput
                        value={config.condition_surcharges.descuidado}
                        autoSelect
                        onChange={(val) => handleSurchargeChange('descuidado', val)}
                        suffix="%"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900 block">Muy Descuidado</span>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-sm font-medium">+</span>
                    <div className="w-20">
                      <UnifiedNumericInput
                        value={config.condition_surcharges.muy_descuidado}
                        autoSelect
                        onChange={(val) => handleSurchargeChange('muy_descuidado', val)}
                        suffix="%"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Waste Removal */}
            <div>
              <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">Gestión de Residuos</h4>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="pr-2">
                    <span className="text-sm font-medium text-gray-900 block">Retirada de restos</span>
                    <p className="text-xs text-gray-500 mt-1">Incremento si el cliente lo solicita</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-sm font-medium">+</span>
                    <div className="w-20">
                      <UnifiedNumericInput
                        value={config.waste_removal.percentage}
                        autoSelect
                        onChange={(val) => handleWasteChange(val)}
                        suffix="%"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
      </div>

      <hr className="border-gray-200 my-8" />

      <div>
        <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">Precio mínimo</h4>
        <div className="flex items-center justify-between">
          <div className="pr-2">
            <span className="text-sm font-medium text-gray-900 block">Importe mínimo del servicio</span>
            <p className="text-xs text-gray-500 mt-1">Se aplica al final del cálculo del precio.</p>
          </div>
          <div className="w-24">
            <UnifiedNumericInput
                value={config.minimum_price}
                autoSelect
                onChange={handleMinimumPriceChange}
                hasError={validationErrors.includes('minimum_price')}
              />
          </div>
        </div>
      </div>

      <ServicePricePreview serviceName="Corte de césped" config={config} />
    </div>
  );
};

export default LawnPricingConfigurator;
