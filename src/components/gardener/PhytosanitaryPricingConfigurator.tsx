import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, AlertTriangle, Bug, ChevronDown, Leaf, Palmtree, Save, Scissors, Sprout, TreePine } from 'lucide-react';
import { deepEqual } from '../../utils/deepEqual';
import {
  PhytosanitaryDetailedCategoryKey as DetailedCategoryKey,
  PhytosanitaryDetailedPricing,
  PhytosanitaryPricingConfig
} from '../../types';
import {
  EMPTY_DETAILED_PHYTOSANITARY_PRICING,
  EMPTY_PHYTOSANITARY_CONFIG,
  normalizeDetailedPhytosanitaryPricing,
  normalizePhytosanitaryPricingConfig,
  toPersistedPhytosanitaryConfig
} from '../../utils/phytosanitaryConfig';

interface Props {
  value?: PhytosanitaryPricingConfig;
  initialConfig?: PhytosanitaryPricingConfig;
  onChange: (config: PhytosanitaryPricingConfig) => void;
  onSave?: (config: PhytosanitaryPricingConfig) => Promise<void>;
}

export type { PhytosanitaryPricingConfig } from '../../types';

const PhytosanitaryPricingConfigurator: React.FC<Props> = ({ value, initialConfig, onChange, onSave }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showGlobalError, setShowGlobalError] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [openSections, setOpenSections] = useState<Record<DetailedCategoryKey, boolean>>({
    cesped: false,
    setos: false,
    palmeras: false,
    arboles: false,
    malas_hierbas: false
  });

  const config = useMemo(() => normalizePhytosanitaryPricingConfig(value), [value]);
  const normalizedInitialConfig = useMemo(() => normalizePhytosanitaryPricingConfig(initialConfig), [initialConfig]);
  const isDirty = useMemo(() => !deepEqual(config, normalizedInitialConfig), [config, normalizedInitialConfig]);
  const detailed = useMemo(() => normalizeDetailedPhytosanitaryPricing(config.detailed_pricing), [config.detailed_pricing]);

  const updateConfig = (next: PhytosanitaryPricingConfig) => onChange(toPersistedPhytosanitaryConfig(next));
  const setDetailedPricing = (next: PhytosanitaryDetailedPricing) => updateConfig({ ...config, detailed_pricing: next });
  const setGlobalMinimum = (valueNum: number) => updateConfig({ ...config, importe_minimo: valueNum, minimum_price: valueNum, minimum_fee: valueNum });

  const setMirroredCategoryFields = <
    K extends DetailedCategoryKey,
    P extends keyof PhytosanitaryDetailedPricing[K],
    C extends keyof PhytosanitaryDetailedPricing[K]
  >(
    category: K,
    preventivoField: P,
    curativoField: C,
    valueNum: number
  ) => {
    setDetailedPricing({
      ...detailed,
      [category]: {
        ...detailed[category],
        [preventivoField]: valueNum,
        [curativoField]: valueNum
      }
    });
  };

  const setPricingModifier = (
    modifier: 'eco' | 'combo_two' | 'severe_infestation',
    valueNum: number
  ) => {
    const nextModifiers = {
      ...config.pricing_modifiers,
      eco: {
        percentage: Number(config.pricing_modifiers?.eco?.percentage || 0)
      },
      combo: {
        two_treatments_percentage: Number(config.pricing_modifiers?.combo?.two_treatments_percentage || 0),
        three_plus_treatments_percentage: Number(config.pricing_modifiers?.combo?.three_plus_treatments_percentage || 0)
      },
      severe_infestation: {
        percentage: Number(config.pricing_modifiers?.severe_infestation?.percentage || 0)
      }
    };

    if (modifier === 'eco') {
      nextModifiers.eco.percentage = valueNum;
    } else if (modifier === 'combo_two') {
      nextModifiers.combo.two_treatments_percentage = valueNum;
    } else {
      nextModifiers.severe_infestation.percentage = valueNum;
    }

    updateConfig({
      ...config,
      pricing_modifiers: nextModifiers
    });
  };

  const setCategoryField = <K extends DetailedCategoryKey>(category: K, field: keyof PhytosanitaryDetailedPricing[K], valueNum: number) => {
    setDetailedPricing({
      ...detailed,
      [category]: {
        ...detailed[category],
        [field]: valueNum
      }
    });
  };

  const toggleSection = (key: DetailedCategoryKey) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  const renderEuroInput = (id: string, valueNum: number, onValueChange: (num: number) => void) => {
    const hasError = validationErrors.includes(id);
    return (
      <div className="relative w-full">
        <input
          type="number"
          min="0"
          step="0.01"
          className={`w-full h-10 pl-3 pr-7 border rounded-lg text-right text-sm focus:ring-2 focus:ring-green-500 ${hasError ? 'border-red-400 bg-red-50' : (valueNum > 0 ? 'border-gray-300' : 'border-gray-200 bg-gray-50')}`}
          value={valueNum === 0 ? '' : valueNum}
          onChange={(e) => {
            onValueChange(parseFloat(e.target.value) || 0);
            if (hasError) {
              setValidationErrors((prev) => prev.filter((x) => x !== id));
            }
          }}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">€</span>
      </div>
    );
  };

  const validateConfig = (): string[] => {
    const errors: string[] = [];
    const requiredFields: Array<[string, number]> = [
      ['servicio_minimo', Number(config.importe_minimo || config.minimum_price || 0)],
      ['cesped_general', Math.max(detailed.cesped.preventivo, detailed.cesped.curativo)],
      ['setos_bajos', Math.max(detailed.setos.bajos_preventivo, detailed.setos.bajos_curativo)],
      ['setos_altos', Math.max(detailed.setos.altos_preventivo, detailed.setos.altos_curativo)],
      ['palmeras_pequenas', Math.max(detailed.palmeras.pequenas_preventivo, detailed.palmeras.pequenas_curativo)],
      ['palmeras_pequenas_cirugia', detailed.palmeras.pequenas_cirugia],
      ['palmeras_medianas', Math.max(detailed.palmeras.medianas_preventivo, detailed.palmeras.medianas_curativo)],
      ['palmeras_medianas_cirugia', detailed.palmeras.medianas_cirugia],
      ['palmeras_altas', Math.max(detailed.palmeras.altas_preventivo, detailed.palmeras.altas_curativo)],
      ['palmeras_altas_cirugia', detailed.palmeras.altas_cirugia],
      ['arboles_pequenos', Math.max(detailed.arboles.pequenos_preventivo, detailed.arboles.pequenos_curativo)],
      ['arboles_medianos', Math.max(detailed.arboles.medianos_preventivo, detailed.arboles.medianos_curativo)],
      ['arboles_grandes', Math.max(detailed.arboles.grandes_preventivo, detailed.arboles.grandes_curativo)],
      ['malas_hierbas_preventivo', detailed.malas_hierbas.preventivo],
      ['malas_hierbas_curativo', detailed.malas_hierbas.curativo],
      ['modifier_eco', Number(config.pricing_modifiers?.eco?.percentage || 0)],
      ['modifier_combo', Number(config.pricing_modifiers?.combo?.two_treatments_percentage || 0)],
      ['modifier_severe', Number(config.pricing_modifiers?.severe_infestation?.percentage || 0)]
    ];
    requiredFields.forEach(([id, val]) => {
      if (Number(val || 0) <= 0) errors.push(id);
    });
    return errors;
  };

  const handleSave = async () => {
    const errors = validateConfig();
    setValidationErrors(errors);
    setShowGlobalError(errors.length > 0);
    if (errors.length > 0) return;
    if (!onSave) return;
    try {
      setIsSaving(true);
      await onSave(toPersistedPhytosanitaryConfig({ ...config, detailed_pricing: detailed }));
    } catch (error) {
      console.error('Error saving phytosanitary pricing config:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const confirmReset = async () => {
    setShowResetModal(false);
    setValidationErrors([]);
    setShowGlobalError(false);
    updateConfig({ ...EMPTY_PHYTOSANITARY_CONFIG, detailed_pricing: EMPTY_DETAILED_PHYTOSANITARY_PRICING });
    if (!onSave) return;
    try {
      setIsSaving(true);
      await onSave(toPersistedPhytosanitaryConfig({ ...EMPTY_PHYTOSANITARY_CONFIG, detailed_pricing: EMPTY_DETAILED_PHYTOSANITARY_PRICING }));
    } catch (error) {
      console.error('Error resetting phytosanitary pricing config:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-gray-200 bg-white p-3.5">
        <div className="flex items-center gap-2">
          <Bug className="w-4 h-4 text-green-700" />
          <h3 className="text-sm font-extrabold text-gray-900 tracking-wide">TARIFAS DE TRATAMIENTOS FITOSANITARIOS</h3>
        </div>
        <p className="text-xs text-gray-500 mt-1.5">Toque una categoría para editar precios</p>
        <div className="mt-3">
          <p className="text-xs text-gray-600 mb-1.5">Precio mínimo del servicio</p>
          {renderEuroInput('servicio_minimo', Number(config.importe_minimo || config.minimum_price || 0), setGlobalMinimum)}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
        <div>
          <button type="button" onClick={() => toggleSection('cesped')} className="w-full px-3 py-2.5 flex items-center justify-between">
            <span className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <Sprout className="w-4 h-4 text-green-700" />
              <span className="flex min-w-0 flex-col items-start leading-tight">
                <span className="text-sm font-bold text-gray-900">CÉSPED</span>
                <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">(Insecticida/fungicida)</span>
              </span>
            </span>
            <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${openSections.cesped ? 'rotate-180' : ''}`} />
          </button>
          {openSections.cesped && (
            <div className="px-3 pb-3 border-t border-gray-100 space-y-2.5">
              <p className="text-xs text-gray-600">Precio por m²</p>
              <div>
                {renderEuroInput('cesped_general', Math.max(detailed.cesped.preventivo, detailed.cesped.curativo), (v) =>
                  setMirroredCategoryFields('cesped', 'preventivo', 'curativo', v)
                )}
              </div>
            </div>
          )}
        </div>

        <div>
          <button type="button" onClick={() => toggleSection('setos')} className="w-full px-3 py-2.5 flex items-center justify-between">
            <span className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <Scissors className="w-4 h-4 text-green-700" />
              <span className="flex min-w-0 flex-col items-start leading-tight">
                <span className="text-sm font-bold text-gray-900">SETOS Y VALLAS</span>
                <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">(Insecticida/fungicida)</span>
              </span>
            </span>
            <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${openSections.setos ? 'rotate-180' : ''}`} />
          </button>
          {openSections.setos && (
            <div className="px-3 pb-3 border-t border-gray-100 space-y-2.5">
              <p className="text-xs text-gray-600">Precio por metro lineal (ml)</p>
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-gray-600">Bajos/Medios (&lt; 2,5m)</p>
                <div>
                  {renderEuroInput('setos_bajos', Math.max(detailed.setos.bajos_preventivo, detailed.setos.bajos_curativo), (v) =>
                    setMirroredCategoryFields('setos', 'bajos_preventivo', 'bajos_curativo', v)
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-gray-600">Altos (2,5m - 5m)</p>
                <div>
                  {renderEuroInput('setos_altos', Math.max(detailed.setos.altos_preventivo, detailed.setos.altos_curativo), (v) =>
                    setMirroredCategoryFields('setos', 'altos_preventivo', 'altos_curativo', v)
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div>
          <button type="button" onClick={() => toggleSection('palmeras')} className="w-full px-3 py-2.5 flex items-center justify-between">
            <span className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <Palmtree className="w-4 h-4 text-green-700" />
              <span className="flex min-w-0 flex-col items-start leading-tight">
                <span className="text-sm font-bold text-gray-900">PALMERAS</span>
                <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">(Insecticida/fungicida)</span>
              </span>
            </span>
            <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${openSections.palmeras ? 'rotate-180' : ''}`} />
          </button>
          {openSections.palmeras && (
            <div className="px-3 pb-3 border-t border-gray-100 space-y-2.5">
              <p className="text-xs text-gray-600">Precio por unidad (ud)</p>
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-gray-600">Pequeñas (&lt; 3,5m)</p>
                <div>
                  {renderEuroInput('palmeras_pequenas', Math.max(detailed.palmeras.pequenas_preventivo, detailed.palmeras.pequenas_curativo), (v) =>
                    setMirroredCategoryFields('palmeras', 'pequenas_preventivo', 'pequenas_curativo', v)
                  )}
                </div>
                <div><p className="text-[11px] text-gray-500 mb-1">Cirugía picudo rojo</p>{renderEuroInput('palmeras_pequenas_cirugia', detailed.palmeras.pequenas_cirugia, (v) => setCategoryField('palmeras', 'pequenas_cirugia', v))}</div>
              </div>
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-gray-600">Medianas (3,5m - 8m)</p>
                <div>
                  {renderEuroInput('palmeras_medianas', Math.max(detailed.palmeras.medianas_preventivo, detailed.palmeras.medianas_curativo), (v) =>
                    setMirroredCategoryFields('palmeras', 'medianas_preventivo', 'medianas_curativo', v)
                  )}
                </div>
                <div><p className="text-[11px] text-gray-500 mb-1">Cirugía picudo rojo</p>{renderEuroInput('palmeras_medianas_cirugia', detailed.palmeras.medianas_cirugia, (v) => setCategoryField('palmeras', 'medianas_cirugia', v))}</div>
              </div>
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-gray-600">Altas (&gt; 8m)</p>
                <div>
                  {renderEuroInput('palmeras_altas', Math.max(detailed.palmeras.altas_preventivo, detailed.palmeras.altas_curativo), (v) =>
                    setMirroredCategoryFields('palmeras', 'altas_preventivo', 'altas_curativo', v)
                  )}
                </div>
                <div><p className="text-[11px] text-gray-500 mb-1">Cirugía picudo rojo</p>{renderEuroInput('palmeras_altas_cirugia', detailed.palmeras.altas_cirugia, (v) => setCategoryField('palmeras', 'altas_cirugia', v))}</div>
              </div>
            </div>
          )}
        </div>

        <div>
          <button type="button" onClick={() => toggleSection('arboles')} className="w-full px-3 py-2.5 flex items-center justify-between">
            <span className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <TreePine className="w-4 h-4 text-green-700" />
              <span className="flex min-w-0 flex-col items-start leading-tight">
                <span className="text-sm font-bold text-gray-900">ÁRBOLES Y FRUTALES</span>
                <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">(Insecticida/fungicida)</span>
              </span>
            </span>
            <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${openSections.arboles ? 'rotate-180' : ''}`} />
          </button>
          {openSections.arboles && (
            <div className="px-3 pb-3 border-t border-gray-100 space-y-2.5">
              <p className="text-xs text-gray-600">Precio por unidad (ud)</p>
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-gray-600">Pequeños (Copa pequeña/baja)</p>
                <div>
                  {renderEuroInput('arboles_pequenos', Math.max(detailed.arboles.pequenos_preventivo, detailed.arboles.pequenos_curativo), (v) =>
                    setMirroredCategoryFields('arboles', 'pequenos_preventivo', 'pequenos_curativo', v)
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-gray-600">Medianos (Copa/altura media)</p>
                <div>
                  {renderEuroInput('arboles_medianos', Math.max(detailed.arboles.medianos_preventivo, detailed.arboles.medianos_curativo), (v) =>
                    setMirroredCategoryFields('arboles', 'medianos_preventivo', 'medianos_curativo', v)
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-gray-600">Grandes (Copa/altura grande)</p>
                <div>
                  {renderEuroInput('arboles_grandes', Math.max(detailed.arboles.grandes_preventivo, detailed.arboles.grandes_curativo), (v) =>
                    setMirroredCategoryFields('arboles', 'grandes_preventivo', 'grandes_curativo', v)
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div>
          <button type="button" onClick={() => toggleSection('malas_hierbas')} className="w-full px-3 py-2.5 flex items-center justify-between">
            <span className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <Leaf className="w-4 h-4 text-green-700" />
              <span className="flex min-w-0 flex-col items-start leading-tight">
                <span className="text-sm font-bold text-gray-900">MALAS HIERBAS</span>
                <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">(hervicida)</span>
              </span>
            </span>
            <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${openSections.malas_hierbas ? 'rotate-180' : ''}`} />
          </button>
          {openSections.malas_hierbas && (
            <div className="px-3 pb-3 border-t border-gray-100 space-y-2.5">
              <p className="text-xs text-gray-600">Precio por m²</p>
              <div className="space-y-2">
                <div>
                  {renderEuroInput('malas_hierbas_preventivo', Math.max(detailed.malas_hierbas.preventivo, detailed.malas_hierbas.curativo), (v) =>
                    setMirroredCategoryFields('malas_hierbas', 'preventivo', 'curativo', v)
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-3.5">
        <h4 className="text-sm font-bold text-gray-900">Suplementos</h4>
        <p className="text-xs text-gray-500 mt-1 mb-2">Incrementos porcentuales aplicables al precio base del tratamiento.</p>
        <div className="space-y-1 divide-y divide-gray-100">
          <div className="flex items-center justify-between py-3 gap-3">
            <div className="min-w-0">
              <span className="block text-sm font-medium text-gray-900">Tratamiento ecológico</span>
              <span className="text-xs text-gray-500">Uso de productos ecológicos y aplicación especializada.</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-gray-400 text-sm font-medium">+</span>
              <input
                type="number"
                min="0"
                step="0.1"
                className={`w-20 h-10 px-3 border rounded-lg text-right text-base sm:text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all ${validationErrors.includes('modifier_eco') ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                value={Number(config.pricing_modifiers?.eco?.percentage || 0) === 0 ? '' : Number(config.pricing_modifiers?.eco?.percentage || 0)}
                placeholder="-"
                onChange={(e) => {
                  setPricingModifier('eco', parseFloat(e.target.value) || 0);
                  if (validationErrors.includes('modifier_eco')) {
                    setValidationErrors((prev) => prev.filter((x) => x !== 'modifier_eco'));
                  }
                }}
              />
              <span className="text-gray-500 text-sm font-medium w-4">%</span>
            </div>
          </div>
          <div className="flex items-center justify-between py-3 gap-3">
            <div className="min-w-0">
              <span className="block text-sm font-medium text-gray-900">Fungicida + insecticida</span>
              <span className="text-xs text-gray-500">Combinación de dos tratamientos en una misma intervención.</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-gray-400 text-sm font-medium">+</span>
              <input
                type="number"
                min="0"
                step="0.1"
                className={`w-20 h-10 px-3 border rounded-lg text-right text-base sm:text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all ${validationErrors.includes('modifier_combo') ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                value={Number(config.pricing_modifiers?.combo?.two_treatments_percentage || 0) === 0 ? '' : Number(config.pricing_modifiers?.combo?.two_treatments_percentage || 0)}
                placeholder="-"
                onChange={(e) => {
                  setPricingModifier('combo_two', parseFloat(e.target.value) || 0);
                  if (validationErrors.includes('modifier_combo')) {
                    setValidationErrors((prev) => prev.filter((x) => x !== 'modifier_combo'));
                  }
                }}
              />
              <span className="text-gray-500 text-sm font-medium w-4">%</span>
            </div>
          </div>
          <div className="flex items-center justify-between py-3 gap-3">
            <div className="min-w-0">
              <span className="block text-sm font-medium text-gray-900">Infección severa</span>
              <span className="text-xs text-gray-500">Mayor carga de producto y tiempo de intervención en casos avanzados.</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-gray-400 text-sm font-medium">+</span>
              <input
                type="number"
                min="0"
                step="0.1"
                className={`w-20 h-10 px-3 border rounded-lg text-right text-base sm:text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all ${validationErrors.includes('modifier_severe') ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                value={Number(config.pricing_modifiers?.severe_infestation?.percentage || 0) === 0 ? '' : Number(config.pricing_modifiers?.severe_infestation?.percentage || 0)}
                placeholder="-"
                onChange={(e) => {
                  setPricingModifier('severe_infestation', parseFloat(e.target.value) || 0);
                  if (validationErrors.includes('modifier_severe')) {
                    setValidationErrors((prev) => prev.filter((x) => x !== 'modifier_severe'));
                  }
                }}
              />
              <span className="text-gray-500 text-sm font-medium w-4">%</span>
            </div>
          </div>
        </div>
      </div>

      {showGlobalError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold text-red-800">Faltan precios por configurar</h4>
            <p className="text-sm text-red-600 mt-1">Completa todos los importes requeridos antes de guardar.</p>
          </div>
        </div>
      )}

      <div className="sticky bottom-3 space-y-2">
        <button
          type="button"
          onClick={() => handleSave()}
          disabled={!isDirty || isSaving}
          className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 ${!isDirty || isSaving ? 'bg-gray-200 text-gray-500' : 'bg-green-600 text-white hover:bg-green-700'}`}
        >
          <Save className="w-4 h-4" />
          {isSaving ? 'GUARDANDO...' : 'GUARDAR TARIFAS'}
        </button>
        <button
          type="button"
          onClick={() => setShowResetModal(true)}
          className="w-full py-2.5 rounded-xl font-semibold text-sm bg-gray-100 text-gray-700 hover:bg-gray-200"
        >
          Restablecer
        </button>
      </div>

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
                Se eliminarán todas las tarifas configuradas de tratamientos fitosanitarios. Esta acción es irreversible.
              </p>
              <div className="flex flex-col gap-3 w-full">
                <button
                  onClick={confirmReset}
                  className="w-full bg-gradient-to-r from-red-600 to-red-700 text-white py-3 px-4 rounded-xl font-bold shadow-lg shadow-red-600/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center"
                >
                  Confirmar
                </button>
                <button
                  onClick={() => setShowResetModal(false)}
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

export default PhytosanitaryPricingConfigurator;
