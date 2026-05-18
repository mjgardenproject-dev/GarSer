import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_CONTRACT_INVENTORY,
  adaptLegacyAnalysisToV2,
  type HedgeServiceMetrics,
  type LawnServiceMetrics,
  type LegacyAnalysisResponse,
  type PalmServiceMetrics,
  type PhytosanitaryServiceMetrics,
  type ShrubServiceMetrics,
  type TreeServiceMetrics,
  type WeedingServiceMetrics,
  validateAnalysisV2,
} from './analysisV2';

describe('ANALYSIS_CONTRACT_INVENTORY', () => {
  it('documenta campos de pricing y tiempo para todos los servicios aprobados', () => {
    Object.values(ANALYSIS_CONTRACT_INVENTORY).forEach((entry) => {
      expect(entry.legacy_sources.length).toBeGreaterThan(0);
      expect(entry.pricing_fields.length).toBeGreaterThan(0);
      expect(entry.time_fields.length).toBeGreaterThan(0);
      expect(entry.analysis_v2_metrics.length).toBeGreaterThan(0);
    });
  });
});

describe('adaptLegacyAnalysisToV2', () => {
  it('preserva métricas de césped para pricing y tiempo', () => {
    const analysis = adaptLegacyAnalysisToV2({
      serviceName: 'Corte de césped',
      sourcePhotoCount: 3,
      legacyResponse: {
        tareas: [{
          tipo_servicio: 'Corte de césped',
          superficie_m2: 85,
          estado_jardin: 'descuidado',
          nivel_analisis: 2,
          observaciones: ['zona con sombras'],
        }],
      },
    });

    const metrics = analysis.service_metrics as LawnServiceMetrics;
    expect(metrics.superficie_m2).toBe(85);
    expect(metrics.estado_jardin).toBe('descuidado');
    expect(analysis.analysis_status).toBe('partial');
    expect(validateAnalysisV2(analysis)).toEqual([]);
  });

  it('preserva cálculo consolidado de setos sin perder resumen de medición', () => {
    const analysis = adaptLegacyAnalysisToV2({
      serviceName: 'Corte de setos',
      sourcePhotoCount: 2,
      legacyResponse: {
        tareas: [{
          tipo_servicio: 'Corte de setos',
          longitud_m: 12,
          altura_m: 2.5,
          tipo_seto: '2-4m',
          estado_seto: 'media',
          caras: 2,
          resumen_medicion: {
            base_longitud_m: 6,
            base_altura_m: 2.5,
            caras_recortar: 2,
            longitud_calculo_m: 12,
            altura_calculo_m: 5,
            metodo: 'media_caras',
          },
          nivel_analisis: 1,
        }],
      },
    });

    const metrics = analysis.service_metrics as HedgeServiceMetrics;
    expect(metrics.longitud_m).toBe(12);
    expect(metrics.altura_m).toBe(2.5);
    expect(metrics.caras).toBe(2);
    expect(metrics.resumen_medicion?.longitud_calculo_m).toBe(12);
    expect(validateAnalysisV2(analysis)).toEqual([]);
  });

  it('preserva especies, alturas y estado de palmeras', () => {
    const analysis = adaptLegacyAnalysisToV2({
      serviceName: 'Poda de palmeras',
      sourcePhotoCount: 3,
      legacyResponse: {
        palmas: [
          {
            indice_imagen: 1,
            especie: 'Phoenix canariensis',
            altura_m: 8.2,
            estado: 'descuidado',
            nivel_analisis: 1,
          },
          {
            indice_imagen: 2,
            especie: 'Washingtonia robusta/filifera',
            altura_m: 12.4,
            estado: 'muy descuidado',
            nivel_analisis: 2,
            observaciones: ['copa parcialmente oculta'],
          },
        ],
      },
    });

    const metrics = analysis.service_metrics as PalmServiceMetrics;
    expect(metrics.palmas).toHaveLength(2);
    expect(metrics.palmas[0]).toMatchObject({
      especie: 'Phoenix canariensis',
      altura_m: 8.2,
      estado: 'descuidado',
    });
    expect(analysis.analyzed_photo_indices).toEqual([1, 2]);
    expect(analysis.analysis_status).toBe('partial');
    expect(validateAnalysisV2(analysis)).toEqual([]);
  });

  it('preserva bands y horas de árboles', () => {
    const analysis = adaptLegacyAnalysisToV2({
      serviceName: 'Poda de árboles',
      sourcePhotoCount: 1,
      legacyResponse: {
        arboles: [{
          indice_imagen: 0,
          especie: 'Olivo',
          size_band: 'large',
          tipo_arbol: 'Frutal',
          horas_estimadas: 2.5,
          nivel_analisis: 1,
        }],
      },
    });

    const metrics = analysis.service_metrics as TreeServiceMetrics;
    expect(metrics.arboles).toHaveLength(1);
    expect(metrics.arboles[0]).toMatchObject({
      size_band: 'large',
      tipo_arbol: 'Frutal',
      horas_estimadas: 2.5,
    });
    expect(validateAnalysisV2(analysis)).toEqual([]);
  });

  it('deriva superficie de arbustos desde payload legacy si falta superficie_m2 explícita', () => {
    const analysis = adaptLegacyAnalysisToV2({
      serviceName: 'Poda de plantas y arbustos',
      sourcePhotoCount: 2,
      legacyResponse: {
        tareas: [{
          tipo_servicio: 'Poda de plantas y arbustos',
          tamano_total_jardin_m2: 40,
          porcentaje_superficie_plantas: 25,
          tamano_dominante: 'medianas',
          nivel_analisis: 1,
        }],
      },
    });

    const metrics = analysis.service_metrics as ShrubServiceMetrics;
    expect(metrics.superficie_m2).toBe(10);
    expect(metrics.tamano_dominante).toBe('medianas');
    expect(validateAnalysisV2(analysis)).toEqual([]);
  });

  it('preserva superficie y estado de desbroce', () => {
    const analysis = adaptLegacyAnalysisToV2({
      serviceName: 'Desbroce de malas hierbas',
      sourcePhotoCount: 1,
      legacyResponse: {
        tareas: [{
          tipo_servicio: 'Desbroce de malas hierbas',
          superficie_malas_hierbas_m2: 72,
          estado_malas_hierbas: 'dificultad_alta',
          nivel_analisis: 1,
        }],
      },
    });

    const metrics = analysis.service_metrics as WeedingServiceMetrics;
    expect(metrics.superficie_malas_hierbas_m2).toBe(72);
    expect(metrics.estado_malas_hierbas).toBe('dificultad_alta');
    expect(validateAnalysisV2(analysis)).toEqual([]);
  });

  it('preserva métricas fitosanitarias consumidas por pricing y tiempo', () => {
    const analysis = adaptLegacyAnalysisToV2({
      serviceName: 'Servicios fitosanitarios',
      sourcePhotoCount: 4,
      legacyResponse: {
        tareas: [{
          tipo_servicio: 'Servicios fitosanitarios',
          nivel_analisis: 2,
          observaciones: ['zona con sombras'],
          metricas_fitosanitarias: {
            cesped_m2: 35,
            seto_bajo_medio_ml: 12,
            seto_alto_ml: 4,
            palmeras_ducha_peq_ud: 1,
            palmeras_ducha_med_ud: 2,
            palmeras_ducha_alta_ud: 0,
            palmeras_cirugia_ud: 1,
            palmeras_endoterapia_troncos_ud: 2,
            arboles_peq_ud: 3,
            arboles_med_ud: 1,
            arboles_gran_ud: 0,
            herbicida_poca_densidad_m2: 18,
            herbicida_mucha_densidad_m2: 7,
            plantas_superficie_calculada_m2: 22,
            plantas_tamano_dominante: 'medianas',
            observaciones_ia: ['spraying risk'],
          },
        }],
      },
    });

    const metrics = analysis.service_metrics as PhytosanitaryServiceMetrics;
    expect(metrics.cesped_m2).toBe(35);
    expect(metrics.palmeras_endoterapia_troncos_ud).toBe(2);
    expect(metrics.herbicida_mucha_densidad_m2).toBe(7);
    expect(metrics.plantas_superficie_calculada_m2).toBe(22);
    expect(analysis.analysis_status).toBe('partial');
    expect(validateAnalysisV2(analysis)).toEqual([]);
  });

  it('convierte errores técnicos a analysis_v2 controlado', () => {
    const analysis = adaptLegacyAnalysisToV2({
      serviceName: 'Corte de césped',
      sourcePhotoCount: 2,
      legacyResponse: {
        reasons: ['PROVIDER_RATE_LIMIT'],
      },
    });

    expect(analysis.analysis_status).toBe('technical_error');
    expect(analysis.error_code).toBe('PROVIDER_RATE_LIMIT');
    expect(analysis.error_message_safe).toBe('El proveedor de analisis esta temporalmente saturado.');
    expect(analysis.quality_reasons).toContain('ANALYSIS_TECHNICAL_FAILURE');
    expect(validateAnalysisV2(analysis)).toEqual([]);
  });

  it('normaliza observaciones visibles del cliente desde el catalogo universal', () => {
    const analysis = adaptLegacyAnalysisToV2({
      serviceName: 'Corte de césped',
      sourcePhotoCount: 1,
      legacyResponse: {
        tareas: [{
          tipo_servicio: 'Corte de césped',
          superficie_m2: 20,
          estado_jardin: 'normal',
          nivel_analisis: 2,
          observaciones: ['LOW_LIGHT'],
        }],
      },
    });

    expect(analysis.client_observations).toEqual([
      {
        code: 'LOW_LIGHT',
        severity: 'warning',
        default_copy: 'La iluminacion limita parte del analisis visual.',
        service_overrides: undefined,
      },
    ]);
  });

  it('mantiene la misma semantica transversal para nivel 2 en todos los servicios', () => {
    const cases: Array<{ serviceName: string; legacyResponse: LegacyAnalysisResponse }> = [
      {
        serviceName: 'Corte de césped',
        legacyResponse: {
          tareas: [{ tipo_servicio: 'Corte de césped', superficie_m2: 10, estado_jardin: 'descuidado', nivel_analisis: 2, observaciones: ['LOW_LIGHT'] }],
        },
      },
      {
        serviceName: 'Corte de setos',
        legacyResponse: {
          tareas: [{ tipo_servicio: 'Corte de setos', longitud_m: 8, altura_m: 2, tipo_seto: '0-2m', estado_seto: 'media', caras: 1, nivel_analisis: 2, observaciones: ['LOW_LIGHT'] }],
        },
      },
      {
        serviceName: 'Poda de palmeras',
        legacyResponse: {
          palmas: [{ indice_imagen: 0, especie: 'Phoenix canariensis', altura_m: 4, estado: 'normal', nivel_analisis: 2, observaciones: ['LOW_LIGHT'] }],
        },
      },
      {
        serviceName: 'Poda de árboles',
        legacyResponse: {
          arboles: [{ indice_imagen: 0, size_band: 'medium', nivel_analisis: 2, observaciones: ['LOW_LIGHT'] }],
        },
      },
      {
        serviceName: 'Poda de plantas y arbustos',
        legacyResponse: {
          tareas: [{ tipo_servicio: 'Poda de plantas y arbustos', superficie_m2: 12, tamano_dominante: 'medianas', nivel_analisis: 2, observaciones: ['LOW_LIGHT'] }],
        },
      },
      {
        serviceName: 'Desbroce de malas hierbas',
        legacyResponse: {
          tareas: [{ tipo_servicio: 'Desbroce de malas hierbas', superficie_malas_hierbas_m2: 14, estado_malas_hierbas: 'normal', nivel_analisis: 2, observaciones: ['LOW_LIGHT'] }],
        },
      },
      {
        serviceName: 'Servicios fitosanitarios',
        legacyResponse: {
          tareas: [{
            tipo_servicio: 'Servicios fitosanitarios',
            nivel_analisis: 2,
            observaciones: ['LOW_LIGHT'],
            metricas_fitosanitarias: { cesped_m2: 5, observaciones_ia: ['LOW_LIGHT'] },
          }],
        },
      },
    ];

    cases.forEach(({ serviceName, legacyResponse }) => {
      const analysis = adaptLegacyAnalysisToV2({
        serviceName,
        sourcePhotoCount: 2,
        legacyResponse,
      });

      expect(analysis.analysis_status).toBe('partial');
      expect(analysis.analysis_level).toBe(2);
      expect(analysis.quality_summary_code).toBe('PARTIAL_ESTIMATE');
      expect(analysis.quality_reasons).toContain('LOW_LIGHT');
      expect(analysis.error_code).toBeNull();
      expect(validateAnalysisV2(analysis)).toEqual([]);
    });
  });

  it('mantiene la misma semantica transversal para nivel 3 en todos los servicios', () => {
    const cases: Array<{ serviceName: string; legacyResponse: LegacyAnalysisResponse }> = [
      {
        serviceName: 'Corte de césped',
        legacyResponse: {
          tareas: [{ tipo_servicio: 'Corte de césped', superficie_m2: 0, estado_jardin: null, nivel_analisis: 3, observaciones: ['ELEMENTS_NOT_DETECTED'] }],
        },
      },
      {
        serviceName: 'Corte de setos',
        legacyResponse: {
          tareas: [{ tipo_servicio: 'Corte de setos', longitud_m: 0, altura_m: 0, tipo_seto: null, estado_seto: null, caras: 1, nivel_analisis: 3, observaciones: ['ELEMENTS_NOT_DETECTED'] }],
        },
      },
      {
        serviceName: 'Poda de palmeras',
        legacyResponse: {
          palmas: [{ indice_imagen: 0, especie: 'No detectada', altura_m: 0, estado: null, nivel_analisis: 3, observaciones: ['ELEMENTS_NOT_DETECTED'] }],
        },
      },
      {
        serviceName: 'Poda de árboles',
        legacyResponse: {
          arboles: [{ indice_imagen: 0, size_band: 'small', nivel_analisis: 3, observaciones: ['ELEMENTS_NOT_DETECTED'] }],
        },
      },
      {
        serviceName: 'Poda de plantas y arbustos',
        legacyResponse: {
          tareas: [{ tipo_servicio: 'Poda de plantas y arbustos', superficie_m2: 0, tamano_dominante: null, nivel_analisis: 3, observaciones: ['ELEMENTS_NOT_DETECTED'] }],
        },
      },
      {
        serviceName: 'Desbroce de malas hierbas',
        legacyResponse: {
          tareas: [{ tipo_servicio: 'Desbroce de malas hierbas', superficie_malas_hierbas_m2: 0, estado_malas_hierbas: null, nivel_analisis: 3, observaciones: ['ELEMENTS_NOT_DETECTED'] }],
        },
      },
      {
        serviceName: 'Servicios fitosanitarios',
        legacyResponse: {
          tareas: [{
            tipo_servicio: 'Servicios fitosanitarios',
            nivel_analisis: 3,
            observaciones: ['ELEMENTS_NOT_DETECTED'],
            metricas_fitosanitarias: { observaciones_ia: ['ELEMENTS_NOT_DETECTED'] },
          }],
        },
      },
    ];

    cases.forEach(({ serviceName, legacyResponse }) => {
      const analysis = adaptLegacyAnalysisToV2({
        serviceName,
        sourcePhotoCount: 2,
        legacyResponse,
      });

      expect(analysis.analysis_status).toBe('failed');
      expect(analysis.analysis_level).toBe(3);
      expect(analysis.quality_summary_code).toBe('INSUFFICIENT_VISUAL_EVIDENCE');
      expect(analysis.quality_reasons).toContain('ELEMENTS_NOT_DETECTED');
      expect(analysis.error_code).toBeNull();
      expect(validateAnalysisV2(analysis)).toEqual([]);
    });
  });
});
