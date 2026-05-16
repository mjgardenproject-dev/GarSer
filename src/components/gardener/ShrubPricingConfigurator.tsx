import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Info, AlertCircle, AlertTriangle, Trash2 } from 'lucide-react';
import { deepEqual } from '../../utils/deepEqual';
import { ShrubPricingConfig, ShrubSize } from '../../types';
import { UnifiedNumericInput } from './UnifiedNumericInput';
import { useAutoSave } from '../../hooks/useAutoSave';
import SaveStatusIndicator from '../common/SaveStatusIndicator';
import ServicePricePreview from './ServicePricePreview';

const EMPTY_CONFIG: ShrubPricingConfig = {
  prices_per_m2: { pequeñas: '' as any, medianas: '' as any, grandes: '' as any },
  waste_removal: { percentage: '' as any },
  minimum_price: '' as any,
  yield_m2_per_hour: { pequeñas: '' as any, medianas: '' as any, grandes: '' as any },
  pricing_method: 'per_quantity',
  hourly_rate: '' as any
};

const getVal = (v: any) => (v === undefined || v === null || v === '') ? ('' as any) : Number(v);
const isInvalid = (v: any) => v === undefined || v === null || v === '';

interface Props {
  value?: ShrubPricingConfig;
  initialConfig?: ShrubPricingConfig;
  onChange: (config: ShrubPricingConfig) => void;
  onSave?: (config: ShrubPricingConfig) => Promise<void>;
}

const ShrubPricingConfigurator: React.FC<Props> = ({ value, initialConfig, onChange, onSave }) => {
  const [showGlobalInfo, setShowGlobalInfo] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Initialize config safely (handling legacy configs)
  const config = React.useMemo(() => {
    if (!value) return EMPTY_CONFIG;
    
    // Check if it's a legacy config (has species_prices instead of prices_per_m2)
    const isLegacy = !value.prices_per_m2 && ('species_prices' in value);
    
    if (isLegacy) {
      return {
        ...EMPTY_CONFIG,
        ...value,
        minimum_price: getVal(value.minimum_price),
        prices_per_m2: { ...EMPTY_CONFIG.prices_per_m2, ...(value.prices_per_m2 || {}) },
        waste_removal: { percentage: getVal(value.waste_removal?.percentage) }
      };
    }

    return {
      ...EMPTY_CONFIG,
      ...value,
      minimum_price: getVal(value.minimum_price),
      prices_per_m2: {
        pequeñas: getVal(value.prices_per_m2?.pequeñas),
        medianas: getVal(value.prices_per_m2?.medianas),
        grandes: getVal(value.prices_per_m2?.grandes)
      },
      waste_removal: { percentage: getVal(value.waste_removal?.percentage) },
      yield_m2_per_hour: {
        pequeñas: getVal(value.yield_m2_per_hour?.pequeñas),
        medianas: getVal(value.yield_m2_per_hour?.medianas),
        grandes: getVal(value.yield_m2_per_hour?.grandes)
      }
    };
  }, [value]);

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

  const validateConfig = useCallback((cfg: ShrubPricingConfig): string[] => {
    const errors: string[] = [];
    const sizes: ShrubSize[] = ['pequeñas', 'medianas', 'grandes'];
    
    if (cfg.pricing_method === 'per_hour') {
      if (isInvalid(cfg.hourly_rate)) errors.push('hourly_rate');
    } else {
      sizes.forEach(s => {
        if (isInvalid(cfg.prices_per_m2[s])) errors.push(s);
      });
    }

    // Yields are always mandatory
    sizes.forEach(s => {
      if (isInvalid(cfg.yield_m2_per_hour[s])) errors.push(`yield_${s}`);
    });

    if (isInvalid(cfg.minimum_price)) errors.push('minimum_price');
    if (isInvalid(cfg.waste_removal?.percentage)) errors.push('waste_removal');
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

  const renderPriceInput = (size: ShrubSize) => {
     const val = config.prices_per_m2[size] || 0;
     const hasError = validationErrors.includes(size);

     return (
        <div className="w-full">
             <UnifiedNumericInput
                value={val}
                autoSelect
                onChange={(newVal) => {
                    handlePriceChange(size, newVal);
                    if (hasError) {
                        setValidationErrors(prev => prev.filter(err => err !== size));
                    }
                }}
                hasError={hasError}
              />
         </div>
     );
  };

  return (
    <div className="space-y-8">
      {/* Header Info */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-8">
        <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
                <h3 className="font-semibold text-gray-900 text-lg flex items-center gap-2">
                    Configuración de tarifas de Poda de plantas y arbustos (IVA incluido)
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
                                    <li>Los precios son por m² según el tamaño predominante.</li>
                                    <li>Los precios <strong>no incluyen la retirada de restos</strong> (se configura abajo).</li>
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
        
        <div className="space-y-6 p-4 bg-white border border-gray-200 rounded-xl shadow-sm">
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

          <p className="text-sm font-medium text-gray-700 mb-3">Velocidad de trabajo (m²/h):</p>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="block text-[11px] leading-[1.15] text-center font-medium text-gray-500 mb-2">
                Pequeñas <span className="block text-[10px] text-gray-400 font-normal">(0-1m)</span>
              </label>
              <UnifiedNumericInput
                value={config.yield_m2_per_hour.pequeñas}
                autoSelect
                onChange={(val) => onChange({
                  ...config,
                  yield_m2_per_hour: { ...config.yield_m2_per_hour, pequeñas: val }
                })}
                hasError={validationErrors.includes('yield_pequeñas')}
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[11px] leading-[1.15] text-center font-medium text-gray-500 mb-2">
                Medianas <span className="block text-[10px] text-gray-400 font-normal">(1-2m)</span>
              </label>
              <UnifiedNumericInput
                value={config.yield_m2_per_hour.medianas}
                autoSelect
                onChange={(val) => onChange({
                  ...config,
                  yield_m2_per_hour: { ...config.yield_m2_per_hour, medianas: val }
                })}
                hasError={validationErrors.includes('yield_medianas')}
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[11px] leading-[1.15] text-center font-medium text-gray-500 mb-2">
                Grandes <span className="block text-[10px] text-gray-400 font-normal">(2-3m)</span>
              </label>
              <UnifiedNumericInput
                value={config.yield_m2_per_hour.grandes}
                autoSelect
                onChange={(val) => onChange({
                  ...config,
                  yield_m2_per_hour: { ...config.yield_m2_per_hour, grandes: val }
                })}
                hasError={validationErrors.includes('yield_grandes')}
              />
            </div>
          </div>
          
          {config.pricing_method === 'per_hour' && config.hourly_rate && (
            <div className="p-3 bg-blue-50 rounded-lg border border-dashed border-blue-200">
              <p className="text-xs font-semibold text-blue-800 mb-2 uppercase">Precios unitarios equivalentes (€/m²):</p>
              <div className="grid grid-cols-3 gap-2">
                {(['pequeñas', 'medianas', 'grandes'] as ShrubSize[]).map(size => {
                  const y = config.yield_m2_per_hour?.[size];
                  return (
                    <div key={size} className="text-[11px] text-blue-700">
                      <span className="font-medium">{size}:</span> {y && y > 0 ? (config.hourly_rate! / y).toFixed(2) : '--'}€
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <p className="text-xs text-gray-500 mt-2 italic">
            Configura cuántos metros cuadrados puedes podar por hora. Este valor se utiliza para calcular la duración estimada del servicio y gestionar tu calendario.
          </p>
        </div>
      </div>

      <hr className="border-gray-200 my-8" />

      {/* Tabla de Precios por m² */}
      {config.pricing_method === 'per_quantity' && (
        <>
          <div>
            <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4">Tarifas por m² según altura (Precio Fijo)</h4>
            {/* Desktop Header */}
            <div className="hidden md:grid md:grid-cols-3 gap-4 pb-2 text-sm font-bold text-gray-900 items-center">
                <div className="text-center">Pequeñas <span className="text-xs font-normal text-gray-500 block mt-1">(0-1m)</span></div>
                <div className="text-center">Medianas <span className="text-xs font-normal text-gray-500 block mt-1">(1-2m)</span></div>
                <div className="text-center">Grandes <span className="text-xs font-normal text-gray-500 block mt-1">(2-3m)</span></div>
            </div>

            {/* Content */}
            <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1 md:space-y-0">
                    <label className="block text-[11px] leading-[1.15] text-center font-medium text-gray-500 md:hidden mb-2">
                        <span className="block text-gray-900 font-bold">Pequeñas <br/><span className="text-[10px] text-gray-500 font-normal mt-1">(0-1m)</span></span>
                    </label>
                    {renderPriceInput('pequeñas')}
                </div>
                <div className="space-y-1 md:space-y-0">
                    <label className="block text-[11px] leading-[1.15] text-center font-medium text-gray-500 md:hidden mb-2">
                        <span className="block text-gray-900 font-bold">Medianas <br/><span className="text-[10px] text-gray-500 font-normal mt-1">(1-2m)</span></span>
                    </label>
                    {renderPriceInput('medianas')}
                </div>
                <div className="space-y-1 md:space-y-0">
                    <label className="block text-[11px] leading-[1.15] text-center font-medium text-gray-500 md:hidden mb-2">
                        <span className="block text-gray-900 font-bold">Grandes <br/><span className="text-[10px] text-gray-500 font-normal mt-1">(2-3m)</span></span>
                    </label>
                    {renderPriceInput('grandes')}
                </div>
            </div>
          </div>
          <hr className="border-gray-200 my-8" />
        </>
      )}

      <div>
        <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">Gestión de Residuos</h4>
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="pr-4">
                    <span className="text-sm font-medium text-gray-900 block">Recargo por retirada</span>
                    <span className="text-xs text-gray-500 mt-1 block">Incremento sobre el total si el cliente lo solicita.</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-gray-400 text-sm font-medium">+</span>
                  <div className="w-20 flex-shrink-0">
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

      <hr className="border-gray-200 my-8" />

      <div className="border-t border-gray-100 pt-6">
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

      <ServicePricePreview serviceName="Poda de plantas y arbustos" config={config} />
    </div>
  );
};

export default ShrubPricingConfigurator;