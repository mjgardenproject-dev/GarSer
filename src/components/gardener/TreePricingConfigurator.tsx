import React, { useState, useMemo } from 'react';
import { Info, Calculator, TreePine, TrendingUp } from 'lucide-react';

export interface TreePricingConfig {
  structuralHourlyRate: number;
  shapingHourlyRate: number;
  ladderModifier: number;
  climbingModifier: number;
  wasteRemovalModifier: number;
}

const DEFAULT_CONFIG: TreePricingConfig = {
  structuralHourlyRate: 40,
  shapingHourlyRate: 30,
  ladderModifier: 20,
  climbingModifier: 50,
  wasteRemovalModifier: 15
};

interface Props {
  value?: TreePricingConfig;
  onChange: (config: TreePricingConfig) => void;
  onSave?: (config: TreePricingConfig) => Promise<void>;
}

const TreePricingConfigurator: React.FC<Props> = ({ value, onChange, onSave }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [simType, setSimType] = useState<'structural' | 'shaping'>('structural');

  // Initialize config with defaults, handling potential legacy data structure
  const config: TreePricingConfig = useMemo(() => {
    if (!value) return DEFAULT_CONFIG;
    
    // Check if it's the new structure
    if ('structuralHourlyRate' in value && 'shapingHourlyRate' in value) {
      return { ...DEFAULT_CONFIG, ...value };
    }

    // Fallback for legacy data migration
    if ('hourlyRate' in value) {
        // @ts-ignore - legacy field
        const legacyRate = value.hourlyRate as number;
        return {
            ...DEFAULT_CONFIG,
            ...value,
            structuralHourlyRate: legacyRate,
            shapingHourlyRate: 30 // Default for new field
        };
    }

    return DEFAULT_CONFIG;
  }, [value]);

  const handleChange = (field: keyof TreePricingConfig, val: number) => {
    const newConfig: TreePricingConfig = {
      ...config,
      [field]: val
    };
    onChange(newConfig);
  };

  const handleSave = async () => {
    if (onSave) {
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

  // --- Simulator Logic ---
  const simHours = 3;
  const currentRate = simType === 'structural' ? config.structuralHourlyRate : config.shapingHourlyRate;
  const baseTotal = simHours * currentRate;
  const ladderExtra = baseTotal * (config.ladderModifier / 100);
  const wasteExtra = baseTotal * (config.wasteRemovalModifier / 100);
  const grandTotal = baseTotal + ladderExtra + wasteExtra;

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
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
                        value={config.structuralHourlyRate}
                        onChange={(e) => handleChange('structuralHourlyRate', parseFloat(e.target.value) || 0)}
                        className="w-full pl-4 pr-12 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-lg font-semibold text-gray-900"
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
                        value={config.shapingHourlyRate}
                        onChange={(e) => handleChange('shapingHourlyRate', parseFloat(e.target.value) || 0)}
                        className="w-full pl-4 pr-12 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-lg font-semibold text-gray-900"
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
                    value={config.ladderModifier}
                    onChange={(e) => handleChange('ladderModifier', parseFloat(e.target.value) || 0)}
                    className="w-full pl-3 pr-8 py-1.5 border border-gray-300 rounded-lg text-right focus:ring-2 focus:ring-green-500 focus:border-green-500"
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
                    value={config.climbingModifier}
                    onChange={(e) => handleChange('climbingModifier', parseFloat(e.target.value) || 0)}
                    className="w-full pl-3 pr-8 py-1.5 border border-gray-300 rounded-lg text-right focus:ring-2 focus:ring-green-500 focus:border-green-500"
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
                  value={config.wasteRemovalModifier}
                  onChange={(e) => handleChange('wasteRemovalModifier', parseFloat(e.target.value) || 0)}
                  className="w-full pl-4 pr-8 py-2 border border-gray-300 rounded-lg text-right focus:ring-2 focus:ring-green-500 focus:border-green-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">%</span>
              </div>
            </div>
          </section>

        </div>

        {/* Right Column: Simulator */}
        <div className="space-y-6">
          
          {/* Section D: Simulator Card */}
          <div className="sticky top-6">
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-100 p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4 text-blue-900">
                <Calculator className="w-5 h-5" />
                <h4 className="font-bold text-lg">Simulador: ¿Qué verá el cliente?</h4>
              </div>

              {/* Type Toggle */}
              <div className="flex gap-2 mb-4 bg-white/50 p-1 rounded-lg border border-blue-100">
                <button
                  onClick={() => setSimType('structural')}
                  className={`flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-all ${
                    simType === 'structural'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-blue-700 hover:bg-blue-50'
                  }`}
                >
                  Poda Estructural
                </button>
                <button
                  onClick={() => setSimType('shaping')}
                  className={`flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-all ${
                    simType === 'shaping'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-blue-700 hover:bg-blue-50'
                  }`}
                >
                  Poda Formación
                </button>
              </div>
              
              <div className="bg-white/60 rounded-lg p-4 mb-6 text-sm text-blue-800 leading-relaxed border border-blue-100">
                <p>
                  <strong>Ejemplo:</strong> El cliente sube la foto de un árbol de 6 metros para <strong>{simType === 'structural' ? 'poda estructural' : 'poda de formación'}</strong>.
                  La IA estima <strong>{simHours} horas</strong> de trabajo y detecta que se requiere <strong>uso de escalera</strong>. 
                  El cliente selecciona la opción de <strong>retirar los restos</strong>.
                </p>
              </div>

              {/* Math Breakdown */}
              <div className="space-y-3 mb-6 text-sm">
                <div className="flex justify-between items-center text-gray-600">
                  <span>Horas estimadas ({simHours}h) x Tarifa base ({currentRate.toFixed(2)}€)</span>
                  <span className="font-medium">{baseTotal.toFixed(2)}€</span>
                </div>
                
                <div className="flex justify-between items-center text-gray-600">
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                    Recargo por Escalera ({config.ladderModifier}%)
                  </span>
                  <span className="font-medium">+{ladderExtra.toFixed(2)}€</span>
                </div>

                <div className="flex justify-between items-center text-gray-600">
                  <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                    Retirada de restos ({config.wasteRemovalModifier}%)
                  </span>
                  <span className="font-medium">+{wasteExtra.toFixed(2)}€</span>
                </div>
              </div>

              <div className="border-t-2 border-blue-200 pt-4 mt-4">
                <div className="flex justify-between items-end">
                  <span className="text-blue-900 font-semibold mb-1">Total a cobrar</span>
                  <span className="text-3xl font-bold text-blue-700">{grandTotal.toFixed(2)}€</span>
                </div>
                <div className="flex items-center gap-1.5 mt-2 text-xs text-blue-600">
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>Este es el precio final que vería el cliente en la app.</span>
                </div>
              </div>
            </div>

            {/* Info Box */}
            <div className="mt-4 p-4 bg-gray-50 rounded-xl border border-gray-200 text-xs text-gray-500 flex gap-3">
              <Info className="w-5 h-5 shrink-0 text-gray-400" />
              <p>
                Recuerda que este simulador es solo una estimación. 
                Las horas reales pueden variar ligeramente según la densidad del árbol, 
                pero tu tarifa base siempre se respetará.
              </p>
            </div>
          </div>

        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end pt-6 border-t border-gray-200">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center px-8 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl shadow-md disabled:opacity-50 transition-all transform active:scale-[0.98] font-semibold text-base"
        >
          {isSaving ? (
            <>
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
              Guardando cambios...
            </>
          ) : (
            'Guardar Configuración'
          )}
        </button>
      </div>
    </div>
  );
};

export default TreePricingConfigurator;
