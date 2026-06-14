import {
  PhytosanitaryDetailedPricing,
  PhytosanitaryMatrixBase,
  PhytosanitaryMatrixNoHerb,
  PhytosanitaryPricingConfig,
  PhytosanitaryType,
  LegacyPhytosanitaryType
} from '../types';
import { getPrecioPorHora } from './hourlyPricing';

const emptyBaseMatrix = (): PhytosanitaryMatrixBase => ({ insecticida: 0, fungicida: 0, ecologico_preventivo: 0 });
const emptyNoHerbMatrix = (): PhytosanitaryMatrixNoHerb => ({ insecticida: 0, fungicida: 0, ecologico_preventivo: 0 });

export const EMPTY_DETAILED_PHYTOSANITARY_PRICING: PhytosanitaryDetailedPricing = {
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
    altas_cirugia: 0
  },
  arboles: {
    minimo: 0,
    pequenos_preventivo: 0,
    pequenos_curativo: 0,
    medianos_preventivo: 0,
    medianos_curativo: 0,
    grandes_preventivo: 0,
    grandes_curativo: 0
  },
  plantas: {
    minimo: 0,
    pequenas_preventivo: 0,
    pequenas_curativo: 0,
    medianas_preventivo: 0,
    medianas_curativo: 0,
    grandes_preventivo: 0,
    grandes_curativo: 0
  }
};

export const EMPTY_PHYTOSANITARY_CONFIG: PhytosanitaryPricingConfig = {
  version: 'phytosanitary_v2',
  precioPorHora: 0,
  importe_minimo: 0,
  tratamientos_activos: [],
  superficies_plantas: {
    hasta_100m2: emptyBaseMatrix(),
    mas_de_100m2: emptyBaseMatrix()
  },
  setos: {
    hasta_2m: emptyNoHerbMatrix(),
    mas_de_2m: emptyNoHerbMatrix()
  },
  arboles: {
    hasta_3m: emptyNoHerbMatrix(),
    mas_de_3m: emptyNoHerbMatrix()
  },
  palmeras: {
    tradicional: { hasta_3m: 0, mas_de_3m: 0 },
    endoterapia: { precio_unico: 0 }
  },
  recargo_retirada: { percentage: 0 },
  minimum_price: 0,
  minimum_fee: 0,
  yields: {
    cesped_m2_per_hour: 0,
    setos_ml_per_hour: 0,
    palmeras_units_per_hour: 0,
    arboles_units_per_hour: 0,
    plantas_m2_per_hour: 0,
    endoterapia_units_per_hour: 0
  },
  waste_removal: { percentage: 0 },
  pricing_modifiers: {
    eco: { percentage: 0 },
    combo: { two_treatments_percentage: 0, three_plus_treatments_percentage: 0 }
  },
  selected_types: [],
  type_prices: {},
  detailed_pricing: EMPTY_DETAILED_PHYTOSANITARY_PRICING
};

const mapLegacyType = (type: LegacyPhytosanitaryType): PhytosanitaryType => {
  if (type === 'Insecticida') return 'insecticida';
  return 'fungicida';
};

const toLegacyType = (type: PhytosanitaryType): LegacyPhytosanitaryType | null => {
  if (type === 'insecticida') return 'Insecticida';
  if (type === 'fungicida') return 'Fungicida';
  return null;
};

export const normalizeDetailedPhytosanitaryPricing = (raw?: PhytosanitaryDetailedPricing): PhytosanitaryDetailedPricing => {
  if (!raw) return EMPTY_DETAILED_PHYTOSANITARY_PRICING;
  return {
    cesped: { ...EMPTY_DETAILED_PHYTOSANITARY_PRICING.cesped, ...(raw.cesped || {}) },
    setos: { ...EMPTY_DETAILED_PHYTOSANITARY_PRICING.setos, ...(raw.setos || {}) },
    palmeras: { ...EMPTY_DETAILED_PHYTOSANITARY_PRICING.palmeras, ...(raw.palmeras || {}) },
    arboles: { ...EMPTY_DETAILED_PHYTOSANITARY_PRICING.arboles, ...(raw.arboles || {}) },
    plantas: { ...EMPTY_DETAILED_PHYTOSANITARY_PRICING.plantas, ...(raw.plantas || {}) }
  };
};

export const normalizePhytosanitaryPricingConfig = (raw?: PhytosanitaryPricingConfig): PhytosanitaryPricingConfig => {
  if (!raw) return EMPTY_PHYTOSANITARY_CONFIG;
  if (raw.version === 'phytosanitary_v2') {
    const inferredDetailed: PhytosanitaryDetailedPricing = raw.detailed_pricing ? normalizeDetailedPhytosanitaryPricing(raw.detailed_pricing) : {
      cesped: {
        minimo: Number(raw.importe_minimo || raw.minimum_price || 0),
        preventivo: Number(raw.superficies_plantas?.hasta_100m2?.ecologico_preventivo || 0),
        curativo: Number(raw.superficies_plantas?.hasta_100m2?.insecticida || 0)
      },
      setos: {
        minimo: Number(raw.importe_minimo || raw.minimum_price || 0),
        bajos_preventivo: Number(raw.setos?.hasta_2m?.ecologico_preventivo || 0),
        bajos_curativo: Number(raw.setos?.hasta_2m?.insecticida || 0),
        altos_preventivo: Number(raw.setos?.mas_de_2m?.ecologico_preventivo || 0),
        altos_curativo: Number(raw.setos?.mas_de_2m?.insecticida || 0)
      },
      palmeras: {
        minimo: Number(raw.importe_minimo || raw.minimum_price || 0),
        pequenas_preventivo: Number(raw.palmeras?.tradicional?.hasta_3m || 0),
        pequenas_curativo: Number(raw.palmeras?.tradicional?.hasta_3m || 0),
        pequenas_cirugia: Number(raw.palmeras?.endoterapia?.precio_unico || 0),
        medianas_preventivo: Number(raw.palmeras?.tradicional?.mas_de_3m || 0),
        medianas_curativo: Number(raw.palmeras?.tradicional?.mas_de_3m || 0),
        medianas_cirugia: Number(raw.palmeras?.endoterapia?.precio_unico || 0),
        altas_preventivo: Number(raw.palmeras?.tradicional?.mas_de_3m || 0),
        altas_curativo: Number(raw.palmeras?.tradicional?.mas_de_3m || 0),
        altas_cirugia: Number(raw.palmeras?.endoterapia?.precio_unico || 0)
      },
      arboles: {
        minimo: Number(raw.importe_minimo || raw.minimum_price || 0),
        pequenos_preventivo: Number(raw.arboles?.hasta_3m?.ecologico_preventivo || 0),
        pequenos_curativo: Number(raw.arboles?.hasta_3m?.insecticida || 0),
        medianos_preventivo: Number(raw.arboles?.mas_de_3m?.ecologico_preventivo || 0),
        medianos_curativo: Number(raw.arboles?.mas_de_3m?.insecticida || 0),
        grandes_preventivo: Number(raw.arboles?.mas_de_3m?.ecologico_preventivo || 0),
        grandes_curativo: Number(raw.arboles?.mas_de_3m?.insecticida || 0)
      },
      plantas: {
        minimo: Number(raw.importe_minimo || raw.minimum_price || 0),
        pequenas_preventivo: Number(raw.superficies_plantas?.hasta_100m2?.ecologico_preventivo || 0),
        pequenas_curativo: Number(raw.superficies_plantas?.hasta_100m2?.insecticida || 0),
        medianas_preventivo: Number(raw.superficies_plantas?.hasta_100m2?.ecologico_preventivo || 0),
        medianas_curativo: Number(raw.superficies_plantas?.hasta_100m2?.insecticida || 0),
        grandes_preventivo: Number(raw.superficies_plantas?.hasta_100m2?.ecologico_preventivo || 0),
        grandes_curativo: Number(raw.superficies_plantas?.hasta_100m2?.insecticida || 0)
      }
    };

    const v2Treatments = (raw.tratamientos_activos || []).filter(Boolean);
    const legacyFromV2 = v2Treatments.map(toLegacyType).filter(Boolean) as LegacyPhytosanitaryType[];
    const inferredMin = Number(raw.minimum_fee ?? raw.importe_minimo ?? raw.minimum_price ?? 0);
    const inferredWaste = Number(raw.recargo_retirada?.percentage || raw.waste_removal?.percentage || 0);
    const inferredEco = Number(raw.pricing_modifiers?.eco?.percentage || 0);
    const inferredComboTwo = Number(raw.pricing_modifiers?.combo?.two_treatments_percentage || 0);
    const inferredComboThreePlus = Number(raw.pricing_modifiers?.combo?.three_plus_treatments_percentage || 0);
    const precioPorHora = getPrecioPorHora(raw);

    return {
      ...EMPTY_PHYTOSANITARY_CONFIG,
      ...raw,
      version: 'phytosanitary_v2',
      precioPorHora,
      importe_minimo: inferredMin,
      minimum_price: inferredMin,
      minimum_fee: inferredMin,
      superficies_plantas: {
        hasta_100m2: { ...emptyBaseMatrix(), ...(raw.superficies_plantas?.hasta_100m2 || {}) },
        mas_de_100m2: { ...emptyBaseMatrix(), ...(raw.superficies_plantas?.mas_de_100m2 || {}) }
      },
      setos: {
        hasta_2m: { ...emptyNoHerbMatrix(), ...(raw.setos?.hasta_2m || {}) },
        mas_de_2m: { ...emptyNoHerbMatrix(), ...(raw.setos?.mas_de_2m || {}) }
      },
      arboles: {
        hasta_3m: { ...emptyNoHerbMatrix(), ...(raw.arboles?.hasta_3m || {}) },
        mas_de_3m: { ...emptyNoHerbMatrix(), ...(raw.arboles?.mas_de_3m || {}) }
      },
      palmeras: {
        tradicional: {
          hasta_3m: Number(raw.palmeras?.tradicional?.hasta_3m || 0),
          mas_de_3m: Number(raw.palmeras?.tradicional?.mas_de_3m || 0)
        },
        endoterapia: {
          precio_unico: Number(raw.palmeras?.endoterapia?.precio_unico || 0)
        }
      },
      recargo_retirada: { percentage: inferredWaste },
      waste_removal: { percentage: inferredWaste },
      pricing_modifiers: {
        eco: { percentage: inferredEco },
        combo: {
          two_treatments_percentage: inferredComboTwo,
          three_plus_treatments_percentage: inferredComboThreePlus
        }
      },
      selected_types: legacyFromV2,
      detailed_pricing: inferredDetailed
    };
  }

  const selectedLegacy = raw.selected_types || [];
  const selected = selectedLegacy.map(mapLegacyType);
  if (!selected.includes('ecologico_preventivo')) selected.push('ecologico_preventivo');
  const sampleType = selectedLegacy[0];
  const fixed = Number(sampleType ? raw.type_prices?.[sampleType]?.['0-50'] || 0 : 0);
  const middle = Number(sampleType ? raw.type_prices?.[sampleType]?.['50-200'] || 0 : 0);
  const high = Number(sampleType ? raw.type_prices?.[sampleType]?.['200+'] || 0 : 0);
  const base = middle > 0 ? middle : (fixed > 0 ? fixed : high);
  const highBase = high > 0 ? high : base;

  return {
    ...EMPTY_PHYTOSANITARY_CONFIG,
    version: 'phytosanitary_v2',
    tratamientos_activos: selected,
    importe_minimo: Number(raw.minimum_price || 0),
    minimum_price: Number(raw.minimum_price || 0),
    minimum_fee: Number(raw.minimum_price || 0),
    recargo_retirada: { percentage: Number(raw.waste_removal?.percentage || 0) },
    waste_removal: { percentage: Number(raw.waste_removal?.percentage || 0) },
    pricing_modifiers: {
      eco: { percentage: 0 },
      combo: { two_treatments_percentage: 0, three_plus_treatments_percentage: 0 }
    },
    superficies_plantas: { hasta_100m2: { ...emptyBaseMatrix(), insecticida: base, fungicida: base, ecologico_preventivo: base }, mas_de_100m2: { ...emptyBaseMatrix(), insecticida: highBase, fungicida: highBase, ecologico_preventivo: highBase } },
    setos: { hasta_2m: { ...emptyNoHerbMatrix(), insecticida: base, fungicida: base, ecologico_preventivo: base }, mas_de_2m: { ...emptyNoHerbMatrix(), insecticida: highBase, fungicida: highBase, ecologico_preventivo: highBase } },
    arboles: { hasta_3m: { ...emptyNoHerbMatrix(), insecticida: base, fungicida: base, ecologico_preventivo: base }, mas_de_3m: { ...emptyNoHerbMatrix(), insecticida: highBase, fungicida: highBase, ecologico_preventivo: highBase } },
    palmeras: { tradicional: { hasta_3m: base, mas_de_3m: highBase }, endoterapia: { precio_unico: 0 } },
    detailed_pricing: normalizeDetailedPhytosanitaryPricing(raw.detailed_pricing)
  };
};

export const toPersistedPhytosanitaryConfig = (config: PhytosanitaryPricingConfig): PhytosanitaryPricingConfig => {
  const normalized = normalizePhytosanitaryPricingConfig(config);
  const { hourly_rate: _legacyHourlyRate, ...normalizedWithoutLegacyHourlyRate } = normalized;
  const detailed = normalizeDetailedPhytosanitaryPricing(normalized.detailed_pricing);
  const inferredMin = Number(normalized.minimum_fee ?? normalized.importe_minimo ?? normalized.minimum_price ?? 0);
  const precioPorHora = getPrecioPorHora(normalized);
  const normalizedEcoModifier = Number(normalized.pricing_modifiers?.eco?.percentage || 0);
  const normalizedComboTwoModifier = Number(normalized.pricing_modifiers?.combo?.two_treatments_percentage || 0);
  const normalizedComboThreeModifier = Number(normalized.pricing_modifiers?.combo?.three_plus_treatments_percentage || 0);
  const hasAnyCirugia = [detailed.palmeras.pequenas_cirugia, detailed.palmeras.medianas_cirugia, detailed.palmeras.altas_cirugia].some((n) => Number(n || 0) > 0);
  const tratamientos: PhytosanitaryType[] = ['insecticida', 'fungicida', 'ecologico_preventivo'];
  if (hasAnyCirugia) tratamientos.push('endoterapia');
  const selectedLegacy = tratamientos.map(toLegacyType).filter(Boolean) as LegacyPhytosanitaryType[];
  const palmHighTraditional = Math.max(Number(detailed.palmeras.medianas_curativo || 0), Number(detailed.palmeras.altas_curativo || 0));
  const treeHighPreventivo = Math.max(Number(detailed.arboles.medianos_preventivo || 0), Number(detailed.arboles.grandes_preventivo || 0));
  const treeHighCurativo = Math.max(Number(detailed.arboles.medianos_curativo || 0), Number(detailed.arboles.grandes_curativo || 0));
  const maxCirugia = Math.max(Number(detailed.palmeras.pequenas_cirugia || 0), Number(detailed.palmeras.medianas_cirugia || 0), Number(detailed.palmeras.altas_cirugia || 0));

  return {
    ...normalizedWithoutLegacyHourlyRate,
    version: 'phytosanitary_v2',
    precioPorHora,
    importe_minimo: inferredMin,
    minimum_price: inferredMin,
    minimum_fee: inferredMin,
    waste_removal: { percentage: Number(normalized.recargo_retirada?.percentage || 0) },
    pricing_modifiers: {
      eco: { percentage: normalizedEcoModifier },
      combo: {
        two_treatments_percentage: normalizedComboTwoModifier,
        three_plus_treatments_percentage: normalizedComboThreeModifier
      }
    },
    tratamientos_activos: tratamientos,
    selected_types: selectedLegacy,
    superficies_plantas: {
      hasta_100m2: {
        insecticida: Number(detailed.cesped.curativo || 0),
        fungicida: Number(detailed.cesped.curativo || 0),
        ecologico_preventivo: Number(detailed.cesped.preventivo || 0)
      },
      mas_de_100m2: {
        insecticida: Number(detailed.cesped.curativo || 0),
        fungicida: Number(detailed.cesped.curativo || 0),
        ecologico_preventivo: Number(detailed.cesped.preventivo || 0)
      }
    },
    setos: {
      hasta_2m: {
        insecticida: Number(detailed.setos.bajos_curativo || 0),
        fungicida: Number(detailed.setos.bajos_curativo || 0),
        ecologico_preventivo: Number(detailed.setos.bajos_preventivo || 0)
      },
      mas_de_2m: {
        insecticida: Number(detailed.setos.altos_curativo || 0),
        fungicida: Number(detailed.setos.altos_curativo || 0),
        ecologico_preventivo: Number(detailed.setos.altos_preventivo || 0)
      }
    },
    arboles: {
      hasta_3m: {
        insecticida: Number(detailed.arboles.pequenos_curativo || 0),
        fungicida: Number(detailed.arboles.pequenos_curativo || 0),
        ecologico_preventivo: Number(detailed.arboles.pequenos_preventivo || 0)
      },
      mas_de_3m: {
        insecticida: treeHighCurativo,
        fungicida: treeHighCurativo,
        ecologico_preventivo: treeHighPreventivo
      }
    },
    palmeras: {
      tradicional: {
        hasta_3m: Number(detailed.palmeras.pequenas_curativo || 0),
        mas_de_3m: palmHighTraditional
      },
      endoterapia: { precio_unico: maxCirugia }
    },
    detailed_pricing: detailed,
    type_prices: {
      Insecticida: { '0-50': Number(detailed.cesped.curativo || 0), '50-200': Number(detailed.cesped.curativo || 0), '200+': Number(detailed.cesped.curativo || 0) },
      Fungicida: { '0-50': Number(detailed.cesped.curativo || 0), '50-200': Number(detailed.cesped.curativo || 0), '200+': Number(detailed.cesped.curativo || 0) }
    }
  };
};

export const ensurePhytosanitaryPersistedConfig = (raw?: PhytosanitaryPricingConfig): PhytosanitaryPricingConfig => {
  if (!raw) return toPersistedPhytosanitaryConfig(EMPTY_PHYTOSANITARY_CONFIG);
  return toPersistedPhytosanitaryConfig(normalizePhytosanitaryPricingConfig(raw));
};
