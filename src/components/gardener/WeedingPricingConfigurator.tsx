import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { UnifiedNumericInput } from './UnifiedNumericInput';
import { useManualSave, ManualSaveResult } from '../../hooks/useManualSave';
import { AlertTriangle, Info } from 'lucide-react';
import { WeedingPricingConfig } from '../../types';

const getVal = (v: any) => (v === undefined || v === null || v === '') ? ('' as any) : Number(v);
const isInvalid = (v: any) => v === undefined || v === null || v === '';

interface Props {
  value?: WeedingPricingConfig;
  initialConfig?: WeedingPricingConfig;
  onChange: (config: WeedingPricingConfig) => void;
  onSave?: (config: WeedingPricingConfig) => Promise<boolean> | boolean;
  registerSave?: (fn: () => Promise<ManualSaveResult>) => void;
  onDirtyChange?: (dirty: boolean) => void;
  licenseStatus?: 'pending' | 'approved' | 'rejected' | 'expired' | null;
  /** D3: guía al jardinero a la pestaña de licencia. Opcional para no romper otros usos/tests. */
  onGoToLicense?: () => void;
}

const EMPTY_CONFIG: WeedingPricingConfig = {
  version: 'weeding_v1',
  importe_minimo: '' as any,
  precio_desbroce_m2: '' as any,
  precio_herbicida_m2: '' as any,
  suplementos: {
    dificultad_media: '' as any,
    dificultad_alta: '' as any,
    retirada_restos: '' as any,
  }
};

const WeedingPricingConfigurator: React.FC<Props> = ({
  value,
  initialConfig,
  onChange,
  onSave,
  registerSave,
  onDirtyChange,
  licenseStatus = null,
  onGoToLicense
}) => {
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isHerbicideEnabled, setIsHerbicideEnabled] = useState<boolean>(() => {
    return (value?.precio_herbicida_m2 || 0) > 0;
  });
  // D3: sin licencia vigente no se puede ACTIVAR el herbicida — antes era solo un aviso
  // ("recuerda que debes subir tu carnet") que no impedía nada; el jardinero podía guardar
  // el precio de herbicida sin carnet y el motor lo cobraba igual.
  const isLicenseActive = licenseStatus === 'approved';

  const [showGlobalInfo, setShowGlobalInfo] = useState(false);

  const config = useMemo((): WeedingPricingConfig => {
    if (!value) return { ...EMPTY_CONFIG };
    return {
      version: 'weeding_v1',
      importe_minimo: getVal(value.importe_minimo),
      precio_desbroce_m2: getVal(value.precio_desbroce_m2),
      precio_herbicida_m2: getVal(value.precio_herbicida_m2),
      suplementos: {
        dificultad_media: getVal(value.suplementos?.dificultad_media),
        dificultad_alta: getVal(value.suplementos?.dificultad_alta),
        retirada_restos: getVal(value.suplementos?.retirada_restos),
      },
      yield_m2_per_hour: getVal(value.yield_m2_per_hour)
    };
  }, [value]);

  const normalizedInitialConfig = useMemo((): WeedingPricingConfig => {
    if (!initialConfig) return { ...EMPTY_CONFIG };
    return {
      version: 'weeding_v1',
      importe_minimo: getVal(initialConfig.importe_minimo),
      precio_desbroce_m2: getVal(initialConfig.precio_desbroce_m2),
      precio_herbicida_m2: getVal(initialConfig.precio_herbicida_m2),
      suplementos: {
        dificultad_media: getVal(initialConfig.suplementos?.dificultad_media),
        dificultad_alta: getVal(initialConfig.suplementos?.dificultad_alta),
        retirada_restos: getVal(initialConfig.suplementos?.retirada_restos),
      },
      yield_m2_per_hour: getVal(initialConfig.yield_m2_per_hour)
    };
  }, [initialConfig]);

  const updateConfig = (updates: Partial<WeedingPricingConfig>) => {
    onChange({ ...config, ...updates });
  };

  const updateSuplemento = (key: keyof WeedingPricingConfig['suplementos'], val: number) => {
    onChange({
      ...config,
      suplementos: {
        ...config.suplementos,
        [key]: val
      }
    });
  };

  const validateConfig = useCallback((cfg: WeedingPricingConfig): string[] => {
    const errors: string[] = [];
    if (isInvalid(cfg.precio_desbroce_m2)) errors.push('precio_desbroce_m2');
    // Yield is always mandatory
    if (isInvalid(cfg.yield_m2_per_hour)) errors.push('yield_m2_per_hour');

    if (isInvalid(cfg.importe_minimo)) errors.push('importe_minimo');
    if (isHerbicideEnabled && isInvalid(cfg.precio_herbicida_m2)) {
      errors.push('precio_herbicida_m2');
    }
    if (isInvalid(cfg.suplementos.dificultad_media)) errors.push('dificultad_media');
    if (isInvalid(cfg.suplementos.dificultad_alta)) errors.push('dificultad_alta');
    if (isInvalid(cfg.suplementos.retirada_restos)) errors.push('retirada_restos');
    return errors;
  }, [isHerbicideEnabled]);

  useEffect(() => {
    setValidationErrors(validateConfig(config));
  }, [config, validateConfig]);

  const { isDirty, save } = useManualSave({
    value: config,
    initialValue: normalizedInitialConfig,
    onSave: async (val) => {
      if (onSave) {
        const configToSave = { ...val };
        if (!isHerbicideEnabled) {
          configToSave.precio_herbicida_m2 = 0;
        }
        return await onSave(configToSave);
      }
      return true;
    },
    validate: validateConfig
  });

  useEffect(() => {
    registerSave?.(save);
  }, [save, registerSave]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const renderEuroInput = (id: string, valueNum: number, onValueChange: (num: number) => void) => {
    return (
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
      />
    );
  };

  const renderPercentageInput = (id: string, valueNum: number, onValueChange: (num: number) => void) => {
    return (
      <div className="w-full max-w-[7.5rem] flex items-center gap-2 shrink-0">
        <span className="text-gray-400 text-sm font-medium">+</span>
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

  return (
    <div className="space-y-8">
      {/* Header Info */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-2">
        <div className="flex items-center justify-between w-full mb-4">
            <div className="flex items-center gap-2">
                <h3 className="font-semibold text-gray-900 text-lg flex items-center gap-2">
                    Configuración de tarifas de Desbroce de malas hierbas (IVA incluido)
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
                                    <li>El precio base se aplica por <strong>metro cuadrado (m²)</strong>.</li>
                                    <li>Puedes activar el uso de herbicida si tienes la licencia correspondiente.</li>
                                </ul>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
      </div>

      <div className="mb-8">
        <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">Precio mínimo</h4>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 pr-2">
            <span className="text-sm font-medium text-gray-900 block">Importe mínimo del servicio</span>
            <p className="text-xs text-gray-500 mt-1">Se aplica al final del cálculo del precio.</p>
          </div>
          <div className="w-full max-w-[7.5rem] shrink-0">
            <UnifiedNumericInput
              value={config.importe_minimo}
              autoSelect
              onChange={(v) => {
                updateConfig({ importe_minimo: v });
                if (validationErrors.includes('importe_minimo')) {
                  setValidationErrors((prev) => prev.filter((x) => x !== 'importe_minimo'));
                }
              }}
              hasError={validationErrors.includes('importe_minimo')}
            />
          </div>
        </div>
      </div>

      <hr className="border-gray-200 my-8" />

      {/* Velocidad de trabajo (Obligatorio) */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Velocidad de trabajo</h4>
          <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[10px] font-bold rounded-full uppercase">Obligatorio</span>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 bg-white border border-gray-200 rounded-xl shadow-sm">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Velocidad de trabajo (m²/h)</label>
            <div className="w-full sm:w-[7.5rem]">
              <UnifiedNumericInput
                value={config.yield_m2_per_hour}
                autoSelect
                onChange={(val) => updateConfig({ yield_m2_per_hour: val })}
                suffix="m²/h"
                hasError={validationErrors.includes('yield_m2_per_hour')}
              />
            </div>
            <p className="text-[10px] text-gray-500 mt-1">¿Cuántos m² puedes desbrozar en una hora?</p>
          </div>
        </div>
      </div>

      <hr className="border-gray-200 my-8" />

      {/* Base m² */}
      <div className="space-y-4">
            <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">
              Tarifa Base de Desbroce (Precio Fijo)
            </h4>
            
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 pr-2">
                <span className="text-sm font-medium text-gray-900 block">Precio desbroce (por m²)</span>
                <p className="text-xs text-gray-500 mt-1">Dificultad Normal: Terreno regular, maleza ligera (&lt; 30cm) y sin obstáculos relevantes.</p>
              </div>
              <div className="w-full max-w-[7.5rem] shrink-0">
                {renderEuroInput('precio_desbroce_m2', config.precio_desbroce_m2 || 0, (v) => updateConfig({ precio_desbroce_m2: v }))}
              </div>
            </div>
          </div>
          <hr className="border-gray-200 my-8" />

      {/* Herbicide Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Aplicación de Herbicida</h4>
            <p className="text-xs text-gray-500 mt-1">Tratamiento para evitar rebrotes tras el desbroce.</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <button
              type="button"
              // D3: sin licencia vigente no se puede ACTIVAR el herbicida — `disabled` sólo
              // bloquea ENCENDERLO (si ya estaba encendido de antes, sigue pudiendo apagarse).
              // Antes esto era solo un aviso que no impedía nada: el jardinero podía guardar
              // el precio de herbicida sin carnet y el motor lo cobraba igual.
              disabled={!isHerbicideEnabled && !isLicenseActive}
              onClick={() => {
                const newVal = !isHerbicideEnabled;
                setIsHerbicideEnabled(newVal);
                if (!newVal) {
                  updateConfig({ precio_herbicida_m2: 0 });
                }
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2 ${
                isHerbicideEnabled ? 'bg-green-600' : 'bg-gray-200'
              } ${!isHerbicideEnabled && !isLicenseActive ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
              role="switch"
              aria-checked={isHerbicideEnabled}
              aria-disabled={!isHerbicideEnabled && !isLicenseActive}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  isHerbicideEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </label>
        </div>

        {!isHerbicideEnabled && !isLicenseActive && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-800">
                {licenseStatus === 'expired' ? 'Tu licencia ha caducado' : 'Licencia fitosanitaria requerida'}
              </p>
              <p className="text-xs text-amber-700 mt-1">
                {licenseStatus === 'expired'
                  ? 'No puedes activar el herbicida hasta que vuelvas a subir tu carnet y sea aprobado.'
                  : licenseStatus === 'pending'
                    ? 'Tu carnet está en revisión. Podrás activar el herbicida en cuanto se apruebe.'
                    : 'Por ley (RD 1311/2012), aplicar herbicida exige el carnet de manipulador de productos fitosanitarios verificado. Sube tu carnet para poder activarlo.'}
              </p>
              {onGoToLicense && (
                <button
                  type="button"
                  onClick={onGoToLicense}
                  className="mt-2 text-xs font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950"
                >
                  {licenseStatus === 'expired' ? 'Renovar mi carnet' : 'Subir mi carnet ahora'}
                </button>
              )}
            </div>
          </div>
        )}

        {isHerbicideEnabled && (
          <div className="mt-4 pt-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 pr-2">
                <span className="text-sm font-medium text-gray-900 block">Precio herbicida (por m²)</span>
              </div>
              <div className="w-full max-w-[7.5rem] shrink-0">
                {renderEuroInput('precio_herbicida_m2', config.precio_herbicida_m2 || 0, (v) => updateConfig({ precio_herbicida_m2: v }))}
              </div>
            </div>
          </div>
        )}
      </div>

      <hr className="border-gray-200 my-8" />
      
      {/* Surcharges Section */}
      <div>
        <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Suplementos y Dificultad</h4>
        <p className="text-xs text-gray-500 mt-1 mb-4">
          Incrementos porcentuales aplicables al precio base del desbroce. La definicion oficial de cada nivel de dificultad es la que aparece junto a su configurador numerico.
        </p>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="block text-sm font-medium text-gray-900">Dificultad Media</span>
              <span className="text-xs text-gray-500">Zonas con pendiente, terreno irregular o maleza herbácea densa (&gt; 30cm).</span>
            </div>
            {renderPercentageInput('dificultad_media', config.suplementos.dificultad_media, (v) => updateSuplemento('dificultad_media', v))}
          </div>
          
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="block text-sm font-medium text-gray-900">Dificultad Alta</span>
              <span className="text-xs text-gray-500 block mt-1">Zonas de difícil acceso, maleza leñosa/zarzas, o presencia de piedras/escombros.</span>
            </div>
            {renderPercentageInput('dificultad_alta', config.suplementos.dificultad_alta, (v) => updateSuplemento('dificultad_alta', v))}
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="block text-sm font-medium text-gray-900">Retirada de restos verdes</span>
              <span className="text-xs text-gray-500 block mt-1">Recogida y gestión de los restos del desbroce.</span>
            </div>
            {renderPercentageInput('retirada_restos', config.suplementos.retirada_restos, (v) => updateSuplemento('retirada_restos', v))}
          </div>
        </div>
      </div>

    </div>
  );
};

export default WeedingPricingConfigurator;
