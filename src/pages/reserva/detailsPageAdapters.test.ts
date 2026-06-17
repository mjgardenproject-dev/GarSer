import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  reportBookingEvent: vi.fn(),
}))

vi.mock('../../utils/bookingTelemetry', () => ({
  reportBookingEvent: mocks.reportBookingEvent,
}))

import {
  adaptPhytosanitaryAnalysisResult,
  adaptTreeAnalysisResult,
  appendFilesToPhotoCollection,
  appendFilesToHedgeFaceCollection,
  buildDetailsPageBookingPatch,
  buildAnalysisFailureFields,
  createEmptyHedgeFaceCollection,
  getPrimaryBookingPhotoUrls,
  normalizeHedgeZonePhotoCollections,
  removePhotoFromCollection,
  removePhotoFromHedgeFaceCollection,
  reportDetailsPageIssue,
  syncLegacyHedgeZonePhotoCollections,
  toggleHedgeFacePhotoSelection,
  togglePhotoSelectionInCollection,
} from './detailsPageAdapters'

describe('detailsPageAdapters', () => {
  it('reconcilia el patch de DetailsPage desde el contrato canónico y conserva previews locales', () => {
    const patch = buildDetailsPageBookingPatch(
      {
        bookingPhotoContract: {
          schemaVersion: 'booking_photo_v1',
          items: [
            {
              id: 'storage:booking-photos:bookings/client-1/booking-1/a.jpg',
              url: 'https://cdn.example.com/a.jpg',
              storageBucket: 'booking-photos',
              storagePath: 'bookings/client-1/booking-1/a.jpg',
            },
          ],
        },
        uploadedPhotoUrls: [
          'https://legacy.example.com/stale.jpg',
          'blob:http://localhost/preview-a',
        ],
      },
      {
        uploadedPhotoUrls: [
          'https://cdn.example.com/a.jpg',
          'blob:http://localhost/preview-a',
        ],
      }
    )

    expect(patch.uploadedPhotoUrls).toEqual([
      'https://cdn.example.com/a.jpg',
      'blob:http://localhost/preview-a',
    ])
    expect(patch.bookingPhotoContract.items).toEqual([
      expect.objectContaining({
        id: 'storage:booking-photos:bookings/client-1/booking-1/a.jpg',
        url: 'https://cdn.example.com/a.jpg',
        storageBucket: 'booking-photos',
        storagePath: 'bookings/client-1/booking-1/a.jpg',
      }),
    ])
  })

  it('prioriza urls del contrato canónico y conserva previews transitorias', () => {
    expect(
      getPrimaryBookingPhotoUrls({
        bookingPhotoContract: {
          schemaVersion: 'booking_photo_v1',
          items: [
            {
              id: 'storage:booking-photos:bookings/client-1/booking-1/a.jpg',
              url: 'https://cdn.example.com/a.jpg',
              storageBucket: 'booking-photos',
              storagePath: 'bookings/client-1/booking-1/a.jpg',
            },
          ],
        },
        uploadedPhotoUrls: [
          'https://legacy.example.com/stale.jpg',
          'blob:http://localhost/preview-a',
        ],
      })
    ).toEqual([
      'https://cdn.example.com/a.jpg',
      'blob:http://localhost/preview-a',
    ])
  })

  it('adapta árboles desde analysis_v2 como fuente primaria y preserva flags de negocio', () => {
    const patch = adaptTreeAnalysisResult({
      analysis: {
        service: 'Poda de árboles',
        schema_version: 'analysis_v2',
        analysis_status: 'success',
        analysis_level: 1,
        quality_summary_code: 'READY_FOR_PRICING',
        quality_reasons: [],
        client_observations: [],
        internal_reasoning: { summary: 'ok' },
        deduplication_summary: 'ok',
        service_metrics: {
          arboles: [{ size_band: 'large' }],
        },
        source_photo_count: 1,
        analyzed_photo_indices: [0],
        provider: null,
        model: null,
        model_params: {},
        error_code: null,
        error_message_safe: null,
      },
      legacyTree: {
        size_band: 'small',
        nivel_analisis: 3,
        observaciones: ['legacy'],
      },
      selectedIndices: [0],
      totalPhotoCount: 1,
      difficultyHigh: true,
    })

    expect(patch.aiSizeBand).toBe('large')
    expect(patch.aiHeightMeters).toBe(7)
    expect(patch.difficultyHigh).toBe(true)
    expect(patch.analysisLevel).toBe(1)
    expect(patch.isFailed).toBe(false)
    expect(patch.analyzedIndices).toEqual([0])
  })

  it('adapta métricas fitosanitarias priorizando el contrato canónico', () => {
    const patch = adaptPhytosanitaryAnalysisResult({
      analysis: {
        service: 'Servicios fitosanitarios',
        schema_version: 'analysis_v2',
        analysis_status: 'partial',
        analysis_level: 2,
        quality_summary_code: 'PARTIAL_ESTIMATE',
        quality_reasons: ['SERVICE_SPECIFIC_NOTE'],
        client_observations: [
          { code: 'SERVICE_SPECIFIC_NOTE', severity: 'warning', default_copy: 'Revisar altura.' },
        ],
        internal_reasoning: { summary: 'ok' },
        deduplication_summary: 'ok',
        service_metrics: {
          cesped_m2: 12,
          seto_bajo_medio_ml: 0,
          seto_alto_ml: 3,
          palmeras_ducha_peq_ud: 1,
          palmeras_ducha_med_ud: 0,
          palmeras_ducha_alta_ud: 0,
          palmeras_cirugia_ud: 0,
          palmeras_endoterapia_troncos_ud: 0,
          arboles_peq_ud: 2,
          arboles_med_ud: 0,
          arboles_gran_ud: 0,
          herbicida_poca_densidad_m2: 0,
          herbicida_mucha_densidad_m2: 0,
          plantas_superficie_calculada_m2: 0,
          plantas_tamano_dominante: null,
          observaciones_ia: [],
        },
        source_photo_count: 2,
        analyzed_photo_indices: [0, 1],
        provider: null,
        model: null,
        model_params: {},
        error_code: null,
        error_message_safe: null,
      },
      legacyTask: { nivel_analisis: 3, observaciones: ['legacy'] },
      legacyMetrics: {
        cesped_m2: 99,
        seto_alto_ml: 99,
        arboles_peq_ud: 99,
      },
      selectedIndices: [0, 1],
      totalPhotoCount: 2,
    })

    expect(patch.analysisMetrics.cesped_m2).toBe(12)
    expect(patch.analysisMetrics.seto_alto_ml).toBe(3)
    expect(patch.analysisMetrics.arboles_peq_ud).toBe(2)
    expect(patch.area).toBe(18)
    expect(patch.analysisLevel).toBe(2)
    expect(patch.observations).toEqual(['Revisar altura.'])
  })

  it('conserva las métricas de plantas y herbicida que consume el pricing fitosanitario', () => {
    const patch = adaptPhytosanitaryAnalysisResult({
      analysis: {
        service: 'Servicios fitosanitarios',
        schema_version: 'analysis_v2',
        analysis_status: 'success',
        analysis_level: 1,
        quality_summary_code: 'READY_FOR_PRICING',
        quality_reasons: [],
        client_observations: [],
        internal_reasoning: { summary: 'ok' },
        deduplication_summary: 'ok',
        service_metrics: {
          cesped_m2: 0,
          seto_bajo_medio_ml: 0,
          seto_alto_ml: 0,
          palmeras_ducha_peq_ud: 0,
          palmeras_ducha_med_ud: 0,
          palmeras_ducha_alta_ud: 0,
          palmeras_cirugia_ud: 0,
          palmeras_endoterapia_troncos_ud: 0,
          arboles_peq_ud: 0,
          arboles_med_ud: 0,
          arboles_gran_ud: 0,
          herbicida_poca_densidad_m2: 8,
          herbicida_mucha_densidad_m2: 0,
          plantas_superficie_calculada_m2: 30,
          plantas_tamano_dominante: 'medianas',
          observaciones_ia: [],
        },
        source_photo_count: 1,
        analyzed_photo_indices: [0],
        provider: null,
        model: null,
        model_params: {},
        error_code: null,
        error_message_safe: null,
      },
      selectedIndices: [0],
      totalPhotoCount: 1,
    })

    expect(patch.analysisMetrics.plantas_superficie_calculada_m2).toBe(30)
    expect(patch.analysisMetrics.plantas_tamano_dominante).toBe('medianas')
    expect(patch.analysisMetrics.herbicida_poca_densidad_m2).toBe(8)
    // area incluye ahora la superficie de plantas y herbicida (proxy de "analizado")
    expect(patch.area).toBe(38)
  })

  it('añade fotos a una colección manteniendo la selección implícita previa', () => {
    const createObjectUrl = vi.fn((file: File) => `blob:${file.name}`)
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: createObjectUrl,
    })

    const first = new File(['a'], 'a.jpg', { type: 'image/jpeg', lastModified: 111 })
    const second = new File(['b'], 'b.jpg', { type: 'image/jpeg', lastModified: 222 })
    const result = appendFilesToPhotoCollection(
      {
        photoUrls: ['https://cdn.example.com/existing.jpg'],
        files: [],
      },
      [first, second]
    )
    const resultCollection = result.nextCollection as { photoIds?: string[]; selectedIndices?: number[] }

    expect(createObjectUrl).toHaveBeenCalledTimes(2)
    expect(result.previewUrls).toEqual(['blob:a.jpg', 'blob:b.jpg'])
    expect(result.newIndices).toEqual([1, 2])
    expect(resultCollection.photoIds).toEqual([
      'booking-photo:https://cdn.example.com/existing.jpg:0',
      'booking-photo:a.jpg:1:111:1',
      'booking-photo:b.jpg:1:222:2',
    ])
    expect(resultCollection.selectedIndices).toEqual([0, 1, 2])
  })

  it('normaliza selección y borrado de colecciones de fotos compartidas', () => {
    const toggled = togglePhotoSelectionInCollection(
      {
        photoUrls: ['a', 'b', 'c'],
      },
      1
    ) as { selectedIndices?: number[]; photoIds?: string[] }
    expect(toggled.selectedIndices).toEqual([0, 2])
    expect(toggled.photoIds).toEqual([
      'booking-photo:a:0',
      'booking-photo:b:1',
      'booking-photo:c:2',
    ])

    const removed = removePhotoFromCollection(
      {
        photoUrls: ['a', 'b', 'c'],
        files: [
          new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
          new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
          new File(['c'], 'c.jpg', { type: 'image/jpeg' }),
        ],
        selectedIndices: [0, 2],
        analyzedIndices: [1, 2],
      },
      1
    )

    expect(removed.photoUrls).toEqual(['a', 'c'])
    expect(removed.files).toHaveLength(2)
    expect(removed.selectedIndices).toEqual([0, 1])
    expect(removed.analyzedIndices).toEqual([1])
  })

  it('normaliza y sincroniza setos por caras manteniendo reglas legacy agregadas', () => {
    const normalized = normalizeHedgeZonePhotoCollections({
      photoUrls: ['front-1', 'front-2'],
      selectedIndices: [0, 1],
      analyzedIndices: [1],
      faceB: {
        photoUrls: ['back-1'],
        selectedIndices: [0],
        analyzedIndices: [],
      },
    }) as {
      faceA: { photoUrls?: string[]; photoIds?: string[] }
      faceB: { photoUrls?: string[]; photoIds?: string[] }
      hasBackFaceTrim?: boolean
    }

    expect(normalized.faceA.photoUrls).toEqual(['front-1', 'front-2'])
    expect(normalized.faceB.photoUrls).toEqual(['back-1'])
    expect(normalized.faceA.photoIds).toEqual([
      'booking-photo:front-1:0',
      'booking-photo:front-2:1',
    ])
    expect(normalized.faceB.photoIds).toEqual(['booking-photo:back-1:0'])
    expect(normalized.hasBackFaceTrim).toBe(true)

    const synced = syncLegacyHedgeZonePhotoCollections(normalized) as {
      photoIds?: string[]
      photoUrls?: string[]
      selectedIndices?: number[]
      analyzedIndices?: number[]
    }
    expect(synced.photoIds).toEqual([
      'booking-photo:front-1:0',
      'booking-photo:front-2:1',
      'booking-photo:back-1:0',
    ])
    expect(synced.photoUrls).toEqual(['front-1', 'front-2', 'back-1'])
    expect(synced.selectedIndices).toEqual([0, 1, 2])
    expect(synced.analyzedIndices).toEqual([1])
  })

  it('permite añadir, seleccionar y borrar fotos por cara sin romper la agregación legacy del seto', () => {
    const createObjectUrl = vi.fn((file: File) => `blob:${file.name}`)
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: createObjectUrl,
    })

    const initialZone = {
      id: 'hedge-1',
      faceA: createEmptyHedgeFaceCollection(),
      faceB: createEmptyHedgeFaceCollection(),
    }

    const appended = appendFilesToHedgeFaceCollection(
      initialZone,
      'faceA',
      [new File(['a'], 'a.jpg', { type: 'image/jpeg' }), new File(['b'], 'b.jpg', { type: 'image/jpeg' })],
    )
    expect(appended.zone.faceA?.photoUrls).toEqual(['blob:a.jpg', 'blob:b.jpg'])
    expect((appended.zone as { selectedIndices?: number[] }).selectedIndices).toEqual([0, 1])

    const toggled = toggleHedgeFacePhotoSelection(appended.zone, 'faceA', 1) as typeof appended.zone & {
      selectedIndices?: number[]
    }
    expect(toggled.faceA?.selectedIndices).toEqual([0])
    expect(toggled.selectedIndices).toEqual([0])

    const removed = removePhotoFromHedgeFaceCollection(
      {
        ...toggled,
        faceB: {
          ...createEmptyHedgeFaceCollection(),
          photoUrls: ['back-1'],
          files: [new File(['c'], 'c.jpg', { type: 'image/jpeg' })],
          selectedIndices: [0],
          analyzedIndices: [0],
        },
      },
      'faceA',
      0,
    )

    expect(removed.faceA?.photoUrls).toEqual(['blob:b.jpg'])
    expect((removed as { photoUrls?: string[] }).photoUrls).toEqual(['blob:b.jpg', 'back-1'])
    expect((removed as { selectedIndices?: number[] }).selectedIndices).toEqual([1])
    expect((removed as { analyzedIndices?: number[] }).analyzedIndices).toEqual([1])
  })

  it('construye fallo técnico controlado y emite telemetría estructurada', () => {
    const failure = buildAnalysisFailureFields({
      serviceName: 'Poda de árboles',
      selectedIndices: [1],
      totalPhotoCount: 3,
    })

    expect(failure.isFailed).toBe(true)
    expect(failure.analysisLevel).toBe(3)
    expect(failure.analyzedIndices).toEqual([1])

    reportDetailsPageIssue({
      event: 'booking.details_analysis_failed',
      service: 'Poda de árboles',
      error: new Error('boom'),
      serviceId: 'svc-1',
      zoneId: 'tree-1',
      scope: 'details_tree_analysis',
      photoCount: 3,
    })

    expect(mocks.reportBookingEvent).toHaveBeenCalledWith(
      'warn',
      expect.objectContaining({
        event: 'booking.details_analysis_failed',
        context: expect.objectContaining({
          service: 'Poda de árboles',
          serviceId: 'svc-1',
          zoneId: 'tree-1',
          scope: 'details_tree_analysis',
          photoCount: 3,
          message: 'boom',
        }),
      })
    )
  })
})
