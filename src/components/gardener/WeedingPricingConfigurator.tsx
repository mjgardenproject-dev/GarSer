import React, { useMemo, useState } from 'react';
import { Save, AlertTriangle, AlertCircle, Info, Leaf } from 'lucide-react';
import { deepEqual } from '../../utils/deepEqual';
import { WeedingPricingConfig } from '../../utils/serviceValidation';

interface Props {
  value?: WeedingPricingConfig;
  initialConfig?: WeedingPricingConfig;
  onChange: (config: WeedingPricingConfig) => void;
  onSave?: (config: WeedingPricingConfig) => Promise<void>;
  licenseStatus?: 'pending' | 'approved' | 'rejected' | null;
}

const EMPTY_CONFIG: WeedingPricingConfig = {
  version: 'weeding_v1',
  importe_minimo: 0,
  precio_desbroce_m2: 0,
  precio_herbicida_m2: 0,
  suplementos: {
    dificultad_media: 0,
    dificultad_alta: 0,
    retirada_restos: 0,
  }
};

const WeedingPricingConfigurator: React.FC<Props> = ({ 
  value, 
  initialConfig, 
  onChange, 
  onSave, 
  licenseStatus = null 
}) => {
  const [isSaving, setIsSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showGlobalError, setShowGlobalError] = useState(false);
  const [isHerbicideEnabled, setIsHerbicideEnabled] = useState<boolean>(() => {
    return (value?.precio_herbicida_m2 || 0) > 0;
  });

  const config = useMemo((): WeedingPricingConfig => {
    if (!value) return { ...EMPTY_CONFIG };
    return {
      version: 'weeding_v1',
      importe_minimo: Number(value.importe_minimo || 0),
      precio_desbroce_m2: Number(value.precio_desbroce_m2 || 0),
      precio_herbicida_m2: Number(value.precio_herbicida_m2 || 0),
      suplementos: {
        dificultad_media: Number(value.suplementos?.dificultad_media || 0),
        dificultad_alta: Number(value.suplementos?.dificultad_alta || 0),
        retirada_restos: Number(value.suplementos?.retirada_restos || 0),
      }
    };
  }, [value]);

  const normalizedInitialConfig = useMemo((): WeedingPricingConfig => {
    if (!initialConfig) return { ...EMPTY_CONFIG };
    return {
      version: 'weeding_v1',
      importe_minimo: Number(initialConfig.importe_minimo || 0),
      precio_desbroce_m2: Number(initialConfig.precio_desbroce_m2 || 0),
      precio_herbicida_m2: Number(initialConfig.precio_herbicida_m2 || 0),
      suplementos: {
        dificultad_media: Number(initialConfig.suplementos?.dificultad_media || 0),
        dificultad_alta: Number(initialConfig.suplementos?.dificultad_alta || 0),
        retirada_restos: Number(initialConfig.suplementos?.retirada_restos || 0),
      }
    };
  }, [initialConfig]);

  const isDirty = useMemo(() => !deepEqual(config, normalizedInitialConfig), [config, normalizedInitialConfig]);

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

  const validateConfig = (): string[] => {
    const errors: string[] = [];
    if (config.importe_minimo <= 0) errors.push('importe_minimo');
    if (config.precio_desbroce_m2 <= 0) errors.push('precio_desbroce_m2');
    if (isHerbicideEnabled && (config.precio_herbicida_m2 || 0) <= 0) {
      errors.push('precio_herbicida_m2');
    }
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
      const configToSave = { ...config };
      if (!isHerbicideEnabled) {
        configToSave.precio_herbicida_m2 = 0;
      }
      await onSave(configToSave);
    } catch (error) {
      console.error('Error saving weeding pricing config:', error);
    } finally {
      setIsSaving(false);
    }
  };

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

  const renderPercentageInput = (id: string, valueNum: number, onValueChange: (num: number) => void) => {
    const hasError = validationErrors.includes(id);
    return (
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-gray-400 text-sm font-medium">+</span>
        <input
          type="number"
          min="0"
          step="1"
          className={`w-20 h-10 px-3 border rounded-lg text-right text-base sm:text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all ${hasError ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
          value={valueNum === 0 ? '' : valueNum}
          placeholder="0"
          onChange={(e) => {
            onValueChange(parseFloat(e.target.value) || 0);
            if (hasError) {
              setValidationErrors((prev) => prev.filter((x) => x !== id));
            }
          }}
        />
        <span className="text-gray-500 text-sm font-medium w-4">%</span>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Herbicide License Warning */}
      {isHerbicideEnabled && (!licenseStatus || licenseStatus === 'rejected') && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Licencia fitosanitaria requerida</p>
            <p className="text-xs text-amber-700 mt-1">
              Has activado la aplicación de herbicida. Recuerda que debes subir tu carnet de manipulador de productos fitosanitarios en la sección superior para poder ofrecer este servicio.
            </p>
          </div>
        </div>
      )}

      {/* Minimum Price & Base M2 */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
        <h4 className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <Leaf className="w-4 h-4 text-green-700" />
          Tarifas Base de Desbroce
        </h4>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-sm font-medium text-gray-700 mb-1">Precio mínimo del servicio</p>
            <p className="text-xs text-gray-500 mb-2">Importe mínimo a cobrar por desplazamiento y equipo.</p>
            {renderEuroInput('importe_minimo', config.importe_minimo, (v) => updateConfig({ importe_minimo: v }))}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700 mb-1">Precio desbroce (por m²)</p>
            <p className="text-xs text-gray-500 mb-2">Tarifa base para desbroce en condiciones normales.</p>
            {renderEuroInput('precio_desbroce_m2', config.precio_desbroce_m2, (v) => updateConfig({ precio_desbroce_m2: v }))}
          </div>
        </div>
      </div>

      {/* Herbicide Section */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h4 className="text-sm font-bold text-gray-900">Aplicación de Herbicida</h4>
            <p className="text-xs text-gray-500 mt-1">Tratamiento para evitar rebrotes tras el desbroce.</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input 
              type="checkbox" 
              className="sr-only peer"
              checked={isHerbicideEnabled}
              onChange={(e) => {
                setIsHerbicideEnabled(e.target.checked);
                if (!e.target.checked) {
                  updateConfig({ precio_herbicida_m2: 0 });
                }
              }}
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
          </label>
        </div>

        {isHerbicideEnabled && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-sm font-medium text-gray-700 mb-1">Precio herbicida (por m²)</p>
            <div className="w-full sm:w-1/2">
              {renderEuroInput('precio_herbicida_m2', config.precio_herbicida_m2 || 0, (v) => updateConfig({ precio_herbicida_m2: v }))}
            </div>
          </div>
        )}
      </div>

      {/* Surcharges Section */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h4 className="text-sm font-bold text-gray-900">Suplementos y Dificultad</h4>
        <p className="text-xs text-gray-500 mt-1 mb-4">Incrementos porcentuales aplicables al precio base del desbroce.</p>
        
        <div className="space-y-1 divide-y divide-gray-100">
          <div className="flex items-center justify-between py-3 gap-3">
            <div className="min-w-0">
              <span className="block text-sm font-medium text-gray-900">Dificultad Media</span>
              <span className="text-xs text-gray-500">Zonas con pendiente o maleza densa (aprox. &gt;30cm).</span>
            </div>
            {renderPercentageInput('dificultad_media', config.suplementos.dificultad_media, (v) => updateSuplemento('dificultad_media', v))}
          </div>

          <div className="flex items-center justify-between py-3 gap-3">
            <div className="min-w-0">
              <span className="block text-sm font-medium text-gray-900">Dificultad Alta</span>
              <span className="text-xs text-gray-500">Zonas de muy difícil acceso o maleza leñosa/zarzas.</span>
            </div>
            {renderPercentageInput('dificultad_alta', config.suplementos.dificultad_alta, (v) => updateSuplemento('dificultad_alta', v))}
          </div>

          <div className="flex items-center justify-between py-3 gap-3">
            <div className="min-w-0">
              <span className="block text-sm font-medium text-gray-900">Retirada de restos verdes</span>
              <span className="text-xs text-gray-500">Recogida y gestión de los restos del desbroce.</span>
            </div>
            {renderPercentageInput('retirada_restos', config.suplementos.retirada_restos, (v) => updateSuplemento('retirada_restos', v))}
          </div>
        </div>
      </div>

      {showGlobalError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold text-red-800">Faltan precios por configurar</h4>
            <p className="text-sm text-red-600 mt-1">Completa todos los importes requeridos (mínimo, desbroce, herbicida) antes de guardar.</p>
          </div>
        </div>
      )}

      <div className="sticky bottom-3">
        <button
          type="button"
          onClick={() => handleSave()}
          disabled={!isDirty || isSaving}
          className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 ${!isDirty || isSaving ? 'bg-gray-200 text-gray-500' : 'bg-green-600 text-white hover:bg-green-700'}`}
        >
          <Save className="w-4 h-4" />
          {isSaving ? 'GUARDANDO...' : 'GUARDAR TARIFAS'}
        </button>
      </div>
    </div>
  );
};

export default WeedingPricingConfigurator;
