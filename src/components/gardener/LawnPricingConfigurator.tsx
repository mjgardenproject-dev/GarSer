import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info, AlertCircle, AlertTriangle } from 'lucide-react';
import { deepEqual } from '../../utils/deepEqual';
import ServiceConfigFooter from './ServiceConfigFooter';

export type LawnSpecies = 
  | 'Bermuda (fina o gramilla)' 
  | 'Gramón (Kikuyu, San Agustín o similares)' 
  | 'Dichondra (oreja de ratón o similares)'
  | 'Césped Mixto (Festuca/Raygrass)';

export type LawnRange = '0-50' | '51-150' | '151-400' | '400+';
type LegacyLawnRange = '0-50' | '50-200' | '200+';

export interface LawnPricingConfig {
  surface_prices: Partial<Record<LawnRange, number>>;
  condition_surcharges: {
    descuidado: number;
    muy_descuidado: number;
  };
  waste_removal: {
    percentage: number;
  };
  minimum_price: number;
  selected_species?: LawnSpecies[];
  species_prices?: Record<string, Partial<Record<LegacyLawnRange, number>>>;
}

const SURFACE_RANGES: LawnRange[] = ['0-50', '51-150', '151-400', '400+'];

const EMPTY_CONFIG: LawnPricingConfig = {
  surface_prices: { '0-50': 0, '51-150': 0, '151-400': 0, '400+': 0 },
  condition_surcharges: { descuidado: 20, muy_descuidado: 50 },
  waste_removal: { percentage: 0 },
  minimum_price: 0,
  selected_species: [],
  species_prices: {}
};

interface Props {
  value?: LawnPricingConfig;
  initialConfig?: LawnPricingConfig;
  onChange: (config: LawnPricingConfig) => void;
  onSave?: (config: LawnPricingConfig) => Promise<void>;
}

const LawnPricingConfigurator: React.FC<Props> = ({ value, initialConfig, onChange, onSave }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [showGlobalInfo, setShowGlobalInfo] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showGlobalError, setShowGlobalError] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);

  const normalizeConfig = (incoming?: LawnPricingConfig): LawnPricingConfig => {
    if (!incoming) return EMPTY_CONFIG;

    const next: LawnPricingConfig = {
      ...EMPTY_CONFIG,
      ...incoming,
      surface_prices: {
        ...EMPTY_CONFIG.surface_prices,
        ...(incoming.surface_prices || {})
      },
      condition_surcharges: {
        ...EMPTY_CONFIG.condition_surcharges,
        ...(incoming.condition_surcharges || {})
      },
      waste_removal: {
        ...EMPTY_CONFIG.waste_removal,
        ...(incoming.waste_removal || {})
      },
      selected_species: incoming.selected_species || [],
      species_prices: incoming.species_prices || {}
    };

    const hasNewPrices = SURFACE_RANGES.some(r => Number(next.surface_prices?.[r] || 0) > 0);
    if (!hasNewPrices && next.species_prices) {
      const candidateFromSelected = (next.selected_species || []).find(s => next.species_prices?.[s]);
      const candidateFallback = Object.keys(next.species_prices)[0];
      const legacyKey = candidateFromSelected || candidateFallback;
      const legacy = legacyKey ? next.species_prices?.[legacyKey] : undefined;
      if (legacy) {
        next.surface_prices = {
          '0-50': Number(legacy['0-50'] || 0),
          '51-150': Number(legacy['50-200'] || 0),
          '151-400': Number(legacy['200+'] || 0),
          '400+': Number(legacy['200+'] || 0)
        };
      }
    }

    return {
      ...next,
      surface_prices: {
        '0-50': Number(next.surface_prices?.['0-50'] || 0),
        '51-150': Number(next.surface_prices?.['51-150'] || 0),
        '151-400': Number(next.surface_prices?.['151-400'] || 0),
        '400+': Number(next.surface_prices?.['400+'] || 0)
      }
    };
  };

  const config = useMemo(() => normalizeConfig(value), [value]);

  const isDirty = useMemo(() => {
    const baseToCompare = normalizeConfig(initialConfig || EMPTY_CONFIG);
    return !deepEqual(config, baseToCompare);
  }, [config, initialConfig]);

  const handleReset = () => {
    setShowResetModal(true);
  };

  const confirmReset = async () => {
    setShowResetModal(false);
    onChange(EMPTY_CONFIG);
    setValidationErrors([]);
    setShowGlobalError(false);
    
    if (onSave) {
      try {
        setIsSaving(true);
        await onSave(EMPTY_CONFIG);
      } catch (error) {
        console.error('Error resetting lawn config:', error);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const cancelReset = () => {
    setShowResetModal(false);
  };

  const handlePriceChange = (range: LawnRange, newPrice: number) => {
    onChange({
      ...config,
      surface_prices: {
        ...config.surface_prices,
        [range]: newPrice
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

  const handleMinimumPriceChange = (val: number) => {
      onChange({
          ...config,
          minimum_price: val
      });
  };

  const handleSave = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    const errors: string[] = [];
    SURFACE_RANGES.forEach(r => {
      if (!config.surface_prices?.[r] || Number(config.surface_prices[r]) <= 0) {
        errors.push(r);
      }
    });

    if (errors.length > 0) {
      setValidationErrors(errors);
      setShowGlobalError(true);
      return;
    }

    if (!config.minimum_price || config.minimum_price <= 0) {
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

  const renderPriceInput = (range: LawnRange) => {
     const val = Number(config.surface_prices?.[range] || 0);
     const hasError = validationErrors.includes(range);

     return (
        <div className="relative w-full">
             <input
                type="number"
                min="0"
                step="0.01"
              className={`w-full h-11 md:h-10 pl-[1px] pr-6 text-right text-[17px] md:text-sm transition-all border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 ${hasError ? 'border-red-400 bg-red-50 md:border-red-500' : (val > 0 ? 'border-slate-200 bg-white md:border-gray-300' : 'border-slate-200 bg-slate-50 md:border-gray-200')}`}
                value={val === 0 ? '' : val}
                placeholder={val === 0 ? '-' : ''}
                onChange={(e) => {
                    handlePriceChange(range, parseFloat(e.target.value) || 0);
                    if (hasError) {
                        setValidationErrors(prev => prev.filter(err => err !== range));
                    }
                }}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 leading-none text-gray-400 text-sm font-medium">€</span>
         </div>
     );
  };

  return (
    <div className="space-y-8">
      {/* Header Info */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 text-lg">
                Configuración de tarifas por superficie (IVA incluido)
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
                                <li>Los precios son por m² en todos los rangos.</li>
                                <li>Los precios <strong>no incluyen la retirada de restos</strong> (se configura abajo).</li>
                                <li>El <strong>IVA está incluido</strong>.</li>
                            </ul>
                        </div>
                    </>
                )}
            </div>
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
                onChange={(e) => handleMinimumPriceChange(parseFloat(e.target.value) || 0)}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium">€</span>
            </div>
          </div>
        </div>
      </div>

      <div className="-mx-1 rounded-xl border border-slate-200 bg-white shadow-sm md:mx-0 md:border md:rounded-xl md:overflow-hidden md:shadow-sm md:bg-white">
        <div className="hidden md:grid md:grid-cols-12 gap-4 bg-gray-50 p-4 border-b text-sm font-semibold text-gray-700 items-center">
            <div className="md:col-span-3">Tramo</div>
            <div className="md:col-span-9 text-center">Precio por m²</div>
        </div>

        <div className="divide-y divide-slate-100">
          {SURFACE_RANGES.map((range) => (
            <div key={range} className="p-4 hover:bg-gray-50 transition-colors">
              <div className="grid grid-cols-1 md:grid-cols-12 md:gap-4 md:items-center gap-2">
                <div className="md:col-span-3">
                  <span className="font-medium text-gray-800">
                    {range === '0-50' ? '0–50 m²' : range === '51-150' ? '51–150 m²' : range === '151-400' ? '151–400 m²' : '>400 m²'}
                  </span>
                </div>
                <div className="md:col-span-9">
                  {renderPriceInput(range)}
                </div>
              </div>
            </div>
          ))}
        </div>
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
                    Asegúrate de rellenar todos los tramos de superficie.
                    Los precios deben ser mayores a 0.
                </p>
            </div>
        </div>
      )}

      {/* Save Button */}
      <ServiceConfigFooter 
        onSave={() => handleSave()} 
        onReset={handleReset} 
        isDirty={isDirty} 
        isSaving={isSaving} 
      />

      {/* Reset Confirmation Modal */}
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
                Se eliminarán todos los precios y recargos configurados para el corte de césped. Esta acción es irreversible.
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

export default LawnPricingConfigurator;
