import {
  calculatePalmHoursFromConfig,
  calculatePriceFromYield,
  calculatePalmPriceEngine,
  findPalmPrice,
  findPalmYield,
  type PalmPricingGroup,
} from '../domain/pricingEngine.ts';
import { isHighestOpenRangeForSpecies } from '../domain/speciesBusinessRules.ts';
import { calculateTreePruningQuoteForTrees } from '../domain/pricing/treePruningPricing.ts';
import { HEDGE_MAX_PLAUSIBLE_LENGTH_M } from '../domain/hedgeBusinessRules.ts';
import type { PhytosanitaryYields } from '../types/index.ts';
import type { TreePruningServiceConfig } from '../types/treePruning.ts';
import { getPrecioPorHora, getPricingMethod } from '../utils/hourlyPricing.ts';
import { BOOKING_MANAGEMENT_FEE_RATE } from './bookingAmounts.ts';

export interface BookingQuoteLine {
  desc: string;
  price: number;
}

export interface BookingQuoteEconomicLine {
  code: string;
  label: string;
  amount: number;
  kind: 'service' | 'tax' | 'fee' | 'adjustment';
}

export interface BookingStripeLineItem {
  code: string;
  label: string;
  unitAmount: number;
  quantity: number;
}

export interface BookingQuoteWarning {
  code: string;
  message: string;
}

export type BookingEligibilityFailureCode =
  | 'missing_provider_config'
  | 'missing_service_payload'
  | 'missing_pricing_config'
  | 'missing_yield_config'
  | 'missing_treatment_config'
  | 'partial_palm_coverage'
  | 'invalid_tree_config'
  | 'unsupported_request';

export interface BookingQuoteEligibility {
  isEligible: boolean;
  reason?: BookingEligibilityFailureCode;
}

export interface BookingQuotePalmGroupContext {
  id?: string;
  species: string;
  height: string;
  quantity: number;
  isTerminalOpenRange: boolean;
  isPriced: boolean;
}

export interface BookingQuotePricingContext {
  serviceType: 'standard' | 'palm_pruning';
  allowsPriceChange: boolean;
  palmGroups: BookingQuotePalmGroupContext[];
}

export interface BookingQuotePalmCoverage {
  isFull: boolean;
  coveredCount: number;
  totalCount: number;
  missingGroups: BookingQuotePalmGroupContext[];
}

export interface BookingQuoteSlotSelection {
  date: string;
  startHour: number;
  startTime: string;
  endTime: string;
  durationHours: number;
}

export interface BookingAvailabilityCalendarDay {
  date: string;
  day: number;
  disabled: boolean;
  count: number;
  availableStartHours?: number[];
}

export interface BookingQuoteAvailability {
  requestedDate?: string;
  windowEndDate?: string;
  validStartHours: number[];
  calendarDays?: BookingAvailabilityCalendarDay[];
  earliestSlot?: BookingQuoteSlotSelection | null;
  selectedSlot?: BookingQuoteSlotSelection | null;
}

export interface BookingQuoteEconomicBreakdown {
  currency: 'EUR';
  taxRate: number;
  serviceGrossTotal: number;
  serviceNetSubtotal: number;
  serviceTaxAmount: number;
  managementFee: number;
  payableNow: number;
  payableLater: number;
  lines: BookingQuoteEconomicLine[];
  stripeLineItems: BookingStripeLineItem[];
}


export interface BookingQuoteMetadata {
  pricingContext: BookingQuotePricingContext;
  palmCoverage?: BookingQuotePalmCoverage;
}

export interface SerializableBookingData {
  address?: string;
  addressCoordinates?: {
    lat: number;
    lng: number;
  };
  description?: string;
  serviceIds?: string[];
  /** Provenance of the service variables. The engine ignores it; the server uses it to gate manual validation. */
  dataInputMode?: 'photos' | 'manual';
  manualDeclarationId?: string;
  /** Auditable consent captured at manual submission (stored in the signed quote snapshot). */
  manualConsent?: {
    legalVersion: string;
    legalHash: string;
    acceptedText: string;
    acceptedAt: string;
    declaredVariables: Record<string, unknown>;
  };
  wasteRemoval?: boolean;
  aiQuantity?: number;
  lawnSpecies?: string;
  palmGroups?: Array<{
    id?: string;
    species: string;
    height: string;
    quantity: number;
    state?: string;
    hasPhytosanitary?: boolean;
    hasTrunkPeeling?: boolean;
    needsPhytosanitary?: boolean;
    needsTrunkFinish?: boolean;
    hasAccessDifficulty?: boolean;
    isTerminalOpenRange?: boolean;
  }>;
  lawnZones?: Array<{
    quantity: number;
    state: string;
  }>;
  hedgeZones?: Array<{
    type: string;
    height: string;
    length: number;
    state?: string;
    faces_to_trim?: number;
    length_pricing_m?: number;
  }>;
  treeGroups?: Array<{
    id: string;
    pruningType: string;
    quantity?: number;
    aiSizeBand?: 'small' | 'medium' | 'large' | 'over_9';
    difficultyHigh?: boolean;
    analysisLevel?: number;
    isFailed?: boolean;
  }>;
  shrubGroups?: Array<{
    id: string;
    area: number;
    size: 'pequeñas' | 'medianas' | 'grandes';
    state?: string;
  }>;
  phytosanitaryZones?: Array<{
    area: number;
    type?: string;
    affectedType?: string;
    /** Porte declarado del ejemplar: selecciona la tarifa dentro del ámbito. */
    sizeBand?: string;
    /** Inyección en tronco, facturada por tronco además del tratamiento por pulverización. */
    wantsEndotherapy?: boolean;
    requestedTreatment?: string;
    aboveTwoMeters?: boolean;
    aboveThreeMeters?: boolean;
    intent?: 'preventive' | 'curative' | 'weed_control';
    curativeTarget?: 'insects' | 'fungus' | 'both';
    productPreference?: 'chemical' | 'ecological';
    analysisMetrics?: {
      cesped_m2?: number;
      plantas_superficie_calculada_m2?: number;
      plantas_tamano_dominante?: 'pequenas' | 'medianas' | 'grandes' | null;
      seto_bajo_medio_ml?: number;
      seto_alto_ml?: number;
      palmeras_ducha_peq_ud?: number;
      palmeras_ducha_med_ud?: number;
      palmeras_ducha_alta_ud?: number;
      palmeras_cirugia_ud?: number;
      palmeras_endoterapia_troncos_ud?: number;
      arboles_peq_ud?: number;
      arboles_med_ud?: number;
      arboles_gran_ud?: number;
      herbicida_poca_densidad_m2?: number;
      herbicida_mucha_densidad_m2?: number;
      observaciones_ia?: string[];
    };
  }>;
  weedingZones?: Array<{
    id?: string;
    area: number;
    state?: string;
    applyHerbicide?: boolean;
  }>;
}

export interface BookingQuoteResult {
  totalPrice: number;
  estimatedHours: number;
  breakdown: BookingQuoteLine[];
  warnings: BookingQuoteWarning[];
  metadata: BookingQuoteMetadata;
  economics: BookingQuoteEconomicBreakdown;
  eligibility: BookingQuoteEligibility;
  availability?: BookingQuoteAvailability;
}

const DEFAULT_HEDGE_SURCHARGES = { media: 20, alta: 50 };
const DEFAULT_SHRUB_SURCHARGES = { media: 20, alta: 50 };

/**
 * Rango plausible de una zona de césped residencial, alineado con el mismo límite que el
 * prompt a Gemini ya declara ("PLAUSIBLE AREA RANGE", ai-pricing-estimator/new_prompts.ts).
 * Ahí es una instrucción al modelo, no una validación: si la IA no la respeta (o alucina la
 * medida), esta es la única red de seguridad del lado del motor. Solo avisa, no bloquea — el
 * mismo patrón que `palm_terminal_range` / `tree_complexity_review` más abajo.
 */
const LAWN_MAX_PLAUSIBLE_AREA_M2 = 2000;

/**
 * Cantidad plausible de palmeras idénticas en un único grupo residencial, mismo criterio
 * que el tope ya usado en árboles (`MANUAL_RANGES.tree.quantity.max`) para el stepper
 * equivalente. Sin este aviso, un grupo de 500 palmeras se facturaba y agendaba sin ningún
 * aviso (auditoría de palmeras 2026-09-11/12, hallazgo #2). Solo avisa, no bloquea.
 */
const PALM_MAX_PLAUSIBLE_QUANTITY = 20;

/**
 * Superficie plausible de un macizo de plantas/arbustos residencial, alineada con el
 * mismo límite que el prompt a Gemini ya declara ("Residential shrub beds measure between
 * 1 and 500 m2", ai-pricing-estimator/new_prompts.ts) — ahí es una instrucción al modelo,
 * no una validación; esta es la única red de seguridad del lado del motor. Sin este aviso
 * no había ninguna forma de detectar una superficie absurda por ningún camino (auditoría
 * 2026-09-12, hallazgo #4). Solo avisa, no bloquea — mismo patrón que
 * lawn_area_implausible/hedge_length_implausible/palm_quantity_implausible.
 */
const SHRUB_MAX_PLAUSIBLE_AREA_M2 = 500;

/**
 * Superficie plausible de una parcela de desbroce residencial, mismo criterio que
 * `LAWN_MAX_PLAUSIBLE_AREA_M2`. Desbroce era el único de los cinco servicios de área/cantidad
 * (césped, setos, palmeras, arbustos, fitosanitarios) sin ningún aviso de plausibilidad — una
 * superficie absurda no generaba ni un warning aunque pasara la validación de rango (auditoría
 * 2026-09-12, hallazgo #3). Solo avisa, no bloquea — mismo patrón que los anteriores.
 */
const WEEDING_MAX_PLAUSIBLE_AREA_M2 = 2000;

/**
 * Resuelve un % de recargo respetando el 0 explícito del jardinero.
 * El patrón anterior (`surcharges.media || 20`) pisaba un 0 configurado a
 * propósito con el default → sobrecobro para jardineros que decidieron no
 * recargar por estado. El default solo aplica si el campo no existe.
 */
const resolveSurchargePercent = (value: unknown, fallback: number): number => {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

type TreeSizeBand = 'small' | 'medium' | 'large' | 'over_9';
type PhytosanitaryTreatment = 'insecticida' | 'fungicida' | 'ecologico_preventivo' | 'endoterapia';
type PhytosanitaryAffectedType = 'Césped' | 'Árboles' | 'Setos' | 'Plantas bajas' | 'Palmeras';

interface PhytosanitaryDetailedPricing {
  cesped: { minimo: number; preventivo: number; curativo: number };
  setos: {
    minimo: number;
    bajos_preventivo: number;
    bajos_curativo: number;
    altos_preventivo: number;
    altos_curativo: number;
  };
  palmeras: {
    minimo: number;
    pequenas_preventivo: number;
    pequenas_curativo: number;
    pequenas_cirugia: number;
    medianas_preventivo: number;
    medianas_curativo: number;
    medianas_cirugia: number;
    altas_preventivo: number;
    altas_curativo: number;
    altas_cirugia: number;
  };
  arboles: {
    minimo: number;
    pequenos_preventivo: number;
    pequenos_curativo: number;
    medianos_preventivo: number;
    medianos_curativo: number;
    grandes_preventivo: number;
    grandes_curativo: number;
  };
  plantas: {
    minimo: number;
    pequenas_preventivo: number;
    pequenas_curativo: number;
    medianas_preventivo: number;
    medianas_curativo: number;
    grandes_preventivo: number;
    grandes_curativo: number;
  };
}

/**
 * Configuración normalizada del servicio.
 *
 * `detailed_pricing` es la ÚNICA tabla de precios. Hasta la auditoría de 2026-09-12 existían
 * además unas estructuras derivadas por banda (`superficies_plantas`, `setos`, `arboles`,
 * `palmeras.tradicional`) que el camino manual usaba en su lugar; mapeaban el precio por tipo
 * de producto (insecticida/fungicida/ecológico) cuando las tarifas reales están por intención
 * (preventivo/curativo), de modo que cobraban la tarifa CURATIVA a todo tratamiento preventivo
 * y la de CÉSPED a las plantas bajas. Se eliminaron: si vuelve a hacer falta una banda, se
 * añade a `detailed_pricing`, no a una tabla paralela.
 */
interface PhytosanitaryNormalizedConfig {
  importe_minimo: number;
  minimum_fee: number;
  tratamientos_activos: PhytosanitaryTreatment[];
  palmeras: {
    endoterapia: {
      precio_unico: number;
    };
  };
  pricing_modifiers: {
    eco: { percentage: number };
  };
  detailed_pricing: PhytosanitaryDetailedPricing;
}

interface PhytosanitaryQuoteBreakdownItem {
  zoneIndex: number;
  affectedType: PhytosanitaryAffectedType;
  requestedTreatments: PhytosanitaryTreatment[];
  appliedTreatments: PhytosanitaryTreatment[];
  quantity: number;
  unitLabel: 'm2' | 'ml' | 'ud';
  unitPrice: number | null;
  subtotal: number | null;
  lineTotal: number | null;
  reason?: string;
}

interface PhytosanitaryQuoteResult {
  total: number;
  totalBeforeMinimum: number;
  minimumFeeApplied: boolean;
  minimumFee: number;
  breakdown: PhytosanitaryQuoteBreakdownItem[];
}

const EMPTY_DETAILED_PHYTOSANITARY_PRICING: PhytosanitaryDetailedPricing = {
  cesped: { minimo: 0, preventivo: 0, curativo: 0 },
  setos: { minimo: 0, bajos_preventivo: 0, bajos_curativo: 0, altos_preventivo: 0, altos_curativo: 0 },
  palmeras: {
    minimo: 0,
    pequenas_preventivo: 0,
    pequenas_curativo: 0,
    pequenas_cirugia: 0,
    medianas_preventivo: 0,
    medianas_curativo: 0,
    medianas_cirugia: 0,
    altas_preventivo: 0,
    altas_curativo: 0,
    altas_cirugia: 0,
  },
  arboles: {
    minimo: 0,
    pequenos_preventivo: 0,
    pequenos_curativo: 0,
    medianos_preventivo: 0,
    medianos_curativo: 0,
    grandes_preventivo: 0,
    grandes_curativo: 0,
  },
  plantas: {
    minimo: 0,
    pequenas_preventivo: 0,
    pequenas_curativo: 0,
    medianas_preventivo: 0,
    medianas_curativo: 0,
    grandes_preventivo: 0,
    grandes_curativo: 0,
  },
};

const BOOKING_TAX_RATE = 0.21;
const roundUp = (value: number) => Math.ceil(Number(value || 0));
const roundCurrency = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const hasPositiveNumber = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0;


const toSafeNumber = (value: unknown): number => {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
};

const buildIneligibleQuote = (
  code: BookingEligibilityFailureCode,
  message: string,
  metadata: BookingQuoteMetadata = buildDefaultQuoteMetadata(),
): BookingQuoteResult => ({
  totalPrice: 0,
  estimatedHours: 0,
  breakdown: [],
  warnings: [{ code, message }],
  metadata,
  economics: buildQuoteEconomics(0, []),
  eligibility: {
    isEligible: false,
    reason: code,
  },
});

const buildShrubBreakdown = (bookingData: SerializableBookingData, config: any, globalWaste: boolean): BookingQuoteLine[] => {
  const priceTable = config?.prices_per_m2 || {};
  const surcharges = config?.condition_surcharges || DEFAULT_SHRUB_SURCHARGES;
  const wastePercent = Number(config?.waste_removal?.percentage || 0);

  const rawLines: Array<{ desc: string; raw: number }> = [];
  (bookingData.shrubGroups || []).forEach((group: any) => {
    const size = (group.size || 'pequeñas') as keyof typeof priceTable;
    const unitPrice = Number(priceTable[size] || 0);
    const area = Number(group.area || 0);
    const state = String(group.state || 'normal').toLowerCase();
    let surchargePercent = 0;
    if (state.includes('muy')) surchargePercent = resolveSurchargePercent(surcharges.alta, DEFAULT_SHRUB_SURCHARGES.alta);
    else if (state.includes('descuidad')) surchargePercent = resolveSurchargePercent(surcharges.media, DEFAULT_SHRUB_SURCHARGES.media);
    const stateMult = 1 + surchargePercent / 100;
    const wasteMult = globalWaste ? 1 + wastePercent / 100 : 1;
    const rawPrice = area * unitPrice * stateMult * wasteMult;

    if (rawPrice > 0) {
      rawLines.push({
        desc: `${area} m2 de arbustos (${group.size || 'pequeñas'}, ${group.state || 'normal'})`,
        raw: rawPrice,
      });
    }
  });

  // El total autoritativo redondea la SUMA una sola vez (más abajo, applyMinimumPrice). Si
  // cada línea se redondeara por separado hacia arriba, con 2+ grupos la suma del desglose
  // podía superar lo realmente cobrado sin ninguna línea de ajuste (auditoría 2026-09-12,
  // hallazgo #5: 33m² + 17m² sumaba 292€ en pantalla cobrando 291€). Se reparte aquí el
  // mismo redondeo único: todas las líneas menos la última se redondean normalmente, y la
  // última absorbe el resto para que la suma coincida siempre con roundUp(suma cruda).
  const target = roundUp(rawLines.reduce((sum, line) => sum + line.raw, 0));
  let allocated = 0;
  const lines: BookingQuoteLine[] = rawLines.map((line, index) => {
    const isLast = index === rawLines.length - 1;
    const price = isLast ? target - allocated : Math.round(line.raw);
    allocated += price;
    return { desc: line.desc, price };
  });

  return lines;
};

const isTreePruningConfig = (value: any): value is TreePruningServiceConfig => {
  if (!value || typeof value !== 'object') return false;
  if (!value.estructural || typeof value.estructural !== 'object') return false;
  if (!value.formacion || typeof value.formacion !== 'object') return false;
  return typeof value.difficultyIncrease === 'number';
};

const mapTreePruningType = (value: any): 'estructural' | 'formacion' => {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('shaping') || normalized.includes('form') || normalized.includes('formacion')) return 'formacion';
  return 'estructural';
};

const normalizeTreeSizeBand = (value: unknown): TreeSizeBand | null => {
  const normalized = String(value || '').toLowerCase().trim();
  if (normalized === 'small' || normalized === 'medium' || normalized === 'large' || normalized === 'over_9') {
    return normalized;
  }
  return null;
};

const resolveTreeBand = (tree: any): TreeSizeBand | null => normalizeTreeSizeBand(tree?.aiSizeBand);

const normalizeWeedingState = (value?: string): 'normal' | 'dificultad_media' | 'dificultad_alta' => {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('alta')) return 'dificultad_alta';
  if (normalized.includes('media') || normalized.includes('descuidad')) return 'dificultad_media';
  return 'normal';
};

const buildDefaultQuoteMetadata = (): BookingQuoteMetadata => ({
  pricingContext: {
    serviceType: 'standard',
    allowsPriceChange: true,
    palmGroups: [],
  },
});

const hasRequestedBookingWork = (bookingData: SerializableBookingData) =>
  Boolean(
    bookingData.lawnZones?.length ||
      bookingData.hedgeZones?.length ||
      bookingData.palmGroups?.length ||
      bookingData.treeGroups?.length ||
      bookingData.shrubGroups?.length ||
      bookingData.phytosanitaryZones?.length ||
      bookingData.weedingZones?.length,
  );

const getRequestedPhytosanitaryYieldKeys = (zones: SerializableBookingData['phytosanitaryZones']) => {
  const required = new Set<keyof PhytosanitaryYields>();
  (zones || []).forEach((zone) => {
    // Las métricas efectivas, no solo las del análisis: una zona declarada a mano deriva las
    // suyas, y el rendimiento que hay que exigir es el de lo que se va a facturar. Si aquí se
    // mirara solo `analysisMetrics`, una zona manual de palmeras con endoterapia pasaría la
    // barrera sin `endoterapia_units_per_hour` y luego sumaría 0 horas por ese concepto.
    const metrics = resolvePhytosanitaryMetrics(zone, normalizePhytosanitaryAffectedType(zone?.affectedType));
    if (metrics && Object.keys(metrics).length) {
      if (metrics.cesped_m2) required.add('cesped_m2_per_hour');
      if (metrics.seto_bajo_medio_ml || metrics.seto_alto_ml) required.add('setos_ml_per_hour');
      if (
        metrics.palmeras_ducha_peq_ud ||
        metrics.palmeras_ducha_med_ud ||
        metrics.palmeras_ducha_alta_ud ||
        metrics.palmeras_cirugia_ud
      ) {
        required.add('palmeras_units_per_hour');
      }
      if (metrics.palmeras_endoterapia_troncos_ud) required.add('endoterapia_units_per_hour');
      if (metrics.arboles_peq_ud || metrics.arboles_med_ud || metrics.arboles_gran_ud) {
        required.add('arboles_units_per_hour');
      }
      if (metrics.plantas_superficie_calculada_m2) required.add('plantas_m2_per_hour');
      return;
    }

    const affectedType = zone?.affectedType;
    if (affectedType === 'Palmeras') required.add('palmeras_units_per_hour');
    else if (affectedType === 'Árboles') required.add('arboles_units_per_hour');
    else if (affectedType === 'Setos') required.add('setos_ml_per_hour');
    else if (affectedType === 'Césped') required.add('cesped_m2_per_hour');
    else required.add('plantas_m2_per_hour');
  });
  return Array.from(required);
};

const inferEconomicLineKind = (desc: string): BookingQuoteEconomicLine['kind'] => {
  const normalized = String(desc || '').toLowerCase();
  if (normalized.includes('ajuste')) return 'adjustment';
  return 'service';
};

const buildQuoteEconomics = (
  totalPrice: number,
  breakdown: BookingQuoteLine[]
): BookingQuoteEconomicBreakdown => {
  const serviceGrossTotal = roundCurrency(totalPrice);
  const serviceNetSubtotal = roundCurrency(serviceGrossTotal / (1 + BOOKING_TAX_RATE));
  const serviceTaxAmount = roundCurrency(serviceGrossTotal - serviceNetSubtotal);
  const managementFee = roundCurrency(serviceGrossTotal * BOOKING_MANAGEMENT_FEE_RATE);

  return {
    currency: 'EUR',
    taxRate: BOOKING_TAX_RATE,
    serviceGrossTotal,
    serviceNetSubtotal,
    serviceTaxAmount,
    managementFee,
    payableNow: managementFee,
    payableLater: serviceGrossTotal,
    lines: [
      ...breakdown.map((line, index) => ({
        code: `service_line_${index + 1}`,
        label: line.desc,
        amount: roundCurrency(line.price),
        kind: inferEconomicLineKind(line.desc),
      })),
      {
        code: 'service_subtotal',
        label: 'Subtotal del servicio',
        amount: serviceNetSubtotal,
        kind: 'service',
      },
      {
        code: 'service_tax',
        label: 'IVA del servicio',
        amount: serviceTaxAmount,
        kind: 'tax',
      },
      {
        code: 'management_fee',
        label: 'Gastos de gestión',
        amount: managementFee,
        kind: 'fee',
      },
    ],
    stripeLineItems: managementFee > 0
      ? [{
          code: 'management_fee',
          label: 'Gastos de gestión',
          unitAmount: managementFee,
          quantity: 1,
        }]
      : [],
  };
};

const getPalmBaseUnitPrice = (config: any, group: Pick<PalmPricingGroup, 'species' | 'height'>): number => {
  const precioPorHora = getPrecioPorHora(config);
  const useYield =
    getPricingMethod(config, { allowLegacyYieldCalculation: true }) === 'per_hour' &&
    config?.yield_units_per_hour &&
    precioPorHora > 0;
  if (useYield) {
    // findPalmYield y no acceso directo por clave: la banda puede llegar con sufijo 'm'
    // (formulario manual, reservas guardadas) y el acceso literal la daba por no cubierta.
    const yieldPerUnit = findPalmYield(config, group.species, group.height);
    return calculatePriceFromYield(1, yieldPerUnit, precioPorHora);
  }
  return findPalmPrice(config, group.species, group.height);
};

const buildPalmQuoteMetadata = (
  bookingGroups: NonNullable<SerializableBookingData['palmGroups']>,
  pricingGroups: PalmPricingGroup[],
  config: any,
): BookingQuoteMetadata => {
  const palmGroups = pricingGroups.map((group, index) => {
    const bookingGroup = bookingGroups[index];
    const quantity = Math.max(0, Number(group.quantity || 0));
    const isTerminalOpenRange =
      Boolean(bookingGroup?.isTerminalOpenRange) ||
      isHighestOpenRangeForSpecies(group.species || '', group.height || '');
    const isPriced = getPalmBaseUnitPrice(config, group) > 0;

    return {
      id: bookingGroup?.id,
      species: group.species,
      height: group.height,
      quantity,
      isTerminalOpenRange,
      isPriced,
    };
  });

  const requestedPalmGroups = palmGroups.filter((group) => group.quantity > 0);
  const coveredPalmGroups = requestedPalmGroups.filter((group) => group.isPriced);

  return {
    pricingContext: {
      serviceType: palmGroups.length > 0 ? 'palm_pruning' : 'standard',
      allowsPriceChange: coveredPalmGroups.some((group) => group.isTerminalOpenRange),
      palmGroups,
    },
    palmCoverage: {
      isFull: requestedPalmGroups.length === coveredPalmGroups.length,
      coveredCount: coveredPalmGroups.length,
      totalCount: requestedPalmGroups.length,
      missingGroups: requestedPalmGroups.filter((group) => !group.isPriced),
    },
  };
};

const calculateWeedingQuote = (params: {
  zones: Array<{ id?: string; area: number; state?: string; applyHerbicide?: boolean }>;
  config: any;
  globalWaste: boolean;
}) => {
  const zones = Array.isArray(params.zones) ? params.zones : [];
  const pricePerM2 = Math.max(0, toSafeNumber(params.config?.precio_desbroce_m2));
  const herbicidePerM2 = Math.max(0, toSafeNumber(params.config?.precio_herbicida_m2));
  const yieldPerHour = Math.max(0, toSafeNumber(params.config?.yield_m2_per_hour));
  const minimumPrice = Math.max(0, toSafeNumber(params.config?.importe_minimo));
  const difficultyMedia = Math.max(0, toSafeNumber(params.config?.suplementos?.dificultad_media));
  const difficultyAlta = Math.max(0, toSafeNumber(params.config?.suplementos?.dificultad_alta));
  const wastePercent = params.globalWaste ? Math.max(0, toSafeNumber(params.config?.suplementos?.retirada_restos)) : 0;

  let totalBeforeMinimum = 0;
  let totalEstimatedHours = 0;

  zones.forEach((zone) => {
    const area = Math.max(0, toSafeNumber(zone.area));
    const state = normalizeWeedingState(zone.state);
    const applyHerbicide = Boolean(zone.applyHerbicide);
    const base = area * pricePerM2;
    const herbicide = applyHerbicide ? area * herbicidePerM2 : 0;
    const statePercent = state === 'dificultad_alta' ? difficultyAlta : state === 'dificultad_media' ? difficultyMedia : 0;
    const stateMultiplier = 1 + statePercent / 100;
    const wasteMultiplier = 1 + wastePercent / 100;
    totalBeforeMinimum += (base + herbicide) * stateMultiplier * wasteMultiplier;
    totalEstimatedHours += yieldPerHour > 0 ? (area / yieldPerHour) * stateMultiplier * wasteMultiplier : 0;
  });

  const minimumApplied = minimumPrice > 0 && totalBeforeMinimum > 0 && totalBeforeMinimum < minimumPrice;
  return {
    finalPrice: Math.ceil(minimumApplied ? minimumPrice : totalBeforeMinimum),
    totalEstimatedHours,
  };
};

const normalizeDetailedPhytosanitaryPricing = (raw?: any): PhytosanitaryDetailedPricing => {
  if (!raw) return EMPTY_DETAILED_PHYTOSANITARY_PRICING;
  return {
    cesped: { ...EMPTY_DETAILED_PHYTOSANITARY_PRICING.cesped, ...(raw.cesped || {}) },
    setos: { ...EMPTY_DETAILED_PHYTOSANITARY_PRICING.setos, ...(raw.setos || {}) },
    palmeras: { ...EMPTY_DETAILED_PHYTOSANITARY_PRICING.palmeras, ...(raw.palmeras || {}) },
    arboles: { ...EMPTY_DETAILED_PHYTOSANITARY_PRICING.arboles, ...(raw.arboles || {}) },
    plantas: { ...EMPTY_DETAILED_PHYTOSANITARY_PRICING.plantas, ...(raw.plantas || {}) },
  };
};

/**
 * Convierte una configuración v1 (tablas por banda y tipo de producto) a la tabla única
 * `detailed_pricing` que usa el motor desde 2026-09-12.
 *
 * La v1 no distinguía preventivo de curativo —el precio dependía del PRODUCTO, no de la
 * intención—, así que ambos heredan la tarifa del insecticida, que era la que se aplicaba
 * por defecto: un profesional que nunca haya abierto el configurador nuevo sigue cobrando
 * exactamente lo que cobraba. Sin esta conversión, su `detailed_pricing` estaría vacío y el
 * motor le devolvería «Tarifa base no configurada», dejándolo fuera del mercado en silencio.
 */
const detailedPricingFromLegacyConfig = (raw: any): Partial<PhytosanitaryDetailedPricing> | null => {
  if (!raw?.superficies_plantas && !raw?.setos && !raw?.arboles && !raw?.palmeras?.tradicional) return null;

  const base = (bucket: any) => Number(bucket?.insecticida ?? bucket?.fungicida ?? bucket?.ecologico_preventivo ?? 0);
  const surfaceSmall = base(raw?.superficies_plantas?.hasta_100m2);
  const surfaceLarge = base(raw?.superficies_plantas?.mas_de_100m2) || surfaceSmall;
  const hedgeLow = base(raw?.setos?.hasta_2m);
  const hedgeHigh = base(raw?.setos?.mas_de_2m) || hedgeLow;
  const treeLow = base(raw?.arboles?.hasta_3m);
  const treeHigh = base(raw?.arboles?.mas_de_3m) || treeLow;
  const palmLow = Number(raw?.palmeras?.tradicional?.hasta_3m || 0);
  const palmHigh = Number(raw?.palmeras?.tradicional?.mas_de_3m || 0) || palmLow;

  return {
    cesped: { minimo: 0, preventivo: surfaceSmall, curativo: surfaceSmall },
    plantas: {
      minimo: 0,
      pequenas_preventivo: surfaceSmall, pequenas_curativo: surfaceSmall,
      medianas_preventivo: surfaceLarge, medianas_curativo: surfaceLarge,
      grandes_preventivo: surfaceLarge, grandes_curativo: surfaceLarge,
    },
    setos: {
      minimo: 0,
      bajos_preventivo: hedgeLow, bajos_curativo: hedgeLow,
      altos_preventivo: hedgeHigh, altos_curativo: hedgeHigh,
    },
    arboles: {
      minimo: 0,
      pequenos_preventivo: treeLow, pequenos_curativo: treeLow,
      medianos_preventivo: treeHigh, medianos_curativo: treeHigh,
      grandes_preventivo: treeHigh, grandes_curativo: treeHigh,
    },
    palmeras: {
      minimo: 0,
      pequenas_preventivo: palmLow, pequenas_curativo: palmLow,
      medianas_preventivo: palmHigh, medianas_curativo: palmHigh,
      altas_preventivo: palmHigh, altas_curativo: palmHigh,
      pequenas_cirugia: 0, medianas_cirugia: 0, altas_cirugia: 0,
    },
  } as Partial<PhytosanitaryDetailedPricing>;
};

const normalizePhytosanitaryPricingConfig = (raw?: any): PhytosanitaryNormalizedConfig => {
  const hasDetailed = raw?.detailed_pricing && Object.keys(raw.detailed_pricing).length > 0;
  const detailed = normalizeDetailedPhytosanitaryPricing(
    hasDetailed ? raw.detailed_pricing : (detailedPricingFromLegacyConfig(raw) ?? raw?.detailed_pricing),
  );
  // Un mínimo puesto a 0 a propósito debe respetarse, así que `??` y no `||`. Las tres claves
  // son el mismo concepto con tres nombres heredados; se resuelven aquí, en un solo sitio.
  const inferredMin = Number(raw?.minimum_fee ?? raw?.importe_minimo ?? raw?.minimum_price ?? 0);

  return {
    importe_minimo: inferredMin,
    minimum_fee: inferredMin,
    tratamientos_activos: (raw?.tratamientos_activos || ['insecticida', 'fungicida', 'ecologico_preventivo']).filter(Boolean),
    palmeras: {
      endoterapia: {
        precio_unico: Number(raw?.palmeras?.endoterapia?.precio_unico || detailed.palmeras.pequenas_cirugia || 0),
      },
    },
    pricing_modifiers: {
      eco: { percentage: Number(raw?.pricing_modifiers?.eco?.percentage || 0) },
    },
    detailed_pricing: detailed,
  };
};

const normalizePhytosanitaryAffectedType = (value: string | undefined | null): PhytosanitaryAffectedType => {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('palmera')) return 'Palmeras';
  if (normalized.includes('árbol') || normalized.includes('arbol')) return 'Árboles';
  if (normalized.includes('seto')) return 'Setos';
  if (normalized.includes('planta')) return 'Plantas bajas';
  return 'Césped';
};


const formatPhytosanitaryLabel = (item: PhytosanitaryQuoteBreakdownItem) => {
  if (item.quantity === 1 && item.unitLabel === 'ud' && typeof item.subtotal === 'number') {
    return `Zona ${item.zoneIndex + 1}: desglose detallado · base ${roundUp(item.subtotal)}€`;
  }
  const treatmentLabel = item.appliedTreatments?.length ? item.appliedTreatments.join(' + ') : 'sin tratamiento';
  return `Zona ${item.zoneIndex + 1}: ${item.affectedType} · ${item.quantity}${item.unitLabel} · ${treatmentLabel}`;
};

/**
 * Ámbitos que factura este servicio. Cada uno tiene su tabla de precios en
 * `detailed_pricing`, su rendimiento y su mínimo propio.
 */
type PhytosanitaryScope = 'cesped' | 'plantas' | 'setos' | 'arboles' | 'palmeras';

/** Superficie/cantidad por encima de la cual conviene que el cliente confirme la medida. */
const PHYTOSANITARY_MAX_PLAUSIBLE_AREA = 5000;


/**
 * Traduce una zona declarada a mano a las mismas métricas que produce el análisis de fotos.
 *
 * Existe para que los dos caminos usen UNA sola tabla de precios (`detailed_pricing`). Antes
 * el camino manual iba por unas estructuras derivadas que cobraban la tarifa CURATIVA a los
 * tratamientos preventivos y la tarifa de CÉSPED a las plantas bajas, así que el mismo
 * trabajo costaba cosas distintas según entrara por fotos o por el formulario.
 *
 * Las bandas admiten un tamaño explícito (`sizeBand`) y, si no viene —zonas antiguas y el
 * builder manual previo a esta auditoría—, caen al interruptor de altura, que es la única
 * pista que esas zonas traían.
 */
const derivePhytosanitaryMetricsFromZone = (
  zone: any,
  affected: PhytosanitaryAffectedType,
): Record<string, any> => {
  const qty = Number(zone?.area || 0);
  if (qty <= 0) return {};
  const isTall = Boolean(zone?.aboveTwoMeters ?? zone?.aboveThreeMeters);
  const band = String(zone?.sizeBand || '').toLowerCase();

  switch (affected) {
    case 'Césped':
      return { cesped_m2: qty };
    case 'Plantas bajas':
      return {
        plantas_superficie_calculada_m2: qty,
        plantas_tamano_dominante: ['pequenas', 'medianas', 'grandes'].includes(band) ? band : 'pequenas',
      };
    case 'Setos':
      return isTall ? { seto_alto_ml: qty } : { seto_bajo_medio_ml: qty };
    case 'Árboles':
      if (band === 'grandes') return { arboles_gran_ud: qty };
      if (band === 'medianos') return { arboles_med_ud: qty };
      if (band === 'pequenos') return { arboles_peq_ud: qty };
      return isTall ? { arboles_med_ud: qty } : { arboles_peq_ud: qty };
    case 'Palmeras':
    default: {
      // La endoterapia se factura por tronco inyectado, aparte del tratamiento por
      // pulverización: si el cliente pide las dos cosas, la zona lleva las dos métricas.
      const wantsEndotherapy =
        Boolean(zone?.wantsEndotherapy) || String(zone?.type || '').toLowerCase().includes('endoterapia');
      const endotherapy = wantsEndotherapy ? { palmeras_endoterapia_troncos_ud: qty } : {};
      // Endoterapia sola: el cliente no pidió ducha, así que no se le cobra una.
      const onlyEndotherapy = wantsEndotherapy && !zone?.intent && !zone?.requestedTreatment;
      if (onlyEndotherapy) return endotherapy;
      if (band === 'altas') return { palmeras_ducha_alta_ud: qty, ...endotherapy };
      if (band === 'medianas') return { palmeras_ducha_med_ud: qty, ...endotherapy };
      if (band === 'pequenas') return { palmeras_ducha_peq_ud: qty, ...endotherapy };
      return isTall
        ? { palmeras_ducha_med_ud: qty, ...endotherapy }
        : { palmeras_ducha_peq_ud: qty, ...endotherapy };
    }
  }
};

/** Métricas efectivas de una zona: las del análisis, o las derivadas de la declaración manual. */
const resolvePhytosanitaryMetrics = (zone: any, affected: PhytosanitaryAffectedType) => {
  const metrics = zone?.analysisMetrics || {};
  const hasAny = [
    metrics.cesped_m2,
    metrics.plantas_superficie_calculada_m2,
    metrics.seto_bajo_medio_ml,
    metrics.seto_alto_ml,
    metrics.palmeras_ducha_peq_ud,
    metrics.palmeras_ducha_med_ud,
    metrics.palmeras_ducha_alta_ud,
    metrics.palmeras_cirugia_ud,
    metrics.palmeras_endoterapia_troncos_ud,
    metrics.arboles_peq_ud,
    metrics.arboles_med_ud,
    metrics.arboles_gran_ud,
  ].some((value) => Number(value || 0) > 0);
  return hasAny ? metrics : derivePhytosanitaryMetricsFromZone(zone, affected);
};

/** Ámbitos con cantidad declarada en unas métricas. Sirve para el mínimo por ámbito. */
const scopesPresentInMetrics = (metrics: Record<string, any>): PhytosanitaryScope[] => {
  const scopes: PhytosanitaryScope[] = [];
  if (Number(metrics.cesped_m2 || 0) > 0) scopes.push('cesped');
  if (Number(metrics.plantas_superficie_calculada_m2 || 0) > 0) scopes.push('plantas');
  if (Number(metrics.seto_bajo_medio_ml || 0) > 0 || Number(metrics.seto_alto_ml || 0) > 0) scopes.push('setos');
  if (
    Number(metrics.arboles_peq_ud || 0) > 0 ||
    Number(metrics.arboles_med_ud || 0) > 0 ||
    Number(metrics.arboles_gran_ud || 0) > 0
  ) scopes.push('arboles');
  if (
    Number(metrics.palmeras_ducha_peq_ud || 0) > 0 ||
    Number(metrics.palmeras_ducha_med_ud || 0) > 0 ||
    Number(metrics.palmeras_ducha_alta_ud || 0) > 0 ||
    Number(metrics.palmeras_cirugia_ud || 0) > 0 ||
    Number(metrics.palmeras_endoterapia_troncos_ud || 0) > 0
  ) scopes.push('palmeras');
  return scopes;
};

/** Horas de una zona a partir de sus métricas efectivas y los rendimientos del jardinero. */
const phytosanitaryHoursFromMetrics = (metrics: Record<string, any>, yields: any) => {
  let hours = 0;
  const add = (qty: any, rate: any) => {
    const q = Number(qty || 0);
    const r = Number(rate || 0);
    if (q > 0 && r > 0) hours += q / r;
  };
  add(metrics.cesped_m2, yields?.cesped_m2_per_hour);
  // El rendimiento de plantas existía y estaba configurado, pero este sumando faltaba: un
  // tratamiento de plantas reservado con fotos bloqueaba el mínimo de 1 h en vez de sus horas.
  add(metrics.plantas_superficie_calculada_m2, yields?.plantas_m2_per_hour);
  add(metrics.seto_bajo_medio_ml, yields?.setos_ml_per_hour);
  add(metrics.seto_alto_ml, yields?.setos_ml_per_hour);
  add(metrics.palmeras_ducha_peq_ud, yields?.palmeras_units_per_hour);
  add(metrics.palmeras_ducha_med_ud, yields?.palmeras_units_per_hour);
  add(metrics.palmeras_ducha_alta_ud, yields?.palmeras_units_per_hour);
  add(metrics.palmeras_cirugia_ud, yields?.palmeras_units_per_hour);
  add(metrics.palmeras_endoterapia_troncos_ud, yields?.endoterapia_units_per_hour);
  add(metrics.arboles_peq_ud, yields?.arboles_units_per_hour);
  add(metrics.arboles_med_ud, yields?.arboles_units_per_hour);
  add(metrics.arboles_gran_ud, yields?.arboles_units_per_hour);
  return hours;
};

const calculatePhytosanitaryQuote = (params: {
  zones: SerializableBookingData['phytosanitaryZones'];
  config: unknown;
  globalWaste: boolean;
}): PhytosanitaryQuoteResult => {
  const normalized = normalizePhytosanitaryPricingConfig(params.config as any);
  const ecoModifierPercent = Number(normalized.pricing_modifiers?.eco?.percentage || 0);
  const breakdown: PhytosanitaryQuoteBreakdownItem[] = [];
  let totalBeforeMinimum = 0;

  (params.zones || []).forEach((zone: any, index) => {
    const affected = normalizePhytosanitaryAffectedType(zone?.affectedType);
    // Fallback de derivación desde zone.type (flujo de fotos legacy): las zonas creadas
    // en DetailsPage guardaban el tratamiento en `type` ('fungicida', 'insecticida+fungicida',
    // '…+ecologico_preventivo', 'endoterapia') sin rellenar intent/curativeTarget/
    // productPreference, así que TODAS caían al default preventivo+insecticida.
    const typeStr = String(zone?.type || '').toLowerCase();
    const typeHasInsecticide = typeStr.includes('insecticida');
    const typeHasFungicide = typeStr.includes('fungicida');
    const derivedIntent: 'preventive' | 'curative' | undefined =
      typeHasFungicide ? 'curative' : undefined;
    const derivedTarget: 'insects' | 'fungus' | 'both' | undefined =
      typeHasInsecticide && typeHasFungicide ? 'both'
        : typeHasFungicide ? 'fungus'
          : undefined;

    const intent = zone?.intent || derivedIntent || 'preventive';
    const isCurative = intent === 'curative';
    const isWeedControl = intent === 'weed_control';
    const curativeTarget = zone?.curativeTarget || (isCurative ? derivedTarget || 'insects' : undefined);
    const isEco = zone?.productPreference
      ? zone.productPreference === 'ecological'
      : typeStr.includes('ecologico_preventivo');

    const metrics = resolvePhytosanitaryMetrics(zone, affected);
    const wantsEndotherapy =
      affected === 'Palmeras' &&
      (typeStr.includes('endoterapia') || Number(metrics.palmeras_endoterapia_troncos_ud || 0) > 0);
    // Endoterapia pura: el cliente pidió solo la inyección en tronco (precio único por
    // tronco); no debe arrastrar además el tratamiento de ducha base.
    const isEndoOnlyRequest = wantsEndotherapy && !typeHasInsecticide && !typeHasFungicide && !zone?.intent;

    // Tratamientos BASE facturables: cada uno es una aplicación completa sobre la superficie.
    const requestedTreatments: PhytosanitaryTreatment[] = [];
    if (isEndoOnlyRequest) {
      // Solo la inyección; se factura aparte, por tronco.
    } else if (isWeedControl) {
      requestedTreatments.push('ecologico_preventivo');
    } else if (isEco && !isCurative) {
      requestedTreatments.push('ecologico_preventivo');
    } else if (isCurative) {
      if (curativeTarget === 'insects' || curativeTarget === 'both') requestedTreatments.push('insecticida');
      if (curativeTarget === 'fungus' || curativeTarget === 'both') requestedTreatments.push('fungicida');
    } else {
      requestedTreatments.push('insecticida');
    }

    const effectiveTreatments = requestedTreatments.filter((treatment) =>
      normalized.tratamientos_activos.includes(treatment));
    const endotherapyActive = wantsEndotherapy && normalized.tratamientos_activos.includes('endoterapia');
    const appliedTreatments: PhytosanitaryTreatment[] = [...effectiveTreatments];
    if (endotherapyActive) appliedTreatments.push('endoterapia');

    const unitLabel: 'm2' | 'ml' | 'ud' =
      affected === 'Palmeras' || affected === 'Árboles' ? 'ud' : (affected === 'Setos' ? 'ml' : 'm2');
    const declaredQty = Number(zone?.area || 0);
    const scopes = scopesPresentInMetrics(metrics);

    if (!scopes.length || (!appliedTreatments.length)) {
      breakdown.push({
        zoneIndex: index,
        affectedType: affected,
        requestedTreatments,
        appliedTreatments: [],
        quantity: declaredQty,
        unitLabel,
        unitPrice: null,
        subtotal: null,
        lineTotal: null,
        reason: !scopes.length ? 'Cantidad o superficie inválida' : 'No hay tratamientos compatibles activos',
      });
      return;
    }

    const detailed = normalized.detailed_pricing;
    const priceFor = (category: any, preventiveField: string, curativeField: string) =>
      Number(category?.[isCurative ? curativeField : preventiveField] || 0);
    const plantasSize = metrics.plantas_tamano_dominante || 'pequenas';

    // Coste de UNA aplicación sobre todo lo declarado en la zona.
    const singleTreatmentBase =
      Number(metrics.cesped_m2 || 0) * priceFor(detailed.cesped, 'preventivo', 'curativo') +
      Number(metrics.plantas_superficie_calculada_m2 || 0) * priceFor(detailed.plantas, `${plantasSize}_preventivo`, `${plantasSize}_curativo`) +
      Number(metrics.seto_bajo_medio_ml || 0) * priceFor(detailed.setos, 'bajos_preventivo', 'bajos_curativo') +
      Number(metrics.seto_alto_ml || 0) * priceFor(detailed.setos, 'altos_preventivo', 'altos_curativo') +
      Number(metrics.palmeras_ducha_peq_ud || 0) * priceFor(detailed.palmeras, 'pequenas_preventivo', 'pequenas_curativo') +
      Number(metrics.palmeras_ducha_med_ud || 0) * priceFor(detailed.palmeras, 'medianas_preventivo', 'medianas_curativo') +
      Number(metrics.palmeras_ducha_alta_ud || 0) * priceFor(detailed.palmeras, 'altas_preventivo', 'altas_curativo') +
      Number(metrics.arboles_peq_ud || 0) * priceFor(detailed.arboles, 'pequenos_preventivo', 'pequenos_curativo') +
      Number(metrics.arboles_med_ud || 0) * priceFor(detailed.arboles, 'medianos_preventivo', 'medianos_curativo') +
      Number(metrics.arboles_gran_ud || 0) * priceFor(detailed.arboles, 'grandes_preventivo', 'grandes_curativo');

    // Intervenciones que se cobran por pieza, no por aplicación sobre la superficie: no se
    // multiplican por el número de tratamientos ni cuentan como uno de ellos.
    const surgeryTotal = Number(metrics.palmeras_cirugia_ud || 0) * Math.max(
      Number(detailed.palmeras.pequenas_cirugia || 0),
      Number(detailed.palmeras.medianas_cirugia || 0),
      Number(detailed.palmeras.altas_cirugia || 0),
    );
    const endotherapyTotal = endotherapyActive
      ? Number(metrics.palmeras_endoterapia_troncos_ud || 0) * Number(normalized.palmeras.endoterapia.precio_unico || 0)
      : 0;

    // Regla de negocio (decidida 2026-09-12): pedir insecticida Y fungicida son DOS
    // tratamientos facturables independientes — se suma el precio de cada uno y no se aplica
    // ningún porcentaje extra por combinarlos.
    const subtotal = singleTreatmentBase * effectiveTreatments.length + surgeryTotal + endotherapyTotal;

    if (subtotal <= 0) {
      breakdown.push({
        zoneIndex: index,
        affectedType: affected,
        requestedTreatments,
        appliedTreatments,
        quantity: declaredQty,
        unitLabel,
        unitPrice: null,
        subtotal: null,
        lineTotal: null,
        reason: 'Tarifa base no configurada',
      });
      return;
    }

    // El recargo eco es una preferencia de producto: aplica también en curativos eco.
    const ecoApplied = isEco || effectiveTreatments.includes('ecologico_preventivo');
    const ecoMult = ecoApplied ? (1 + (ecoModifierPercent / 100)) : 1;

    // Mínimo por ámbito: el jardinero fija un suelo por tipo de vegetación porque desplazarse
    // a tratar cuatro palmeras no cuesta lo mismo que tratar cuatro metros de seto.
    const scopeMinimum = scopes.reduce(
      (max, scope) => Math.max(max, Number((detailed as any)[scope]?.minimo || 0)),
      0,
    );
    const lineTotal = Math.max(subtotal * ecoMult, scopeMinimum);
    totalBeforeMinimum += lineTotal;

    breakdown.push({
      zoneIndex: index,
      affectedType: affected,
      requestedTreatments,
      appliedTreatments,
      quantity: declaredQty || 1,
      unitLabel,
      unitPrice: singleTreatmentBase,
      subtotal,
      lineTotal,
    });
  });

  const rounded = Math.ceil(Math.round(totalBeforeMinimum * 100) / 100);
  const minimumFee = Number(normalized.minimum_fee || 0);
  const minimumFeeApplied = minimumFee > 0 && rounded > 0 && rounded < minimumFee;

  return {
    total: minimumFeeApplied ? Math.ceil(minimumFee) : rounded,
    totalBeforeMinimum,
    minimumFeeApplied,
    minimumFee: minimumFee > 0 ? Math.ceil(minimumFee) : 0,
    breakdown,
  };
};

export function buildAuthoritativeBookingQuote(params: {
  bookingData: SerializableBookingData;
  providerConfig: any;
}): BookingQuoteResult {
  const { bookingData, providerConfig } = params;
  const config = providerConfig;
  const globalWaste = bookingData.wasteRemoval !== undefined ? bookingData.wasteRemoval : true;
  const breakdown: BookingQuoteLine[] = [];
  const warnings: BookingQuoteWarning[] = [];
  let metadata = buildDefaultQuoteMetadata();

  if (!config) {
    return buildIneligibleQuote(
      'missing_provider_config',
      'El profesional no tiene una configuración operativa válida para este servicio.',
      metadata,
    );
  }

  if (!hasRequestedBookingWork(bookingData)) {
    return buildIneligibleQuote(
      'missing_service_payload',
      'Faltan datos operativos del servicio para calcular un presupuesto autoritativo.',
      metadata,
    );
  }

  const pushWarning = (code: string, message: string) => {
    if (!warnings.some((item) => item.code === code && item.message === message)) {
      warnings.push({ code, message });
    }
  };

  let totalHours = 0;
  const palmGroups: PalmPricingGroup[] = (bookingData.palmGroups || []).map((group) => ({
    species: group.species,
    height: group.height,
    quantity: group.quantity || 1,
    state: group.state || 'normal',
    hasPhytosanitary: group.hasPhytosanitary ?? group.needsPhytosanitary,
    hasTrunkPeeling: group.hasTrunkPeeling ?? group.needsTrunkFinish,
    needsPhytosanitary: group.needsPhytosanitary,
    needsTrunkFinish: group.needsTrunkFinish,
    hasAccessDifficulty: group.hasAccessDifficulty,
    isTerminalOpenRange: group.isTerminalOpenRange,
  }));
  if (bookingData.palmGroups?.length) {
    metadata = buildPalmQuoteMetadata(bookingData.palmGroups, palmGroups, config);
    if (!metadata.palmCoverage?.isFull) {
      return buildIneligibleQuote(
        'partial_palm_coverage',
        'La configuración del profesional no cubre todas las palmeras solicitadas.',
        metadata,
      );
    }
  }
  const pricedPalmGroups = palmGroups.filter((_, index) => metadata.pricingContext.palmGroups[index]?.isPriced);

  const validTrees = bookingData.treeGroups
    ?.filter((tree: any) => !(tree.isFailed || tree.analysisLevel === 3))
    .flatMap((tree: any) => {
      const sizeBand = resolveTreeBand(tree);
      if (!sizeBand) return [];
      // Cantidad confirmada por el cliente: un grupo puede representar N árboles idénticos.
      const quantity = Math.max(1, Math.trunc(Number(tree.quantity) || 1));
      return Array.from({ length: quantity }, (_, unitIndex) => ({
        id: unitIndex === 0 ? String(tree.id) : `${tree.id}-${unitIndex}`,
        pruningType: mapTreePruningType(tree.pruningType),
        sizeBand,
        dificultad_alta: Boolean(tree.difficultyHigh),
        nivel_analisis: tree.analysisLevel,
      }));
    }) || [];
  const treeQuote =
    validTrees.length > 0 && isTreePruningConfig(config)
      ? calculateTreePruningQuoteForTrees(config, validTrees, globalWaste)
      : null;

  if (bookingData.treeGroups?.length) {
    if (!isTreePruningConfig(config)) {
      return buildIneligibleQuote(
        'invalid_tree_config',
        'La poda de árboles requiere una configuración completa de precios y dificultad.',
        metadata,
      );
    }
    if (validTrees.length === 0 || !treeQuote?.isProfessionalSuitable) {
      return buildIneligibleQuote(
        'invalid_tree_config',
        'La configuración del profesional no permite cotizar los árboles solicitados.',
        metadata,
      );
    }
  }

  if (bookingData.lawnZones?.length) {
    const usesHourlyPricing = getPricingMethod(config) === 'per_hour';
    if (!hasPositiveNumber(config.yield_m2_per_hour)) {
      return buildIneligibleQuote(
        'missing_yield_config',
        'El servicio de césped requiere rendimiento por m2/hora configurado.',
        metadata,
      );
    }
    if (usesHourlyPricing) {
      if (!hasPositiveNumber(getPrecioPorHora(config))) {
        return buildIneligibleQuote(
          'missing_pricing_config',
          'El servicio de césped por horas requiere una tarifa horaria válida.',
          metadata,
        );
      }
    } else if (!hasPositiveNumber(config.price_per_m2)) {
      return buildIneligibleQuote(
        'missing_pricing_config',
        'El servicio de césped requiere un precio por m2 válido.',
        metadata,
      );
    }
  }

  if (bookingData.hedgeZones?.length) {
    const pricingMethod = getPricingMethod(config);
    const yields = config.yield_ml_per_hour || {};
    for (const zone of bookingData.hedgeZones) {
      const height = zone.height || '0-2m';
      if (pricingMethod === 'per_hour') {
        if (!hasPositiveNumber(getPrecioPorHora(config))) {
          return buildIneligibleQuote(
            'missing_pricing_config',
            'El servicio de setos por horas requiere una tarifa horaria válida.',
            metadata,
          );
        }
      } else {
        const base = Number(config.pricing_matrix?.[height] || config.species_prices?.[zone.type]?.[height] || 0);
        if (!(base > 0)) {
          return buildIneligibleQuote(
            'missing_pricing_config',
            'El servicio de setos requiere una matriz de precios completa para la altura solicitada.',
            metadata,
          );
        }
      }
      if (!hasPositiveNumber(yields[height])) {
        return buildIneligibleQuote(
          'missing_yield_config',
          'El servicio de setos requiere rendimientos configurados para cada altura ofertada.',
          metadata,
        );
      }
    }
  }

  if (bookingData.weedingZones?.length) {
    if (!hasPositiveNumber(config.precio_desbroce_m2)) {
      return buildIneligibleQuote(
        'missing_pricing_config',
        'El desbroce requiere un precio por m2 válido.',
        metadata,
      );
    }
    if (!hasPositiveNumber(config.yield_m2_per_hour)) {
      return buildIneligibleQuote(
        'missing_yield_config',
        'El desbroce requiere un rendimiento por m2/hora válido.',
        metadata,
      );
    }
    if ((bookingData.weedingZones || []).some((zone) => zone.applyHerbicide) && !hasPositiveNumber(config.precio_herbicida_m2)) {
      return buildIneligibleQuote(
        'missing_pricing_config',
        'El desbroce con herbicida requiere una tarifa de herbicida válida.',
        metadata,
      );
    }
  }

  if (bookingData.shrubGroups?.length) {
    const pricingMethod = getPricingMethod(config);
    const pricesPerM2 = config.prices_per_m2 || {};
    const yieldsBySize = config.yield_m2_per_hour || {};
    if (pricingMethod === 'per_hour' && !hasPositiveNumber(getPrecioPorHora(config))) {
      return buildIneligibleQuote(
        'missing_pricing_config',
        'La poda de arbustos por horas requiere una tarifa horaria válida.',
        metadata,
      );
    }
    for (const group of bookingData.shrubGroups) {
      const size = String(group.size || 'pequeñas');
      if (pricingMethod !== 'per_hour' && !hasPositiveNumber(pricesPerM2[size])) {
        return buildIneligibleQuote(
          'missing_pricing_config',
          'La poda de arbustos requiere precios válidos por tamaño.',
          metadata,
        );
      }
      if (!hasPositiveNumber(yieldsBySize[size])) {
        return buildIneligibleQuote(
          'missing_yield_config',
          'La poda de arbustos requiere rendimientos válidos por tamaño.',
          metadata,
        );
      }
    }
  }

  if (bookingData.phytosanitaryZones?.length) {
    const normalizedPhytosanitary = normalizePhytosanitaryPricingConfig(config);
    const activeTreatments = normalizedPhytosanitary.tratamientos_activos || [];
    if (activeTreatments.length === 0) {
      return buildIneligibleQuote(
        'missing_treatment_config',
        'Los servicios fitosanitarios requieren tratamientos activos configurados.',
        metadata,
      );
    }
    const yields = config.yields || {};
    const missingYield = getRequestedPhytosanitaryYieldKeys(bookingData.phytosanitaryZones).find(
      (key) => !hasPositiveNumber(yields[key]),
    );
    if (missingYield) {
      return buildIneligibleQuote(
        'missing_yield_config',
        'Los servicios fitosanitarios requieren rendimientos completos para el trabajo solicitado.',
        metadata,
      );
    }
  }

  if (bookingData.lawnZones?.length) {
    const yieldM2 = Number(config.yield_m2_per_hour);
    const lawnWasteMult = globalWaste ? 1 + Number(config.waste_removal?.percentage || 0) / 100 : 1;
    // El % de condition_surcharges es tiempo Y precio a la vez: si el trabajo tarda un 50 %
    // más, cuesta un 50 % más, y viceversa — no dos magnitudes independientes. Por eso las
    // horas usan aquí la MISMA resolución que el precio (mismos fallbacks, más abajo en este
    // bloque) en vez de un multiplicador fijo (setos, arbustos y desbroce corregidos con el
    // mismo patrón en auditorías posteriores — ver sus propios bloques más abajo): un fijo
    // es lo que hacía que un jardinero con un recargo distinto del 20/50 % por defecto
    // reservara un tiempo que no correspondía a lo que cobraba.
    const lawnSurcharges = config.condition_surcharges || {};
    bookingData.lawnZones.forEach((zone) => {
      const state = String(zone.state || 'normal').toLowerCase();
      let lawnStatePercent = 0;
      if (state.includes('muy')) lawnStatePercent = resolveSurchargePercent(lawnSurcharges.muy_descuidado, 50);
      else if (state.includes('descuidad')) lawnStatePercent = resolveSurchargePercent(lawnSurcharges.descuidado, 20);
      const lawnDurationMult = 1 + lawnStatePercent / 100;
      if (zone.quantity > 0) totalHours += (zone.quantity / yieldM2) * lawnDurationMult * lawnWasteMult;
      if (Number(zone.quantity) > LAWN_MAX_PLAUSIBLE_AREA_M2) {
        pushWarning(
          'lawn_area_implausible',
          `La superficie declarada (${zone.quantity} m²) supera lo habitual para un jardín residencial (${LAWN_MAX_PLAUSIBLE_AREA_M2} m²): confirma la medida antes de continuar.`,
        );
      }
    });
  }

  if (bookingData.hedgeZones?.length) {
    const yields = config.yield_ml_per_hour || {};
    const hedgeWasteMult = globalWaste ? 1 + Number(config.waste_removal?.percentage || 0) / 100 : 1;
    // Mismo stateMult que el bloque de precio (más abajo, `:1424`+ en el momento de este fix):
    // el % de condition_surcharges es tiempo y precio a la vez, igual que en césped más arriba.
    // Antes usaba el `getDurationMultiplier` fijo (1,3/1,7) — con la config sembrada (20/50 %)
    // eso reservaba hasta 2 h de más en un tramo largo sin que el precio reflejara esa hora
    // (auditoría 2026-09-11, hallazgo #1).
    const hedgeSurcharges = config.condition_surcharges || DEFAULT_HEDGE_SURCHARGES;
    bookingData.hedgeZones.forEach((zone) => {
      const height = zone.height || '0-2m';
      const yieldMl = Number(yields[height]);
      const length = Number(zone.length || 0);
      const faces = Number(zone.faces_to_trim || 1);
      const hedgeState = String(zone.state || 'normal').toLowerCase();
      let hedgeStatePercent = 0;
      if (hedgeState.includes('alta') || hedgeState.includes('muy_descuidado')) hedgeStatePercent = resolveSurchargePercent(hedgeSurcharges.alta, DEFAULT_HEDGE_SURCHARGES.alta);
      else if (hedgeState.includes('media') || hedgeState.includes('descuidado')) hedgeStatePercent = resolveSurchargePercent(hedgeSurcharges.media, DEFAULT_HEDGE_SURCHARGES.media);
      const hedgeDurationMult = 1 + hedgeStatePercent / 100;
      totalHours += (length * faces / yieldMl) * hedgeDurationMult * hedgeWasteMult;
      // Anti-alucinación: un seto declarado por fotos no pasa por el rango duro del flujo
      // manual (1-200 ml) — sin este aviso se facturaba cualquier longitud en silencio
      // (auditoría 2026-09-11, hallazgo #3). Mismo patrón que lawn_area_implausible arriba.
      if (length > HEDGE_MAX_PLAUSIBLE_LENGTH_M) {
        pushWarning(
          'hedge_length_implausible',
          `La longitud declarada (${length} ml) supera lo habitual para un seto residencial (${HEDGE_MAX_PLAUSIBLE_LENGTH_M} ml): confirma la medida antes de continuar.`,
        );
      }
    });
  }

  if (palmGroups.length) {
    totalHours += Number(calculatePalmHoursFromConfig(pricedPalmGroups, config, globalWaste) || 0);

    metadata.pricingContext.palmGroups.forEach((group) => {
      if (group.isPriced && group.quantity > 0 && group.isTerminalOpenRange) {
        pushWarning('palm_terminal_range', 'Precio aproximado: en el rango más alto de palmera el jardinero puede ajustar el importe y requerirá tu aceptación en el chat.');
      }
      // Anti-alucinación / declaración manual absurda: mismo patrón que lawn_area_implausible
      // y hedge_length_implausible (auditoría de palmeras 2026-09-11/12, hallazgo #2).
      if (group.quantity > PALM_MAX_PLAUSIBLE_QUANTITY) {
        pushWarning(
          'palm_quantity_implausible',
          `La cantidad declarada (${group.quantity} palmeras) supera lo habitual para un encargo residencial (${PALM_MAX_PLAUSIBLE_QUANTITY}): confirma la medida antes de continuar.`,
        );
      }
    });
  }

  if (treeQuote?.isProfessionalSuitable) {
    totalHours += Number(treeQuote.totalEstimatedHours || 0);
    treeQuote.overallWarnings.forEach((message) => {
      pushWarning('tree_complexity_review', message);
    });
  }

  if (bookingData.weedingZones?.length) {
    const yieldM2 = Number(config.yield_m2_per_hour);
    // El desbroce usa suplementos.retirada_restos (no waste_removal.percentage). La retirada
    // también consume tiempo: sin este multiplicador se bloqueaban slots de menos (§7.6).
    const weedingWasteMult = globalWaste ? 1 + Number(config.suplementos?.retirada_restos || 0) / 100 : 1;
    // Mismo stateMult que el bloque de precio (`calculateWeedingQuote`, más arriba): el % de
    // suplementos.dificultad_media/alta es tiempo y precio a la vez, igual que césped/setos/
    // arbustos. Antes usaba el `getDurationMultiplier` fijo (1,3/1,7) — con la config sembrada
    // (20/50 %) eso reservaba hasta 1,5-2 h de más sin que el precio reflejara esa hora
    // (auditoría 2026-09-12, hallazgo #2).
    const weedingDifficultyMedia = Math.max(0, toSafeNumber(config.suplementos?.dificultad_media));
    const weedingDifficultyAlta = Math.max(0, toSafeNumber(config.suplementos?.dificultad_alta));
    bookingData.weedingZones.forEach((zone) => {
      const weedingState = normalizeWeedingState(zone.state);
      const weedingStatePercent =
        weedingState === 'dificultad_alta'
          ? weedingDifficultyAlta
          : weedingState === 'dificultad_media'
            ? weedingDifficultyMedia
            : 0;
      const weedingDurationMult = 1 + weedingStatePercent / 100;
      totalHours += (Number(zone.area || 0) / yieldM2) * weedingDurationMult * weedingWasteMult;
      // Anti-alucinación: mismo patrón que lawn_area_implausible/hedge_length_implausible/
      // palm_quantity_implausible/shrub_area_implausible (auditoría de desbroce 2026-09-12,
      // hallazgo #3). Desbroce era el único de los 5 servicios de área/cantidad sin ninguno.
      if (Number(zone.area) > WEEDING_MAX_PLAUSIBLE_AREA_M2) {
        pushWarning(
          'weeding_area_implausible',
          `La superficie declarada (${zone.area} m²) supera lo habitual para una parcela residencial (${WEEDING_MAX_PLAUSIBLE_AREA_M2} m²): confirma la medida antes de continuar.`,
        );
      }
    });
  }

  if (bookingData.shrubGroups?.length) {
    const yields = config.yield_m2_per_hour || {};
    const shrubWasteMult = globalWaste ? 1 + Number(config.waste_removal?.percentage || 0) / 100 : 1;
    // Mismo stateMult que el bloque de precio (buildShrubBreakdown, más arriba): el % de
    // condition_surcharges es tiempo y precio a la vez. Antes usaba el getDurationMultiplier
    // fijo (1,3/1,7) — con la config sembrada (20/50 %) eso reservaba más tiempo del que el
    // precio reflejaba (auditoría 2026-09-12, hallazgo #3; mismo patrón que césped/setos).
    const shrubSurcharges = config.condition_surcharges || DEFAULT_SHRUB_SURCHARGES;
    bookingData.shrubGroups.forEach((group) => {
      const size = (group.size || 'pequeñas') as keyof typeof yields;
      const yieldM2 = Number(yields[size] || 0);
      const shrubState = String(group.state || 'normal').toLowerCase();
      let shrubStatePercent = 0;
      if (shrubState.includes('muy')) shrubStatePercent = resolveSurchargePercent(shrubSurcharges.alta, DEFAULT_SHRUB_SURCHARGES.alta);
      else if (shrubState.includes('descuidad')) shrubStatePercent = resolveSurchargePercent(shrubSurcharges.media, DEFAULT_SHRUB_SURCHARGES.media);
      const shrubDurationMult = 1 + shrubStatePercent / 100;
      totalHours += (Number(group.area || 0) / yieldM2) * shrubDurationMult * shrubWasteMult;
      if (Number(group.area) > SHRUB_MAX_PLAUSIBLE_AREA_M2) {
        pushWarning(
          'shrub_area_implausible',
          `La superficie declarada (${group.area} m²) supera lo habitual para un macizo residencial (${SHRUB_MAX_PLAUSIBLE_AREA_M2} m²): confirma la medida antes de continuar.`,
        );
      }
    });
  }

  if (bookingData.phytosanitaryZones?.length) {
    const yields = config.yields || {};
    bookingData.phytosanitaryZones.forEach((zone: any) => {
      // Las MISMAS métricas efectivas que factura `calculatePhytosanitaryQuote`, para que
      // precio y horas no puedan volver a describir trabajos distintos. El bloque anterior
      // enumeraba once métricas a mano y se dejaba `plantas_superficie_calculada_m2`, así que
      // un tratamiento de plantas reservado con fotos bloqueaba el mínimo de 1 h en vez de
      // sus horas reales — pese a que la barrera de elegibilidad sí exigía el rendimiento.
      const affected = normalizePhytosanitaryAffectedType(zone?.affectedType);
      totalHours += phytosanitaryHoursFromMetrics(resolvePhytosanitaryMetrics(zone, affected), yields);

      if (Number(zone?.area || 0) > PHYTOSANITARY_MAX_PLAUSIBLE_AREA) {
        pushWarning(
          'phytosanitary_area_implausible',
          `La cantidad declarada (${zone.area}) supera lo habitual para una sola zona de tratamiento (${PHYTOSANITARY_MAX_PLAUSIBLE_AREA}): confirma la medida antes de continuar.`,
        );
      }
    });
  }

  // Red de seguridad: las barreras de elegibilidad (missing_yield_config) impiden llegar
  // aquí con un rendimiento 0, pero si un dato corrupto (yield NaN, métrica Infinity) se
  // colara, una división por cero convertiría totalHours en Infinity/NaN y el presupuesto
  // en horas y precio Infinity. Clampeamos a un número finito no negativo (garser-pricing §2/§7).
  if (!Number.isFinite(totalHours) || totalHours < 0) totalHours = 0;

  if (totalHours > 8) totalHours *= 0.9;
  const estimatedHours = Math.max(1, Math.ceil(totalHours * 2) / 2);

  const applyMinimumPrice = (calculatedPrice: number) => {
    const rounded = roundUp(calculatedPrice);
    const gardenerMin = Number(config?.minimum_price || config?.minimumPrice || config?.importe_minimo || 0);
    if (gardenerMin > 0 && rounded > 0 && rounded < gardenerMin) return roundUp(gardenerMin);
    return rounded;
  };

  // Árboles/palmeras se detectan por el PAYLOAD (grupos presentes), no por los serviceIds:
  // serviceIds contiene UUIDs de la tabla `services`, por lo que buscar slugs como
  // 'poda-palmeras'/'palm' daba SIEMPRE false y las palmeras/árboles con pricing_method
  // 'per_hour' caían en la rama ingenua (horas × tarifa), perdiendo los extras
  // (fitosanitario €/ud, pelado de tronco %, precio por unidad vía yield) que sí aplica
  // calculatePalmPriceEngine / el motor de árboles en la rama detallada de abajo.
  const hasTreeOrPalm = palmGroups.length > 0 || (bookingData.treeGroups?.length ?? 0) > 0;

  let totalPrice = 0;
  const precioPorHora = getPrecioPorHora(config);

  if (getPricingMethod(config) === 'per_hour' && precioPorHora > 0 && !hasTreeOrPalm) {
    totalPrice = applyMinimumPrice(estimatedHours * precioPorHora);
  } else {
    let total = 0;

    if (palmGroups.length) {
      total += calculatePalmPriceEngine(pricedPalmGroups, config, globalWaste);

      metadata.pricingContext.palmGroups.forEach((group) => {
        if (!group.isPriced || group.quantity <= 0) return;
        breakdown.push({
          desc: `${group.quantity}x ${group.species} (${group.height})${group.isTerminalOpenRange ? ' · verificación final del profesional' : ''}`,
          price: 0,
        });
      });
    }

    if (bookingData.hedgeZones?.length) {
      let hedgeTotal = 0;
      for (const zone of bookingData.hedgeZones) {
        const lengthForPricing = Number(zone.length_pricing_m ?? zone.length ?? 0);
        const faces = Number(zone.faces_to_trim ?? 1);
        const height = zone.height || '0-2m';
        let base = Number(config.pricing_matrix?.[height] || 0);
        if (base <= 0) base = Number(config.species_prices?.[zone.type]?.[height] || 0);
        if (base <= 0) continue;

        const surcharges = config.condition_surcharges || DEFAULT_HEDGE_SURCHARGES;
        const state = String(zone.state || 'normal').toLowerCase();
        let statePercent = 0;
        if (state.includes('alta') || state.includes('muy_descuidado')) statePercent = resolveSurchargePercent(surcharges.alta, DEFAULT_HEDGE_SURCHARGES.alta);
        else if (state.includes('media') || state.includes('descuidado')) statePercent = resolveSurchargePercent(surcharges.media, DEFAULT_HEDGE_SURCHARGES.media);

        const stateMult = 1 + statePercent / 100;
        const wasteMult = globalWaste ? 1 + Number(config.waste_removal?.percentage || 0) / 100 : 1;
        hedgeTotal += base * lengthForPricing * faces * stateMult * wasteMult;
      }
      total += hedgeTotal;
    }

    if (treeQuote?.isProfessionalSuitable) {
      total += treeQuote.totalPrice;
    }

    if (bookingData.weedingZones?.length) {
      const quote = calculateWeedingQuote({
        zones: bookingData.weedingZones.map((zone) => ({
          id: zone.id,
          area: Number(zone.area || 0),
          state: zone.state,
          applyHerbicide: Boolean(zone.applyHerbicide),
        })),
        config,
        globalWaste,
      });
      total += quote.finalPrice;
    }

    if ((bookingData.lawnSpecies || bookingData.lawnZones?.length) && !config.height_prices) {
      let lawnSubtotal = 0;
      const zones = bookingData.lawnZones || [{ state: 'normal', quantity: bookingData.aiQuantity || 0 }];
      const baseRate = Number(config.price_per_m2 || 0);

      if (baseRate > 0) {
        zones.forEach((zone) => {
          const state = String(zone.state || 'normal').toLowerCase();
          const surcharges = config.condition_surcharges || {};
          let statePercent = 0;
          if (state.includes('muy')) statePercent = resolveSurchargePercent(surcharges.muy_descuidado, 50);
          else if (state.includes('descuidad')) statePercent = resolveSurchargePercent(surcharges.descuidado, 20);
          const stateMult = 1 + statePercent / 100;
          const wasteMult = globalWaste ? 1 + Number(config.waste_removal?.percentage || 0) / 100 : 1;
          lawnSubtotal += baseRate * Number(zone.quantity || 0) * stateMult * wasteMult;
        });
      }

      total += lawnSubtotal;
    }

    if (bookingData.shrubGroups?.length) {
      let shrubTotal = 0;
      const pricesPerM2 = config.prices_per_m2 || {};
      bookingData.shrubGroups.forEach((group) => {
        const size = (group.size || 'pequeñas') as keyof typeof pricesPerM2;
        const pricePerM2 = Number(pricesPerM2[size] || 0);
        const state = String(group.state || 'normal').toLowerCase();
        const surcharges = config.condition_surcharges || DEFAULT_SHRUB_SURCHARGES;
        let statePercent = 0;
        if (state.includes('muy')) statePercent = resolveSurchargePercent(surcharges.alta, DEFAULT_SHRUB_SURCHARGES.alta);
        else if (state.includes('descuidad')) statePercent = resolveSurchargePercent(surcharges.media, DEFAULT_SHRUB_SURCHARGES.media);
        const stateMult = 1 + statePercent / 100;
        const wasteMult = globalWaste ? 1 + Number(config.waste_removal?.percentage || 0) / 100 : 1;
        shrubTotal += Number(group.area || 0) * pricePerM2 * stateMult * wasteMult;
      });
      total += shrubTotal;
      breakdown.push(...buildShrubBreakdown(bookingData, config, globalWaste));
    }

    if (bookingData.phytosanitaryZones?.length) {
      const phytosanitaryQuote = calculatePhytosanitaryQuote({
        zones: bookingData.phytosanitaryZones,
        config,
        globalWaste,
      });
      total += phytosanitaryQuote.total;
      phytosanitaryQuote.breakdown.forEach((item) => {
        breakdown.push({
          desc: item.reason ? `${formatPhytosanitaryLabel(item)} · ${item.reason}` : formatPhytosanitaryLabel(item),
          price: roundUp(Number(item.lineTotal || 0)),
        });
      });
      if (phytosanitaryQuote.minimumFeeApplied) {
        breakdown.push({
          desc: `Ajuste por importe mínimo (${roundUp(phytosanitaryQuote.minimumFee)}€)`,
          price: roundUp(phytosanitaryQuote.minimumFee),
        });
      }
      if (phytosanitaryQuote.breakdown.some((item) => item.reason)) {
        return buildIneligibleQuote(
          'missing_pricing_config',
          'Los servicios fitosanitarios tienen tratamientos o tarifas incompletos para la solicitud.',
          metadata,
        );
      }
    }

    totalPrice = applyMinimumPrice(total);
    const currentBreakdownTotal = breakdown.reduce((sum, line) => sum + line.price, 0);
    if (totalPrice > 0 && breakdown.length > 0 && currentBreakdownTotal > 0 && totalPrice > currentBreakdownTotal) {
      breakdown.push({
        desc: `Ajuste por importe mínimo (${roundUp(Number(config?.minimum_price || config?.minimumPrice || config?.importe_minimo || 0))}€)`,
        price: totalPrice - currentBreakdownTotal,
      });
    }
  }

  const normalizedBreakdown = breakdown.filter((line) => line.price > 0 || line.desc.includes('verificación final del profesional'));

  return {
    totalPrice,
    estimatedHours,
    breakdown: normalizedBreakdown,
    warnings,
    metadata,
    economics: buildQuoteEconomics(totalPrice, normalizedBreakdown),
    eligibility: {
      isEligible: totalPrice > 0,
    },
  };
}
