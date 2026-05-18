// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { adaptLegacyAnalysisToV2 } from '../../shared/analysisV2';
import { buildTechnicalFailureAnalysis } from '../../shared/analysisV2Details';
import { ServiceResultCard } from './ServiceResultCard';

const baseStats = [
  { label: 'Cantidad', value: '12' },
  { label: 'Estado', value: 'normal' },
];

describe('ServiceResultCard', () => {
  it('muestra estado fiable para nivel 1', () => {
    const analysis = adaptLegacyAnalysisToV2({
      serviceName: 'Corte de césped',
      sourcePhotoCount: 2,
      legacyResponse: {
        tareas: [{
          tipo_servicio: 'Corte de césped',
          superficie_m2: 24,
          estado_jardin: 'normal',
          nivel_analisis: 1,
        }],
      },
    });

    render(
      <ServiceResultCard
        title="Césped general"
        analysis={analysis}
        stats={baseStats}
      />,
    );

    expect(screen.getByText('Análisis fiable')).toBeTruthy();
    expect(screen.queryByText('La estimación sigue siendo utilizable para presupuesto.')).toBeNull();
  });

  it('muestra observaciones y ayuda contextual para nivel 2', () => {
    const analysis = adaptLegacyAnalysisToV2({
      serviceName: 'Corte de césped',
      sourcePhotoCount: 2,
      legacyResponse: {
        tareas: [{
          tipo_servicio: 'Corte de césped',
          superficie_m2: 24,
          estado_jardin: 'normal',
          nivel_analisis: 2,
          observaciones: ['LOW_LIGHT'],
        }],
      },
    });

    render(
      <ServiceResultCard
        title="Césped general"
        analysis={analysis}
        stats={baseStats}
      />,
    );

    expect(screen.getByText('Estimación parcial')).toBeTruthy();
    expect(screen.getByText('La estimación sigue siendo utilizable para presupuesto.')).toBeTruthy();
    expect(screen.getByText('La iluminacion limita parte del analisis visual.')).toBeTruthy();
  });

  it('muestra fallo de evidencia para nivel 3', () => {
    const analysis = adaptLegacyAnalysisToV2({
      serviceName: 'Corte de césped',
      sourcePhotoCount: 1,
      legacyResponse: {
        tareas: [{
          tipo_servicio: 'Corte de césped',
          superficie_m2: 0,
          estado_jardin: null,
          nivel_analisis: 3,
          observaciones: ['ELEMENTS_NOT_DETECTED'],
        }],
      },
    });

    render(
      <ServiceResultCard
        title="Césped general"
        analysis={analysis}
        stats={baseStats}
      />,
    );

    expect(screen.getByText('Sin evidencia suficiente')).toBeTruthy();
    expect(screen.getByText('No se detecta con fiabilidad el elemento a analizar.')).toBeTruthy();
  });

  it('muestra error técnico controlado y mensaje seguro', () => {
    render(
      <ServiceResultCard
        title="Césped general"
        analysis={buildTechnicalFailureAnalysis('Corte de césped', 2)}
        stats={baseStats}
      />,
    );

    expect(screen.getByText('Error técnico controlado')).toBeTruthy();
    expect(screen.getByText('Se ha producido un error interno controlado.')).toBeTruthy();
  });
});
