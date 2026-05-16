import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { UnifiedNumericInput } from './UnifiedNumericInput';
import { useAutoSave } from '../../hooks/useAutoSave';
import SaveStatusIndicator from '../common/SaveStatusIndicator';
import ServicePricePreview from './ServicePricePreview';
import { createPortal } from 'react-dom';
import { AlertCircle, AlertTriangle, Bug, ChevronDown, Leaf, Palmtree, Save, Scissors, Sprout, TreePine, Info } from 'lucide-react';
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

const getVal = (v: any) => (v === undefined || v === null || v === '') ? ('' as any) : Number(v);
const isInvalid = (v: any) => v === undefined || v === null || v === '';

interface Props {
  value?: PhytosanitaryPricingConfig;
  initialConfig?: PhytosanitaryPricingConfig;
  onChange: (config: PhytosanitaryPricingConfig) => void;
  onSave?: (config: PhytosanitaryPricingConfig) => Promise<void>;
  licenseStatus?: 'pending' | 'approved' | 'rejected' | null;
}

export type { PhytosanitaryPricingConfig } from '../../types';

const PhytosanitaryPricingConfigurator: React.FC<Props> = ({ value, initialConfig, onChange, onSave, licenseStatus = null }) => {
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showGlobalInfo, setShowGlobalInfo] = useState(false);
  const [openSections, setOpenSections] = useState<Record<DetailedCategoryKey, boolean>>({
    cesped: false,
    setos: false,
    palmeras: false,
    arboles: false,
    plantas: false
  });

  const config = useMemo(() => normalizePhytosanitaryPricingConfig(value), [value]);
  const normalizedInitialConfig = useMemo(() => normalizePhytosanitaryPricingConfig(initialConfig), [initialConfig]);
  const isDirty = useMemo(() => !deepEqual(config, normalizedInitialConfig), [config, normalizedInitialConfig]);
  const detailed = useMemo(() => normalizeDetailedPhytosanitaryPricing(config.detailed_pricing), [config.detailed_pricing]);

  const updateConfig = (next: PhytosanitaryPricingConfig) => onChange(toPersistedPhytosanitaryConfig(next));
  const setDetailedPricing = (next: PhytosanitaryDetailedPricing) => updateConfig({ ...config, detailed_pricing: next });
  const setGlobalMinimum = (valueNum: number) => updateConfig({ ...config, importe_minimo: valueNum, minimum_price: valueNum, minimum_fee: valueNum });

  const setPricingModifier = (
    modifier: 'eco' | 'combo_two',
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
      }
    };

    if (modifier === 'eco') {
      nextModifiers.eco.percentage = valueNum;
    } else if (modifier === 'combo_two') {
      nextModifiers.combo.two_treatments_percentage = valueNum;
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

  const renderEuroInput = (id: string, valueNum: number, onValueChange: (num: number) => void, customClass?: string) => {
    return (
      <div className="w-24">
        <UnifiedNumericInput
          value={valueNum}
          autoSelect
          onChange={(v) => {
            onValueChange(v);
            if (validationErrors.includes(id)) {
              setValidationErrors((prev) => prev.filter((x) => x !== id));
            }
          }}
          hasError={validationErrors.includes(id)}
          className={customClass}
        />
      </div>
    );
  };

  const renderPercentageInput = (id: string, valueNum: number, onValueChange: (num: number) => void) => {
    return (
      <div className="w-20">
        <UnifiedNumericInput
          value={valueNum}
          autoSelect
          onChange={(v) => {
            onValueChange(v);
            if (validationErrors.includes(id)) {
              setValidationErrors((prev) => prev.filter((x) => x !== id));
            }
          }}
          hasError={validationErrors.includes(id)}
          suffix="%"
        />
      </div>
    );
  };

  const renderDualEuroInput = (
    preventivoId: string, 
    preventivoValue: number, 
    onPreventivoChange: (num: number) => void,
    curativoId: string,
    curativoValue: number,
    onCurativoChange: (num: number) => void
  ) => {
    return (
      <div className="grid grid-cols-2 gap-2 mt-1">
        <div>
          <p className="text-[10px] uppercase font-semibold text-gray-500 mb-1">Preventivo</p>
          {renderEuroInput(preventivoId, preventivoValue, onPreventivoChange)}
        </div>
        <div className="relative">
          <p className="text-[10px] uppercase font-bold text-green-700 mb-1">Curativo</p>
          {renderEuroInput(curativoId, curativoValue, onCurativoChange, "border-green-500 bg-green-50 focus:ring-green-500")}
        </div>
      </div>
    );
  };

  const validateConfig = useCallback((cfg: PhytosanitaryPricingConfig, det: PhytosanitaryDetailedPricing): string[] => {
    const errors: string[] = [];
    
    if (cfg.pricing_method === 'per_hour') {
      if (isInvalid(cfg.hourly_rate)) errors.push('hourly_rate');
    } else {
      const requiredPricingFields: Array<[string, number]> = [
        ['cesped_preventivo', det.cesped.preventivo],
        ['cesped_curativo', det.cesped.curativo],
        ['setos_bajos_preventivo', det.setos.bajos_preventivo],
        ['setos_bajos_curativo', det.setos.bajos_curativo],
        ['setos_altos_preventivo', det.setos.altos_preventivo],
        ['setos_altos_curativo', det.setos.altos_curativo],
        ['palmeras_pequenas_preventivo', det.palmeras.pequenas_preventivo],
        ['palmeras_pequenas_curativo', det.palmeras.pequenas_curativo],
        ['palmeras_pequenas_cirugia', det.palmeras.pequenas_cirugia],
        ['palmeras_medianas_preventivo', det.palmeras.medianas_preventivo],
        ['palmeras_medianas_curativo', det.palmeras.medianas_curativo],
        ['palmeras_medianas_cirugia', det.palmeras.medianas_cirugia],
        ['palmeras_altas_preventivo', det.palmeras.altas_preventivo],
        ['palmeras_altas_curativo', det.palmeras.altas_curativo],
        ['palmeras_altas_cirugia', det.palmeras.altas_cirugia],
        ['arboles_pequenos_preventivo', det.arboles.pequenos_preventivo],
        ['arboles_pequenos_curativo', det.arboles.pequenos_curativo],
        ['arboles_medianos_preventivo', det.arboles.medianos_preventivo],
        ['arboles_medianos_curativo', det.arboles.medianos_curativo],
        ['arboles_grandes_preventivo', det.arboles.grandes_preventivo],
        ['arboles_grandes_curativo', det.arboles.grandes_curativo],
        ['plantas_pequenas_preventivo', det.plantas.pequenas_preventivo],
        ['plantas_pequenas_curativo', det.plantas.pequenas_curativo],
        ['plantas_medianas_preventivo', det.plantas.medianas_preventivo],
        ['plantas_medianas_curativo', det.plantas.medianas_curativo],
        ['plantas_grandes_preventivo', det.plantas.grandes_preventivo],
        ['plantas_grandes_curativo', det.plantas.grandes_curativo]
      ];
      requiredPricingFields.forEach(([id, val]) => {
        if (Number(val || 0) <= 0) errors.push(id);
      });
    }

    if (Number(cfg.importe_minimo || cfg.minimum_price || 0) <= 0) errors.push('servicio_minimo');
    if (Number(cfg.pricing_modifiers?.eco?.percentage || 0) < 0) errors.push('modifier_eco');
    if (Number(cfg.pricing_modifiers?.combo?.two_treatments_percentage || 0) < 0) errors.push('modifier_combo');

    // Validate yields
    if (!cfg.yields) {
      errors.push('yields_missing');
    } else {
      if (isInvalid(cfg.yields.cesped_m2_per_hour)) errors.push('yield_cesped');
      if (isInvalid(cfg.yields.setos_ml_per_hour)) errors.push('yield_setos');
      if (isInvalid(cfg.yields.palmeras_units_per_hour)) errors.push('yield_palmeras');
      if (isInvalid(cfg.yields.arboles_units_per_hour)) errors.push('yield_arboles');
      if (isInvalid(cfg.yields.plantas_m2_per_hour)) errors.push('yield_plantas');
      if (isInvalid(cfg.yields.endoterapia_units_per_hour)) errors.push('yield_endoterapia');
    }

    return errors;
  }, []);

  useEffect(() => {
    setValidationErrors(validateConfig(config, detailed));
  }, [config, detailed, validateConfig]);

  const { status } = useAutoSave({
    value: { ...config, detailed_pricing: detailed },
    initialValue: { ...normalizedInitialConfig, detailed_pricing: normalizeDetailedPhytosanitaryPricing(normalizedInitialConfig.detailed_pricing) },
    onSave: async (val) => {
      if (onSave) {
        await onSave(toPersistedPhytosanitaryConfig(val));
      }
    },
    validate: (val) => validateConfig(val, val.detailed_pricing)
  });

  return (
    <div className="space-y-3">
      {(!licenseStatus || licenseStatus === 'rejected') && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Licencia fitosanitaria requerida para químicos</p>
            <p className="text-xs text-amber-700 mt-1">
              Puedes configurar tus tarifas ahora. Sin embargo, <strong>solo aparecerás en búsquedas de tratamientos ecológicos</strong> hasta que subas y se verifique tu carnet de manipulador de productos fitosanitarios.
            </p>
          </div>
        </div>
      )}

      {licenseStatus === 'pending' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-blue-800">Licencia en revisión</p>
            <p className="text-xs text-blue-700 mt-1">
              Tu licencia está siendo verificada. Mientras tanto, puedes configurar tus tarifas, pero <strong>solo aparecerás en búsquedas de tratamientos ecológicos</strong>.
            </p>
          </div>
        </div>
      )}

      {/* Header Info */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-2">
        <div className="flex items-center justify-between w-full mb-4">
            <div className="flex items-center gap-2">
                <h3 className="font-semibold text-gray-900 text-lg flex items-center gap-2">
                    Configuración de tarifas de Servicios fitosanitarios (IVA incluido)
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
                                    <li>El <strong>IVA está incluido</strong> en todos los precios mostrados.</li>
                                    <li>El precio incluye mano de obra, maquinaria y producto básico de aplicación.</li>
                                    <li>Se aplicará la tarifa que establezcas según la zona y el tipo de tratamiento solicitado.</li>
                                </ul>
                            </div>
                        </>
                    )}
                </div>
            </div>
            <SaveStatusIndicator status={status} />
        </div>
      </div>

      <hr className="border-gray-200 my-8" />

      {/* Método de Cobro */}
      <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 mb-8">
        <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4">Método de Cobro</h4>
        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => updateConfig({ ...config, pricing_method: 'per_quantity' })}
            className={`p-3 rounded-lg border-2 text-sm font-semibold transition-all ${
              config.pricing_method === 'per_quantity'
                ? 'border-blue-600 bg-blue-50 text-blue-700'
                : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
            }`}
          >
            Por Cantidad (€/ud, €/m²)
          </button>
          <button
            type="button"
            onClick={() => updateConfig({ ...config, pricing_method: 'per_hour' })}
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
            : 'El precio se calculará usando tus tarifas fijas por categoría.'}
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
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Precio por Hora (€/h)</label>
              <div className="w-32">
                <UnifiedNumericInput
                  value={config.hourly_rate}
                  autoSelect
                  onChange={(val) => updateConfig({ ...config, hourly_rate: val })}
                  suffix="€/h"
                  hasError={validationErrors.includes('hourly_rate')}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-400 uppercase">Césped (m²/h)</label>
              <UnifiedNumericInput
                value={config.yields?.cesped_m2_per_hour}
                autoSelect
                onChange={(v) => updateConfig({ ...config, yields: { ...config.yields!, cesped_m2_per_hour: v } })}
                hasError={validationErrors.includes('yield_cesped')}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-400 uppercase">Setos (ml/h)</label>
              <UnifiedNumericInput
                value={config.yields?.setos_ml_per_hour}
                autoSelect
                onChange={(v) => updateConfig({ ...config, yields: { ...config.yields!, setos_ml_per_hour: v } })}
                hasError={validationErrors.includes('yield_setos')}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-400 uppercase">Plantas/Arbustos (m²/h)</label>
              <UnifiedNumericInput
                value={config.yields?.plantas_m2_per_hour}
                autoSelect
                onChange={(v) => updateConfig({ ...config, yields: { ...config.yields!, plantas_m2_per_hour: v } })}
                hasError={validationErrors.includes('yield_plantas')}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-400 uppercase">Árboles (ud/h)</label>
              <UnifiedNumericInput
                value={config.yields?.arboles_units_per_hour}
                autoSelect
                onChange={(v) => updateConfig({ ...config, yields: { ...config.yields!, arboles_units_per_hour: v } })}
                hasError={validationErrors.includes('yield_arboles')}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-400 uppercase">Palmeras (ud/h)</label>
              <UnifiedNumericInput
                value={config.yields?.palmeras_units_per_hour}
                autoSelect
                onChange={(v) => updateConfig({ ...config, yields: { ...config.yields!, palmeras_units_per_hour: v } })}
                hasError={validationErrors.includes('yield_palmeras')}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-400 uppercase">Endoterapia (ud/h)</label>
              <UnifiedNumericInput
                value={config.yields?.endoterapia_units_per_hour}
                autoSelect
                onChange={(v) => updateConfig({ ...config, yields: { ...config.yields!, endoterapia_units_per_hour: v } })}
                hasError={validationErrors.includes('yield_endoterapia')}
              />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2 italic">
            Configura tus rendimientos por hora para cada tipo de tratamiento. Estos valores se utilizan para calcular la duración estimada del servicio y gestionar tu calendario.
          </p>
        </div>
      </div>

      <hr className="border-gray-200 my-8" />

      {config.pricing_method === 'per_quantity' && (
        <>
          <div>
            <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">Tarifas por Categoría (Precio Fijo)</h4>
            <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg bg-white overflow-hidden">
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
                  <p className="text-xs text-gray-600 mt-2">Precio por m²</p>
                  {renderDualEuroInput(
                    'cesped_preventivo', detailed.cesped.preventivo, (v) => setCategoryField('cesped', 'preventivo', v),
                    'cesped_curativo', detailed.cesped.curativo, (v) => setCategoryField('cesped', 'curativo', v)
                  )}
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
                  <p className="text-xs text-gray-600 mt-2">Precio por metro lineal (ml)</p>
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-gray-600">Bajos/Medios (&lt; 2,5m)</p>
                    {renderDualEuroInput(
                      'setos_bajos_preventivo', detailed.setos.bajos_preventivo, (v) => setCategoryField('setos', 'bajos_preventivo', v),
                      'setos_bajos_curativo', detailed.setos.bajos_curativo, (v) => setCategoryField('setos', 'bajos_curativo', v)
                    )}
                  </div>
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-gray-600">Altos (2,5m - 5m)</p>
                    {renderDualEuroInput(
                      'setos_altos_preventivo', detailed.setos.altos_preventivo, (v) => setCategoryField('setos', 'altos_preventivo', v),
                      'setos_altos_curativo', detailed.setos.altos_curativo, (v) => setCategoryField('setos', 'altos_curativo', v)
                    )}
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
                  <p className="text-xs text-gray-600 mt-2">Precio por unidad (ud)</p>
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-gray-600">Pequeñas (&lt; 3,5m)</p>
                    {renderDualEuroInput(
                      'palmeras_pequenas_preventivo', detailed.palmeras.pequenas_preventivo, (v) => setCategoryField('palmeras', 'pequenas_preventivo', v),
                      'palmeras_pequenas_curativo', detailed.palmeras.pequenas_curativo, (v) => setCategoryField('palmeras', 'pequenas_curativo', v)
                    )}
                    <div><p className="text-[11px] text-gray-500 mb-1">Cirugía por plagas (Curativo intensivo)</p>{renderEuroInput('palmeras_pequenas_cirugia', detailed.palmeras.pequenas_cirugia, (v) => setCategoryField('palmeras', 'pequenas_cirugia', v))}</div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-gray-600">Medianas (3,5m - 8m)</p>
                    {renderDualEuroInput(
                      'palmeras_medianas_preventivo', detailed.palmeras.medianas_preventivo, (v) => setCategoryField('palmeras', 'medianas_preventivo', v),
                      'palmeras_medianas_curativo', detailed.palmeras.medianas_curativo, (v) => setCategoryField('palmeras', 'medianas_curativo', v)
                    )}
                    <div><p className="text-[11px] text-gray-500 mb-1">Cirugía por plagas (Curativo intensivo)</p>{renderEuroInput('palmeras_medianas_cirugia', detailed.palmeras.medianas_cirugia, (v) => setCategoryField('palmeras', 'medianas_cirugia', v))}</div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-gray-600">Altas (&gt; 8m)</p>
                    {renderDualEuroInput(
                      'palmeras_altas_preventivo', detailed.palmeras.altas_preventivo, (v) => setCategoryField('palmeras', 'altas_preventivo', v),
                      'palmeras_altas_curativo', detailed.palmeras.altas_curativo, (v) => setCategoryField('palmeras', 'altas_curativo', v)
                    )}
                    <div><p className="text-[11px] text-gray-500 mb-1">Cirugía por plagas (Curativo intensivo)</p>{renderEuroInput('palmeras_altas_cirugia', detailed.palmeras.altas_cirugia, (v) => setCategoryField('palmeras', 'altas_cirugia', v))}</div>
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
                  <p className="text-xs text-gray-600 mt-2">Precio por unidad (ud)</p>
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-gray-600">Pequeños (&lt; 3m altura)</p>
                    {renderDualEuroInput(
                      'arboles_pequenos_preventivo', detailed.arboles.pequenos_preventivo, (v) => setCategoryField('arboles', 'pequenos_preventivo', v),
                      'arboles_pequenos_curativo', detailed.arboles.pequenos_curativo, (v) => setCategoryField('arboles', 'pequenos_curativo', v)
                    )}
                  </div>
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-gray-600">Medianos (3m - 6m altura)</p>
                    {renderDualEuroInput(
                      'arboles_medianos_preventivo', detailed.arboles.medianos_preventivo, (v) => setCategoryField('arboles', 'medianos_preventivo', v),
                      'arboles_medianos_curativo', detailed.arboles.medianos_curativo, (v) => setCategoryField('arboles', 'medianos_curativo', v)
                    )}
                  </div>
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-gray-600">Grandes (&gt; 6m altura)</p>
                    {renderDualEuroInput(
                      'arboles_grandes_preventivo', detailed.arboles.grandes_preventivo, (v) => setCategoryField('arboles', 'grandes_preventivo', v),
                      'arboles_grandes_curativo', detailed.arboles.grandes_curativo, (v) => setCategoryField('arboles', 'grandes_curativo', v)
                    )}
                  </div>
                </div>
              )}
            </div>

            <div>
              <button type="button" onClick={() => toggleSection('plantas')} className="w-full px-3 py-2.5 flex items-center justify-between">
                <span className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  <Leaf className="w-4 h-4 text-green-700" />
                  <span className="flex min-w-0 flex-col items-start leading-tight">
                    <span className="text-sm font-bold text-gray-900">PLANTAS Y ARBUSTOS</span>
                    <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">(Insecticida/fungicida)</span>
                  </span>
                </span>
                <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${openSections.plantas ? 'rotate-180' : ''}`} />
              </button>
              {openSections.plantas && (
                <div className="px-3 pb-3 border-t border-gray-100 space-y-2.5">
                  <p className="text-xs text-gray-600 mt-2">Precio por m² (según altura dominante de la zona)</p>
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-gray-600">Pequeñas (&lt; 0.5m)</p>
                    {renderDualEuroInput(
                      'plantas_pequenas_preventivo', detailed.plantas.pequenas_preventivo, (v) => setCategoryField('plantas', 'pequenas_preventivo', v),
                      'plantas_pequenas_curativo', detailed.plantas.pequenas_curativo, (v) => setCategoryField('plantas', 'pequenas_curativo', v)
                    )}
                  </div>
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-gray-600">Medianas (0.5m - 1.5m)</p>
                    {renderDualEuroInput(
                      'plantas_medianas_preventivo', detailed.plantas.medianas_preventivo, (v) => setCategoryField('plantas', 'medianas_preventivo', v),
                      'plantas_medianas_curativo', detailed.plantas.medianas_curativo, (v) => setCategoryField('plantas', 'medianas_curativo', v)
                    )}
                  </div>
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-gray-600">Grandes (1.5m - 2m)</p>
                    {renderDualEuroInput(
                      'plantas_grandes_preventivo', detailed.plantas.grandes_preventivo, (v) => setCategoryField('plantas', 'grandes_preventivo', v),
                      'plantas_grandes_curativo', detailed.plantas.grandes_curativo, (v) => setCategoryField('plantas', 'grandes_curativo', v)
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          </div>
          <hr className="border-gray-200 my-8" />
        </>
      )}

      <div>
        <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Suplementos</h4>
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
        </div>
      </div>

      <hr className="border-gray-200 my-8" />

      <div>
        <div className="flex items-center justify-between">
          <div className="pr-2">
            <span className="text-sm font-medium text-gray-900 block">Precio mínimo del servicio</span>
            <p className="text-xs text-gray-500 mt-1">Se aplica al final del cálculo del precio.</p>
          </div>
          <div className="w-24">
            {renderEuroInput('servicio_minimo', Number(config.importe_minimo || config.minimum_price || 0), setGlobalMinimum)}
          </div>
        </div>
      </div>

      <ServicePricePreview serviceName="Servicios fitosanitarios" config={config} />
    </div>
  );
};

export default PhytosanitaryPricingConfigurator;
