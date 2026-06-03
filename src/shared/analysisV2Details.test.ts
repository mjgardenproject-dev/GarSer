import { describe, expect, it } from 'vitest';
import { adaptLegacyAnalysisToV2 } from './analysisV2';
import {
  buildAnalysisCommonFields,
  buildTechnicalFailureAnalysis,
  getAnalysisPresentation,
  getCanonicalAnalyzedPhotoIndices,
  getCanonicalAnalysisObservations,
  getAnalysisLoadingMessage,
  resetAnalysisCommonFields,
} from './analysisV2Details';

describe('analysisV2Details', () => {
  it('prioriza observaciones canónicas visibles al cliente', () => {
    const analysis = adaptLegacyAnalysisToV2({
      serviceName: 'Corte de césped',
      sourcePhotoCount: 2,
      legacyResponse: {
        tareas: [{
          tipo_servicio: 'Corte de césped',
          superficie_m2: 20,
          estado_jardin: 'normal',
          nivel_analisis: 2,
          observaciones: ['LOW_LIGHT', 'PARTIAL_FRAME'],
          indices_imagenes: [1],
        }],
      },
    });

    expect(getCanonicalAnalysisObservations(analysis)).toEqual([
      'La iluminacion limita parte del analisis visual.',
      'Parte de la zona queda fuera del encuadre.',
    ]);
  });

  it('usa índices analizados de analysis_v2 para el estado local', () => {
    const analysis = adaptLegacyAnalysisToV2({
      serviceName: 'Corte de césped',
      sourcePhotoCount: 3,
      legacyResponse: {
        tareas: [{
          tipo_servicio: 'Corte de césped',
          superficie_m2: 18,
          estado_jardin: 'descuidado',
          nivel_analisis: 1,
          indices_imagenes: [2, 0, 2],
        }],
      },
    });

    expect(buildAnalysisCommonFields({
      analysis,
      totalPhotoCount: 3,
      selectedIndices: [0, 1, 2],
    })).toMatchObject({
      analysisLevel: 1,
      isFailed: false,
      analyzedIndices: [0, 2],
    });
  });

  it('separa error técnico de análisis fallido en la presentación', () => {
    const technical = buildTechnicalFailureAnalysis('Poda de árboles', 1);
    const technicalPresentation = getAnalysisPresentation(technical);

    expect(technicalPresentation.status).toBe('technical_error');
    expect(technicalPresentation.isTechnicalError).toBe(true);
    expect(technicalPresentation.badgeLabel).toBe('Revision no disponible');

    const failed = adaptLegacyAnalysisToV2({
      serviceName: 'Poda de árboles',
      sourcePhotoCount: 1,
      legacyResponse: {
        arboles: [{ indice_imagen: 0, size_band: 'small', nivel_analisis: 3, observaciones: ['ELEMENTS_NOT_DETECTED'] }],
      },
    });

    const failedPresentation = getAnalysisPresentation(failed);
    expect(failedPresentation.status).toBe('failed');
    expect(failedPresentation.isTechnicalError).toBe(false);
    expect(failedPresentation.badgeLabel).toBe('Sin evidencia suficiente');
  });

  it('presenta nivel 1 como resultado fiable listo para presupuesto', () => {
    const success = adaptLegacyAnalysisToV2({
      serviceName: 'Desbroce de malas hierbas',
      sourcePhotoCount: 2,
      legacyResponse: {
        tareas: [{
          tipo_servicio: 'Desbroce de malas hierbas',
          superficie_malas_hierbas_m2: 16,
          estado_malas_hierbas: 'normal',
          nivel_analisis: 1,
        }],
      },
    });

    expect(getAnalysisPresentation(success)).toMatchObject({
      status: 'success',
      isFailed: false,
      isTechnicalError: false,
      tone: 'success',
      badgeLabel: 'Análisis fiable',
      title: 'Resultado listo para presupuesto',
      message: 'Las métricas detectadas son aptas para calcular precio y tiempo.',
    });
  });

  it('usa fallback local para estados cuando aún no existe analysis_v2', () => {
    expect(getAnalysisPresentation(undefined, {
      analysisLevel: 2,
      observations: ['Revisión manual recomendada'],
    })).toMatchObject({
      status: 'partial',
      tone: 'partial',
      badgeLabel: 'Estimación parcial',
      message: 'Revisión manual recomendada',
    });
  });

  it('prioriza índices canónicos y cae a selección local filtrando duplicados e índices inválidos', () => {
    const analysis = adaptLegacyAnalysisToV2({
      serviceName: 'Corte de césped',
      sourcePhotoCount: 3,
      legacyResponse: {
        tareas: [{
          tipo_servicio: 'Corte de césped',
          superficie_m2: 18,
          estado_jardin: 'normal',
          nivel_analisis: 1,
          indices_imagenes: [2, 1, 2],
        }],
      },
    });

    expect(getCanonicalAnalyzedPhotoIndices(analysis, {
      totalPhotoCount: 3,
      analyzedIndices: [0],
      selectedIndices: [0, 1, 2],
    })).toEqual([1, 2]);

    expect(getCanonicalAnalyzedPhotoIndices(undefined, {
      totalPhotoCount: 3,
      analyzedIndices: [2, 2, 4, -1],
      selectedIndices: [0, 1],
    })).toEqual([2]);

    expect(getCanonicalAnalyzedPhotoIndices(undefined, {
      totalPhotoCount: 3,
      selectedIndices: [2, 2, 3, -1],
    })).toEqual([]);
  });

  it('resetea campos comunes de análisis para reanálisis sin dejar residuos', () => {
    expect(resetAnalysisCommonFields({
      id: 'zone-1',
      analysisLevel: 3,
      isFailed: true,
      observations: ['No se detecta con fiabilidad el elemento a analizar.'],
      analyzedIndices: [0, 2],
      analysisV2: buildTechnicalFailureAnalysis('Poda de palmeras', 2),
      quantity: 4,
    }, {
      quantity: 0,
    })).toMatchObject({
      id: 'zone-1',
      analysisLevel: undefined,
      isFailed: false,
      observations: [],
      analyzedIndices: [],
      analysisV2: undefined,
      quantity: 0,
    });
  });

  it('mantiene mensajes de carga específicos por servicio en el patrón común', () => {
    expect(getAnalysisLoadingMessage('Corte de césped')).toBe('Analizando zona de césped...');
    expect(getAnalysisLoadingMessage('Corte de setos')).toBe('Analizando zona de setos...');
    expect(getAnalysisLoadingMessage('Poda de palmeras')).toBe('Analizando palmeras...');
    expect(getAnalysisLoadingMessage('Poda de árboles')).toBe('Analizando árboles...');
    expect(getAnalysisLoadingMessage('Poda de plantas y arbustos')).toBe('Analizando plantas y arbustos...');
    expect(getAnalysisLoadingMessage('Desbroce de malas hierbas')).toBe('Analizando desbroce...');
    expect(getAnalysisLoadingMessage('Servicios fitosanitarios')).toBe('Analizando zona de tratamientos...');
  });
});
