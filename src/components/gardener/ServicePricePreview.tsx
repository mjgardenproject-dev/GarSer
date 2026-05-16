import React, { useState, useMemo } from 'react';
import { Calculator, Clock, Euro, AlertCircle, TrendingUp } from 'lucide-react';
import { 
  calculateLawnPrice, 
  calculatePalmPriceEngine, 
  findPalmPrice, 
  calculatePriceFromYield,
  getConditionMultiplier,
  getWasteMultiplier,
  applyMinimumPrice
} from '../../domain/pricingEngine';
import { UnifiedNumericInput } from './UnifiedNumericInput';

interface ServicePricePreviewProps {
  serviceName: string;
  config: any;
}

const ServicePricePreview: React.FC<ServicePricePreviewProps> = ({ serviceName, config }) => {
  // Common states
  const [wasteRemoval, setWasteRemoval] = useState(true);

  // Service specific states
  const [quantity, setQuantity] = useState<number>(10);
  const [state, setState] = useState<'normal' | 'descuidado' | 'muy_descuidado'>('normal');
  
  // Hedge specific
  const [hedgeHeight, setHedgeHeight] = useState<'0-2m' | '2-4m' | '4-6m'>('0-2m');
  
  // Palm specific
  const [palmSpecies, setPalmSpecies] = useState<string>('');
  const [palmHeight, setPalmHeight] = useState<string>('5-12');
  const [palmExtras, setPalmExtras] = useState({
    phytosanitary: false,
    trunkPeeling: false,
    accessDifficulty: false
  });

  // Tree Pruning specific
  const [treeType, setTreeType] = useState<'formacion' | 'estructural'>('formacion');
  const [treeSize, setTreeSize] = useState<'small' | 'medium' | 'large'>('small');

  // Shrub specific
  const [shrubSize, setShrubSize] = useState<'pequeñas' | 'medianas' | 'grandes'>('medianas');

  // Phytosanitary specific
  const [phytosanitaryType, setPhytosanitaryType] = useState<string>('');

  const calculation = useMemo(() => {
    if (!config) return { price: 0, time: 0, breakdown: [] };

    let price = 0;
    let time = 0;
    const breakdown: string[] = [];

    switch (serviceName) {
      case 'Corte de césped': {
        const pricingMethod = config.pricing_method || 'per_quantity';
        let baseRate = 0;
        
        if (pricingMethod === 'per_hour') {
          if (config.yield_m2_per_hour > 0 && config.hourly_rate > 0) {
            baseRate = config.hourly_rate / config.yield_m2_per_hour;
          }
        } else {
          baseRate = config.price_per_m2 || 0;
        }

        const stateMult = getConditionMultiplier(state.replace('_', ' '));
        const wasteMult = getWasteMultiplier(wasteRemoval, config.waste_removal?.percentage || 0);
        
        price = baseRate * quantity * stateMult * wasteMult;
        price = applyMinimumPrice(price, config.minimum_price || 0);
        
        if (config.yield_m2_per_hour > 0) {
          time = (quantity / config.yield_m2_per_hour) * stateMult;
        }
        break;
      }

      case 'Corte de setos a máquina': {
        const pricingMethod = config.pricing_method || 'per_quantity';
        let baseRate = 0;
        
        if (pricingMethod === 'per_hour') {
          const yieldVal = config.yield_ml_per_hour?.[hedgeHeight] || 0;
          if (yieldVal > 0 && config.hourly_rate > 0) {
            baseRate = config.hourly_rate / yieldVal;
          }
        } else {
          baseRate = config.pricing_matrix?.[hedgeHeight] || 0;
        }

        const surcharges = config.condition_surcharges || {};
        let statePercent = 0;
        if (state === 'muy_descuidado') statePercent = surcharges.alta || surcharges.muy_descuidado || 0;
        else if (state === 'descuidado') statePercent = surcharges.media || surcharges.descuidado || 0;
        
        const stateMult = 1 + (statePercent / 100);
        const wasteMult = getWasteMultiplier(wasteRemoval, config.waste_removal?.percentage || 0);
        
        price = baseRate * quantity * stateMult * wasteMult;
        price = applyMinimumPrice(price, config.minimum_price || 0);

        const yieldVal = config.yield_ml_per_hour?.[hedgeHeight] || 0;
        if (yieldVal > 0) {
          time = (quantity / yieldVal) * stateMult;
        }
        break;
      }

      case 'Poda de palmeras': {
        const groups = [{
          species: palmSpecies || Object.keys(config.height_prices || {})[0] || '',
          height: palmHeight,
          quantity: quantity,
          state: state,
          hasPhytosanitary: palmExtras.phytosanitary,
          hasTrunkPeeling: palmExtras.trunkPeeling,
          hasAccessDifficulty: palmExtras.accessDifficulty
        }];

        price = calculatePalmPriceEngine(groups, config, wasteRemoval);
        
        // Time estimation for palms
        const species = palmSpecies || Object.keys(config.yield_units_per_hour || {})[0] || '';
        const yieldVal = config.yield_units_per_hour?.[species]?.[palmHeight] || 0;
        if (yieldVal > 0) {
          time = (quantity / yieldVal);
          // Add state multiplier for time
          time *= getConditionMultiplier(state.replace('_', ' '));
        }
        break;
      }

      case 'Poda de árboles': {
        const basePrice = config[treeType]?.[treeSize] || 0;
        const difficultyMult = 1 + (treeSize !== 'small' ? (config.difficultyIncrease || 0) / 100 : 0);
        const wasteMult = 1 + (wasteRemoval ? (config.wasteRemovalMultiplier || 0) / 100 : 0);
        
        price = basePrice * quantity * difficultyMult * wasteMult;
        price = applyMinimumPrice(price, config.minimumPrice || 0);

        const yieldVal = config.yield_units_per_hour?.[treeType]?.[treeSize] || 0;
        if (yieldVal > 0) {
          time = (quantity / yieldVal);
        }
        break;
      }

      case 'Poda de plantas y arbustos': {
        const basePrice = config.prices_per_m2?.[shrubSize] || 0;
        const wasteMult = getWasteMultiplier(wasteRemoval, config.waste_removal?.percentage || 0);
        
        price = basePrice * quantity * wasteMult;
        price = applyMinimumPrice(price, config.minimum_price || 0);

        const yieldVal = config.yield_m2_per_hour?.[shrubSize] || 0;
        if (yieldVal > 0) {
          time = (quantity / yieldVal);
        }
        break;
      }

      case 'Servicios fitosanitarios': {
        const range = quantity <= 50 ? '0-50' : (quantity <= 200 ? '50-200' : '200+');
        const type = phytosanitaryType || Object.keys(config.type_prices || {})[0] || '';
        const baseRate = config.type_prices?.[type]?.[range] || 0;
        
        const subtotal = range === '0-50' ? baseRate : baseRate * quantity;
        const wasteMult = getWasteMultiplier(wasteRemoval, config.waste_removal?.percentage || 0);
        
        price = subtotal * wasteMult;
        price = applyMinimumPrice(price, config.minimum_price || config.importe_minimo || 0);

        // Time estimation for phytosanitary
        // Using generic yields if available
        const yields = config.yields || {};
        const yieldVal = yields.cesped_m2_per_hour || 100; // fallback
        time = quantity / yieldVal;
        break;
      }

      case 'Desbroce de malas hierbas': {
        const baseRate = config.precio_desbroce_m2 || 0;
        const surcharges = config.suplementos || {};
        let diffPercent = 0;
        if (state === 'muy_descuidado') diffPercent = surcharges.dificultad_alta || 0;
        else if (state === 'descuidado') diffPercent = surcharges.dificultad_media || 0;
        
        const stateMult = 1 + (diffPercent / 100);
        const wasteMult = 1 + (wasteRemoval ? (surcharges.retirada_restos || 0) / 100 : 0);
        
        price = baseRate * quantity * stateMult * wasteMult;
        price = applyMinimumPrice(price, config.importe_minimo || 0);

        const yieldVal = config.yield_m2_per_hour || 100;
        time = (quantity / yieldVal) * stateMult;
        break;
      }
    }

    return { 
      price: Math.round(price * 100) / 100, 
      time: Math.round(time * 10) / 10,
      breakdown 
    };
  }, [serviceName, config, quantity, state, wasteRemoval, hedgeHeight, palmSpecies, palmHeight, palmExtras, treeType, treeSize, shrubSize, phytosanitaryType]);

  const renderInputs = () => {
    switch (serviceName) {
      case 'Corte de césped':
      case 'Desbroce de malas hierbas':
        return (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Superficie (m²)</label>
              <UnifiedNumericInput value={quantity} onChange={setQuantity} suffix="m²" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Estado</label>
              <select 
                value={state} 
                onChange={(e) => setState(e.target.value as any)}
                className="w-full h-10 px-3 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="normal">Normal</option>
                <option value="descuidado">Descuidado</option>
                <option value="muy_descuidado">Muy descuidado</option>
              </select>
            </div>
          </div>
        );

      case 'Corte de setos a máquina':
        return (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Longitud (ml)</label>
              <UnifiedNumericInput value={quantity} onChange={setQuantity} suffix="ml" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Altura</label>
              <select 
                value={hedgeHeight} 
                onChange={(e) => setHedgeHeight(e.target.value as any)}
                className="w-full h-10 px-3 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="0-2m">0-2m</option>
                <option value="2-4m">2-4m</option>
                <option value="4-6m" disabled={!config?.specialist_enabled}>4-6m</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Estado</label>
              <select 
                value={state} 
                onChange={(e) => setState(e.target.value as any)}
                className="w-full h-10 px-3 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="normal">Normal</option>
                <option value="descuidado">Descuidado</option>
                <option value="muy_descuidado">Muy descuidado</option>
              </select>
            </div>
          </div>
        );

      case 'Poda de palmeras':
        const palmSpeciesOptions = Object.keys(config?.height_prices || {});
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Especie</label>
                <select 
                  value={palmSpecies} 
                  onChange={(e) => setPalmSpecies(e.target.value)}
                  className="w-full h-10 px-3 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">Seleccionar...</option>
                  {palmSpeciesOptions.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Unidades</label>
                  <UnifiedNumericInput value={quantity} onChange={setQuantity} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Altura (m)</label>
                  <input 
                    type="text" 
                    value={palmHeight} 
                    onChange={(e) => setPalmHeight(e.target.value)}
                    className="w-full h-10 px-3 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="ej. 5-12"
                  />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={palmExtras.phytosanitary} onChange={e => setPalmExtras(prev => ({ ...prev, phytosanitary: e.target.checked }))} className="rounded text-blue-600" />
                <span className="text-xs text-gray-600">Fitosanitario</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={palmExtras.trunkPeeling} onChange={e => setPalmExtras(prev => ({ ...prev, trunkPeeling: e.target.checked }))} className="rounded text-blue-600" />
                <span className="text-xs text-gray-600">Cepillado</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={palmExtras.accessDifficulty} onChange={e => setPalmExtras(prev => ({ ...prev, accessDifficulty: e.target.checked }))} className="rounded text-blue-600" />
                <span className="text-xs text-gray-600">Difícil Acceso</span>
              </label>
            </div>
          </div>
        );

      case 'Poda de árboles':
        return (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
             <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Unidades</label>
              <UnifiedNumericInput value={quantity} onChange={setQuantity} />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Tipo de Poda</label>
              <select 
                value={treeType} 
                onChange={(e) => setTreeType(e.target.value as any)}
                className="w-full h-10 px-3 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="formacion">Formación</option>
                <option value="estructural">Estructural</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Tamaño</label>
              <select 
                value={treeSize} 
                onChange={(e) => setTreeSize(e.target.value as any)}
                className="w-full h-10 px-3 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="small">Pequeño (0-3m)</option>
                <option value="medium">Mediano (3-5m)</option>
                <option value="large" disabled={config.estructural?.large === undefined}>Grande (5-9m)</option>
              </select>
            </div>
          </div>
        );

      case 'Poda de plantas y arbustos':
        return (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Superficie (m²)</label>
              <UnifiedNumericInput value={quantity} onChange={setQuantity} suffix="m²" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Tamaño dominante</label>
              <select 
                value={shrubSize} 
                onChange={(e) => setShrubSize(e.target.value as any)}
                className="w-full h-10 px-3 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="pequeñas">Pequeñas (0-1m)</option>
                <option value="medianas">Medianas (1-2m)</option>
                <option value="grandes">Grandes (2-3m)</option>
              </select>
            </div>
          </div>
        );

      case 'Servicios fitosanitarios':
        const fumiOptions = Object.keys(config?.type_prices || {});
        return (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Tipo de tratamiento</label>
              <select 
                value={phytosanitaryType} 
                onChange={(e) => setPhytosanitaryType(e.target.value)}
                className="w-full h-10 px-3 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="">Seleccionar...</option>
                {fumiOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Superficie (m²)</label>
              <UnifiedNumericInput value={quantity} onChange={setQuantity} suffix="m²" />
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="mt-12 bg-blue-50/50 border border-blue-100 rounded-2xl overflow-hidden">
      <div className="bg-blue-600 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-white">
          <Calculator className="w-5 h-5" />
          <h3 className="font-bold text-sm uppercase tracking-wider">Vista previa en tiempo real</h3>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer group">
            <input 
              type="checkbox" 
              checked={wasteRemoval} 
              onChange={e => setWasteRemoval(e.target.checked)}
              className="w-4 h-4 rounded border-white/30 bg-white/10 text-blue-500 focus:ring-0 focus:ring-offset-0" 
            />
            <span className="text-xs font-medium text-white/90 group-hover:text-white transition-colors">Retirada de restos</span>
          </label>
        </div>
      </div>

      <div className="p-6">
        <div className="mb-8">
          <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Caso de prueba</h4>
          {renderInputs()}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Price Card */}
          <div className="bg-white p-5 rounded-xl border border-blue-100 shadow-sm">
            <div className="flex items-center gap-2 text-blue-600 mb-2">
              <Euro className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Precio estimado</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-black text-gray-900">{calculation.price}</span>
              <span className="text-lg font-bold text-gray-400">€</span>
            </div>
            <p className="text-[10px] text-gray-500 mt-2 italic">IVA incluido • Sujeto a cambios según análisis IA final</p>
          </div>

          {/* Time Card */}
          <div className="bg-white p-5 rounded-xl border border-blue-100 shadow-sm">
            <div className="flex items-center gap-2 text-blue-600 mb-2">
              <Clock className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Duración estimada</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-black text-gray-900">{calculation.time}</span>
              <span className="text-lg font-bold text-gray-400">h</span>
            </div>
            <p className="text-[10px] text-gray-500 mt-2 italic">Basado en tu rendimiento configurado arriba</p>
          </div>
        </div>

        {calculation.price <= 0 && (
          <div className="mt-4 flex items-start gap-2 p-3 bg-amber-50 border border-amber-100 rounded-lg">
            <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-700">
              Parece que falta alguna configuración clave para calcular el precio. Revisa tus tarifas y rendimientos.
            </p>
          </div>
        )}
        
        <div className="mt-6 flex items-center gap-2 text-[10px] text-blue-500 bg-blue-100/50 px-3 py-2 rounded-full w-fit">
          <TrendingUp className="w-3 h-3" />
          <span>Cambia los valores de arriba para ver cómo afectan al presupuesto final</span>
        </div>
      </div>
    </div>
  );
};

export default ServicePricePreview;
