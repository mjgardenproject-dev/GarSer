import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { TreePine, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { deepEqual } from '../../utils/deepEqual';
import ServiceConfigFooter from './ServiceConfigFooter';

export interface TreePricingConfig {
  structuralHourlyRate: number | null;
  shapingHourlyRate: number | null;
  ladderModifier: number | null;
  climbingModifier: number | null;
  wasteRemovalModifier: number | null;
}

const DEFAULT_CONFIG: TreePricingConfig = {
  structuralHourlyRate: null,
  shapingHourlyRate: null,
  ladderModifier: null,
  climbingModifier: null,
  wasteRemovalModifier: null
};

interface Props {
  value?: TreePricingConfig;
  initialConfig?: TreePricingConfig;
  onChange: (config: TreePricingConfig) => void;
  onSave?: (config: TreePricingConfig) => Promise<void>;
}

const TreePricingConfigurator: React.FC<Props> = ({ value, initialConfig, onChange, onSave }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);

  // Helper to normalize config (handle legacy data)
  const normalizeConfig = (val?: TreePricingConfig): TreePricingConfig => {
    if (!val) return DEFAULT_CONFIG;
    
    // Check if it's the new structure (checking properties exist)
    if ('structuralHourlyRate' in val && 'shapingHourlyRate' in val) {
      return { ...DEFAULT_CONFIG, ...val };
    }

    // Fallback for legacy data migration
    if ('hourlyRate' in val) {
        // @ts-ignore - legacy field
        const legacyRate = (val as any).hourlyRate as number;
        return {
            ...DEFAULT_CONFIG,
            ...(val as any),
            structuralHourlyRate: legacyRate,
            shapingHourlyRate: 30 // Default for new field
        };
    }

    return DEFAULT_CONFIG;
  };

  // Initialize config with defaults
  const config: TreePricingConfig = useMemo(() => {
    return normalizeConfig(value);
  }, [value]);

  // Determine if dirty
  const isDirty = useMemo(() => {
    const processedBase = normalizeConfig(initialConfig);
    return !deepEqual(config, processedBase);
  }, [config, initialConfig]);

  const handleReset = () => {
    setShowResetModal(true);
  };

  const confirmReset = async () => {
    setShowResetModal(false);
    onChange(DEFAULT_CONFIG);
    
    if (onSave) {
      try {
        setIsSaving(true);
        await onSave(DEFAULT_CONFIG);
      } catch (error) {
        console.error('Error resetting tree config:', error);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const cancelReset = () => {
    setShowResetModal(false);
  };

  const handleChange = (field: keyof TreePricingConfig, val: string) => {
    // Permitir vacío
    if (val === '') {
        onChange({ ...config, [field]: null });
        return;
    }
    
    // Convertir a número
    const num = parseFloat(val);
    
    // Si es NaN (por ejemplo "-"), dejarlo como null o controlar input
    if (isNaN(num)) return;

    onChange({ ...config, [field]: num });
  };

  const handleSave = async () => {
    if (onSave) {
        // 1. Validar campos vacíos
        const requiredFields: (keyof TreePricingConfig)[] = [
            'structuralHourlyRate', 
            'shapingHourlyRate', 
            'ladderModifier', 
            'climbingModifier', 
            'wasteRemovalModifier'
        ];

        const missingFields = requiredFields.filter(field => config[field] === null || config[field] === undefined);
        
        if (missingFields.length > 0) {
            toast.error('Tienes campos de precio sin completar. Debes rellenar todos los valores antes de guardar.');
            return;
        }

        // 2. Validar valores 0 o negativos (Precios > 0, Modificadores >= 0)
        // Regla usuario: "El precio no puede ser 0. Introduce un valor válido mayor que 0."
        // Asumimos que esto aplica a las tarifas por hora.
        if ((config.structuralHourlyRate || 0) <= 0 || (config.shapingHourlyRate || 0) <= 0) {
             toast.error('El precio no puede ser 0. Introduce un valor válido mayor que 0.');
             return;
        }

        // Validar negativos en general
        const hasNegatives = requiredFields.some(field => (config[field] || 0) < 0);
        if (hasNegatives) {
            toast.error('No se permiten valores negativos.');
            return;
        }

      try {
        setIsSaving(true);
        await onSave(config);
      } catch (error) {
        console.error('Error saving tree config:', error);
      } finally {
        setIsSaving(false);
      }
    }
  };

  return (
    <div className="space-y-8 text-gray-800">
      
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-gray-200 pb-4">
        <div className="p-2 bg-green-100 rounded-lg">
          <TreePine className="w-6 h-6 text-green-700" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-gray-900">Configuración de Poda de Árboles</h3>
          <p className="text-sm text-gray-500">Define tu tarifa base y los suplementos por dificultad.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8">
        
        {/* Left Column: Inputs */}
        <div className="space-y-8">
          
          {/* Section A: Base Rates */}
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 bg-gray-50">
              <h4 className="font-semibold text-gray-900">A. Tarifas Base por Hora</h4>
              <p className="text-xs text-gray-500 mt-1">
                Define el precio por hora según el tipo de poda.
              </p>
            </div>
            
            <div className="divide-y divide-gray-100">
                {/* Structural Pruning */}
                <div className="p-5">
                    <div className="mb-2">
                        <label className="block text-sm font-bold text-gray-900">
                            Poda Estructural
                        </label>
                        <p className="text-xs text-gray-500 mt-1">
                            Para reducciones de copa, ramas gruesas o podas drásticas. Requiere motosierra.
                        </p>
                    </div>
                    <div className="relative max-w-xs mt-3">
                        <input
                        type="number"
                        min="0"
                        step="1"
                        value={config.structuralHourlyRate ?? ''}
                        onChange={(e) => handleChange('structuralHourlyRate', e.target.value)}
                        className="w-full pl-4 pr-12 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-lg font-semibold text-gray-900"
                        placeholder="-"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">€ / h</span>
                    </div>
                </div>

                {/* Shaping Pruning */}
                <div className="p-5">
                    <div className="mb-2">
                        <label className="block text-sm font-bold text-gray-900">
                            Poda de Formación (Shaping)
                        </label>
                        <p className="text-xs text-gray-500 mt-1">
                            Para mantenimiento estético, recortar puntas y dar forma geométrica. Herramientas manuales o cortasetos.
                        </p>
                    </div>
                    <div className="relative max-w-xs mt-3">
                        <input
                        type="number"
                        min="0"
                        step="1"
                        value={config.shapingHourlyRate ?? ''}
                        onChange={(e) => handleChange('shapingHourlyRate', e.target.value)}
                        className="w-full pl-4 pr-12 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-lg font-semibold text-gray-900"
                        placeholder="-"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">€ / h</span>
                    </div>
                </div>
            </div>
          </section>
          
          {/* Section B: Access Difficulty */}
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 bg-gray-50">
              <h4 className="font-semibold text-gray-900">B. Suplementos por Dificultad (Acceso)</h4>
              <p className="text-xs text-gray-500 mt-1">
                Incremento porcentual según la altura y equipo necesario.
              </p>
            </div>
            <div className="divide-y divide-gray-100">
              {/* Row 1 */}
              <div className="p-4 flex items-center justify-between">
                <div>
                  <span className="block text-sm font-medium text-gray-900">Poda desde el suelo</span>
                  <span className="text-xs text-gray-500">Altura &lt; 4m</span>
                </div>
                <div className="text-sm font-medium text-green-600 bg-green-50 px-3 py-1 rounded-full">
                  Incluido (0%)
                </div>
              </div>

              {/* Row 2 */}
              <div className="p-4 flex items-center justify-between">
                <div>
                  <span className="block text-sm font-medium text-gray-900">Uso de escalera</span>
                  <span className="text-xs text-gray-500">Altura 4m - 8m</span>
                </div>
                <div className="relative w-24">
                  <input
                    type="number"
                    min="0"
                    value={config.ladderModifier ?? ''}
                    onChange={(e) => handleChange('ladderModifier', e.target.value)}
                    className="w-full pl-3 pr-8 py-1.5 border border-gray-300 rounded-lg text-right focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    placeholder="-"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">%</span>
                </div>
              </div>

              {/* Row 3 */}
              <div className="p-4 flex items-center justify-between">
                <div>
                  <span className="block text-sm font-medium text-gray-900">Poda en altura / Trepa</span>
                  <span className="text-xs text-gray-500">Altura &gt; 8m</span>
                </div>
                <div className="relative w-24">
                  <input
                    type="number"
                    min="0"
                    value={config.climbingModifier ?? ''}
                    onChange={(e) => handleChange('climbingModifier', e.target.value)}
                    className="w-full pl-3 pr-8 py-1.5 border border-gray-300 rounded-lg text-right focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    placeholder="-"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">%</span>
                </div>
              </div>
            </div>
          </section>

          {/* Section C: Waste Removal */}
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 bg-gray-50">
              <h4 className="font-semibold text-gray-900">C. Gestión de Residuos</h4>
              <p className="text-xs text-gray-500 mt-1">
                Recargo si el cliente solicita la retirada de restos.
              </p>
            </div>
            <div className="p-5 flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">
                Recargo por retirada
              </label>
              <div className="relative w-32">
                <input
                  type="number"
                  min="0"
                  value={config.wasteRemovalModifier ?? ''}
                  onChange={(e) => handleChange('wasteRemovalModifier', e.target.value)}
                  className="w-full pl-4 pr-8 py-2 border border-gray-300 rounded-lg text-right focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  placeholder="-"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">%</span>
              </div>
            </div>
          </section>

        </div>
      </div>

      {/* Save Button */}
      <div className="pt-6 border-t border-gray-200 sticky bottom-0 bg-white z-10 pb-4">
        <ServiceConfigFooter 
            onSave={handleSave} 
            onReset={handleReset} 
            isDirty={isDirty} 
            isSaving={isSaving} 
        />
      </div>

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
                Se eliminarán todas las tarifas configuradas para la poda de árboles. Esta acción es irreversible.
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

export default TreePricingConfigurator;
