import React, { useMemo, useState } from 'react';
import { Calculator } from 'lucide-react';
import { PhytosanitaryPricingConfig, Service } from '../../types';
import { HEDGE_HEIGHT_BANDS } from './HedgePricingConfigurator';
import { TreePricingConfig } from './TreePricingConfigurator';
import {
  buildAuthoritativeBookingQuote,
  type SerializableBookingData,
} from '../../shared/bookingQuoteCore';

type SimulatorConfigs = {
  palmConfig?: any;
  lawnConfig?: any;
  hedgeConfig?: any;
  treeConfig?: TreePricingConfig;
  shrubConfig?: any;
  phytosanitaryConfig?: PhytosanitaryPricingConfig;
  weedingConfig?: any;
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
};
type LawnZone = { state: string; quantity: number };
type HedgeZone = { height: string; length: number; state: string };
type TreeGroup = {
  pruningType: 'structural' | 'shaping';
  sizeBand: 'small' | 'medium' | 'large' | 'over_9';
  difficultyHigh: boolean;
  analysisLevel?: number;
  isFailed?: boolean;
};
type ShrubGroup = { size: string; area: number };
type PhytosanitaryZone = {
  type: string;
  area: number;
  affectedType: 'Césped' | 'Árboles' | 'Setos' | 'Plantas bajas' | 'Palmeras';
  aboveTwoMeters?: boolean;
  aboveThreeMeters?: boolean;
};
type WeedingZone = {
  area: number;
  state: 'normal' | 'dificultad_media' | 'dificultad_alta';
  applyHerbicide: boolean;
};

const SERVICE_NAMES = [
  'Corte de césped',
  'Poda de plantas y arbustos',
  'Corte de setos a máquina',
  'Poda de árboles',
  'Servicios fitosanitarios',
  'Poda de palmeras',
  'Desbroce de malas hierbas',
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
  const [treeGroups, setTreeGroups] = useState<TreeGroup[]>([{ pruningType: 'structural', sizeBand: 'medium', difficultyHigh: false }]);
  const [shrubGroups, setShrubGroups] = useState<ShrubGroup[]>([{ size: 'medianas', area: 5 }]);
  const [phytosanitaryZones, setPhytosanitaryZones] = useState<PhytosanitaryZone[]>([{ type: 'insecticida', area: 50, affectedType: 'Plantas bajas' }]);
  const [weedingZones, setWeedingZones] = useState<WeedingZone[]>([{ area: 50, state: 'normal', applyHerbicide: false }]);

  const selectedConfig = useMemo(() => {
    if (selectedService === 'Poda de palmeras') return configs.palmConfig;
    if (selectedService === 'Corte de césped') return configs.lawnConfig;
    if (selectedService === 'Corte de setos a máquina') return configs.hedgeConfig;
    if (selectedService === 'Poda de árboles') return configs.treeConfig;
    if (selectedService === 'Poda de plantas y arbustos') return configs.shrubConfig;
    if (selectedService === 'Servicios fitosanitarios') return configs.phytosanitaryConfig;
    if (selectedService === 'Desbroce de malas hierbas') return configs.weedingConfig;
    return undefined;
  }, [selectedService, configs]);

  const buildSimulatorBookingData = (): SerializableBookingData => {
    const baseData: SerializableBookingData = {
      wasteRemoval: globalWasteRemoval,
      serviceIds: [selectedService],
    };

    if (selectedService === 'Poda de palmeras') {
      return { ...baseData, palmGroups };
    }
    if (selectedService === 'Corte de césped') {
      return { ...baseData, lawnZones };
    }
    if (selectedService === 'Corte de setos a máquina') {
      return {
        ...baseData,
        hedgeZones: hedgeZones.map((zone) => ({
          type: 'general',
          height: zone.height,
          length: zone.length,
          state: zone.state,
          faces_to_trim: 1,
        })),
      };
    }
    if (selectedService === 'Poda de árboles') {
      return {
        ...baseData,
        treeGroups: treeGroups.map((group, index) => ({
          id: `tree-${index + 1}`,
          pruningType: group.pruningType,
          aiSizeBand: group.sizeBand,
          difficultyHigh: group.difficultyHigh,
          analysisLevel: group.analysisLevel,
          isFailed: group.isFailed,
        })),
      };
    }
    if (selectedService === 'Poda de plantas y arbustos') {
      return {
        ...baseData,
        shrubGroups: shrubGroups.map((group, index) => ({
          id: `shrub-${index + 1}`,
          area: group.area,
          size: group.size as 'pequeñas' | 'medianas' | 'grandes',
        })),
      };
    }
    if (selectedService === 'Servicios fitosanitarios') {
      return { ...baseData, phytosanitaryZones };
    }
    if (selectedService === 'Desbroce de malas hierbas') {
      return { ...baseData, weedingZones };
    }
    return baseData;
  };

  const result = useMemo(() => {
    if (!selectedConfig) {
      return {
        price: 0,
        estimatedHours: 0,
        breakdown: [] as Array<{ desc: string; price: number }>,
        warnings: ['No hay configuración guardada para este servicio.'],
      };
    }

    const quote = buildAuthoritativeBookingQuote({
      bookingData: buildSimulatorBookingData(),
      providerConfig: selectedConfig,
    });

    const warnings = quote.warnings.map((warning) => warning.message);
    if (quote.totalPrice <= 0) {
      warnings.push('No hay coincidencia entre las variables introducidas y tu tarifa guardada.');
    }

    return {
      price: quote.totalPrice,
      estimatedHours: quote.estimatedHours,
      breakdown: quote.breakdown,
      warnings,
    };
  }, [selectedConfig, selectedService, palmGroups, lawnZones, hedgeZones, treeGroups, shrubGroups, phytosanitaryZones, weedingZones, globalWasteRemoval]);

  const hedgeHeightOptions = useMemo(() => HEDGE_HEIGHT_BANDS, []);
  const palmSpeciesOptions = useMemo(() => Object.keys((configs.palmConfig as any)?.height_prices || {}), [configs.palmConfig]);
  const phytosanitaryTypeOptions = useMemo(
    () => ['insecticida', 'fungicida', 'insecticida+fungicida', 'insecticida+fungicida+ecologico_preventivo', 'endoterapia'],
    []
  );
  const phytosanitaryAffectedOptions = useMemo(
    () => ['Plantas bajas', 'Césped', 'Setos', 'Árboles', 'Palmeras'] as const,
    []
  );

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
              <select value={group.sizeBand} onChange={(e) => setTreeGroups((prev) => prev.map((g, i) => i === idx ? { ...g, sizeBand: e.target.value as TreeGroup['sizeBand'] } : g))} className="p-2 border border-gray-300 rounded-lg bg-white">
                <option value="small">Pequeño (0-3m)</option>
                <option value="medium">Mediano (3-5m)</option>
                <option value="large">Grande (5-9m)</option>
                <option value="over_9">Muy grande (&gt;9m)</option>
              </select>
              <select value={group.difficultyHigh ? 'alta' : 'normal'} onChange={(e) => setTreeGroups((prev) => prev.map((g, i) => i === idx ? { ...g, difficultyHigh: e.target.value === 'alta' } : g))} className="p-2 border border-gray-300 rounded-lg bg-white">
                <option value="normal">Dificultad normal</option>
                <option value="alta">Dificultad alta</option>
              </select>
              <button type="button" onClick={() => setTreeGroups((prev) => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))} className="px-3 py-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-50">Eliminar</button>
            </div>
          ))}
          <button type="button" onClick={() => setTreeGroups((prev) => [...prev, { pruningType: 'structural', sizeBand: 'medium', difficultyHigh: false }])} className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50">+ Añadir árbol</button>
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
            <div key={`fumi-${idx}`} className="grid grid-cols-1 md:grid-cols-5 gap-2">
              <select value={zone.type} onChange={(e) => setPhytosanitaryZones((prev) => prev.map((z, i) => i === idx ? { ...z, type: e.target.value } : z))} className="p-2 border border-gray-300 rounded-lg bg-white">
                {phytosanitaryTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <select value={zone.affectedType} onChange={(e) => setPhytosanitaryZones((prev) => prev.map((z, i) => i === idx ? { ...z, affectedType: e.target.value as PhytosanitaryZone['affectedType'] } : z))} className="p-2 border border-gray-300 rounded-lg bg-white">
                {phytosanitaryAffectedOptions.map((affectedType) => <option key={affectedType} value={affectedType}>{affectedType}</option>)}
              </select>
              <div className="relative">
                <input type="number" min={0} value={zone.area} onChange={(e) => setPhytosanitaryZones((prev) => prev.map((z, i) => i === idx ? { ...z, area: Number(e.target.value) || 0 } : z))} className="w-full p-2 pr-12 border border-gray-300 rounded-lg bg-white" placeholder="Área" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">m²</span>
              </div>
              <select value={zone.aboveTwoMeters ? 'alto' : 'bajo'} onChange={(e) => setPhytosanitaryZones((prev) => prev.map((z, i) => i === idx ? { ...z, aboveTwoMeters: e.target.value === 'alto' } : z))} className="p-2 border border-gray-300 rounded-lg bg-white">
                <option value="bajo">Hasta 2m</option>
                <option value="alto">Más de 2m</option>
              </select>
              <select value={zone.aboveThreeMeters ? 'alto' : 'bajo'} onChange={(e) => setPhytosanitaryZones((prev) => prev.map((z, i) => i === idx ? { ...z, aboveThreeMeters: e.target.value === 'alto' } : z))} className="p-2 border border-gray-300 rounded-lg bg-white">
                <option value="bajo">Hasta 3m</option>
                <option value="alto">Más de 3m</option>
              </select>
              <button type="button" onClick={() => setPhytosanitaryZones((prev) => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))} className="px-3 py-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-50">Eliminar</button>
            </div>
          ))}
          <button type="button" onClick={() => setPhytosanitaryZones((prev) => [...prev, { type: 'insecticida', area: 50, affectedType: 'Plantas bajas' }])} className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50">+ Añadir zona</button>
        </div>
      )}

      {selectedService === 'Desbroce de malas hierbas' && (
        <div className="space-y-3">
          {weedingZones.map((zone, idx) => (
            <div key={`weed-${idx}`} className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <div className="relative">
                <input type="number" min={0} value={zone.area} onChange={(e) => setWeedingZones((prev) => prev.map((z, i) => i === idx ? { ...z, area: Number(e.target.value) || 0 } : z))} className="w-full p-2 pr-12 border border-gray-300 rounded-lg bg-white" placeholder="Área" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">m²</span>
              </div>
              <select value={zone.state} onChange={(e) => setWeedingZones((prev) => prev.map((z, i) => i === idx ? { ...z, state: e.target.value as WeedingZone['state'] } : z))} className="p-2 border border-gray-300 rounded-lg bg-white">
                <option value="normal">Normal</option>
                <option value="dificultad_media">Dificultad media</option>
                <option value="dificultad_alta">Dificultad alta</option>
              </select>
              <select value={zone.applyHerbicide ? 'si' : 'no'} onChange={(e) => setWeedingZones((prev) => prev.map((z, i) => i === idx ? { ...z, applyHerbicide: e.target.value === 'si' } : z))} className="p-2 border border-gray-300 rounded-lg bg-white">
                <option value="no">Sin herbicida</option>
                <option value="si">Con herbicida</option>
              </select>
              <button type="button" onClick={() => setWeedingZones((prev) => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))} className="px-3 py-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-50">Eliminar</button>
            </div>
          ))}
          <button type="button" onClick={() => setWeedingZones((prev) => [...prev, { area: 50, state: 'normal', applyHerbicide: false }])} className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50">+ Añadir zona</button>
        </div>
      )}

      <div className="mt-5 bg-white border border-amber-200 rounded-lg p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-gray-600">Precio final simulado</div>
            <div className="text-3xl font-bold text-amber-700 mt-1">€{result.price}</div>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-600">Duración estimada</div>
            <div className="text-xl font-semibold text-gray-900 mt-1">{result.estimatedHours} h</div>
          </div>
        </div>
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
            {result.breakdown.map((line, idx) => (
              <div key={`${line.desc}-${idx}`} className="flex items-start justify-between gap-3">
                <span className="min-w-0">{line.desc}</span>
                <span className="shrink-0 font-medium text-gray-900">€{line.price}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PriceSimulator;
