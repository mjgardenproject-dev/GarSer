import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { deepEqual } from '../../utils/deepEqual';
import ServiceConfigFooter from './ServiceConfigFooter';

export type HedgeHeightBand = '0-2m' | '2-4m' | '4-6m';

export const HEDGE_HEIGHT_BANDS: HedgeHeightBand[] = ['0-2m', '2-4m', '4-6m'];

export interface HedgePricingConfig {
  pricing_matrix: Record<HedgeHeightBand, number>;
  specialist_enabled?: boolean;
  condition_surcharges: {
    media: number;
    alta: number;
    descuidado?: number;
    muy_descuidado?: number;
  };
  waste_removal: {
    percentage: number;
  };
  minimum_price: number;
  category_prices?: Record<string, any>;
  selected_categories?: string[];
  species_prices?: Record<string, any>;
  selected_types?: string[];
}

const EMPTY_CONFIG: HedgePricingConfig = {
  pricing_matrix: {
    '0-2m': 0,
    '2-4m': 0,
    '4-6m': 0
  },
  specialist_enabled: false,
  condition_surcharges: { media: 20, alta: 50 },
  waste_removal: { percentage: 0 },
  minimum_price: 0,
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

interface Props {
  value?: HedgePricingConfig;
  initialConfig?: HedgePricingConfig;
  onChange: (config: HedgePricingConfig) => void;
  onSave?: (config: HedgePricingConfig) => Promise<void>;
}

const HedgePricingConfigurator: React.FC<Props> = ({ value, initialConfig, onChange, onSave }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [showFormulaSheet, setShowFormulaSheet] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showGlobalError, setShowGlobalError] = useState(false);
  const [showGlobalInfo, setShowGlobalInfo] = useState(false);
  const [minimumPriceError, setMinimumPriceError] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);

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
      specialist_enabled: legacySpecialist,
      pricing_matrix: mergedMatrix,
      condition_surcharges: conditionSurcharges,
      waste_removal: { ...EMPTY_CONFIG.waste_removal, ...(value.waste_removal || {}) },
    };
  }, [value]);

  const isDirty = useMemo(() => {
    const baseToCompare = initialConfig || EMPTY_CONFIG;
    const legacySpecialist =
      baseToCompare.specialist_enabled !== undefined
        ? baseToCompare.specialist_enabled
        : Boolean((baseToCompare.selected_categories || []).includes('Setos Gran Altura (>3m)'));
    const legacyMatrix = deriveMatrixFromLegacy(baseToCompare);
    const mergedMatrix = hasAnyMatrixValue(baseToCompare.pricing_matrix)
      ? {
          ...EMPTY_CONFIG.pricing_matrix,
          ...(baseToCompare.pricing_matrix || {})
        }
      : {
          ...EMPTY_CONFIG.pricing_matrix,
          ...legacyMatrix
        };
    const conditionSurchargesBase = { ...EMPTY_CONFIG.condition_surcharges, ...(baseToCompare.condition_surcharges || {}) };
    if (baseToCompare.condition_surcharges) {
      if (baseToCompare.condition_surcharges.descuidado !== undefined && conditionSurchargesBase.media === EMPTY_CONFIG.condition_surcharges.media) {
        conditionSurchargesBase.media = baseToCompare.condition_surcharges.descuidado;
      }
      if (baseToCompare.condition_surcharges.muy_descuidado !== undefined && conditionSurchargesBase.alta === EMPTY_CONFIG.condition_surcharges.alta) {
        conditionSurchargesBase.alta = baseToCompare.condition_surcharges.muy_descuidado;
      }
    }

    const processedBase = {
      ...EMPTY_CONFIG,
      ...baseToCompare,
      specialist_enabled: legacySpecialist,
      pricing_matrix: mergedMatrix,
      condition_surcharges: conditionSurchargesBase,
      waste_removal: { ...EMPTY_CONFIG.waste_removal, ...(baseToCompare.waste_removal || {}) },
    };
    return !deepEqual(config, processedBase);
  }, [config, initialConfig]);

  const activeHeightBands = useMemo(
    () => (config.specialist_enabled ? HEDGE_HEIGHT_BANDS : HEDGE_HEIGHT_BANDS.slice(0, 2)),
    [config.specialist_enabled]
  );

  const handleReset = () => setShowResetModal(true);

  const confirmReset = async () => {
    setShowResetModal(false);
    onChange(EMPTY_CONFIG);
    setValidationErrors([]);
    setShowGlobalError(false);
    setMinimumPriceError(false);
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

  const cancelReset = () => setShowResetModal(false);

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

  const handleSave = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const errors: string[] = [];
    activeHeightBands.forEach((height) => {
      const price = Number(config.pricing_matrix?.[height] || 0);
      if (price <= 0) errors.push(height);
    });

    if (errors.length > 0) {
      setValidationErrors(errors);
      setShowGlobalError(true);
      setMinimumPriceError(false);
      return;
    }

    if (!config.minimum_price || config.minimum_price <= 0) {
      setValidationErrors([]);
      setMinimumPriceError(true);
      setShowGlobalError(true);
      return;
    }

    setValidationErrors([]);
    setShowGlobalError(false);
    setMinimumPriceError(false);

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

  const renderPriceInput = (
    height: HedgeHeightBand,
    options?: { inputId?: string; disabled?: boolean }
  ) => {
    const val = Number(config.pricing_matrix?.[height] || 0);
    const hasError = validationErrors.includes(height);
    return (
      <div className="relative w-full">
        <input
          id={options?.inputId}
          disabled={options?.disabled}
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          className={`w-full h-11 min-h-[44px] pl-2 pr-7 text-right text-[15px] transition-all border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed ${hasError ? 'border-red-400 bg-red-50 md:border-red-500' : val > 0 ? 'border-slate-200 bg-white md:border-gray-300' : 'border-slate-200 bg-slate-50 md:border-gray-200'}`}
          value={val === 0 ? '' : val}
          placeholder={val === 0 ? '-' : ''}
          onChange={(e) => {
            handlePriceChange(height, parseFloat(e.target.value) || 0);
            if (hasError) {
              setValidationErrors((prev) => prev.filter((err) => err !== height));
            }
          }}
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 leading-none text-gray-400 text-[10px] sm:text-xs font-semibold">€/m</span>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-gray-900">Tarifas de Setos y Vallas (IVA incluido)</h3>
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
                                <li>El precio base se aplica por metro lineal y puede multiplicarse por las caras a recortar.</li>
                                <li>Los modificadores se aplican sobre el subtotal final.</li>
                            </ul>
                        </div>
                    </>
                )}
            </div>
        </div>
        <button
          type="button"
          onClick={() => setShowFormulaSheet(true)}
          className="h-11 min-h-[44px] px-3 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 text-left sm:text-center"
        >
          ℹ️ Ver fórmula de cálculo
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <section className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <h4 className="font-bold text-gray-800 text-xs uppercase tracking-wide mb-3">Precio mínimo</h4>
          <div className="flex items-center justify-between gap-3">
            <div className="pr-2">
              <span className="text-gray-700 text-sm font-medium block">Importe mínimo del servicio</span>
              <p className="text-xs text-gray-500 mt-1">Se aplica al final del cálculo del precio.</p>
            </div>
            <div className="relative w-28">
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className={`w-full h-11 min-h-[44px] pl-3 pr-7 border rounded-lg text-right text-[16px] focus:ring-2 focus:ring-green-500 ${config.minimum_price > 0 ? 'border-gray-300' : 'border-red-300 bg-red-50'}`}
                value={config.minimum_price === 0 ? '' : config.minimum_price}
                placeholder={config.minimum_price === 0 ? '-' : ''}
                onChange={(e) => handleMinimumPriceChange(parseFloat(e.target.value) || 0)}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium">€</span>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="font-semibold text-gray-900 text-sm">Activar columna 4-6m</h4>
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
        </section>
      </div>

      <section className="-mx-1 md:mx-0 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 py-4 md:px-4 border-b border-gray-100 bg-gray-50">
          <h4 className="font-semibold text-gray-900">Tarifas por metro lineal (€/m)</h4>
        </div>
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
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <h4 className="font-semibold text-gray-900">Suplemento por Dificultad de Corte</h4>
          <p className="text-xs text-gray-500 mt-1">Recargo único global sobre el subtotal de metros según la dificultad.</p>
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="block text-sm font-medium text-gray-900">Normal</span>
                <span className="text-xs text-gray-500">Seto plano, conserva forma, brotes nuevos.</span>
              </div>
              <div className="text-sm font-medium text-green-600 bg-green-50 px-3 py-1 rounded-full">Sin recargo</div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex-1 pr-4">
                <span className="block text-sm font-medium text-gray-900">Media</span>
                <span className="text-xs text-gray-500">Pérdida de geometría, esfuerzo extra para líneas rectas.</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 font-medium">+</span>
                <div className="relative w-24">
                  <input
                    type="number"
                    min="0"
                    max="200"
                    inputMode="decimal"
                    value={config.condition_surcharges?.media || 0}
                    onChange={(e) => handleSurchargeChange('media', parseFloat(e.target.value) || 0)}
                    className="w-full h-11 min-h-[44px] pl-3 pr-8 border border-gray-300 rounded-lg text-right text-[16px] focus:ring-2 focus:ring-green-500"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium">%</span>
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
                <div className="relative w-24">
                  <input
                    type="number"
                    min="0"
                    max="300"
                    inputMode="decimal"
                    value={config.condition_surcharges?.alta || 0}
                    onChange={(e) => handleSurchargeChange('alta', parseFloat(e.target.value) || 0)}
                    className="w-full h-11 min-h-[44px] pl-3 pr-8 border border-gray-300 rounded-lg text-right text-[16px] focus:ring-2 focus:ring-green-500"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium">%</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <h4 className="font-semibold text-gray-900">Gestión de Residuos</h4>
          <p className="text-xs text-gray-500 mt-1">Recargo opcional si el cliente solicita la retirada de restos.</p>
          <div className="mt-4 flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">Recargo por retirada</label>
            <div className="relative w-32">
              <input
                type="number"
                min="0"
                max="100"
                inputMode="decimal"
                value={config.waste_removal?.percentage || 0}
                onChange={(e) => handleWasteChange(parseFloat(e.target.value) || 0)}
                className="w-full h-11 min-h-[44px] pl-3 pr-8 border border-gray-300 rounded-lg text-right text-[16px] focus:ring-2 focus:ring-green-500"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">%</span>
            </div>
          </div>
        </section>
      </div>

      {showGlobalError && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-red-50 text-red-700 px-6 py-3 rounded-full shadow-xl border border-red-200 flex items-center gap-3 animate-bounce-short">
          <AlertCircle className="w-5 h-5" />
          <span className="font-medium">
            {minimumPriceError ? 'Define un importe mínimo mayor que 0.' : `Revisa las casillas pendientes (${validationErrors.length}).`}
          </span>
        </div>
      )}

      <ServiceConfigFooter onSave={() => handleSave()} onReset={handleReset} isDirty={isDirty} isSaving={isSaving} />

      {showResetModal &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 animate-in fade-in zoom-in duration-200 max-h-[90vh] overflow-y-auto">
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mb-4">
                  <AlertTriangle className="w-6 h-6 text-yellow-600" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2 text-center">¿Restablecer configuración?</h3>
                <p className="text-gray-500 text-center mb-6 text-sm">
                  Se eliminarán todos los precios y recargos configurados para el corte de setos. Esta acción es irreversible.
                </p>
                <div className="flex flex-col gap-3 w-full">
                  <button
                    onClick={confirmReset}
                    className="w-full bg-gradient-to-r from-red-600 to-red-700 text-white py-3 px-4 rounded-xl font-bold shadow-lg shadow-red-600/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center"
                  >
                    Confirmar
                  </button>
                  <button onClick={cancelReset} className="w-full bg-gray-100 text-gray-700 py-3 px-4 rounded-xl font-bold hover:bg-gray-200 transition-colors">
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {showFormulaSheet &&
        createPortal(
          <div className="fixed inset-0 z-[9998] flex items-end md:items-center justify-center bg-black/50" onClick={() => setShowFormulaSheet(false)}>
            <div
              className="w-full md:max-w-lg rounded-t-2xl md:rounded-2xl bg-white p-5 md:p-6 shadow-2xl animate-in slide-in-from-bottom-8 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-gray-200 md:hidden" />
              <div className="flex items-start justify-between gap-4">
                <h3 className="text-base font-semibold text-gray-900">Fórmula de cálculo</h3>
                <button
                  type="button"
                  onClick={() => setShowFormulaSheet(false)}
                  className="h-11 min-h-[44px] px-3 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-600"
                >
                  Cerrar
                </button>
              </div>
              <div className="mt-4 space-y-3 text-sm text-gray-700">
                <p>1) Selecciona la tarifa €/m según altura y longitud.</p>
                <p>2) Multiplicamos tarifa × metros lineales del seto.</p>
                <p>3) Aplicamos suplemento por estado si corresponde.</p>
                <p>4) Aplicamos retirada de residuos si corresponde.</p>
                <p>5) Si el total queda por debajo del mínimo, se aplica el precio mínimo.</p>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default HedgePricingConfigurator;
