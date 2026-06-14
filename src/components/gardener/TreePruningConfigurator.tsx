import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Trash2, Info } from 'lucide-react';
import { TreePruningServiceConfig } from '../../types/treePruning';
import { UnifiedNumericInput } from './UnifiedNumericInput';
import { useAutoSave } from '../../hooks/useAutoSave';
import SaveStatusIndicator from '../common/SaveStatusIndicator';

const getVal = (v: any) => (v === undefined || v === null || v === '') ? ('' as any) : Number(v);
const isInvalid = (v: any) => v === undefined || v === null || v === '';

interface Props {
  value?: TreePruningServiceConfig;
  initialConfig?: TreePruningServiceConfig;
  onChange: (config: TreePruningServiceConfig) => void;
  onSave?: (config: TreePruningServiceConfig) => Promise<void>;
}

export const TreePruningConfigurator: React.FC<Props> = ({ value, initialConfig, onChange, onSave }) => {
  const [showGlobalInfo, setShowGlobalInfo] = useState(false);
  const hasLargeBandConfigured = (cfg?: TreePruningServiceConfig) =>
    cfg?.estructural?.large !== undefined ||
    cfg?.formacion?.large !== undefined ||
    cfg?.yield_units_per_hour?.estructural?.large !== undefined ||
    cfg?.yield_units_per_hour?.formacion?.large !== undefined;

  const normalizedInitialConfig: TreePruningServiceConfig = useMemo(() => {
    return {
      minimumPrice: getVal(initialConfig?.minimumPrice),
      formacion: {
        small: getVal(initialConfig?.formacion?.small),
        medium: getVal(initialConfig?.formacion?.medium),
        large: initialConfig?.formacion?.large !== undefined ? getVal(initialConfig?.formacion?.large) : undefined,
      },
      estructural: {
        small: getVal(initialConfig?.estructural?.small),
        medium: getVal(initialConfig?.estructural?.medium),
        large: initialConfig?.estructural?.large !== undefined ? getVal(initialConfig?.estructural?.large) : undefined,
      },
      difficultyIncrease: getVal(initialConfig?.difficultyIncrease),
      wasteRemovalMultiplier: getVal(initialConfig?.wasteRemovalMultiplier),
      yield_units_per_hour: {
        formacion: {
          small: getVal(initialConfig?.yield_units_per_hour?.formacion?.small),
          medium: getVal(initialConfig?.yield_units_per_hour?.formacion?.medium),
          large: initialConfig?.yield_units_per_hour?.formacion?.large !== undefined ? getVal(initialConfig?.yield_units_per_hour?.formacion?.large) : undefined,
        },
        estructural: {
          small: getVal(initialConfig?.yield_units_per_hour?.estructural?.small),
          medium: getVal(initialConfig?.yield_units_per_hour?.estructural?.medium),
          large: initialConfig?.yield_units_per_hour?.estructural?.large !== undefined ? getVal(initialConfig?.yield_units_per_hour?.estructural?.large) : undefined,
        }
      }
    };
  }, [initialConfig]);

  const [config, setConfig] = useState<TreePruningServiceConfig>(normalizedInitialConfig);
  const [showLargeOption, setShowLargeOption] = useState<boolean>(hasLargeBandConfigured(initialConfig));
  useEffect(() => {
    if (value) {
      setConfig(value);
      setShowLargeOption(hasLargeBandConfigured(value));
    }
  }, [value]);

  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const validateConfig = useCallback((currentConfig: TreePruningServiceConfig): string[] => {
    const errors: string[] = [];
    
    if (isInvalid(currentConfig.formacion.small)) errors.push('formacion.small');
    if (isInvalid(currentConfig.formacion.medium)) errors.push('formacion.medium');
    if (isInvalid(currentConfig.estructural.small)) errors.push('estructural.small');
    if (isInvalid(currentConfig.estructural.medium)) errors.push('estructural.medium');

    if (showLargeOption) {
      if (isInvalid(currentConfig.formacion.large)) errors.push('formacion.large');
      if (isInvalid(currentConfig.estructural.large)) errors.push('estructural.large');
    }

    // Yields are always mandatory
    const yields = currentConfig.yield_units_per_hour;
    if (isInvalid(yields?.formacion?.small)) errors.push('yield_formacion_small');
    if (isInvalid(yields?.formacion?.medium)) errors.push('yield_formacion_medium');
    if (isInvalid(yields?.estructural?.small)) errors.push('yield_estructural_small');
    if (isInvalid(yields?.estructural?.medium)) errors.push('yield_estructural_medium');
    if (showLargeOption) {
      if (isInvalid(yields?.formacion?.large)) errors.push('yield_formacion_large');
      if (isInvalid(yields?.estructural?.large)) errors.push('yield_estructural_large');
    }

    if (isInvalid(currentConfig.minimumPrice)) errors.push('minimumPrice');
    if (isInvalid(currentConfig.difficultyIncrease)) errors.push('difficultyIncrease');
    if (isInvalid(currentConfig.wasteRemovalMultiplier)) errors.push('wasteRemovalMultiplier');
    return errors;
  }, [showLargeOption]);

  useEffect(() => {
    setValidationErrors(validateConfig(config));
  }, [config, validateConfig]);

  const { status } = useAutoSave({
    value: config,
    initialValue: normalizedInitialConfig,
    onSave: async (val) => {
      if (onSave) {
        await onSave(val);
      }
    },
    validate: validateConfig
  });

  const updateConfig = (updates: Partial<TreePruningServiceConfig>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    validateConfig(newConfig);
    onChange(newConfig);
  };

  const handleBandChange = (
    pruningType: 'estructural' | 'formacion',
    band: 'small' | 'medium' | 'large',
    value: number
  ) => {
    const nextValue = value;
    const newPruningType = { ...config[pruningType] };
    if (band === 'large' && nextValue <= 0) {
      newPruningType.large = undefined;
    } else {
      newPruningType[band] = nextValue;
    }
    
    updateConfig({
      [pruningType]: newPruningType
    });

    if (validationErrors.includes(`${pruningType}.${band}`)) {
      setValidationErrors(prev => prev.filter(x => x !== `${pruningType}.${band}`));
    }
  };

  const handleShowLargeOption = () => {
    setShowLargeOption(true);
    const updates: Partial<TreePruningServiceConfig> = {};
    if (config.estructural.large === undefined) {
      updates.estructural = { ...config.estructural, large: 0 };
    }
    if (config.formacion.large === undefined) {
      updates.formacion = { ...config.formacion, large: 0 };
    }
    if (config.yield_units_per_hour.estructural.large === undefined || config.yield_units_per_hour.formacion.large === undefined) {
      updates.yield_units_per_hour = {
        estructural: {
          ...config.yield_units_per_hour.estructural,
          large: config.yield_units_per_hour.estructural.large ?? 0,
        },
        formacion: {
          ...config.yield_units_per_hour.formacion,
          large: config.yield_units_per_hour.formacion.large ?? 0,
        },
      };
    }
    if (Object.keys(updates).length > 0) {
      updateConfig(updates);
    }
  };

  const handleRemoveLargeOption = () => {
    setShowLargeOption(false);
    updateConfig({
      formacion: { ...config.formacion, large: undefined },
      estructural: { ...config.estructural, large: undefined },
      yield_units_per_hour: {
        formacion: { ...config.yield_units_per_hour.formacion, large: undefined },
        estructural: { ...config.yield_units_per_hour.estructural, large: undefined },
      },
    });
    setValidationErrors(prev => prev.filter(x => !x.endsWith('.large') && !x.endsWith('_large')));
  };

  const renderEuroInput = (id: string, valueNum: number | undefined, onValueChange: (num: number) => void) => {
    return (
      <div className="w-full sm:w-[7.5rem] mt-2 sm:mt-0">
        <UnifiedNumericInput
          value={valueNum}
          autoSelect
          onChange={onValueChange}
          hasError={validationErrors.includes(id)}
        />
      </div>
    );
  };

  const renderPercentageInput = (id: string, valueNum: number, onValueChange: (num: number) => void) => {
    return (
      <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto mt-2 sm:mt-0">
        <span className="text-gray-400 text-sm font-medium hidden sm:inline">+</span>
        <div className="w-full sm:w-[6.5rem]">
          <UnifiedNumericInput
            value={valueNum}
            autoSelect
            onChange={onValueChange}
            hasError={validationErrors.includes(id)}
            suffix="%"
          />
        </div>
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
                    Configuración de tarifas de Poda de árboles (IVA incluido)
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
                                    <li>Precios por unidad según el tipo de poda y tamaño del árbol.</li>
                                    <li>La poda <strong>Formación</strong> es para árboles jóvenes o mantenimiento ligero.</li>
                                    <li>La poda <strong>Estructural</strong> es para árboles grandes, ramas pesadas o saneamiento profundo.</li>
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between">
          <div className="pr-2">
            <span className="text-sm font-medium text-gray-900 block">Importe mínimo del servicio</span>
            <p className="text-xs text-gray-500 mt-1">Se aplica al final del cálculo del precio.</p>
          </div>
          <div className="w-full sm:w-[7.5rem] mt-3 sm:mt-0">
            {renderEuroInput('minimumPrice', config.minimumPrice, (v) => updateConfig({ minimumPrice: v }))}
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
        
        <div className="space-y-6 p-4 bg-white border border-gray-200 rounded-xl shadow-sm">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            <div>
              <h5 className="text-xs font-bold text-gray-400 uppercase mb-3">Velocidad de trabajo Poda Formación (arb/h)</h5>
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between">
                  <span className="text-sm text-gray-600">Pequeño</span>
                  <div className="w-full sm:w-[7.5rem] mt-2 sm:mt-0">
                    <UnifiedNumericInput
                      value={config.yield_units_per_hour?.formacion?.small}
                      suffix="arb/h"
                      onChange={(v) => updateConfig({ 
                        yield_units_per_hour: { 
                          ...config.yield_units_per_hour!, 
                          formacion: { ...config.yield_units_per_hour!.formacion, small: v } 
                        } 
                      })}
                      hasError={validationErrors.includes('yield_formacion_small')}
                    />
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between">
                  <span className="text-sm text-gray-600">Mediano</span>
                  <div className="w-full sm:w-[7.5rem] mt-2 sm:mt-0">
                    <UnifiedNumericInput
                      value={config.yield_units_per_hour?.formacion?.medium}
                      suffix="arb/h"
                      onChange={(v) => updateConfig({ 
                        yield_units_per_hour: { 
                          ...config.yield_units_per_hour!, 
                          formacion: { ...config.yield_units_per_hour!.formacion, medium: v } 
                        } 
                      })}
                      hasError={validationErrors.includes('yield_formacion_medium')}
                    />
                  </div>
                </div>
                {showLargeOption && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between">
                    <span className="text-sm text-gray-600">Grande</span>
                    <div className="w-full sm:w-[7.5rem] mt-2 sm:mt-0">
                      <UnifiedNumericInput
                        value={config.yield_units_per_hour?.formacion?.large}
                        suffix="arb/h"
                        onChange={(v) => updateConfig({ 
                          yield_units_per_hour: { 
                            ...config.yield_units_per_hour!, 
                            formacion: { ...config.yield_units_per_hour!.formacion, large: v } 
                          } 
                        })}
                        hasError={validationErrors.includes('yield_formacion_large')}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div>
              <h5 className="text-xs font-bold text-gray-400 uppercase mb-3">Velocidad de trabajo Poda Estructural (arb/h)</h5>
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between">
                  <span className="text-sm text-gray-600">Pequeño</span>
                  <div className="w-full sm:w-[7.5rem] mt-2 sm:mt-0">
                    <UnifiedNumericInput
                      value={config.yield_units_per_hour?.estructural?.small}
                      suffix="arb/h"
                      onChange={(v) => updateConfig({ 
                        yield_units_per_hour: { 
                          ...config.yield_units_per_hour!, 
                          estructural: { ...config.yield_units_per_hour!.estructural, small: v } 
                        } 
                      })}
                      hasError={validationErrors.includes('yield_estructural_small')}
                    />
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between">
                  <span className="text-sm text-gray-600">Mediano</span>
                  <div className="w-full sm:w-[7.5rem] mt-2 sm:mt-0">
                    <UnifiedNumericInput
                      value={config.yield_units_per_hour?.estructural?.medium}
                      suffix="arb/h"
                      onChange={(v) => updateConfig({ 
                        yield_units_per_hour: { 
                          ...config.yield_units_per_hour!, 
                          estructural: { ...config.yield_units_per_hour!.estructural, medium: v } 
                        } 
                      })}
                      hasError={validationErrors.includes('yield_estructural_medium')}
                    />
                  </div>
                </div>
                {showLargeOption && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between">
                    <span className="text-sm text-gray-600">Grande</span>
                    <div className="w-full sm:w-[7.5rem] mt-2 sm:mt-0">
                      <UnifiedNumericInput
                        value={config.yield_units_per_hour?.estructural?.large}
                        suffix="arb/h"
                        onChange={(v) => updateConfig({ 
                          yield_units_per_hour: { 
                            ...config.yield_units_per_hour!, 
                            estructural: { ...config.yield_units_per_hour!.estructural, large: v } 
                          } 
                        })}
                        hasError={validationErrors.includes('yield_estructural_large')}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2 italic">
            Configura cuántos árboles puedes podar por hora. Este valor se utiliza para calcular la duración estimada del servicio y gestionar tu calendario.
          </p>
        </div>
      </div>

      <hr className="border-gray-200 my-8" />

      <div>
        <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">Tarifas por unidad (Precio Fijo)</h4>
        {/* 1. Tipos de poda */}
            <div className="space-y-8">
              <div>
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 mb-6">
                  <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Tarifas por tipo de poda (€/unidad)</h4>
                  
                  {!showLargeOption ? (
                    <button 
                      type="button"
                      onClick={handleShowLargeOption}
                      className="w-full md:w-auto mt-2 md:mt-0 text-xs font-semibold text-green-700 bg-green-50 px-4 py-2.5 rounded-lg hover:bg-green-100 transition-colors border border-green-200/60"
                    >
                      + Añadir árboles grandes
                    </button>
                  ) : (
                    <button 
                      type="button"
                      onClick={handleRemoveLargeOption}
                      className="w-full md:w-auto mt-2 md:mt-0 justify-center text-xs font-semibold text-red-600 bg-red-50 px-4 py-2.5 rounded-lg hover:bg-red-100 transition-colors flex items-center gap-1 border border-red-200/60"
                    >
                      <Trash2 className="w-4 h-4" /> Quitar árboles grandes
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                  {/* Formación */}
                  <div>
                    <h4 className="text-sm font-bold text-gray-900 mb-3">Poda de formación</h4>
                    <p className="text-xs text-gray-500 mt-1 mb-4">Guía el crecimiento para dar forma, ideal en árboles jóvenes.</p>
                    
                    <div className="space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between">
                        <div className="min-w-0">
                          <span className="block text-sm font-medium text-gray-900">0m - 3m (Pequeño)</span>
                        </div>
                        {renderEuroInput('formacion.small', config.formacion.small, (v) => handleBandChange('formacion', 'small', v))}
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between">
                        <div className="min-w-0">
                          <span className="block text-sm font-medium text-gray-900">3m - 5m (Mediano)</span>
                        </div>
                        {renderEuroInput('formacion.medium', config.formacion.medium, (v) => handleBandChange('formacion', 'medium', v))}
                      </div>
                      {showLargeOption && (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between">
                          <div className="min-w-0">
                            <span className="block text-sm font-medium text-gray-900">5m - 9m (Grande)</span>
                          </div>
                          {renderEuroInput('formacion.large', config.formacion.large, (v) => handleBandChange('formacion', 'large', v))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Estructural */}
                  <div>
                    <h4 className="text-sm font-bold text-gray-900 mb-3">Poda estructural</h4>
                    <p className="text-xs text-gray-500 mt-1 mb-4">Elimina ramas dañadas o peligrosas y mejora la estructura del árbol.</p>
                    
                    <div className="space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between">
                        <div className="min-w-0">
                          <span className="block text-sm font-medium text-gray-900">0m - 3m (Pequeño)</span>
                        </div>
                        {renderEuroInput('estructural.small', config.estructural.small, (v) => handleBandChange('estructural', 'small', v))}
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between">
                        <div className="min-w-0">
                          <span className="block text-sm font-medium text-gray-900">3m - 5m (Mediano)</span>
                        </div>
                        {renderEuroInput('estructural.medium', config.estructural.medium, (v) => handleBandChange('estructural', 'medium', v))}
                      </div>
                      {showLargeOption && (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between">
                          <div className="min-w-0">
                            <span className="block text-sm font-medium text-gray-900">5m - 9m (Grande)</span>
                          </div>
                          {renderEuroInput('estructural.large', config.estructural.large, (v) => handleBandChange('estructural', 'large', v))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
      </div>
      <hr className="border-gray-200 my-8" />

      {/* Suplementos */}
      <div>
        <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">Suplementos Adicionales</h4>
        
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-3">
            <div className="min-w-0">
              <span className="block text-sm font-medium text-gray-900">Dificultad Alta</span>
              <span className="text-xs text-gray-500 block mt-1">Aplica si la IA detecta terreno irregular u obstáculos. No aplica a árboles de 0-3m.</span>
            </div>
            {renderPercentageInput('difficultyIncrease', config.difficultyIncrease, (v) => updateConfig({ difficultyIncrease: v }))}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-3">
            <div className="min-w-0">
              <span className="block text-sm font-medium text-gray-900">Retirada de restos verdes</span>
              <span className="text-xs text-gray-500 block mt-1">Recogida y gestión de los restos de la poda.</span>
            </div>
            {renderPercentageInput('wasteRemovalMultiplier', config.wasteRemovalMultiplier, (v) => updateConfig({ wasteRemovalMultiplier: v }))}
          </div>
        </div>
      </div>

    </div>
  );
};

export default TreePruningConfigurator;
