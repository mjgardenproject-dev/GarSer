import React, { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, AlertCircle, Trash2, Info } from 'lucide-react';
import { deepEqual } from '../../utils/deepEqual';
import { TreePruningServiceConfig } from '../../types/treePruning';
import ServiceConfigFooter from './ServiceConfigFooter';

interface Props {
  value?: TreePruningServiceConfig;
  initialConfig?: TreePruningServiceConfig;
  onChange: (config: TreePruningServiceConfig) => void;
  onSave?: (config: TreePruningServiceConfig) => Promise<void>;
}

const EuroInput = ({ id, valueNum, validationErrors, setValidationErrors, onValueChange }: { id: string, valueNum: number | undefined, validationErrors: string[], setValidationErrors: any, onValueChange: (num: number) => void }) => {
  const hasError = validationErrors.includes(id);
  const [localValue, setLocalValue] = useState(valueNum === 0 || valueNum === undefined ? '' : valueNum.toString());

  useEffect(() => {
    if (valueNum === undefined || valueNum === 0) {
      setLocalValue((prev) => {
        if (prev !== '' && prev !== '0' && prev !== '0.') return '';
        return prev;
      });
    } else {
      setLocalValue((prev) => {
        const parsed = parseFloat(prev.replace(/,/g, '.'));
        if (isNaN(parsed) || parsed !== valueNum) return valueNum.toString();
        return prev;
      });
    }
  }, [valueNum]);

  return (
    <div className="relative w-full">
      <input
        type="text"
        inputMode="decimal"
        className={`w-full h-10 pl-3 pr-7 border rounded-lg text-right text-sm focus:ring-2 focus:ring-green-500 ${hasError ? 'border-red-400 bg-red-50' : ((valueNum || 0) > 0 ? 'border-gray-300' : 'border-gray-200 bg-gray-50')}`}
        value={localValue}
        onChange={(e) => {
          const val = e.target.value.replace(/,/g, '.');
          if (/^\d*\.?\d*$/.test(val)) {
            setLocalValue(val);
            if (val !== '' && val !== '.') {
              onValueChange(parseFloat(val));
            } else {
              onValueChange(0);
            }
            if (hasError) {
              setValidationErrors((prev: string[]) => prev.filter((x) => x !== id));
            }
          }
        }}
        onBlur={() => {
          if (valueNum === 0 || valueNum === undefined) {
            setLocalValue('');
          } else {
            setLocalValue(valueNum.toString());
          }
        }}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">€</span>
    </div>
  );
};

const PercentageInput = ({ id, valueNum, validationErrors, setValidationErrors, onValueChange }: { id: string, valueNum: number, validationErrors: string[], setValidationErrors: any, onValueChange: (num: number) => void }) => {
  const hasError = validationErrors.includes(id);
  const [localValue, setLocalValue] = useState(valueNum === 0 ? '' : valueNum.toString());

  useEffect(() => {
    if (valueNum === 0) {
      setLocalValue((prev) => {
        if (prev !== '' && prev !== '0' && prev !== '0.') return '';
        return prev;
      });
    } else {
      setLocalValue((prev) => {
        const parsed = parseFloat(prev.replace(/,/g, '.'));
        if (isNaN(parsed) || parsed !== valueNum) return valueNum.toString();
        return prev;
      });
    }
  }, [valueNum]);

  return (
    <div className="flex items-center gap-2 shrink-0">
      <span className="text-gray-400 text-sm font-medium">+</span>
      <input
        type="text"
        inputMode="numeric"
        className={`w-20 h-10 px-3 border rounded-lg text-right text-base sm:text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all ${hasError ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
        value={localValue}
        placeholder="0"
        onChange={(e) => {
          const val = e.target.value.replace(/,/g, '.');
          if (/^\d*\.?\d*$/.test(val)) {
            setLocalValue(val);
            if (val !== '' && val !== '.') {
              onValueChange(parseFloat(val));
            } else {
              onValueChange(0);
            }
            if (hasError) {
              setValidationErrors((prev: string[]) => prev.filter((x) => x !== id));
            }
          }
        }}
        onBlur={() => {
          if (valueNum === 0) {
            setLocalValue('');
          } else {
            setLocalValue(valueNum.toString());
          }
        }}
      />
      <span className="text-gray-500 text-sm font-medium w-4">%</span>
    </div>
  );
};

const TreePruningConfigurator: React.FC<Props> = ({ value, initialConfig, onChange, onSave }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [showGlobalInfo, setShowGlobalInfo] = useState(false);

  const normalizedInitialConfig: TreePruningServiceConfig = useMemo(() => {
    return {
      minimumPrice: initialConfig?.minimumPrice || 0,
      formacion: {
        small: initialConfig?.formacion?.small || 0,
        medium: initialConfig?.formacion?.medium || 0,
        large: initialConfig?.formacion?.large,
      },
      estructural: {
        small: initialConfig?.estructural?.small || 0,
        medium: initialConfig?.estructural?.medium || 0,
        large: initialConfig?.estructural?.large,
      },
      difficultyIncrease: initialConfig?.difficultyIncrease || 0,
      wasteRemovalMultiplier: initialConfig?.wasteRemovalMultiplier || 0,
    };
  }, [initialConfig]);

  const [config, setConfig] = useState<TreePruningServiceConfig>(normalizedInitialConfig);
  const [showLargeOption, setShowLargeOption] = useState<boolean>(
    initialConfig?.estructural?.large !== undefined || initialConfig?.formacion?.large !== undefined
  );
  useEffect(() => {
    if (value) {
      setConfig(value);
      setShowLargeOption(value.estructural?.large !== undefined || value.formacion?.large !== undefined);
    }
  }, [value]);

  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showResetModal, setShowResetModal] = useState(false);

  const isDirty = useMemo(() => !deepEqual(config, normalizedInitialConfig), [config, normalizedInitialConfig]);

  const validateConfig = (currentConfig: TreePruningServiceConfig): string[] => {
    const errors: string[] = [];
    if (currentConfig.minimumPrice <= 0) errors.push('minimumPrice');
    if (currentConfig.formacion.small <= 0) errors.push('formacion.small');
    if (currentConfig.formacion.medium <= 0) errors.push('formacion.medium');
    if (currentConfig.estructural.small <= 0) errors.push('estructural.small');
    if (currentConfig.estructural.medium <= 0) errors.push('estructural.medium');

    if (showLargeOption) {
      if ((currentConfig.formacion.large || 0) <= 0) errors.push('formacion.large');
      if ((currentConfig.estructural.large || 0) <= 0) errors.push('estructural.large');
    }
    return errors;
  };

  const updateConfig = (updates: Partial<TreePruningServiceConfig>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    validateConfig(newConfig);
    onChange(newConfig);
  };

  const handleReset = () => {
    setShowResetModal(true);
  };

  const confirmReset = async () => {
    setShowResetModal(false);
    const emptyConfig: TreePruningServiceConfig = {
      minimumPrice: 0,
      formacion: { small: 0, medium: 0 },
      estructural: { small: 0, medium: 0 },
      difficultyIncrease: 0,
      wasteRemovalMultiplier: 0
    };
    onChange(emptyConfig);
    setValidationErrors([]);
    
    if (onSave) {
      try {
        setIsSaving(true);
        await onSave(emptyConfig);
      } catch (error) {
        console.error('Error resetting config:', error);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const handleSave = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    const errors = validateConfig(config);
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors([]);

    if (onSave) {
      try {
        setIsSaving(true);
        await onSave(config);
      } catch (error) {
        console.error('Error saving config:', error);
      } finally {
        setIsSaving(false);
      }
    }
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
    if (Object.keys(updates).length > 0) {
      updateConfig(updates);
    }
  };

  const handleRemoveLargeOption = () => {
    setShowLargeOption(false);
    updateConfig({
      formacion: { ...config.formacion, large: undefined },
      estructural: { ...config.estructural, large: undefined },
    });
    setValidationErrors(prev => prev.filter(x => !x.endsWith('.large')));
  };

  const renderEuroInput = (id: string, valueNum: number | undefined, onValueChange: (num: number) => void) => {
    return <EuroInput id={id} valueNum={valueNum} validationErrors={validationErrors} setValidationErrors={setValidationErrors} onValueChange={onValueChange} />;
  };

  const renderPercentageInput = (id: string, valueNum: number, onValueChange: (num: number) => void) => {
    return <PercentageInput id={id} valueNum={valueNum} validationErrors={validationErrors} setValidationErrors={setValidationErrors} onValueChange={onValueChange} />;
  };

  return (
    <div className="space-y-4">
      {/* Header Info */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-2">
        <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 text-lg">
                Configuración de tarifas de poda de árboles (IVA incluido)
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
                                <li>Los precios son fijos por árbol y rango de altura.</li>
                                <li>Los precios <strong>no incluyen la retirada de restos</strong> (se configura abajo).</li>
                                <li>El <strong>IVA está incluido</strong>.</li>
                            </ul>
                        </div>
                    </>
                )}
            </div>
        </div>
      </div>

      {/* Minimum Price */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-sm font-medium text-gray-700 mb-1">Precio mínimo del servicio</p>
            <p className="text-xs text-gray-500 mb-2">Importe mínimo a cobrar por desplazamiento y equipo.</p>
            {renderEuroInput('minimumPrice', config.minimumPrice, (v) => updateConfig({ minimumPrice: v }))}
          </div>
        </div>
      </div>

      {/* Formacion */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
        <div>
          <h4 className="text-sm font-bold text-gray-900">Poda de formación</h4>
          <p className="text-xs text-gray-500 mt-1">Guía el crecimiento para dar forma, ideal en árboles jóvenes.</p>
        </div>
        
        <div className="space-y-1 divide-y divide-gray-100">
          <div className="flex items-center justify-between py-3 gap-3">
            <div className="min-w-0">
              <span className="block text-sm font-medium text-gray-900">0m - 3m (Pequeño)</span>
            </div>
            <div className="w-32">
              {renderEuroInput('formacion.small', config.formacion.small, (v) => handleBandChange('formacion', 'small', v))}
            </div>
          </div>
          <div className="flex items-center justify-between py-3 gap-3">
            <div className="min-w-0">
              <span className="block text-sm font-medium text-gray-900">3m - 5m (Mediano)</span>
            </div>
            <div className="w-32">
              {renderEuroInput('formacion.medium', config.formacion.medium, (v) => handleBandChange('formacion', 'medium', v))}
            </div>
          </div>
          {showLargeOption && (
            <div className="flex items-center justify-between py-3 gap-3">
              <div className="min-w-0">
                <span className="block text-sm font-medium text-gray-900">5m - 9m (Grande)</span>
              </div>
              <div className="w-32">
                {renderEuroInput('formacion.large', config.formacion.large, (v) => handleBandChange('formacion', 'large', v))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Estructural */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
        <div>
          <h4 className="text-sm font-bold text-gray-900">Poda estructural</h4>
          <p className="text-xs text-gray-500 mt-1">Elimina ramas dañadas o peligrosas y mejora la estructura del árbol.</p>
        </div>
        
        <div className="space-y-1 divide-y divide-gray-100">
          <div className="flex items-center justify-between py-3 gap-3">
            <div className="min-w-0">
              <span className="block text-sm font-medium text-gray-900">0m - 3m (Pequeño)</span>
            </div>
            <div className="w-32">
              {renderEuroInput('estructural.small', config.estructural.small, (v) => handleBandChange('estructural', 'small', v))}
            </div>
          </div>
          <div className="flex items-center justify-between py-3 gap-3">
            <div className="min-w-0">
              <span className="block text-sm font-medium text-gray-900">3m - 5m (Mediano)</span>
            </div>
            <div className="w-32">
              {renderEuroInput('estructural.medium', config.estructural.medium, (v) => handleBandChange('estructural', 'medium', v))}
            </div>
          </div>
          {showLargeOption && (
            <div className="flex items-center justify-between py-3 gap-3">
              <div className="min-w-0">
                <span className="block text-sm font-medium text-gray-900">5m - 9m (Grande)</span>
              </div>
              <div className="w-32">
                {renderEuroInput('estructural.large', config.estructural.large, (v) => handleBandChange('estructural', 'large', v))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Toggle large option */}
      <div className="flex justify-end">
        {!showLargeOption ? (
          <button
            type="button"
            onClick={handleShowLargeOption}
            className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
          >
            + Añadir poda de árboles en altura (5m - 9m)
          </button>
        ) : (
          <button
            type="button"
            onClick={handleRemoveLargeOption}
            className="px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" /> Eliminar poda en altura
          </button>
        )}
      </div>

      {/* Suplementos */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h4 className="text-sm font-bold text-gray-900 mb-2">Suplementos Adicionales</h4>
        
        <div className="space-y-1 divide-y divide-gray-100">
          <div className="flex items-center justify-between py-3 gap-3">
            <div className="min-w-0">
              <span className="block text-sm font-medium text-gray-900">Dificultad Alta</span>
              <span className="text-xs text-gray-500">Aplica si la IA detecta terreno irregular u obstáculos. No aplica a árboles de 0-3m.</span>
            </div>
            {renderPercentageInput('difficultyIncrease', config.difficultyIncrease, (v) => updateConfig({ difficultyIncrease: v }))}
          </div>

          <div className="flex items-center justify-between py-3 gap-3">
            <div className="min-w-0">
              <span className="block text-sm font-medium text-gray-900">Retirada de restos verdes</span>
              <span className="text-xs text-gray-500">Recogida y gestión de los restos de la poda.</span>
            </div>
            {renderPercentageInput('wasteRemovalMultiplier', config.wasteRemovalMultiplier, (v) => updateConfig({ wasteRemovalMultiplier: v }))}
          </div>
        </div>
      </div>

      {/* Error warnings if needed - though we only use global validation */}
      {validationErrors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold text-red-800">Faltan precios por configurar</h4>
            <p className="text-sm text-red-600 mt-1">Completa todos los importes requeridos (mínimo, rangos básicos) antes de continuar.</p>
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
                Se eliminarán todos los precios y recargos configurados para la poda de árboles. Esta acción es irreversible.
              </p>
              
              <div className="flex gap-3 w-full">
                <button
                  type="button"
                  onClick={() => setShowResetModal(false)}
                  className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmReset}
                  className="flex-1 px-4 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition-colors"
                >
                  Sí, restablecer
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

export default TreePruningConfigurator;
