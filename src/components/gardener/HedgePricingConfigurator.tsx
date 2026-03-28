import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import { deepEqual } from '../../utils/deepEqual';
import ServiceConfigFooter from './ServiceConfigFooter';

export type HedgeHeightBand = '0-1m' | '1-2m' | '2-4m' | '4-6m';
export type HedgeLengthRange = '0-25m (Estándar)' | '>25m (Gran Volumen)';

export const HEDGE_HEIGHT_BANDS: HedgeHeightBand[] = ['0-1m', '1-2m', '2-4m', '4-6m'];
export const HEDGE_LENGTH_RANGES: HedgeLengthRange[] = ['0-25m (Estándar)', '>25m (Gran Volumen)'];

export interface HedgePricingConfig {
  pricing_matrix: Record<HedgeHeightBand, Partial<Record<HedgeLengthRange, number>>>;
  specialist_enabled?: boolean;
  condition_surcharges: {
    descuidado: number;
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
    '0-1m': {},
    '1-2m': {},
    '2-4m': {},
    '4-6m': {}
  },
  specialist_enabled: false,
  condition_surcharges: { descuidado: 25, muy_descuidado: 25 },
  waste_removal: { percentage: 0 },
  minimum_price: 0,
};

const averagePositive = (values: number[]) => {
  const valid = values.filter((v) => Number(v) > 0);
  if (valid.length === 0) return 0;
  return Number((valid.reduce((acc, v) => acc + v, 0) / valid.length).toFixed(2));
};

const toLegacyLengthRanges = (range: HedgeLengthRange) =>
  range === '0-25m (Estándar)' ? ['0-10m', '11-25m'] : ['26-50m', '>50m'];

const toLegacyHeightPairs = (height: HedgeHeightBand): Array<{ category: string; height: string }> => {
  if (height === '0-1m') {
    return [
      { category: 'Setos Estándar (≤3m)', height: '0-1m' }
    ];
  }
  if (height === '1-2m') {
    return [
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

const deriveMatrixFromLegacy = (value?: HedgePricingConfig): Record<HedgeHeightBand, Partial<Record<HedgeLengthRange, number>>> => {
  const matrix: Record<HedgeHeightBand, Partial<Record<HedgeLengthRange, number>>> = {
    '0-1m': {},
    '1-2m': {},
    '2-4m': {},
    '4-6m': {}
  };
  HEDGE_HEIGHT_BANDS.forEach((height) => {
    HEDGE_LENGTH_RANGES.forEach((range) => {
      const legacyRanges = toLegacyLengthRanges(range);
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
        matrix[height][range] = derived;
      }
    });
  });
  return matrix;
};

const hasAnyMatrixValue = (matrix?: Record<HedgeHeightBand, Partial<Record<HedgeLengthRange, number>>>) => {
  if (!matrix) return false;
  return HEDGE_HEIGHT_BANDS.some((h) => HEDGE_LENGTH_RANGES.some((r) => Number(matrix[h]?.[r] || 0) > 0));
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
    return {
      ...EMPTY_CONFIG,
      ...value,
      specialist_enabled: legacySpecialist,
      pricing_matrix: mergedMatrix,
      condition_surcharges: {
        ...EMPTY_CONFIG.condition_surcharges,
        ...(value.condition_surcharges || {})
      },
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
    const processedBase = {
      ...EMPTY_CONFIG,
      ...baseToCompare,
      specialist_enabled: legacySpecialist,
      pricing_matrix: mergedMatrix,
      condition_surcharges: {
        ...EMPTY_CONFIG.condition_surcharges,
        ...(baseToCompare.condition_surcharges || {})
      },
      waste_removal: { ...EMPTY_CONFIG.waste_removal, ...(baseToCompare.waste_removal || {}) },
    };
    return !deepEqual(config, processedBase);
  }, [config, initialConfig]);

  const activeHeightBands = useMemo(
    () => (config.specialist_enabled ? HEDGE_HEIGHT_BANDS : HEDGE_HEIGHT_BANDS.slice(0, 3)),
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

  const handlePriceChange = (height: HedgeHeightBand, range: HedgeLengthRange, newPrice: number) => {
    const currentHeight = { ...(config.pricing_matrix?.[height] || {}) };
    currentHeight[range] = newPrice;
    onChange({
      ...config,
      pricing_matrix: {
        ...(config.pricing_matrix || {}),
        [height]: currentHeight
      }
    });
  };

  const handleSurchargeChange = (val: number) => {
    onChange({
      ...config,
      condition_surcharges: {
        ...config.condition_surcharges,
        descuidado: val,
        muy_descuidado: val
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
      HEDGE_LENGTH_RANGES.forEach((range) => {
        const price = Number(config.pricing_matrix?.[height]?.[range] || 0);
        if (price <= 0) errors.push(`${height}-${range}`);
      });
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
    range: HedgeLengthRange,
    options?: { inputId?: string; disabled?: boolean }
  ) => {
    const val = Number(config.pricing_matrix?.[height]?.[range] || 0);
    const hasError = validationErrors.includes(`${height}-${range}`);
    return (
      <div className="relative w-full">
        <input
          id={options?.inputId}
          disabled={options?.disabled}
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          className={`w-full h-11 min-h-[44px] pl-3 pr-12 text-right text-[16px] transition-all border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed ${hasError ? 'border-red-400 bg-red-50 md:border-red-500' : val > 0 ? 'border-slate-200 bg-white md:border-gray-300' : 'border-slate-200 bg-slate-50 md:border-gray-200'}`}
          value={val === 0 ? '' : val}
          placeholder={val === 0 ? '-' : ''}
          onChange={(e) => {
            handlePriceChange(height, range, parseFloat(e.target.value) || 0);
            if (hasError) {
              setValidationErrors((prev) => prev.filter((err) => err !== `${height}-${range}`));
            }
          }}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 leading-none text-gray-400 text-xs font-semibold">€/m</span>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h3 className="font-semibold text-gray-900 text-lg">Configuración de setos (IVA incluido)</h3>
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="bg-white text-left text-xs font-semibold text-gray-700">
                <th className="px-2.5 md:px-4 py-3 border-b border-gray-100 w-[170px]">Longitud</th>
                {activeHeightBands.map((height) => (
                  <th key={`head-${height}`} className="px-2.5 md:px-4 py-3 border-b border-gray-100 text-center min-w-[120px]">
                    {height}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {HEDGE_LENGTH_RANGES.map((range) => (
                <tr key={`row-${range}`} className="border-b border-gray-50 last:border-b-0">
                  <td className="px-2.5 md:px-4 py-3 align-top">
                    <p className="text-sm font-medium text-gray-900">{range}</p>
                  </td>
                  {activeHeightBands.map((height) => {
                    const rowKey = `${height}-${range}`;
                    const hasError = validationErrors.includes(rowKey);
                    return (
                      <td key={rowKey} className="px-2.5 md:px-4 py-3 align-top">
                        {renderPriceInput(height, range, { inputId: rowKey })}
                        {hasError && <p className="text-[11px] text-red-600 mt-1">Completa esta casilla</p>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <h4 className="font-semibold text-gray-900">Suplemento por Estado</h4>
          <p className="text-xs text-gray-500 mt-1">Recargo único global para setos en estado descuidado.</p>
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="block text-sm font-medium text-gray-900">Normal</span>
                <span className="text-xs text-gray-500">Sin recargo</span>
              </div>
              <div className="text-sm font-medium text-green-600 bg-green-50 px-3 py-1 rounded-full">Sin recargo</div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <span className="block text-sm font-medium text-gray-900">Descuidado</span>
                <span className="text-xs text-gray-500">Recargo global sobre el subtotal de metros.</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 font-medium">+</span>
                <div className="relative w-24">
                  <input
                    type="number"
                    min="0"
                    max="200"
                    inputMode="decimal"
                    value={config.condition_surcharges?.descuidado || 0}
                    onChange={(e) => handleSurchargeChange(parseFloat(e.target.value) || 0)}
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
