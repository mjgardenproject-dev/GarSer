import { describe, expect, it } from 'vitest';

import {
  buildAuthoritativeBookingQuote,
  getBookingCustomerPaymentSummary,
} from './bookingQuoteCore';

describe('getBookingCustomerPaymentSummary', () => {
  it('deriva el resumen de pago visible al cliente sin alterar el contrato económico', () => {
    expect(
      getBookingCustomerPaymentSummary({
        currency: 'EUR',
        taxRate: 0.21,
        serviceGrossTotal: 158,
        serviceNetSubtotal: 130.58,
        serviceTaxAmount: 27.42,
        managementFee: 19.75,
        payableNow: 19.75,
        payableLater: 158,
        lines: [],
        stripeLineItems: [],
      })
    ).toEqual({
      reservationTotal: 177.75,
      serviceSubtotal: 158,
      reservationFee: 19.75,
      confirmationDeposit: 19.75,
      pendingToProfessional: 158,
    });
  });

  it('devuelve null si todavía no hay datos económicos disponibles', () => {
    expect(getBookingCustomerPaymentSummary(null)).toBeNull();
  });
});

describe('buildAuthoritativeBookingQuote', () => {
  it.each([
    {
      title: 'falla cerrado si el cesped por horas no tiene tarifa horaria',
      bookingData: {
        serviceIds: ['svc-lawn'],
        lawnZones: [{ quantity: 120, state: 'normal' }],
      },
      providerConfig: {
        pricing_method: 'per_hour',
        yield_m2_per_hour: 100,
      },
      reason: 'missing_pricing_config',
      message: 'El servicio de césped por horas requiere una tarifa horaria válida.',
    },
    {
      title: 'falla cerrado si los setos no tienen rendimiento para la altura solicitada',
      bookingData: {
        serviceIds: ['svc-hedge'],
        hedgeZones: [{ type: 'cipres', height: '2-4m', length: 15, state: 'normal', faces_to_trim: 2 }],
      },
      providerConfig: {
        pricing_matrix: { '2-4m': 18 },
        yield_ml_per_hour: { '0-2m': 30 },
      },
      reason: 'missing_yield_config',
      message: 'El servicio de setos requiere rendimientos configurados para cada altura ofertada.',
    },
    {
      title: 'falla cerrado si el desbroce con herbicida no tiene tarifa de herbicida',
      bookingData: {
        serviceIds: ['svc-weeding'],
        weedingZones: [{ area: 80, state: 'normal', applyHerbicide: true }],
      },
      providerConfig: {
        precio_desbroce_m2: 1.4,
        yield_m2_per_hour: 90,
      },
      reason: 'missing_pricing_config',
      message: 'El desbroce con herbicida requiere una tarifa de herbicida válida.',
    },
    {
      title: 'falla cerrado si la poda de arboles no tiene configuracion completa',
      bookingData: {
        serviceIds: ['svc-tree'],
        treeGroups: [{ id: 'tree-1', pruningType: 'estructural', aiSizeBand: 'large', analysisLevel: 1 }],
      },
      providerConfig: {
        estructural: { small: 50, medium: 100, large: 180 },
      },
      reason: 'invalid_tree_config',
      message: 'La poda de árboles requiere una configuración completa de precios y dificultad.',
    },
    {
      title: 'falla cerrado si fitosanitarios no tiene tratamientos activos',
      bookingData: {
        serviceIds: ['svc-phyto'],
        phytosanitaryZones: [{ area: 60, affectedType: 'Césped', intent: 'preventive' }],
      },
      providerConfig: {
        tratamientos_activos: [],
        yields: { cesped_m2_per_hour: 100 },
      },
      reason: 'missing_treatment_config',
      message: 'Los servicios fitosanitarios requieren tratamientos activos configurados.',
    },
    {
      title: 'falla cerrado si fitosanitarios deja tarifas incompletas tras normalizar el desglose',
      bookingData: {
        serviceIds: ['svc-phyto'],
        phytosanitaryZones: [{ area: 60, affectedType: 'Césped', intent: 'curative', curativeTarget: 'insects' }],
      },
      providerConfig: {
        tratamientos_activos: ['insecticida'],
        yields: { cesped_m2_per_hour: 100 },
        superficies_plantas: {
          hasta_100m2: { insecticida: 0, fungicida: 0, ecologico_preventivo: 0 },
          mas_de_100m2: { insecticida: 0, fungicida: 0, ecologico_preventivo: 0 },
        },
      },
      reason: 'missing_pricing_config',
      message: 'Los servicios fitosanitarios tienen tratamientos o tarifas incompletos para la solicitud.',
    },
  ])('$title', ({ bookingData, providerConfig, reason, message }) => {
    const result = buildAuthoritativeBookingQuote({
      bookingData: bookingData as Parameters<typeof buildAuthoritativeBookingQuote>[0]['bookingData'],
      providerConfig,
    });

    expect(result.totalPrice).toBe(0);
    expect(result.estimatedHours).toBe(0);
    expect(result.eligibility).toEqual({
      isEligible: false,
      reason,
    });
    expect(result.warnings).toEqual([
      {
        code: reason,
        message,
      },
    ]);
  });

  it('multiplica precio y horas de árboles por la cantidad confirmada del grupo', () => {
    const providerConfig = {
      formacion: { small: 40, medium: 80, large: 150 },
      estructural: { small: 50, medium: 100, large: 180 },
      yield_units_per_hour: {
        formacion: { small: 2, medium: 1, large: 0.5 },
        estructural: { small: 2, medium: 1, large: 0.5 },
      },
      difficultyIncrease: 30,
      wasteRemovalMultiplier: 0,
      minimumPrice: 0,
    };

    const single = buildAuthoritativeBookingQuote({
      bookingData: {
        serviceIds: ['svc-tree'],
        treeGroups: [{ id: 'tree-1', pruningType: 'shaping', aiSizeBand: 'medium', analysisLevel: 1 }],
      } as any,
      providerConfig,
    });
    const triple = buildAuthoritativeBookingQuote({
      bookingData: {
        serviceIds: ['svc-tree'],
        treeGroups: [{ id: 'tree-1', pruningType: 'shaping', quantity: 3, aiSizeBand: 'medium', analysisLevel: 1 }],
      } as any,
      providerConfig,
    });

    expect(single.eligibility).toEqual({ isEligible: true });
    expect(triple.eligibility).toEqual({ isEligible: true });
    // Formación mediana: 80 €/árbol y 1 árbol/hora → 3 unidades = 3× precio y horas.
    expect(single.totalPrice).toBe(80);
    expect(triple.totalPrice).toBe(240);
    expect(triple.estimatedHours).toBe(3);
  });

  it('aplica el recargo de estado de arbustos cuando el grupo lleva state', () => {
    const providerConfig = {
      pricing_method: 'per_quantity',
      prices_per_m2: { pequeñas: 2, medianas: 4, grandes: 6 },
      yield_m2_per_hour: { pequeñas: 30, medianas: 20, grandes: 10 },
      condition_surcharges: { media: 20, alta: 50 },
      waste_removal: { percentage: 0 },
      minimum_price: 0,
    };

    const normal = buildAuthoritativeBookingQuote({
      bookingData: {
        serviceIds: ['svc-shrub'],
        shrubGroups: [{ id: 'shrub-1', size: 'medianas', area: 10, state: 'normal' }],
      } as any,
      providerConfig,
    });
    const veryNeglected = buildAuthoritativeBookingQuote({
      bookingData: {
        serviceIds: ['svc-shrub'],
        shrubGroups: [{ id: 'shrub-1', size: 'medianas', area: 10, state: 'muy_descuidado' }],
      } as any,
      providerConfig,
    });

    // 10 m² × 4 €/m² = 40 €; muy descuidado aplica surcharges.alta (50%) → 60 €.
    expect(normal.totalPrice).toBe(40);
    expect(veryNeglected.totalPrice).toBe(60);
    // Las horas también escalan: 10/20 = 0.5h → ×1.7 (muy descuidado) = 0.85 → redondeo a 1h.
    expect(veryNeglected.estimatedHours).toBeGreaterThanOrEqual(normal.estimatedHours);
  });

  it('fitosanitarios: deriva curativo/eco/combo desde type cuando faltan los campos canónicos (flujo fotos legacy)', () => {
    const providerConfig = {
      tratamientos_activos: ['insecticida', 'fungicida', 'ecologico_preventivo'],
      yields: { cesped_m2_per_hour: 100 },
      detailed_pricing: {
        cesped: { preventivo: 0.5, curativo: 1 },
      },
      pricing_modifiers: {
        eco: { percentage: 10 },
        combo: { two_treatments_percentage: 20, three_plus_treatments_percentage: 30 },
      },
      minimum_fee: 0,
    };
    const build = (zone: Record<string, unknown>) => buildAuthoritativeBookingQuote({
      bookingData: {
        serviceIds: ['svc-phyto'],
        phytosanitaryZones: [{
          id: 'fum-1',
          affectedType: 'Césped',
          area: 100,
          analysisMetrics: { cesped_m2: 100 },
          ...zone,
        }],
      } as any,
      providerConfig,
    });

    // Zona legacy con solo type (sin intent/curativeTarget/productPreference):
    // fungicida → tarifa CURATIVA (100 × 1 = 100), no la preventiva (50).
    expect(build({ type: 'fungicida' }).totalPrice).toBe(100);
    // combo → curativa + recargo de 2 tratamientos: 100 × 1.2 = 120.
    expect(build({ type: 'insecticida+fungicida' }).totalPrice).toBe(120);
    // eco preventivo → tarifa preventiva + modificador eco: 50 × 1.1 = 55.
    expect(build({ type: 'ecologico_preventivo' }).totalPrice).toBe(55);
    // Con campos canónicos (flujo manual/nuevo): curativo eco aplica el % eco sin alterar el combo.
    expect(build({ type: 'fungicida+ecologico_preventivo', intent: 'curative', curativeTarget: 'fungus', productPreference: 'ecological' }).totalPrice).toBe(110);
  });

  it('fitosanitarios: la endoterapia solicitada se cobra por tronco, sin arrastrar la ducha base', () => {
    const providerConfig = {
      tratamientos_activos: ['insecticida', 'fungicida', 'ecologico_preventivo', 'endoterapia'],
      yields: { palmeras_units_per_hour: 2, endoterapia_units_per_hour: 4 },
      detailed_pricing: {
        palmeras: { pequenas_preventivo: 30, medianas_preventivo: 50, altas_preventivo: 80 },
      },
      palmeras: { endoterapia: { precio_unico: 45 } },
      pricing_modifiers: { eco: { percentage: 10 }, combo: { two_treatments_percentage: 20, three_plus_treatments_percentage: 30 } },
      minimum_fee: 0,
    };
    const result = buildAuthoritativeBookingQuote({
      bookingData: {
        serviceIds: ['svc-phyto'],
        phytosanitaryZones: [{
          id: 'fum-1',
          affectedType: 'Palmeras',
          type: 'endoterapia',
          area: 3,
          // El adaptador ya trasvasó las 3 palmeras detectadas a troncos de endoterapia.
          analysisMetrics: { palmeras_endoterapia_troncos_ud: 3 },
        }],
      } as any,
      providerConfig,
    });

    // 3 troncos × 45 € = 135 €, sin sumar tarifas de ducha ni combos espurios.
    expect(result.totalPrice).toBe(135);
  });

  it('desbroce: suma el herbicida a la base y aplica el importe mínimo', () => {
    const providerConfig = {
      precio_desbroce_m2: 1,
      precio_herbicida_m2: 0.5,
      yield_m2_per_hour: 100,
      suplementos: { dificultad_media: 20, dificultad_alta: 50, retirada_restos: 0 },
      importe_minimo: 80,
    };
    const build = (area: number, applyHerbicide: boolean) => buildAuthoritativeBookingQuote({
      bookingData: {
        serviceIds: ['svc-weeding'],
        weedingZones: [{ id: 'weed-1', area, state: 'normal', applyHerbicide }],
      } as any,
      providerConfig,
    });

    // (400×1 + 400×0.5) = 600 € con herbicida; 400 € sin él.
    expect(build(400, true).totalPrice).toBe(600);
    expect(build(400, false).totalPrice).toBe(400);
    // 50 m² → 50 € < importe_minimo 80 → 80 €.
    expect(build(50, false).totalPrice).toBe(80);
  });

  it('fitosanitarios fallback sin métricas: matrices por altura y minimum_fee', () => {
    const providerConfig = {
      tratamientos_activos: ['insecticida', 'fungicida', 'ecologico_preventivo'],
      yields: { setos_ml_per_hour: 30 },
      setos: {
        hasta_2m: { insecticida: 1.5, fungicida: 1.5, ecologico_preventivo: 1.2 },
        mas_de_2m: { insecticida: 2, fungicida: 2, ecologico_preventivo: 1.6 },
      },
      pricing_modifiers: { eco: { percentage: 10 }, combo: { two_treatments_percentage: 20, three_plus_treatments_percentage: 30 } },
      minimum_fee: 80,
    };
    const build = (area: number, aboveTwoMeters: boolean) => buildAuthoritativeBookingQuote({
      bookingData: {
        serviceIds: ['svc-phyto'],
        phytosanitaryZones: [{
          id: 'fum-1',
          affectedType: 'Setos',
          type: 'insecticida',
          intent: 'curative',
          curativeTarget: 'insects',
          area,
          aboveTwoMeters,
        }],
      } as any,
      providerConfig,
    });

    // 60 ml × 2 €/ml (más de 2m) = 120 €.
    expect(build(60, true).totalPrice).toBe(120);
    // 60 ml × 1.5 €/ml (hasta 2m) = 90 €.
    expect(build(60, false).totalPrice).toBe(90);
    // 20 ml × 2 = 40 € < minimum_fee 80 → 80 €.
    expect(build(20, true).totalPrice).toBe(80);
  });

  it('incluye la retirada de restos en las horas del desbroce (no solo en el precio)', () => {
    const providerConfig = {
      precio_desbroce_m2: 1,
      precio_herbicida_m2: 0.5,
      yield_m2_per_hour: 100,
      suplementos: { dificultad_media: 20, dificultad_alta: 50, retirada_restos: 50 },
      importe_minimo: 0,
    };
    const build = (wasteRemoval: boolean) => buildAuthoritativeBookingQuote({
      bookingData: {
        serviceIds: ['svc-weeding'],
        weedingZones: [{ id: 'weed-1', area: 400, state: 'normal', applyHerbicide: false }],
        wasteRemoval,
      } as any,
      providerConfig,
    });

    const withoutWaste = build(false);
    const withWaste = build(true);

    // Precio: 400 m² × 1 €/m² = 400 €; con retirada +50% → 600 €.
    expect(withoutWaste.totalPrice).toBe(400);
    expect(withWaste.totalPrice).toBe(600);
    // Horas: 400/100 = 4h; la retirada también consume tiempo → 6h (antes se quedaba en 4h).
    expect(withoutWaste.estimatedHours).toBe(4);
    expect(withWaste.estimatedHours).toBe(6);
  });

  it('césped per_hour: cobra por horas (estado incluido) con la tarifa horaria', () => {
    const providerConfig = {
      pricing_method: 'per_hour',
      precioPorHora: 30,
      yield_m2_per_hour: 100,
      condition_surcharges: { descuidado: 20, muy_descuidado: 50 },
      waste_removal: { percentage: 0 },
      minimum_price: 0,
    };
    const build = (state: string) => buildAuthoritativeBookingQuote({
      bookingData: {
        serviceIds: ['svc-lawn'],
        lawnZones: [{ id: 'lawn-1', species: 'Césped general', quantity: 200, state }],
      } as any,
      providerConfig,
    });

    // Normal: 200/100 = 2h × 30 € = 60 €.
    const normal = build('normal');
    expect(normal.estimatedHours).toBe(2);
    expect(normal.totalPrice).toBe(60);
    // Muy descuidado: 200/100 × 1.7 = 3.4h → 3.5h × 30 € = 105 €.
    const neglected = build('muy descuidado');
    expect(neglected.estimatedHours).toBe(3.5);
    expect(neglected.totalPrice).toBe(105);
  });

  it('respeta el 0 explícito en condition_surcharges (no lo pisa con el default)', () => {
    // Un jardinero puede decidir NO recargar por estado configurando 0%. El patrón
    // `surcharges.muy_descuidado || 50` pisaba ese 0 con el default → sobrecobro.
    const build = (surcharges: Record<string, number> | undefined) => buildAuthoritativeBookingQuote({
      bookingData: {
        serviceIds: ['svc-lawn'],
        lawnZones: [{ id: 'lawn-1', species: 'Césped general', quantity: 200, state: 'muy descuidado' }],
      } as any,
      providerConfig: {
        pricing_method: 'per_quantity',
        price_per_m2: 0.5,
        yield_m2_per_hour: 100,
        condition_surcharges: surcharges,
        waste_removal: { percentage: 0 },
        minimum_price: 0,
      },
    });

    // 0 explícito → sin recargo: 200 × 0.5 = 100 €.
    expect(build({ descuidado: 0, muy_descuidado: 0 }).totalPrice).toBe(100);
    // Campo ausente → default 50%: 150 €.
    expect(build({} as any).totalPrice).toBe(150);
  });

  it('aplica el recargo de estado del césped cuando la zona lleva state', () => {
    const providerConfig = {
      pricing_method: 'per_quantity',
      price_per_m2: 0.5,
      yield_m2_per_hour: 100,
      condition_surcharges: { descuidado: 20, muy_descuidado: 50 },
      waste_removal: { percentage: 0 },
      minimum_price: 0,
    };
    const build = (state: string) => buildAuthoritativeBookingQuote({
      bookingData: {
        serviceIds: ['svc-lawn'],
        lawnZones: [{ id: 'lawn-1', species: 'Césped general', quantity: 200, state }],
      } as any,
      providerConfig,
    });

    // 200 m² × 0,5 €/m² = 100 €; descuidado +20% → 120 €; muy descuidado +50% → 150 €.
    expect(build('normal').totalPrice).toBe(100);
    expect(build('descuidado').totalPrice).toBe(120);
    expect(build('muy descuidado').totalPrice).toBe(150);
  });

  it('cobra la segunda cara del seto exactamente una vez (length_pricing_m es la longitud base)', () => {
    const providerConfig = {
      pricing_method: 'per_quantity',
      pricing_matrix: { '0-2m': 3, '2-4m': 5, '4-6m': 8 },
      yield_ml_per_hour: { '0-2m': 30, '2-4m': 20, '4-6m': 10 },
      condition_surcharges: { media: 20, alta: 50 },
      waste_removal: { percentage: 0 },
      minimum_price: 0,
    };

    const oneFace = buildAuthoritativeBookingQuote({
      bookingData: {
        serviceIds: ['svc-hedge'],
        hedgeZones: [{ id: 'hedge-1', type: '2-4m', height: '2-4m', length: 40, length_pricing_m: 40, faces_to_trim: 1, state: 'normal' }],
      } as any,
      providerConfig,
    });
    const twoFaces = buildAuthoritativeBookingQuote({
      bookingData: {
        serviceIds: ['svc-hedge'],
        hedgeZones: [{ id: 'hedge-1', type: '2-4m', height: '2-4m', length: 40, length_pricing_m: 40, faces_to_trim: 2, state: 'normal' }],
      } as any,
      providerConfig,
    });

    // 40 ml × 5 €/ml = 200 €; dos caras = exactamente el doble (400 €), nunca 4×.
    expect(oneFace.totalPrice).toBe(200);
    expect(twoFaces.totalPrice).toBe(400);
    // Las horas también: 40/20 = 2h vs 80/20 = 4h.
    expect(oneFace.estimatedHours).toBe(2);
    expect(twoFaces.estimatedHours).toBe(4);
  });

  it('aplica la retirada de restos al precio y a las horas del seto', () => {
    const providerConfig = {
      pricing_method: 'per_quantity',
      pricing_matrix: { '0-2m': 3, '2-4m': 5, '4-6m': 8 },
      yield_ml_per_hour: { '0-2m': 30, '2-4m': 20, '4-6m': 10 },
      condition_surcharges: { media: 20, alta: 50 },
      waste_removal: { percentage: 20 },
      minimum_price: 0,
    };
    const build = (wasteRemoval: boolean) => buildAuthoritativeBookingQuote({
      bookingData: {
        serviceIds: ['svc-hedge'],
        hedgeZones: [{ id: 'hedge-1', type: '2-4m', height: '2-4m', length: 40, length_pricing_m: 40, faces_to_trim: 1, state: 'normal' }],
        wasteRemoval,
      } as any,
      providerConfig,
    });

    // 40 ml × 5 €/ml = 200 €; con retirada +20% → 240 €. Horas: 2h → 2.4h → redondeo 2.5h.
    expect(build(false).totalPrice).toBe(200);
    expect(build(false).estimatedHours).toBe(2);
    expect(build(true).totalPrice).toBe(240);
    expect(build(true).estimatedHours).toBe(2.5);
  });

  it('aplica el recargo de estado del seto (media/alta) cuando la zona lleva state', () => {
    const providerConfig = {
      pricing_method: 'per_quantity',
      pricing_matrix: { '0-2m': 3, '2-4m': 5, '4-6m': 8 },
      yield_ml_per_hour: { '0-2m': 30, '2-4m': 20, '4-6m': 10 },
      condition_surcharges: { media: 20, alta: 50 },
      waste_removal: { percentage: 0 },
      minimum_price: 0,
    };
    const build = (state: string) => buildAuthoritativeBookingQuote({
      bookingData: {
        serviceIds: ['svc-hedge'],
        hedgeZones: [{ id: 'hedge-1', type: '2-4m', height: '2-4m', length: 10, length_pricing_m: 10, faces_to_trim: 1, state }],
      } as any,
      providerConfig,
    });

    // 50 € base; media +20% → 60 €; alta +50% → 75 €.
    expect(build('normal').totalPrice).toBe(50);
    expect(build('media').totalPrice).toBe(60);
    expect(build('alta').totalPrice).toBe(75);
  });

  it('cotiza setos en modo per_hour sin exigir pricing_matrix', () => {
    const result = buildAuthoritativeBookingQuote({
      bookingData: {
        serviceIds: ['svc-hedge'],
        hedgeZones: [{ type: 'cipres', height: '2-4m', length: 20, state: 'normal', faces_to_trim: 2 }],
      } as any,
      providerConfig: {
        pricing_method: 'per_hour',
        precioPorHora: 40,
        minimum_price: 0,
        condition_surcharges: { media: 20, alta: 50 },
        waste_removal: { percentage: 0 },
        yield_ml_per_hour: { '0-2m': 25, '2-4m': 20, '4-6m': 10 },
      },
    });

    expect(result.eligibility).toEqual({ isEligible: true });
    expect(result.estimatedHours).toBe(2);
    expect(result.totalPrice).toBe(80);
  });

  it('cotiza arbustos en modo per_hour sin exigir prices_per_m2', () => {
    const result = buildAuthoritativeBookingQuote({
      bookingData: {
        serviceIds: ['svc-shrub'],
        shrubGroups: [{ id: 'shrub-1', size: 'medianas', area: 20, state: 'descuidado' }],
      } as any,
      providerConfig: {
        pricing_method: 'per_hour',
        precioPorHora: 50,
        minimum_price: 0,
        waste_removal: { percentage: 0 },
        yield_m2_per_hour: { pequeñas: 30, medianas: 20, grandes: 10 },
      },
    });

    expect(result.eligibility).toEqual({ isEligible: true });
    expect(result.estimatedHours).toBe(1.5);
    expect(result.totalPrice).toBe(75);
  });

  it('palmeras per_quantity: fórmula completa §7.4 con estado, restos, extras y acceso', () => {
    const providerConfig = {
      pricing_method: 'per_quantity',
      height_prices: { 'Phoenix canariensis': { '0-4': 60, '4-10': 100, '>10': 150 } },
      yield_units_per_hour: { 'Phoenix canariensis': { '0-4': 2, '4-10': 1 } },
      condition_surcharges: { normal: 0, descuidado: 20, muy_descuidado: 50 },
      waste_removal: { percentage: 10 },
      phytosanitary: 15,
      trunk_finish: 10,
      access_difficulty: 20,
      minimum_price: 0,
    };
    const result = buildAuthoritativeBookingQuote({
      bookingData: {
        serviceIds: ['svc-palm'],
        wasteRemoval: true,
        palmGroups: [{
          id: 'palm-1',
          species: 'Phoenix canariensis',
          height: '4-10',
          quantity: 2,
          state: 'muy_descuidado',
          hasPhytosanitary: true,
          hasTrunkPeeling: true,
          hasAccessDifficulty: true,
        }],
      } as any,
      providerConfig,
    });

    // base 100 × estado 1.5 × restos 1.1 = 165; extras = tronco 10% (16.5) + fito 15 = 31.5;
    // (165 + 31.5) × acceso 1.2 = 235.8 × 2 uds = 471.6 → 472 €.
    expect(result.totalPrice).toBe(472);
    // Horas desde los yields DEL JARDINERO también en per_quantity (§2):
    // (2/1) × 1.5 × 1.1 × 1.2 = 3.96h → redondeo a 4h.
    expect(result.estimatedHours).toBe(4);
  });

  it('palmeras: el recargo de acceso no aplica en la banda de altura mínima de la especie', () => {
    const providerConfig = {
      pricing_method: 'per_quantity',
      height_prices: { 'Phoenix canariensis': { '0-4': 60, '4-10': 100, '>10': 150 } },
      yield_units_per_hour: { 'Phoenix canariensis': { '0-4': 2, '4-10': 1 } },
      condition_surcharges: { normal: 0, descuidado: 20, muy_descuidado: 50 },
      waste_removal: { percentage: 0 },
      access_difficulty: 20,
      minimum_price: 0,
    };
    const build = (height: string) => buildAuthoritativeBookingQuote({
      bookingData: {
        serviceIds: ['svc-palm'],
        palmGroups: [{ id: 'palm-1', species: 'Phoenix canariensis', height, quantity: 2, state: 'normal', hasAccessDifficulty: true }],
      } as any,
      providerConfig,
    });

    // '0-4' es la banda mínima de Phoenix canariensis → sin recargo de acceso: 60×2 = 120 €.
    expect(build('0-4').totalPrice).toBe(120);
    // '4-10' sí lo aplica: 100×1.2×2 = 240 €.
    expect(build('4-10').totalPrice).toBe(240);
  });

  it('cotiza palmeras en modo per_hour usando pricing_method como contrato canónico', () => {
    const result = buildAuthoritativeBookingQuote({
      bookingData: {
        serviceIds: ['svc-palm'],
        palmGroups: [
          {
            id: 'palm-1',
            species: 'Phoenix canariensis',
            height: '0-4',
            quantity: 2,
            state: 'normal',
            isTerminalOpenRange: false,
          },
        ],
      } as any,
      providerConfig: {
        pricing_method: 'per_hour',
        precioPorHora: 40,
        minimum_price: 0,
        condition_surcharges: { normal: 0, descuidado: 20, muy_descuidado: 50 },
        waste_removal: { percentage: 0 },
        yield_units_per_hour: {
          'Phoenix canariensis': { '0-4': 2 },
        },
      },
    });

    expect(result.eligibility).toEqual({ isEligible: true });
    expect(result.estimatedHours).toBe(1);
    expect(result.totalPrice).toBe(40);
  });
});
