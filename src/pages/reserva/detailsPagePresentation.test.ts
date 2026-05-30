import { describe, expect, it } from 'vitest'

import {
  getDetailsContinueDisabled,
  getDetailsContinueLabel,
  getDetailsServiceFlags,
} from './detailsPagePresentation'

describe('detailsPagePresentation', () => {
  it('clasifica correctamente los servicios activos del funnel', () => {
    expect(getDetailsServiceFlags('Corte de césped')).toMatchObject({
      isLawn: true,
      showsPhotoCounter: false,
      showsGlobalAnalyzeButton: false,
    })

    expect(getDetailsServiceFlags('Desbroce de malas hierbas')).toMatchObject({
      isWeeding: true,
      showsPhotoCounter: false,
      showsGlobalAnalyzeButton: false,
    })

    expect(getDetailsServiceFlags('Servicios fitosanitarios')).toMatchObject({
      isPhytosanitary: true,
      showsGlobalAnalyzeButton: true,
    })
  })

  it('bloquea el CTA de desbroce hasta que exista confirmacion manual y datos validos', () => {
    const bookingData = {
      weedingZones: [{ id: 'zone-1', area: 40, state: 'normal' }],
      phytosanitaryZones: [],
      estimatedHours: 1,
    } as any

    expect(
      getDetailsContinueDisabled({
        bookingData,
        serviceFlags: getDetailsServiceFlags('Desbroce de malas hierbas'),
        weedingManualConfirmed: false,
        getPhytosanitaryValidation: () => ({ issues: [] }),
        isPhytosanitaryZoneAnalyzed: () => false,
      }),
    ).toBe(true)

    expect(
      getDetailsContinueDisabled({
        bookingData,
        serviceFlags: getDetailsServiceFlags('Desbroce de malas hierbas'),
        weedingManualConfirmed: true,
        getPhytosanitaryValidation: () => ({ issues: [] }),
        isPhytosanitaryZoneAnalyzed: () => false,
      }),
    ).toBe(false)
  })

  it('genera el copy del CTA segun el dominio activo', () => {
    expect(
      getDetailsContinueLabel(
        {
          lawnZones: [{ analysisLevel: 2 }, { analysisLevel: 1 }, { analysisLevel: 0 }],
          hedgeZones: [],
          phytosanitaryZones: [],
          treeGroups: [],
        } as any,
        getDetailsServiceFlags('Corte de césped'),
      ),
    ).toBe('Continuar con 2 zonas')

    expect(
      getDetailsContinueLabel(
        {
          lawnZones: [],
          hedgeZones: [],
          phytosanitaryZones: [{ analysisLevel: 2 }],
          treeGroups: [],
        } as any,
        getDetailsServiceFlags('Servicios fitosanitarios'),
      ),
    ).toBe('Continuar con 1 zona')
  })
})
