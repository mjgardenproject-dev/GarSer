import React, { useMemo, useState } from 'react';
import { Calculator } from 'lucide-react';
import { PhytosanitaryPricingConfig, Service } from '../../types';
import { PalmPricingConfig } from './PalmPricingConfigurator';
import { LawnPricingConfig } from './LawnPricingConfigurator';
import { HedgePricingConfig, HEDGE_HEIGHT_BANDS, HedgeHeightBand } from './HedgePricingConfigurator';
import { TreePricingConfig } from './TreePricingConfigurator';
import { ShrubPricingConfig } from './ShrubPricingConfigurator';
import { ClearingPricingConfig } from './ClearingPricingConfigurator';

type SimulatorConfigs = {
  palmConfig?: PalmPricingConfig;
  lawnConfig?: LawnPricingConfig;
  hedgeConfig?: HedgePricingConfig;
  treeConfig?: TreePricingConfig;
  shrubConfig?: ShrubPricingConfig;
  clearingConfig?: ClearingPricingConfig;
  phytosanitaryConfig?: PhytosanitaryPricingConfig;
};

interface PriceSimulatorProps {
  services: Service[];
  configs: SimulatorConfigs;
}

type PalmGroup = { species: string; height: string; quantity: number; state: string };
type LawnZone = { state: string; quantity: number };
type HedgeZone = { height: string; length: number; state: string };
type TreeGroup = { pruningType: 'structural' | 'shaping'; access: 'normal' | 'medio' | 'dificil'; estimatedHours: number; analysisLevel?: number; isFailed?: boolean };
type ShrubGroup = { type: string; size: string; quantity: number; state: string };
type AreaZone = { type: string; area: number };

const SERVICE_NAMES = [
  'Corte de césped',
  'Poda de plantas',
  'Corte de setos a máquina',
  'Poda de árboles',
  'Labrar y quitar malas hierbas a mano',
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
  const [hedgeZones, setHedgeZones] = useState<HedgeZone[]>([{ height: '1-2m', length: 10, state: 'normal' }]);
  const [treeGroups, setTreeGroups] = useState<TreeGroup[]>([{ pruningType: 'structural', access: 'normal', estimatedHours: 2 }]);
  const [shrubGroups, setShrubGroups] = useState<ShrubGroup[]>([{ type: '', size: 'Mediano (1-2.5m)', quantity: 5, state: 'normal' }]);
  const [clearingZones, setClearingZones] = useState<AreaZone[]>([{ type: '', area: 50 }]);
  const [phytosanitaryZones, setPhytosanitaryZones] = useState<AreaZone[]>([{ type: '', area: 50 }]);

  const selectedConfig = useMemo(() => {
    if (selectedService === 'Poda de palmeras') return configs.palmConfig;
    if (selectedService === 'Corte de césped') return configs.lawnConfig;
    if (selectedService === 'Corte de setos a máquina') return configs.hedgeConfig;
    if (selectedService === 'Poda de árboles') return configs.treeConfig;
    if (selectedService === 'Poda de plantas') return configs.shrubConfig;
    if (selectedService === 'Labrar y quitar malas hierbas a mano') return configs.clearingConfig;
    if (selectedService === 'Servicios fitosanitarios') return configs.phytosanitaryConfig;
    return undefined;
  }, [selectedService, configs]);

  const findPalmPrice = (config: any, species: string, height: string): number => {
    if (!config || !config.height_prices) {
      if (config?.species_prices?.[species] && typeof config.species_prices[species] === 'number') return config.species_prices[species];
      return 0;
    }

    if (config.height_prices[species]?.[height]) return config.height_prices[species][height];

    let speciesKey = species;
    const speciesLower = species.toLowerCase();
    const speciesMap: Record<string, string> = {
      phoenix: 'Phoenix (datilera o canaria)',
      datilera: 'Phoenix (datilera o canaria)',
      canaria: 'Phoenix (datilera o canaria)',
      washingtonia: 'Washingtonia',
      roystonea: 'Roystonea regia (cubana)',
      cubana: 'Roystonea regia (cubana)',
      syagrus: 'Syagrus romanzoffiana (cocotera)',
      cocotera: 'Syagrus romanzoffiana (cocotera)',
      trachycarpus: 'Trachycarpus fortunei',
      fortunei: 'Trachycarpus fortunei',
      livistona: 'Livistona',
      kentia: 'Kentia (palmito)',
      palmito: 'Kentia (palmito)',
      roebelenii: 'Phoenix roebelenii(pigmea)',
      pigmea: 'Phoenix roebelenii(pigmea)',
      cycas: 'cycas revoluta (falsa palmera)',
      revoluta: 'cycas revoluta (falsa palmera)',
      falsa: 'cycas revoluta (falsa palmera)'
    };

    let found = false;
    for (const [key, val] of Object.entries(speciesMap)) {
      if (speciesLower.includes(key)) {
        speciesKey = val;
        found = true;
        break;
      }
    }

    if (!found && !config.height_prices[speciesKey]) {
      const configKeys = Object.keys(config.height_prices);
      const match = configKeys.find((k) => k.toLowerCase().includes(speciesLower) || speciesLower.includes(k.toLowerCase()));
      if (match) speciesKey = match;
    }

    if (!config.height_prices[speciesKey]) {
      if (config.species_prices?.[speciesKey] && typeof config.species_prices[speciesKey] === 'number') return config.species_prices[speciesKey];
      return 0;
    }

    if (config.height_prices[speciesKey][height]) return config.height_prices[speciesKey][height];

    const matches = height.match(/(\d+(?:\.\d+)?)/g);
    let heightNum = 0;
    if (matches && matches.length > 0) {
      if (matches.length === 1) heightNum = parseFloat(matches[0]);
      else heightNum = (parseFloat(matches[0]) + parseFloat(matches[1])) / 2;
    } else {
      if (config.species_prices?.[speciesKey]) return config.species_prices[speciesKey];
      return 0;
    }

    const ranges = Object.keys(config.height_prices[speciesKey]);
    let bestRange = '';
    for (const range of ranges) {
      if (range.includes('+')) {
        const min = parseFloat(range.replace('+', ''));
        if (heightNum >= min) bestRange = range;
      } else if (range.includes('-')) {
        const [min, max] = range.split('-').map(Number);
        if (heightNum >= min && heightNum < max) {
          bestRange = range;
          break;
        }
      }
    }

    if (bestRange) return config.height_prices[speciesKey][bestRange] || 0;
    if (config.species_prices?.[speciesKey]) return config.species_prices[speciesKey];
    return 0;
  };

  const getLawnSurfacePrices = (config: any) => {
    const parsed = {
      '0-50': Number(config?.surface_prices?.['0-50'] || 0),
      '51-150': Number(config?.surface_prices?.['51-150'] || 0),
      '151-400': Number(config?.surface_prices?.['151-400'] || 0),
      '400+': Number(config?.surface_prices?.['400+'] || 0)
    };
    const hasNew = Object.values(parsed).some(v => v > 0);
    if (hasNew) return parsed;

    const selectedSpecies = Array.isArray(config?.selected_species) ? config.selected_species : [];
    const legacySpeciesKey = selectedSpecies.find((s: string) => config?.species_prices?.[s]) || Object.keys(config?.species_prices || {})[0];
    const legacyPrices = legacySpeciesKey ? config?.species_prices?.[legacySpeciesKey] : null;
    if (!legacyPrices) return parsed;

    return {
      '0-50': Number(legacyPrices['0-50'] || 0),
      '51-150': Number(legacyPrices['50-200'] || 0),
      '151-400': Number(legacyPrices['200+'] || 0),
      '400+': Number(legacyPrices['200+'] || 0)
    };
  };

  const toNewHedgeLengthRange = (length: number): '0-25m (Estándar)' | '>25m (Gran Volumen)' =>
    length <= 25 ? '0-25m (Estándar)' : '>25m (Gran Volumen)';

  const normalizeHedgeHeightBand = (height: string): HedgeHeightBand => {
    if (HEDGE_HEIGHT_BANDS.includes(height as HedgeHeightBand)) return height as HedgeHeightBand;
    const normalized = height.toLowerCase();
    if (normalized.includes('0-1') || normalized.includes('<1')) {
      return '0-1m';
    }
    if (normalized.includes('1-2') || normalized.includes('hasta 2') || normalized.includes('suelo')) {
      return '1-2m';
    }
    if (normalized.includes('2-3') || normalized.includes('3-4.5') || normalized.includes('2-4') || normalized.includes('escalera')) {
      return '2-4m';
    }
    return '4-6m';
  };

  const getLegacyHedgeBase = (config: any, heightBand: HedgeHeightBand, lengthRange: '0-25m (Estándar)' | '>25m (Gran Volumen)') => {
    const legacyRangeOptions = lengthRange === '0-25m (Estándar)' ? ['0-10m', '11-25m'] : ['26-50m', '>50m'];
    const legacyHeightOptions =
      heightBand === '0-1m'
        ? [{ category: 'Setos Estándar (≤3m)', height: '0-1m' }]
        : heightBand === '1-2m'
        ? [{ category: 'Setos Estándar (≤3m)', height: '>1-2m' }]
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
      let total = 0;
      for (const group of palmGroups) {
        const basePrice = findPalmPrice(config, group.species, group.height);
        if (basePrice <= 0 || !group.species) continue;
        const state = (group.state || 'normal').toLowerCase();
        const surcharges = config.condition_surcharges || { normal: 0, neglected: 15, overgrown: 30 };
        let statePercent = 0;
        if (state.includes('muy') && (state.includes('descuidado') || state.includes('mal'))) statePercent = surcharges.muy_descuidado || surcharges.muy_descuidada || surcharges.overgrown || 0;
        else if (state.includes('descuidado') || state.includes('mal')) statePercent = surcharges.descuidado || surcharges.descuidada || surcharges.neglected || 0;
        else statePercent = surcharges.normal || 0;
        const stateMult = 1 + statePercent / 100;
        let wastePercent = 0;
        if (globalWasteRemoval) wastePercent = config.wasteRemovalModifier !== undefined ? config.wasteRemovalModifier : (config.waste_removal?.percentage || 0);
        const wasteMult = 1 + wastePercent / 100;
        const lineTotal = basePrice * (group.quantity || 1) * stateMult * wasteMult;
        total += lineTotal;
        breakdown.push(`${group.quantity}x ${group.species} (${group.height}) → base ${basePrice.toFixed(2)}€ · estado ${statePercent}% · restos ${wastePercent}% = ${lineTotal.toFixed(2)}€`);
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
        const lengthRange = toNewHedgeLengthRange(zone.length || 0);
        const heightBand = normalizeHedgeHeightBand(zone.height);
        if (!config.specialist_enabled && heightBand === '4-6m') {
          warnings.push('Altura 4-6m desactivada: esta zona no se incluye en el cálculo.');
          continue;
        }
        const matrixBase = Number(config.pricing_matrix?.[heightBand]?.[lengthRange] || 0);
        const legacyBase = Number(getLegacyHedgeBase(config, heightBand, lengthRange) || 0);
        const base = matrixBase || legacyBase;
        if (base <= 0) continue;
        const surcharges = config.condition_surcharges || { descuidado: 25 };
        const s = (zone.state || 'normal').toLowerCase();
        const statePercent = s.includes('descuidado') ? Number(surcharges.descuidado || 0) : 0;
        const stateMult = 1 + statePercent / 100;
        let wasteMult = 1;
        if (globalWasteRemoval) wasteMult = 1 + ((config.waste_removal?.percentage || 0) / 100);
        const lineTotal = base * (zone.length || 0) * stateMult * wasteMult;
        total += lineTotal;
        breakdown.push(`${heightBand} (${lengthRange}) ${zone.length}m → base ${base.toFixed(2)}€ · estado ${statePercent}% · restos ${((wasteMult - 1) * 100).toFixed(0)}% = ${lineTotal.toFixed(2)}€`);
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

    if (selectedService === 'Poda de plantas') {
      if (!config.species_prices) return { price: 0, breakdown, warnings: ['Configuración incompleta de poda de plantas.'] };
      let total = 0;
      for (const group of shrubGroups) {
        const base = config.species_prices[group.type]?.[group.size] || 0;
        if (base <= 0 || !group.type) continue;
        const surcharges = config.condition_multipliers || { normal: 0, neglected: 15, overgrown: 30 };
        const s = (group.state || 'normal').toLowerCase();
        let conditionPercent = 0;
        if (s.includes('muy') && s.includes('descuidado')) conditionPercent = surcharges.overgrown;
        else if (s.includes('descuidado')) conditionPercent = surcharges.neglected;
        else conditionPercent = surcharges.normal;
        const conditionMult = 1 + conditionPercent / 100;
        let wasteMult = 1;
        if (globalWasteRemoval) wasteMult = 1 + ((config.waste_removal?.percentage || 0) / 100);
        const lineTotal = base * group.quantity * conditionMult * wasteMult;
        total += lineTotal;
        breakdown.push(`${group.type} (${group.size}) x${group.quantity} → base ${base.toFixed(2)}€ · estado ${conditionPercent}% · restos ${((wasteMult - 1) * 100).toFixed(0)}% = ${lineTotal.toFixed(2)}€`);
      }
      const minimumResult = applyMinimumPrice(total);
      if (minimumResult.minimumApplied) {
        breakdown.push(`Tarifa mínima aplicada: cálculo normal ${minimumResult.roundedCalculatedPrice.toFixed(0)}€ < tarifa mínima configurada ${minimumResult.minimumPrice.toFixed(0)}€. Resultado final: ${minimumResult.finalPrice.toFixed(0)}€.`);
      }
      if (minimumResult.finalPrice <= 0) warnings.push('No hay coincidencia entre las variables introducidas y tu tarifa guardada.');
      return { price: minimumResult.finalPrice, breakdown, warnings };
    }

    if (selectedService === 'Labrar y quitar malas hierbas a mano') {
      if (!config.type_prices) return { price: 0, breakdown, warnings: ['Configuración incompleta de desbroce.'] };
      const totalArea = clearingZones.reduce((acc, z) => acc + (z.area || 0), 0);
      let range = '0-50';
      if (totalArea > 200) range = '200+';
      else if (totalArea > 50) range = '50-200';
      let total = 0;
      for (const zone of clearingZones) {
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
      const priceTable = getLawnSurfacePrices(config);
      let range: '0-50' | '51-150' | '151-400' | '400+' = '0-50';
      if (totalArea > 400) range = '400+';
      else if (totalArea > 150) range = '151-400';
      else if (totalArea > 50) range = '51-150';
      const baseRate = Number(priceTable[range] || 0);
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
        breakdown.push(`Césped general ${zone.quantity}m² · rango ${range} · estado ${stateSurchargePercent}% = ${lineTotal.toFixed(2)}€`);
      }
      const minimumResult = applyMinimumPrice(totalCost);
      if (minimumResult.minimumApplied) {
        breakdown.push(`Tarifa mínima aplicada: cálculo normal ${minimumResult.roundedCalculatedPrice.toFixed(0)}€ < tarifa mínima configurada ${minimumResult.minimumPrice.toFixed(0)}€. Resultado final: ${minimumResult.finalPrice.toFixed(0)}€.`);
      }
      if (minimumResult.finalPrice <= 0) warnings.push('No hay coincidencia entre las variables introducidas y tu tarifa guardada.');
      return { price: minimumResult.finalPrice, breakdown, warnings };
    }

    return { price: 0, breakdown, warnings };
  }, [selectedConfig, selectedService, palmGroups, lawnZones, hedgeZones, treeGroups, shrubGroups, clearingZones, phytosanitaryZones, globalWasteRemoval]);

  const hedgeHeightOptions = useMemo(() => HEDGE_HEIGHT_BANDS, []);
  const shrubTypeOptions = useMemo(() => Object.keys((configs.shrubConfig as any)?.species_prices || {}), [configs.shrubConfig]);
  const clearingTypeOptions = useMemo(() => Object.keys((configs.clearingConfig as any)?.type_prices || {}), [configs.clearingConfig]);
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
                <option value="descuidada">Descuidada</option>
                <option value="muy_descuidada">Muy descuidada</option>
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
                <option value="descuidado">Descuidado</option>
              </select>
              <button type="button" onClick={() => setHedgeZones((prev) => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))} className="px-3 py-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-50">Eliminar</button>
            </div>
          ))}
          <button type="button" onClick={() => setHedgeZones((prev) => [...prev, { height: '1-2m', length: 10, state: 'normal' }])} className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50">+ Añadir zona</button>
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

      {selectedService === 'Poda de plantas' && (
        <div className="space-y-3">
          {shrubGroups.map((group, idx) => (
            <div key={`shrub-${idx}`} className="grid grid-cols-1 md:grid-cols-5 gap-2">
              <select value={group.type} onChange={(e) => setShrubGroups((prev) => prev.map((g, i) => i === idx ? { ...g, type: e.target.value } : g))} className="p-2 border border-gray-300 rounded-lg bg-white">
                <option value="">Tipo</option>
                {shrubTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select value={group.size} onChange={(e) => setShrubGroups((prev) => prev.map((g, i) => i === idx ? { ...g, size: e.target.value } : g))} className="p-2 border border-gray-300 rounded-lg bg-white">
                <option value="Pequeño (hasta 1m)">Pequeño (hasta 1m)</option>
                <option value="Mediano (1-2.5m)">Mediano (1-2.5m)</option>
                <option value="Grande (>2.5m)">Grande (&gt;2.5m)</option>
              </select>
              <div className="relative">
                <input type="number" min={0} value={group.quantity} onChange={(e) => setShrubGroups((prev) => prev.map((g, i) => i === idx ? { ...g, quantity: Number(e.target.value) || 0 } : g))} className="w-full p-2 pr-14 border border-gray-300 rounded-lg bg-white" placeholder="Cantidad" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">uds</span>
              </div>
              <select value={group.state} onChange={(e) => setShrubGroups((prev) => prev.map((g, i) => i === idx ? { ...g, state: e.target.value } : g))} className="p-2 border border-gray-300 rounded-lg bg-white">
                <option value="normal">Normal</option>
                <option value="descuidado">Descuidado</option>
                <option value="muy descuidado">Muy descuidado</option>
              </select>
              <button type="button" onClick={() => setShrubGroups((prev) => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))} className="px-3 py-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-50">Eliminar</button>
            </div>
          ))}
          <button type="button" onClick={() => setShrubGroups((prev) => [...prev, { type: '', size: 'Mediano (1-2.5m)', quantity: 5, state: 'normal' }])} className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50">+ Añadir grupo</button>
        </div>
      )}

      {selectedService === 'Labrar y quitar malas hierbas a mano' && (
        <div className="space-y-3">
          {clearingZones.map((zone, idx) => (
            <div key={`clear-${idx}`} className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <select value={zone.type} onChange={(e) => setClearingZones((prev) => prev.map((z, i) => i === idx ? { ...z, type: e.target.value } : z))} className="p-2 border border-gray-300 rounded-lg bg-white">
                <option value="">Tipo</option>
                {clearingTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <div className="relative">
                <input type="number" min={0} value={zone.area} onChange={(e) => setClearingZones((prev) => prev.map((z, i) => i === idx ? { ...z, area: Number(e.target.value) || 0 } : z))} className="w-full p-2 pr-12 border border-gray-300 rounded-lg bg-white" placeholder="Área" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">m²</span>
              </div>
              <button type="button" onClick={() => setClearingZones((prev) => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))} className="px-3 py-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-50">Eliminar</button>
            </div>
          ))}
          <button type="button" onClick={() => setClearingZones((prev) => [...prev, { type: '', area: 50 }])} className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50">+ Añadir zona</button>
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
