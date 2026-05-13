import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { deepEqual } from '../../utils/deepEqual';
import { HedgePricingConfig, HedgeHeightBand } from '../../types';
import { UnifiedNumericInput } from './UnifiedNumericInput';
import { useAutoSave } from '../../hooks/useAutoSave';
import SaveStatusIndicator from '../common/SaveStatusIndicator';
import ServicePricePreview from './ServicePricePreview';

export const HEDGE_HEIGHT_BANDS: HedgeHeightBand[] = ['0-2m', '2-4m', '4-6m'];

const EMPTY_CONFIG: HedgePricingConfig = {
  pricing_matrix: {
    '0-2m': '' as any,
    '2-4m': '' as any,
    '4-6m': '' as any
  },
  specialist_enabled: false,
  condition_surcharges: { media: '' as any, alta: '' as any },
  waste_removal: { percentage: '' as any },
  minimum_price: '' as any,
  pricing_method: 'per_quantity',
  hourly_rate: '' as any,
  yield_ml_per_hour: {
    '0-2m': '' as any,
    '2-4m': '' as any,
    '4-6m': '' as any
  }
};

const averagePositive = (values: number[]) => {
  const valid = values.filter((v) => Number(v) > 0);
  if (valid.length === 0) return 0;
  return Number((valid.reduce((acc, v) => acc + v, 0) / valid.length).toFixed(2));
};

const toLegacyHeightPairs = (height: HedgeHeightBand): Array<{ category: string; height: string }> => {
  if (height === '0-2m') {
    return [
      { category: 'Setos Estándar (≤3m)', height: '0-1m' },
      { category: 'Setos Estándar (≤3m)', height: '>1-2m' }
    ];
  }
  if (height === '2-4m') {
    return [
      { category: 'Setos Estándar (≤3m)', height: '>2-3m' },
      { category: 'Setos Gran Altura (>3m)', height: '3-4.5m' }
    ];
  }
  return [
    { category: 'Setos Gran Altura (>3m)', height: '>4.5-6m' },
    { category: 'Setos Gran Altura (>3m)', height: '>6-7.5m' }
  ];
};

const deriveMatrixFromLegacy = (value?: any): Record<HedgeHeightBand, number> => {
  const matrix: Record<HedgeHeightBand, number> = {
    '0-2m': 0,
    '2-4m': 0,
    '4-6m': 0
  };

  if (value?.pricing_matrix && (value.pricing_matrix['0-1m'] || value.pricing_matrix['1-2m'] || typeof value.pricing_matrix['2-4m'] === 'object')) {
    const pm = value.pricing_matrix;
    const extractPrice = (entry: any) => {
      if (!entry) return 0;
      if (typeof entry === 'number') return entry;
      const standard = Number(entry['0-25m (Estándar)'] || 0);
      const volume = Number(entry['>25m (Gran Volumen)'] || 0);
      const candidates = [standard, volume].filter(v => v > 0);
      if (candidates.length === 0) return 0;
      return candidates.reduce((a, b) => a + b, 0) / candidates.length;
    };

    const p0_1 = extractPrice(pm['0-1m']);
    const p1_2 = extractPrice(pm['1-2m']);
    const c0_2 = [p0_1, p1_2].filter(v => v > 0);
    matrix['0-2m'] = c0_2.length > 0 ? c0_2.reduce((a, b) => a + b, 0) / c0_2.length : 0;
    
    matrix['2-4m'] = extractPrice(pm['2-4m']);
    matrix['4-6m'] = extractPrice(pm['4-6m']);

    return matrix;
  }

  HEDGE_HEIGHT_BANDS.forEach((height) => {
    const legacyRanges = ['0-10m', '11-25m', '26-50m', '>50m'];
    const legacyHeights = toLegacyHeightPairs(height);
    const candidates: number[] = [];
    legacyHeights.forEach(({ category, height: legacyHeight }) => {
      legacyRanges.forEach((legacyRange) => {
        const val = Number(value?.category_prices?.[category]?.[legacyHeight]?.[legacyRange] || 0);
        if (val > 0) candidates.push(val);
      });
    });
    const derived = averagePositive(candidates);
    if (derived > 0) {
      matrix[height] = derived;
    }
  });
  return matrix;
};

const hasAnyMatrixValue = (matrix?: Record<HedgeHeightBand, number>) => {
  if (!matrix) return false;
  return HEDGE_HEIGHT_BANDS.some((h) => Number(matrix[h] || 0) > 0);
};

const getVal = (v: any) => (v === undefined || v === null || v === '') ? ('' as any) : Number(v);
const isInvalid = (v: any) => v === undefined || v === null || v === '';

interface Props {
  value?: HedgePricingConfig;
  initialConfig?: HedgePricingConfig;
  onChange: (config: HedgePricingConfig) => void;
  onSave?: (config: HedgePricingConfig) => Promise<void>;
}

const HedgePricingConfigurator: React.FC<Props> = ({ value, initialConfig, onChange, onSave }) => {
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showGlobalInfo, setShowGlobalInfo] = useState(false);
  const [minimumPriceError, setMinimumPriceError] = useState(false);

  const config = useMemo(() => {
    if (!value) return EMPTY_CONFIG;
    const legacySpecialist =
      value.specialist_enabled !== undefined
        ? value.specialist_enabled
        : Boolean((value.selected_categories || []).includes('Setos Gran Altura (>3m)'));
    const legacyMatrix = deriveMatrixFromLegacy(value);
    const mergedMatrix = hasAnyMatrixValue(value.pricing_matrix)
      ? {
          ...EMPTY_CONFIG.pricing_matrix,
          ...(value.pricing_matrix || {})
        }
      : {
          ...EMPTY_CONFIG.pricing_matrix,
          ...legacyMatrix
        };
    const conditionSurcharges = { ...EMPTY_CONFIG.condition_surcharges, ...(value.condition_surcharges || {}) };
    if (value.condition_surcharges) {
      if (value.condition_surcharges.descuidado !== undefined && conditionSurcharges.media === EMPTY_CONFIG.condition_surcharges.media) {
        conditionSurcharges.media = value.condition_surcharges.descuidado;
      }
      if (value.condition_surcharges.muy_descuidado !== undefined && conditionSurcharges.alta === EMPTY_CONFIG.condition_surcharges.alta) {
        conditionSurcharges.alta = value.condition_surcharges.muy_descuidado;
      }
    }

    return {
      ...EMPTY_CONFIG,
      ...value,
      minimum_price: getVal(value.minimum_price),
      specialist_enabled: legacySpecialist,
      pricing_matrix: {
        '0-2m': getVal(mergedMatrix['0-2m']),
        '2-4m': getVal(mergedMatrix['2-4m']),
        '4-6m': getVal(mergedMatrix['4-6m'])
      },
      condition_surcharges: {
        media: getVal(conditionSurcharges.media),
        alta: getVal(conditionSurcharges.alta)
      },
      waste_removal: { percentage: getVal(value.waste_removal?.percentage) },
    };
  }, [value]);

  const activeHeightBands = useMemo(
    () => (config.specialist_enabled ? HEDGE_HEIGHT_BANDS : HEDGE_HEIGHT_BANDS.slice(0, 2)),
    [config.specialist_enabled]
  );

  const handlePriceChange = (height: HedgeHeightBand, newPrice: number) => {
    onChange({
      ...config,
      pricing_matrix: {
        ...(config.pricing_matrix || {}),
        [height]: newPrice
      }
    });
  };

  const handleSurchargeChange = (level: 'media' | 'alta', value: number) => {
    onChange({
      ...config,
      condition_surcharges: {
        ...(config.condition_surcharges || {}),
        [level]: value
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
    if (val > 0) setMinimumPriceError(false);
    onChange({
      ...config,
      minimum_price: val
    });
  };

  const toggleSpecialist = () => {
    onChange({
      ...config,
      specialist_enabled: !config.specialist_enabled
    });
  };

  const validateConfig = useCallback((cfg: HedgePricingConfig): string[] => {
    const errors: string[] = [];
    if (cfg.pricing_method === 'per_hour') {
      if (isInvalid(cfg.hourly_rate)) errors.push('hourly_rate');
    } else {
      activeHeightBands.forEach((band) => {
        if (isInvalid(cfg.pricing_matrix?.[band])) errors.push(band);
      });
    }

    // Yields are always mandatory
    activeHeightBands.forEach((band) => {
      if (isInvalid(cfg.yield_ml_per_hour?.[band])) errors.push(`yield_${band}`);
    });

    if (isInvalid(cfg.minimum_price)) errors.push('minimum_price');
    if (isInvalid(cfg.condition_surcharges?.media)) errors.push('media');
    if (isInvalid(cfg.condition_surcharges?.alta)) errors.push('alta');
    if (isInvalid(cfg.waste_removal?.percentage)) errors.push('waste_removal');

    setMinimumPriceError(isInvalid(cfg.minimum_price));
    return errors;
  }, [activeHeightBands]);

  useEffect(() => {
    setValidationErrors(validateConfig(config));
  }, [config, validateConfig]);

  const processConfigForSave = (cfg: HedgePricingConfig) => {
    return {
      ...cfg,
      pricing_matrix: {
        '0-2m': cfg.pricing_matrix['0-2m'],
        '2-4m': cfg.pricing_matrix['2-4m'],
        '4-6m': cfg.specialist_enabled ? cfg.pricing_matrix['4-6m'] : ('' as any)
      },
      yield_ml_per_hour: {
        '0-2m': cfg.yield_ml_per_hour?.['0-2m'] ?? ('' as any),
        '2-4m': cfg.yield_ml_per_hour?.['2-4m'] ?? ('' as any),
        '4-6m': cfg.specialist_enabled ? (cfg.yield_ml_per_hour?.['4-6m'] ?? ('' as any)) : ('' as any)
      }
    };
  };

  const { status } = useAutoSave({
    value: config,
    initialValue: initialConfig || EMPTY_CONFIG, // Note: maybe need a processed base like in isDirty, let's use value since initialValue is only to skip first render
    onSave: async (val) => {
      if (onSave) {
        await onSave(processConfigForSave(val));
      }
    },
    validate: validateConfig
  });

  const renderPriceInput = (
    height: HedgeHeightBand,
    options?: { inputId?: string; disabled?: boolean }
  ) => {
    const val = Number(config.pricing_matrix?.[height] || 0);
    const hasError = validationErrors.includes(height);
    return (
      <div className="w-full">
        <UnifiedNumericInput
          id={options?.inputId}
          disabled={options?.disabled}
          value={val}
          autoSelect
          onChange={(newVal) => {
            handlePriceChange(height, newVal);
            if (hasError) {
              setValidationErrors((prev) => prev.filter((err) => err !== height));
            }
          }}
          hasError={hasError}
        />
      </div>
    );
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div className="flex items-center justify-between w-full mb-4">
            <div className="flex items-center gap-2">
                <h3 className="font-semibold text-gray-900 text-lg flex items-center gap-2">Configuración de tarifas de Poda de setos (IVA incluido)</h3>
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
                                    <li>El <strong>IVA está incluido</strong> en todos los precios mostrados.</li>
                                    <li>El precio base se aplica por <strong>metro lineal (ml) solo por una cara</strong> del seto.</li>
                                    <li>Si el seto se corta por ambos lados y por arriba, cuenta como caras adicionales.</li>
                                    <li>Los modificadores se aplican sobre el subtotal final.</li>
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
        <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">Activar columna 4-6m</h4>
        <div className="flex items-start justify-between gap-3 bg-white p-4 border border-gray-200 rounded-xl shadow-sm">
          <div>
            <span className="text-sm font-medium text-gray-900 block">Setos de gran altura</span>
            <p className="text-xs text-gray-500 mt-1">Solo si aceptas trabajos de setos altos.</p>
          </div>
          <button
            type="button"
            onClick={toggleSpecialist}
            className={`h-11 min-h-[44px] px-4 rounded-lg text-xs font-semibold border ${config.specialist_enabled ? 'bg-green-600 text-white border-green-600' : 'bg-gray-100 text-gray-700 border-gray-200'}`}
          >
            {config.specialist_enabled ? 'Activado' : 'Desactivado'}
          </button>
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
            Por Cantidad (€/ml)
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
            : 'El precio se calculará usando tu matriz de precios por metro lineal.'}
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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Velocidad de trabajo por tramo (ml/h por cara)</label>
            <div className="grid grid-cols-3 gap-4">
              {activeHeightBands.map((band) => (
                <div key={band}>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">{band}</label>
                  <UnifiedNumericInput
                    value={config.yield_ml_per_hour?.[band]}
                    autoSelect
                    onChange={(val) => onChange({
                      ...config,
                      yield_ml_per_hour: { ...(config.yield_ml_per_hour || {}), [band]: val }
                    })}
                    suffix="ml/h"
                    hasError={validationErrors.includes(`yield_${band}`)}
                  />
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-500 mt-2">¿Cuántos metros lineales por cara puedes cortar en una hora para cada altura?</p>
          </div>

          {config.pricing_method === 'per_hour' && config.hourly_rate && (
            <div className="p-3 bg-blue-50 rounded-lg border border-dashed border-blue-200">
              <p className="text-xs font-semibold text-blue-800 mb-2 uppercase">Precios unitarios equivalentes (€/ml):</p>
              <div className="grid grid-cols-3 gap-2">
                {activeHeightBands.map(band => {
                  const y = config.yield_ml_per_hour?.[band];
                  return (
                    <div key={band} className="text-[11px] text-blue-700">
                      <span className="font-medium">{band}:</span> {y && y > 0 ? (config.hourly_rate! / y).toFixed(2) : '--'}€
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <hr className="border-gray-200 my-8" />

      {config.pricing_method === 'per_quantity' && (
        <>
          <div>
            <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">Tarifas por metro lineal (Precio Fijo)</h4>
            <div className="p-3 md:p-4">
              <div className="flex w-full gap-2 md:gap-4">
                {activeHeightBands.map((height) => {
                  const rowKey = height;
                  const hasError = validationErrors.includes(rowKey);
                  return (
                    <div key={rowKey} className="flex-1 flex flex-col min-w-0">
                      <label className="text-xs font-semibold text-gray-700 mb-2 text-center truncate">{height}</label>
                      {renderPriceInput(height, { inputId: rowKey })}
                      {hasError && <p className="text-[10px] text-red-600 mt-1 text-center leading-tight">Completa</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <hr className="border-gray-200 my-8" />
        </>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <div>
          <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">Suplemento por Dificultad de Corte</h4>
          <p className="text-xs text-gray-500 mt-1 mb-4">Recargo único global sobre el subtotal de metros según la dificultad.</p>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="block text-sm font-medium text-gray-900">Normal</span>
                <span className="text-xs text-gray-500">Seto plano, conserva forma, brotes nuevos.</span>
              </div>
              <span className="text-sm font-medium text-green-600 bg-green-50 px-3 py-1 rounded-full shrink-0 whitespace-nowrap">Sin recargo</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex-1 pr-4">
                <span className="block text-sm font-medium text-gray-900">Media</span>
                <span className="text-xs text-gray-500">Pérdida de geometría, esfuerzo extra para líneas rectas.</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 font-medium">+</span>
                <div className="w-20">
                  <UnifiedNumericInput
                    value={config.condition_surcharges?.media || 0}
                    autoSelect
                    onChange={(val) => handleSurchargeChange('media', val)}
                    suffix="%"
                    hasError={validationErrors.includes('media')}
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex-1 pr-4">
                <span className="block text-sm font-medium text-gray-900">Alta</span>
                <span className="text-xs text-gray-500">Crecimiento descontrolado, ramas muy gruesas, uso de herramientas pesadas.</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 font-medium">+</span>
                <div className="w-20">
                  <UnifiedNumericInput
                    value={config.condition_surcharges?.alta || 0}
                    autoSelect
                    onChange={(val) => handleSurchargeChange('alta', val)}
                    suffix="%"
                    hasError={validationErrors.includes('alta')}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">Gestión de Residuos</h4>
          <p className="text-xs text-gray-500 mt-1 mb-4">Recargo opcional si el cliente solicita la retirada de restos.</p>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-900">Recargo por retirada</span>
            <div className="flex items-center gap-2">
              <span className="text-gray-400 font-medium">+</span>
              <div className="w-20">
                <UnifiedNumericInput
                  value={config.waste_removal?.percentage || 0}
                  autoSelect
                  onChange={handleWasteChange}
                  suffix="%"
                  hasError={validationErrors.includes('waste_removal')}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <hr className="border-gray-200 my-8" />

      <div>
        <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">Precio mínimo</h4>
        <div className="flex items-center justify-between gap-3">
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

      <ServicePricePreview serviceName="Corte de setos a máquina" config={config} />
    </div>
  );
};

export default HedgePricingConfigurator;
