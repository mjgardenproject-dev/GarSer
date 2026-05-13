import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { TreePine, AlertTriangle, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { deepEqual } from '../../utils/deepEqual';
import { UnifiedNumericInput } from './UnifiedNumericInput';
import { useAutoSave } from '../../hooks/useAutoSave';

export interface TreePricingConfig {
  structuralHourlyRate: number | null;
  shapingHourlyRate: number | null;
  ladderModifier: number | null;
  climbingModifier: number | null;
  wasteRemovalModifier: number | null;
  minimum_price: number | null;
}

const DEFAULT_CONFIG: TreePricingConfig = {
  structuralHourlyRate: null,
  shapingHourlyRate: null,
  ladderModifier: null,
  climbingModifier: null,
  wasteRemovalModifier: null,
  minimum_price: null
};

interface Props {
  value?: TreePricingConfig;
  initialConfig?: TreePricingConfig;
  onChange: (config: TreePricingConfig) => void;
  onSave?: (config: TreePricingConfig) => Promise<void>;
}

const TreePricingConfigurator: React.FC<Props> = ({ value, initialConfig, onChange, onSave }) => {
  const [showGlobalInfo, setShowGlobalInfo] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Helper to normalize config (handle legacy data)
  const normalizeConfig = (val?: TreePricingConfig): TreePricingConfig => {
    if (!val) return DEFAULT_CONFIG;
    
    // Check if it's the new structure (checking properties exist)
    if ('structuralHourlyRate' in val && 'shapingHourlyRate' in val) {
      return { ...DEFAULT_CONFIG, ...val };
    }

    // Fallback for legacy data migration
    if ('hourlyRate' in val) {
        const legacyRate = Number((val as { hourlyRate?: number }).hourlyRate || 0);
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

  const validateConfig = useCallback((cfg: TreePricingConfig): string[] => {
    const errors: string[] = [];
    const requiredFields: (keyof TreePricingConfig)[] = [
        'structuralHourlyRate', 
        'shapingHourlyRate', 
        'ladderModifier', 
        'climbingModifier', 
        'wasteRemovalModifier',
        'minimum_price'
    ];

    const missingFields = requiredFields.filter(field => cfg[field] === null || cfg[field] === undefined);
    if (missingFields.length > 0) {
        errors.push('missing_fields');
    }

    if ((cfg.structuralHourlyRate || 0) <= 0 || (cfg.shapingHourlyRate || 0) <= 0) {
         errors.push('invalid_hourly_rate');
    }

    if ((cfg.minimum_price || 0) <= 0) {
         errors.push('invalid_minimum_price');
    }

    const hasNegatives = requiredFields.some(field => (cfg[field] || 0) < 0);
    if (hasNegatives) {
        errors.push('negative_values');
    }
    
    return errors;
  }, []);

  useEffect(() => {
    setValidationErrors(validateConfig(config));
  }, [config, validateConfig]);

  useAutoSave({
    value: config,
    initialValue: normalizeConfig(initialConfig),
    onSave: async (val) => {
      if (onSave) {
        await onSave(val);
      }
    },
    validate: validateConfig
  });

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

  return (
    <div className="space-y-8 text-gray-800">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 border-b border-gray-200 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-green-100 rounded-lg">
            <TreePine className="w-6 h-6 text-green-700" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-gray-900 flex items-center">
                Configuración de Poda de Árboles (IVA incluido)
            </h3>
            <p className="text-sm text-gray-500">Define tu tarifa base y los suplementos por dificultad.</p>
          </div>
        </div>
        <div className="relative self-end md:self-center">
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
                    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90vw] max-w-xs p-6 bg-white rounded-xl shadow-xl border border-gray-100 text-sm text-gray-600 md:absolute md:top-8 md:right-0 md:translate-x-0 md:translate-y-0 md:w-72 md:p-4 md:shadow-lg md:border-blue-100 md:rounded-lg">
                        <ul className="list-disc pl-4 space-y-2">
                            <li>El <strong>IVA está incluido</strong> en todos los precios.</li>
                            <li>El precio final se calcula multiplicando las horas estimadas por la IA por tu tarifa horaria, sumando los modificadores de acceso y retirada.</li>
                            <li>La IA estimará la duración en base al tamaño, especie y cantidad de árboles.</li>
                        </ul>
                    </div>
                </>
            )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8">
        
        {/* Left Column: Inputs */}
        <div className="space-y-8">

          <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 bg-gray-50">
              <h4 className="font-semibold text-gray-900">Precio mínimo</h4>
              <p className="text-xs text-gray-500 mt-1">
                Importe mínimo aplicado al final del cálculo.
              </p>
            </div>
            <div className="p-5">
              <div className="relative max-w-xs">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={config.minimum_price ?? ''}
                  onChange={(e) => handleChange('minimum_price', e.target.value)}
                  className="w-full pl-4 pr-10 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-lg font-semibold text-gray-900"
                  placeholder="-"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">€</span>
              </div>
            </div>
          </section>
          
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
                            Para ramas gruesas, reducción de copa, aclareo profundo o talas controladas.
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
    </div>
  );
};

export default TreePricingConfigurator;