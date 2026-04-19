import React, { useMemo, useState } from 'react';
import { Calculator } from 'lucide-react';
import { PhytosanitaryPricingConfig, Service } from '../../types';
import { calculatePalmPriceEngine, findPalmPrice, PalmPricingGroup } from '../../domain/pricingEngine';
import { PalmPricingConfig } from './PalmPricingConfigurator';
import { LawnPricingConfig } from './LawnPricingConfigurator';
import { HedgePricingConfig, HEDGE_HEIGHT_BANDS, HedgeHeightBand } from './HedgePricingConfigurator';
import { TreePricingConfig } from './TreePricingConfigurator';
import { ShrubPricingConfig } from './ShrubPricingConfigurator';
import { WeedingPricingConfig } from '../../utils/serviceValidation';

type SimulatorConfigs = {
  palmConfig?: PalmPricingConfig;
  lawnConfig?: LawnPricingConfig;
  hedgeConfig?: HedgePricingConfig;
  treeConfig?: TreePricingConfig;
  shrubConfig?: ShrubPricingConfig;
  phytosanitaryConfig?: PhytosanitaryPricingConfig;
  weedingConfig?: WeedingPricingConfig;
};

interface PriceSimulatorProps {
  services: Service[];
  configs: SimulatorConfigs;
}

type PalmGroup = {
  species: string;
  height: string;
  quantity: number;
  state: string;
  hasPhytosanitary?: boolean;
  hasTrunkPeeling?: boolean;
  lowestRangeThreshold?: string;
  needsPhytosanitary?: boolean;
  needsTrunkFinish?: boolean;
  hasAccessDifficulty?: boolean;
};
type LawnZone = { state: string; quantity: number };
type HedgeZone = { height: string; length: number; state: string };
type TreeGroup = { pruningType: 'structural' | 'shaping'; access: 'normal' | 'medio' | 'dificil'; estimatedHours: number; analysisLevel?: number; isFailed?: boolean };
type ShrubGroup = { size: string; area: number };
type AreaZone = { type: string; area: number };

const SERVICE_NAMES = [
  'Corte de césped',
  'Poda de plantas y arbustos',
  'Corte de setos a máquina',
  'Poda de árboles',
  'Servicios fitosanitarios',
  'Poda de palmeras'
] as const;

const PriceSimulator: React.FC<PriceSimulatorProps> = ({ services, configs }) => {
  const availableServices = useMemo(() => {
    const names = new Set(services.map((s) => s.name));
    return SERVICE_NAMES.filter((name) => names.has(name));
  }, [services]);

  const [selectedService, setSelectedService] = useState<string>(availableServices[0] || SERVICE_NAMES[0]);
  const [globalWasteRemoval, setGlobalWasteRemoval] = useState<boolean>(true);
  const [palmGroups, setPalmGroups] = useState<PalmGroup[]>([{ species: '', height: '0-5', quantity: 1, state: 'normal' }]);
  const [lawnZones, setLawnZones] = useState<LawnZone[]>([{ state: 'normal', quantity: 50 }]);
  const [hedgeZones, setHedgeZones] = useState<HedgeZone[]>([{ height: '0-2m', length: 10, state: 'normal' }]);
  const [treeGroups, setTreeGroups] = useState<TreeGroup[]>([{ pruningType: 'structural', access: 'normal', estimatedHours: 2 }]);
  const [shrubGroups, setShrubGroups] = useState<ShrubGroup[]>([{ size: 'medianas', area: 5 }]);
  const [phytosanitaryZones, setPhytosanitaryZones] = useState<AreaZone[]>([{ type: '', area: 50 }]);

  const selectedConfig = useMemo(() => {
    if (selectedService === 'Poda de palmeras') return configs.palmConfig;
    if (selectedService === 'Corte de césped') return configs.lawnConfig;
    if (selectedService === 'Corte de setos a máquina') return configs.hedgeConfig;
    if (selectedService === 'Poda de árboles') return configs.treeConfig;
    if (selectedService === 'Poda de plantas y arbustos') return configs.shrubConfig;
    if (selectedService === 'Servicios fitosanitarios') return configs.phytosanitaryConfig;
    return undefined;
  }, [selectedService, configs]);

  const getLawnPricePerM2 = (config: any) => {
    if (config?.price_per_m2 > 0) return config.price_per_m2;

    const parsed = {
      '0-50': Number(config?.surface_prices?.['0-50'] || 0),
      '51-150': Number(config?.surface_prices?.['51-150'] || 0),
      '151-400': Number(config?.surface_prices?.['151-400'] || 0),
      '400+': Number(config?.surface_prices?.['400+'] || 0)
    };
    const hasNew = Object.values(parsed).some(v => v > 0);
    if (hasNew) return parsed['0-50'] || parsed['51-150'] || parsed['151-400'] || parsed['400+'] || 0;

    const selectedSpecies = Array.isArray(config?.selected_species) ? config.selected_species : [];
    const legacySpeciesKey = selectedSpecies.find((s: string) => config?.species_prices?.[s]) || Object.keys(config?.species_prices || {})[0];
    const legacyPrices = legacySpeciesKey ? config?.species_prices?.[legacySpeciesKey] : null;
    if (!legacyPrices) return 0;

    return Number(legacyPrices['0-50'] || legacyPrices['50-200'] || legacyPrices['200+'] || 0);
  };

  const normalizeHedgeHeightBand = (height: string): HedgeHeightBand => {
    if (HEDGE_HEIGHT_BANDS.includes(height as HedgeHeightBand)) return height as HedgeHeightBand;
    const normalized = height.toLowerCase();
    if (normalized.includes('0-1') || normalized.includes('<1') || normalized.includes('1-2') || normalized.includes('hasta 2') || normalized.includes('suelo') || normalized.includes('0-2')) {
      return '0-2m';
    }
    if (normalized.includes('2-3') || normalized.includes('3-4.5') || normalized.includes('2-4') || normalized.includes('escalera')) {
      return '2-4m';
    }
    return '4-6m';
  };

  const getLegacyHedgeBase = (config: any, heightBand: HedgeHeightBand) => {
    if (config?.pricing_matrix) {
      const pm = config.pricing_matrix;
      const extractPrice = (entry: any) => {
        if (!entry) return 0;
        if (typeof entry === 'number') return entry;
        const standard = Number(entry['0-25m (Estándar)'] || 0);
        const volume = Number(entry['>25m (Gran Volumen)'] || 0);
        const candidates = [standard, volume].filter(v => v > 0);
        return candidates.length > 0 ? candidates.reduce((a, b) => a + b, 0) / candidates.length : 0;
      };

      let base = 0;
      if (heightBand === '0-2m') {
        const p0_1 = extractPrice(pm['0-1m']);
        const p1_2 = extractPrice(pm['1-2m']);
        const c0_2 = [p0_1, p1_2].filter(v => v > 0);
        if (c0_2.length > 0) base = c0_2.reduce((a, b) => a + b, 0) / c0_2.length;
      } else if (heightBand === '2-4m') {
        base = extractPrice(pm['2-4m']);
      } else if (heightBand === '4-6m') {
        base = extractPrice(pm['4-6m']);
      }
      if (base > 0) return base;
    }

    const legacyRangeOptions = ['0-10m', '11-25m', '26-50m', '>50m'];
    const legacyHeightOptions =
      heightBand === '0-2m'
        ? [
            { category: 'Setos Estándar (≤3m)', height: '0-1m' },
            { category: 'Setos Estándar (≤3m)', height: '>1-2m' }
          ]
        : heightBand === '2-4m'
        ? [
            { category: 'Setos Estándar (≤3m)', height: '>2-3m' },
            { category: 'Setos Gran Altura (>3m)', height: '3-4.5m' }
          ]
        : [
            { category: 'Setos Gran Altura (>3m)', height: '>4.5-6m' },
            { category: 'Setos Gran Altura (>3m)', height: '>6-7.5m' }
          ];
    const candidates: number[] = [];
    legacyHeightOptions.forEach(({ category, height }) => {
      legacyRangeOptions.forEach((legacyRange) => {
        const value = Number(config?.category_prices?.[category]?.[height]?.[legacyRange] || 0);
        if (value > 0) candidates.push(value);
      });
    });
    if (candidates.length === 0) return 0;
    return candidates.reduce((acc, v) => acc + v, 0) / candidates.length;
  };

  const result = useMemo(() => {
    const breakdown: string[] = [];
    const warnings: string[] = [];
    const config: any = selectedConfig;

    if (!config) {
      warnings.push('No hay configuración guardada para este servicio.');
      return { price: 0, breakdown, warnings };
    }

    const applyMinimumPrice = (calculatedPrice: number) => {
      const roundedCalculatedPrice = Math.ceil(calculatedPrice);
      const minimumPrice = Number(config?.minimum_price || 0);
      const minimumApplied = minimumPrice > 0 && calculatedPrice > 0 && calculatedPrice < minimumPrice;
      const finalPrice = minimumApplied ? Math.ceil(minimumPrice) : roundedCalculatedPrice;
      return { finalPrice, roundedCalculatedPrice, minimumPrice, minimumApplied };
    };

    if (selectedService === 'Poda de palmeras') {
      if (!config.species_prices) return { price: 0, breakdown, warnings: ['Configuración incompleta de palmeras.'] };
      
      const groups: PalmPricingGroup[] = palmGroups.map(g => ({
        species: g.species,
        height: g.height,
        quantity: g.quantity || 1,
        state: g.state || 'normal',
        hasPhytosanitary: g.hasPhytosanitary ?? g.needsPhytosanitary,
        hasTrunkPeeling: g.hasTrunkPeeling ?? g.needsTrunkFinish,
        lowestRangeThreshold: g.lowestRangeThreshold,
        needsPhytosanitary: g.needsPhytosanitary,
        needsTrunkFinish: g.needsTrunkFinish,
        hasAccessDifficulty: g.hasAccessDifficulty
      }));
      
      const total = calculatePalmPriceEngine(groups, config, globalWasteRemoval);
      
      for (const group of groups) {
        const basePrice = findPalmPrice(config, group.species, group.height);
        if (basePrice > 0) {
            breakdown.push(`${group.quantity}x ${group.species} (${group.height}) → precio simulado con base, estado, extras y cantidad = ${((total / groups.length) || 0).toFixed(2)}€ (aprox por grupo)`);
        }
      }
      
      const minimumResult = applyMinimumPrice(total);
      if (minimumResult.minimumApplied) {
        breakdown.push(`Tarifa mínima aplicada: cálculo normal ${minimumResult.roundedCalculatedPrice.toFixed(0)}€ < tarifa mínima configurada ${minimumResult.minimumPrice.toFixed(0)}€. Resultado final: ${minimumResult.finalPrice.toFixed(0)}€.`);
      }
      if (minimumResult.finalPrice <= 0) warnings.push('No hay coincidencia entre las variables introducidas y tu tarifa guardada.');
      return { price: minimumResult.finalPrice, breakdown, warnings };
    }

    if (selectedService === 'Corte de setos a máquina') {
      if (!config.pricing_matrix && !config.category_prices && !config.species_prices) return { price: 0, breakdown, warnings: ['Configuración incompleta de setos.'] };
      let total = 0;
      for (const zone of hedgeZones) {
        const heightBand = normalizeHedgeHeightBand(zone.height);
        if (!config.specialist_enabled && heightBand === '4-6m') {
          warnings.push('Altura 4-6m desactivada: esta zona no se incluye en el cálculo.');
          continue;
        }
        const matrixBase = Number(config.pricing_matrix?.[heightBand] || 0);
        const legacyBase = Number(getLegacyHedgeBase(config, heightBand) || 0);
        const base = matrixBase || legacyBase;
        if (base <= 0) continue;
        const surcharges = config.condition_surcharges || { media: 20, alta: 50 };
        const s = (zone.state || 'normal').toLowerCase();
        let statePercent = 0;
        if (s.includes('alta') || s.includes('muy_descuidado')) {
          statePercent = Number(surcharges.alta || surcharges.muy_descuidado || 0);
        } else if (s.includes('media') || s.includes('descuidado')) {
          statePercent = Number(surcharges.media || surcharges.descuidado || 0);
        }
        const stateMult = 1 + statePercent / 100;
        let wasteMult = 1;
        if (globalWasteRemoval) wasteMult = 1 + ((config.waste_removal?.percentage || 0) / 100);
        const lineTotal = base * (zone.length || 0) * stateMult * wasteMult;
        total += lineTotal;
        breakdown.push(`${heightBand} ${zone.length}m → base ${base.toFixed(2)}€ · estado ${statePercent}% · restos ${((wasteMult - 1) * 100).toFixed(0)}% = ${lineTotal.toFixed(2)}€`);
      }
      const minimumResult = applyMinimumPrice(total);
      if (minimumResult.minimumApplied) {
        breakdown.push(`Tarifa mínima aplicada: cálculo normal ${minimumResult.roundedCalculatedPrice.toFixed(0)}€ < tarifa mínima configurada ${minimumResult.minimumPrice.toFixed(0)}€. Resultado final: ${minimumResult.finalPrice.toFixed(0)}€.`);
      }
      if (minimumResult.finalPrice <= 0) warnings.push('No hay coincidencia entre las variables introducidas y tu tarifa guardada.');
      return { price: minimumResult.finalPrice, breakdown, warnings };
    }

    if (selectedService === 'Poda de árboles') {
      let total = 0;
      for (const group of treeGroups) {
        if (group.isFailed || group.analysisLevel === 3) continue;
        if (!group.estimatedHours || group.estimatedHours <= 0) continue;
        const hourlyRate = group.pruningType === 'shaping' ? config.shapingHourlyRate : config.structuralHourlyRate;
        if (!hourlyRate || hourlyRate <= 0) continue;
        let accessPercent = 0;
        const legacySurcharges = config.access_surcharges || {};
        if (group.access === 'medio') accessPercent = config.ladderModifier != null ? config.ladderModifier : (legacySurcharges.medio || 0);
        else if (group.access === 'dificil') accessPercent = config.climbingModifier != null ? config.climbingModifier : (legacySurcharges.dificil || 0);
        let wastePercent = 0;
        if (globalWasteRemoval) wastePercent = config.wasteRemovalModifier != null ? config.wasteRemovalModifier : (config.waste_removal?.percentage || 0);
        const totalMultiplier = 1 + accessPercent / 100 + wastePercent / 100;
        const lineTotal = group.estimatedHours * hourlyRate * totalMultiplier;
        total += lineTotal;
        breakdown.push(`${group.pruningType === 'shaping' ? 'Poda de forma' : 'Poda estructural'} ${group.estimatedHours}h · acceso ${group.access} → ${lineTotal.toFixed(2)}€`);
      }
      const minimumResult = applyMinimumPrice(total);
      if (minimumResult.minimumApplied) {
        breakdown.push(`Tarifa mínima aplicada: cálculo normal ${minimumResult.roundedCalculatedPrice.toFixed(0)}€ < tarifa mínima configurada ${minimumResult.minimumPrice.toFixed(0)}€. Resultado final: ${minimumResult.finalPrice.toFixed(0)}€.`);
      }
      if (minimumResult.finalPrice <= 0) warnings.push('No hay coincidencia entre las variables introducidas y tu tarifa guardada.');
      return { price: minimumResult.finalPrice, breakdown, warnings };
    }

    if (selectedService === 'Poda de plantas y arbustos') {
      if (!config.prices_per_m2) return { price: 0, breakdown, warnings: ['Configuración incompleta de poda de plantas.'] };
      let total = 0;
      for (const group of shrubGroups) {
        const base = config.prices_per_m2[group.size as 'pequeñas' | 'medianas' | 'grandes'] || 0;
        if (base <= 0 || !group.size) continue;
        
        let wasteMult = 1;
        if (globalWasteRemoval) wasteMult = 1 + ((config.waste_removal?.percentage || 0) / 100);
        
        const lineTotal = base * group.area * wasteMult;
        total += lineTotal;
        breakdown.push(`Macizo de plantas (${group.size}) ${group.area}m² → base ${base.toFixed(2)}€/m² · restos ${((wasteMult - 1) * 100).toFixed(0)}% = ${lineTotal.toFixed(2)}€`);
      }
      const minimumResult = applyMinimumPrice(total);
      if (minimumResult.minimumApplied) {
        breakdown.push(`Tarifa mínima aplicada: cálculo normal ${minimumResult.roundedCalculatedPrice.toFixed(0)}€ < tarifa mínima configurada ${minimumResult.minimumPrice.toFixed(0)}€. Resultado final: ${minimumResult.finalPrice.toFixed(0)}€.`);
      }
      if (minimumResult.finalPrice <= 0) warnings.push('No hay coincidencia entre las variables introducidas y tu tarifa guardada.');
      return { price: minimumResult.finalPrice, breakdown, warnings };
    }

    if (selectedService === 'Servicios fitosanitarios') {
      if (!config.type_prices) return { price: 0, breakdown, warnings: ['Configuración incompleta de servicios fitosanitarios.'] };
      const totalArea = phytosanitaryZones.reduce((acc, z) => acc + (z.area || 0), 0);
      let range = '0-50';
      if (totalArea > 200) range = '200+';
      else if (totalArea > 50) range = '50-200';
      let total = 0;
      for (const zone of phytosanitaryZones) {
        const baseRate = config.type_prices[zone.type]?.[range] || 0;
        if (baseRate <= 0 || !zone.type) continue;
        const subtotal = range === '0-50' ? baseRate : baseRate * zone.area;
        let wasteMult = 1;
        if (globalWasteRemoval) wasteMult = 1 + ((config.waste_removal?.percentage || 0) / 100);
        const lineTotal = subtotal * wasteMult;
        total += lineTotal;
        breakdown.push(`${zone.type} ${zone.area}m² · rango ${range} → ${lineTotal.toFixed(2)}€`);
      }
      const minimumResult = applyMinimumPrice(total);
      if (minimumResult.minimumApplied) {
        breakdown.push(`Tarifa mínima aplicada: cálculo normal ${minimumResult.roundedCalculatedPrice.toFixed(0)}€ < tarifa mínima configurada ${minimumResult.minimumPrice.toFixed(0)}€. Resultado final: ${minimumResult.finalPrice.toFixed(0)}€.`);
      }
      if (minimumResult.finalPrice <= 0) warnings.push('No hay coincidencia entre las variables introducidas y tu tarifa guardada.');
      return { price: minimumResult.finalPrice, breakdown, warnings };
    }

    if (selectedService === 'Corte de césped') {
      const zones = lawnZones.map((z) => ({ state: z.state, quantity: z.quantity }));
      const totalArea = zones.reduce((acc, z) => acc + (z.quantity || 0), 0);
      const baseRate = getLawnPricePerM2(config);
      if (baseRate <= 0) return { price: 0, breakdown, warnings: ['Configuración incompleta de césped.'] };
      let totalCost = 0;
      for (const zone of zones) {
        const subtotal = baseRate * zone.quantity;
        if (subtotal <= 0) continue;
        const surcharges = config.condition_surcharges || {};
        let stateSurchargePercent = 0;
        const s = (zone.state || 'normal').toLowerCase();
        if (s.includes('muy') && s.includes('descuidad')) stateSurchargePercent = surcharges.muy_descuidado || 0;
        else if (s.includes('descuidad') && !s.includes('muy')) stateSurchargePercent = surcharges.descuidado || 0;
        const stateMult = 1 + stateSurchargePercent / 100;
        let wasteMult = 1;
        if (globalWasteRemoval) wasteMult = 1 + ((config.waste_removal?.percentage || 0) / 100);
        const lineTotal = subtotal * stateMult * wasteMult;
        totalCost += lineTotal;
        breakdown.push(`Césped general ${zone.quantity}m² · base ${baseRate.toFixed(2)}€/m² · estado ${stateSurchargePercent}% = ${lineTotal.toFixed(2)}€`);
      }
      const minimumResult = applyMinimumPrice(totalCost);
      if (minimumResult.minimumApplied) {
        breakdown.push(`Tarifa mínima aplicada: cálculo normal ${minimumResult.roundedCalculatedPrice.toFixed(0)}€ < tarifa mínima configurada ${minimumResult.minimumPrice.toFixed(0)}€. Resultado final: ${minimumResult.finalPrice.toFixed(0)}€.`);
      }
      if (minimumResult.finalPrice <= 0) warnings.push('No hay coincidencia entre las variables introducidas y tu tarifa guardada.');
      return { price: minimumResult.finalPrice, breakdown, warnings };
    }

    return { price: 0, breakdown, warnings };
  }, [selectedConfig, selectedService, palmGroups, lawnZones, hedgeZones, treeGroups, shrubGroups, phytosanitaryZones, globalWasteRemoval]);

  const hedgeHeightOptions = useMemo(() => HEDGE_HEIGHT_BANDS, []);
  const shrubTypeOptions = useMemo(() => Object.keys((configs.shrubConfig as any)?.species_prices || {}), [configs.shrubConfig]);
  const phytosanitaryTypeOptions = useMemo(() => Object.keys((configs.phytosanitaryConfig as any)?.type_prices || {}), [configs.phytosanitaryConfig]);
  const palmSpeciesOptions = useMemo(() => Object.keys((configs.palmConfig as any)?.height_prices || {}), [configs.palmConfig]);

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-4">
        <Calculator className="w-5 h-5 text-amber-700" />
        <h3 className="text-lg font-bold text-amber-900">Simulador de Precios</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-800 mb-1">Servicio</label>
          <select value={selectedService} onChange={(e) => setSelectedService(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg bg-white">
            {availableServices.map((serviceName) => (
              <option key={serviceName} value={serviceName}>{serviceName}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-800 mb-1">Retirada de restos</label>
          <select value={globalWasteRemoval ? 'si' : 'no'} onChange={(e) => setGlobalWasteRemoval(e.target.value === 'si')} className="w-full p-2.5 border border-gray-300 rounded-lg bg-white">
            <option value="si">Sí</option>
            <option value="no">No</option>
          </select>
        </div>
      </div>

      {selectedService === 'Corte de césped' && (
        <div className="space-y-3">
          {lawnZones.map((zone, idx) => (
            <div key={`lawn-${idx}`} className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <select value={zone.state} onChange={(e) => setLawnZones((prev) => prev.map((z, i) => i === idx ? { ...z, state: e.target.value } : z))} className="p-2 border border-gray-300 rounded-lg bg-white">
                <option value="normal">Normal</option>
                <option value="descuidado">Descuidado</option>
                <option value="muy descuidado">Muy descuidado</option>
              </select>
              <div className="relative">
                <input type="number" min={0} value={zone.quantity} onChange={(e) => setLawnZones((prev) => prev.map((z, i) => i === idx ? { ...z, quantity: Number(e.target.value) || 0 } : z))} className="w-full p-2 pr-12 border border-gray-300 rounded-lg bg-white" placeholder="Superficie" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">m²</span>
              </div>
              <button type="button" onClick={() => setLawnZones((prev) => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))} className="px-3 py-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-50">Eliminar</button>
            </div>
          ))}
          <button type="button" onClick={() => setLawnZones((prev) => [...prev, { state: 'normal', quantity: 50 }])} className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50">+ Añadir zona</button>
        </div>
      )}

      {selectedService === 'Poda de palmeras' && (
        <div className="space-y-3">
          {palmGroups.map((group, idx) => (
            <div key={`palm-${idx}`} className="grid grid-cols-1 md:grid-cols-5 gap-2">
              <select value={group.species} onChange={(e) => setPalmGroups((prev) => prev.map((g, i) => i === idx ? { ...g, species: e.target.value } : g))} className="p-2 border border-gray-300 rounded-lg bg-white">
                <option value="">Especie</option>
                {palmSpeciesOptions.map((sp) => <option key={sp} value={sp}>{sp}</option>)}
              </select>
              <div className="relative">
                <input value={group.height} onChange={(e) => setPalmGroups((prev) => prev.map((g, i) => i === idx ? { ...g, height: e.target.value } : g))} className="w-full p-2 pr-10 border border-gray-300 rounded-lg bg-white" placeholder="Altura (ej. 5-12)" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">m</span>
              </div>
              <div className="relative">
                <input type="number" min={1} value={group.quantity} onChange={(e) => setPalmGroups((prev) => prev.map((g, i) => i === idx ? { ...g, quantity: Number(e.target.value) || 1 } : g))} className="w-full p-2 pr-14 border border-gray-300 rounded-lg bg-white" placeholder="Cantidad" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">uds</span>
              </div>
              <select value={group.state} onChange={(e) => setPalmGroups((prev) => prev.map((g, i) => i === idx ? { ...g, state: e.target.value } : g))} className="p-2 border border-gray-300 rounded-lg bg-white">
                <option value="normal">Normal</option>
                <option value="descuidado">Descuidado</option>
                <option value="muy_descuidado">Muy descuidado</option>
              </select>
              <button type="button" onClick={() => setPalmGroups((prev) => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))} className="px-3 py-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-50">Eliminar</button>
            </div>
          ))}
          <button type="button" onClick={() => setPalmGroups((prev) => [...prev, { species: '', height: '0-5', quantity: 1, state: 'normal' }])} className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50">+ Añadir grupo</button>
        </div>
      )}

      {selectedService === 'Corte de setos a máquina' && (
        <div className="space-y-3">
          {hedgeZones.map((zone, idx) => (
            <div key={`hedge-${idx}`} className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <select value={zone.height} onChange={(e) => setHedgeZones((prev) => prev.map((z, i) => i === idx ? { ...z, height: e.target.value } : z))} className="p-2 border border-gray-300 rounded-lg bg-white">
                {hedgeHeightOptions.map((height) => (
                  <option key={height} value={height} disabled={height === '4-6m' && !(selectedConfig as any)?.specialist_enabled}>
                    {height}
                  </option>
                ))}
              </select>
              <div className="relative">
                <input type="number" min={0} value={zone.length} onChange={(e) => setHedgeZones((prev) => prev.map((z, i) => i === idx ? { ...z, length: Number(e.target.value) || 0 } : z))} className="w-full p-2 pr-10 border border-gray-300 rounded-lg bg-white" placeholder="Longitud" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">m</span>
              </div>
              <select value={zone.state} onChange={(e) => setHedgeZones((prev) => prev.map((z, i) => i === idx ? { ...z, state: e.target.value } : z))} className="p-2 border border-gray-300 rounded-lg bg-white">
                <option value="normal">Normal</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
              </select>
              <button type="button" onClick={() => setHedgeZones((prev) => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))} className="px-3 py-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-50">Eliminar</button>
            </div>
          ))}
          <button type="button" onClick={() => setHedgeZones((prev) => [...prev, { height: '0-2m', length: 10, state: 'normal' }])} className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50">+ Añadir zona</button>
        </div>
      )}

      {selectedService === 'Poda de árboles' && (
        <div className="space-y-3">
          {treeGroups.map((group, idx) => (
            <div key={`tree-${idx}`} className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <select value={group.pruningType} onChange={(e) => setTreeGroups((prev) => prev.map((g, i) => i === idx ? { ...g, pruningType: e.target.value as 'structural' | 'shaping' } : g))} className="p-2 border border-gray-300 rounded-lg bg-white">
                <option value="structural">Estructural</option>
                <option value="shaping">De forma</option>
              </select>
              <select value={group.access} onChange={(e) => setTreeGroups((prev) => prev.map((g, i) => i === idx ? { ...g, access: e.target.value as 'normal' | 'medio' | 'dificil' } : g))} className="p-2 border border-gray-300 rounded-lg bg-white">
                <option value="normal">Acceso normal</option>
                <option value="medio">Acceso medio</option>
                <option value="dificil">Acceso difícil</option>
              </select>
              <div className="relative">
                <input type="number" min={0} step="0.1" value={group.estimatedHours} onChange={(e) => setTreeGroups((prev) => prev.map((g, i) => i === idx ? { ...g, estimatedHours: Number(e.target.value) || 0 } : g))} className="w-full p-2 pr-10 border border-gray-300 rounded-lg bg-white" placeholder="Horas" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">h</span>
              </div>
              <button type="button" onClick={() => setTreeGroups((prev) => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))} className="px-3 py-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-50">Eliminar</button>
            </div>
          ))}
          <button type="button" onClick={() => setTreeGroups((prev) => [...prev, { pruningType: 'structural', access: 'normal', estimatedHours: 2 }])} className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50">+ Añadir árbol</button>
        </div>
      )}

      {selectedService === 'Poda de plantas y arbustos' && (
        <div className="space-y-3">
          {shrubGroups.map((group, idx) => (
            <div key={`shrub-${idx}`} className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <select value={group.size} onChange={(e) => setShrubGroups((prev) => prev.map((g, i) => i === idx ? { ...g, size: e.target.value } : g))} className="p-2 border border-gray-300 rounded-lg bg-white">
                <option value="pequeñas">Pequeñas (0-1m)</option>
                <option value="medianas">Medianas (1-2m)</option>
                <option value="grandes">Grandes (2-3m)</option>
              </select>
              <div className="relative">
                <input type="number" min={0} value={group.area} onChange={(e) => setShrubGroups((prev) => prev.map((g, i) => i === idx ? { ...g, area: Number(e.target.value) || 0 } : g))} className="w-full p-2 pr-12 border border-gray-300 rounded-lg bg-white" placeholder="Área" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">m²</span>
              </div>
              <button type="button" onClick={() => setShrubGroups((prev) => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))} className="px-3 py-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-50">Eliminar</button>
            </div>
          ))}
          <button type="button" onClick={() => setShrubGroups((prev) => [...prev, { size: 'medianas', area: 5 }])} className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50">+ Añadir macizo</button>
        </div>
      )}

      {selectedService === 'Servicios fitosanitarios' && (
        <div className="space-y-3">
          {phytosanitaryZones.map((zone, idx) => (
            <div key={`fumi-${idx}`} className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <select value={zone.type} onChange={(e) => setPhytosanitaryZones((prev) => prev.map((z, i) => i === idx ? { ...z, type: e.target.value } : z))} className="p-2 border border-gray-300 rounded-lg bg-white">
                <option value="">Tipo</option>
                {phytosanitaryTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <div className="relative">
                <input type="number" min={0} value={zone.area} onChange={(e) => setPhytosanitaryZones((prev) => prev.map((z, i) => i === idx ? { ...z, area: Number(e.target.value) || 0 } : z))} className="w-full p-2 pr-12 border border-gray-300 rounded-lg bg-white" placeholder="Área" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">m²</span>
              </div>
              <button type="button" onClick={() => setPhytosanitaryZones((prev) => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))} className="px-3 py-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-50">Eliminar</button>
            </div>
          ))}
          <button type="button" onClick={() => setPhytosanitaryZones((prev) => [...prev, { type: '', area: 50 }])} className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50">+ Añadir zona</button>
        </div>
      )}

      <div className="mt-5 bg-white border border-amber-200 rounded-lg p-4">
        <div className="text-sm text-gray-600">Precio final simulado</div>
        <div className="text-3xl font-bold text-amber-700 mt-1">€{result.price}</div>
        {result.warnings.length > 0 && (
          <div className="mt-2 text-sm text-amber-700">
            {result.warnings.map((w) => <div key={w}>{w}</div>)}
          </div>
        )}
      </div>

      {result.breakdown.length > 0 && (
        <div className="mt-3 bg-white border border-gray-200 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-gray-900 mb-2">Desglose del cálculo</h4>
          <div className="space-y-1 text-sm text-gray-700">
            {result.breakdown.map((line, idx) => <div key={`${line}-${idx}`}>{line}</div>)}
          </div>
        </div>
      )}
    </div>
  );
};

export default PriceSimulator;
