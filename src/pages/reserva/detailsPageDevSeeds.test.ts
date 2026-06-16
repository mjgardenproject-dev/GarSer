// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  buildHedgeDevZone,
  buildLawnDevZone,
  buildPalmDevGroup,
  buildPhytosanitaryDevZone,
  buildShrubDevGroup,
  buildTreeDevGroup,
  buildWeedingDevZone,
} from './detailsPageDevSeeds';

describe('detailsPageDevSeeds', () => {
  it('genera una zona de cesped con contrato de analisis valido', () => {
    const zone = buildLawnDevZone();

    expect(zone.quantity).toBeGreaterThan(0);
    expect(zone.analysisLevel).toBe(1);
    expect(zone.analysisV2?.service).toBe('Corte de césped');
    expect(zone.photoUrls?.length).toBeGreaterThan(0);
    expect(zone.analyzedIndices).toEqual([0, 1]);
  });

  it('genera un seto con cara A y cara B listos para pricing', () => {
    const zone = buildHedgeDevZone();

    expect(zone.length).toBeGreaterThan(0);
    expect(zone.faces_to_trim).toBe(2);
    expect(zone.faceA?.photoUrls?.length).toBe(1);
    expect(zone.faceB?.photoUrls?.length).toBe(1);
    expect(zone.analysisV2?.service).toBe('Poda de setos');
  });

  it('genera un grupo de palmeras analizado', () => {
    const group = buildPalmDevGroup();

    expect(group.quantity).toBeGreaterThan(0);
    expect(group.species).toBe('Phoenix canariensis');
    expect(group.analysisLevel).toBe(1);
    expect(group.analysisV2?.service).toBe('Poda de palmeras');
  });

  it('genera un grupo de arboles con acceso respondido y horas iniciales', () => {
    const group = buildTreeDevGroup();

    expect(group.aiSizeBand).toBe('medium');
    expect(group.difficultyHigh).toBe(false);
    expect(group.estimatedHours).toBeGreaterThan(0);
    expect(group.analysisV2?.service).toBe('Poda de árboles');
  });

  it('genera un grupo de arbustos con area y tamano validos', () => {
    const group = buildShrubDevGroup();

    expect(group.area).toBeGreaterThan(0);
    expect(group.size).toBe('medianas');
    expect(group.analysisV2?.service).toBe('Poda de plantas y arbustos');
  });

  it('genera una zona fitosanitaria valida para continuar', () => {
    const zone = buildPhytosanitaryDevZone();

    expect(zone.scope).toEqual(['setos']);
    expect(zone.requestedTreatment).toBe('insecticida');
    expect(zone.affectedType).toBe('Setos');
    expect(zone.type).toBe('insecticida');
    expect(zone.area).toBeGreaterThan(0);
    expect(zone.analysisMetrics?.seto_bajo_medio_ml).toBeGreaterThan(0);
    expect(zone.analysisV2?.service).toBe('Servicios fitosanitarios');
  });

  it('genera una zona de desbroce valida para confirmar manualmente', () => {
    const zone = buildWeedingDevZone();

    expect(zone.area).toBeGreaterThan(0);
    expect(zone.state).toBe('dificultad_media');
    expect(zone.analysisLevel).toBe(1);
    expect(zone.analysisV2?.service).toBe('Desbroce de malas hierbas');
  });
});
