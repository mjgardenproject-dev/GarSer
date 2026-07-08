import type { AnalysisService, AnalysisV2Envelope } from '../../shared/analysisV2'
import {
  buildAnalysisCommonFields,
  buildTechnicalFailureAnalysis,
} from '../../shared/analysisV2Details'
import {
  BOOKING_PHOTO_CONTRACT_VERSION,
  buildBookingPhotoContract,
  extractBookingPhotoUrls,
  extractPreferredBookingPhotoUrls,
} from '../../utils/bookingPhotoContract'
import { reportBookingEvent } from '../../utils/bookingTelemetry'

export type TreeSizeBand = 'small' | 'medium' | 'large' | 'over_9'

export type PhytosanitaryPlantasSize = 'pequenas' | 'medianas' | 'grandes' | null

export type PhytosanitaryAnalysisMetrics = {
  cesped_m2: number
  seto_bajo_medio_ml: number
  seto_alto_ml: number
  palmeras_ducha_peq_ud: number
  palmeras_ducha_med_ud: number
  palmeras_ducha_alta_ud: number
  palmeras_cirugia_ud: number
  palmeras_endoterapia_troncos_ud: number
  arboles_peq_ud: number
  arboles_med_ud: number
  arboles_gran_ud: number
  herbicida_poca_densidad_m2: number
  herbicida_mucha_densidad_m2: number
  plantas_superficie_calculada_m2: number
  plantas_tamano_dominante: PhytosanitaryPlantasSize
  observaciones_ia: string[]
}

export const EMPTY_PHYTOSANITARY_ANALYSIS_METRICS: PhytosanitaryAnalysisMetrics = {
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
  herbicida_poca_densidad_m2: 0,
  herbicida_mucha_densidad_m2: 0,
  plantas_superficie_calculada_m2: 0,
  plantas_tamano_dominante: null,
  observaciones_ia: [],
}

export interface AnalysisDebugInfo {
  service: string
  model: string
  promptInputs: any
  rawResponse: any
  parsedResponse: any
  finalAnalysisData: any
  errors: any[]
  timestamp: string
}

type MainPhotoSource = {
  bookingPhotoContract?: unknown
  uploadedPhotoUrls?: unknown[]
}

type PhotoCollectionSource = {
  photoIds?: string[]
  photoUrls?: string[]
  files?: File[]
  selectedIndices?: number[]
  analyzedIndices?: number[]
}

export type HedgeFaceKey = 'faceA' | 'faceB'

export type HedgeFaceCollection = PhotoCollectionSource & {
  analysisLevel?: number
  observations?: string[]
  longitud_m?: number
  altura_m?: number
}

export type HedgeZonePhotoCollections = {
  faceA?: HedgeFaceCollection
  faceB?: HedgeFaceCollection
  hasBackFaceTrim?: boolean
  photoUrls?: string[]
  files?: File[]
  selectedIndices?: number[]
  analyzedIndices?: number[]
}

const TREE_SIZE_BAND_FALLBACK_METERS: Record<TreeSizeBand, number> = {
  small: 2,
  medium: 4,
  large: 7,
  over_9: 9.5,
}

const PHYTOSANITARY_METRIC_KEYS: Array<keyof Omit<PhytosanitaryAnalysisMetrics, 'observaciones_ia' | 'plantas_tamano_dominante'>> = [
  'cesped_m2',
  'seto_bajo_medio_ml',
  'seto_alto_ml',
  'palmeras_ducha_peq_ud',
  'palmeras_ducha_med_ud',
  'palmeras_ducha_alta_ud',
  'palmeras_cirugia_ud',
  'palmeras_endoterapia_troncos_ud',
  'arboles_peq_ud',
  'arboles_med_ud',
  'arboles_gran_ud',
  'herbicida_poca_densidad_m2',
  'herbicida_mucha_densidad_m2',
  'plantas_superficie_calculada_m2',
]

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error.trim()
  return 'unknown_error'
}

export function getPrimaryBookingPhotoUrls(source: MainPhotoSource): string[] {
  return extractPreferredBookingPhotoUrls(source.bookingPhotoContract, source.uploadedPhotoUrls || [])
}

function normalizePhotoIndices(indices: number[], total: number) {
  return Array.from(new Set(
    indices.filter((value) => Number.isInteger(value) && value >= 0 && value < total)
  )).sort((a, b) => a - b)
}

function getPhotoCollectionLength(source: PhotoCollectionSource) {
  const photoUrls = Array.isArray(source.photoUrls) ? source.photoUrls.length : 0
  const files = Array.isArray(source.files) ? source.files.length : 0
  const photoIds = Array.isArray(source.photoIds) ? source.photoIds.length : 0
  return Math.max(photoUrls, files, photoIds)
}

function buildRuntimePhotoId(seed: string, index: number) {
  return `booking-photo:${seed}:${index}`
}

export function normalizePhotoIdentityList(source: PhotoCollectionSource) {
  const photoUrls = Array.isArray(source.photoUrls) ? source.photoUrls : []
  const files = Array.isArray(source.files) ? source.files : []
  const total = getPhotoCollectionLength(source)
  const existingIds = Array.isArray(source.photoIds) ? source.photoIds.filter(Boolean) : []

  return Array.from({ length: total }, (_, index) => {
    const existing = existingIds[index]
    if (existing) return existing

    const urlSeed = photoUrls[index]
    if (typeof urlSeed === 'string' && urlSeed.trim()) {
      return buildRuntimePhotoId(urlSeed.trim(), index)
    }

    const file = files[index]
    if (file instanceof File) {
      return buildRuntimePhotoId(`${file.name}:${file.size}:${file.lastModified}`, index)
    }

    return buildRuntimePhotoId('unknown', index)
  })
}

function getImplicitSelectedPhotoIndices(source: PhotoCollectionSource) {
  const total = getPhotoCollectionLength(source)
  if (Array.isArray(source.selectedIndices)) {
    return normalizePhotoIndices(source.selectedIndices, total)
  }
  return Array.from({ length: total }, (_, index) => index)
}

export function appendFilesToPhotoCollection<T extends PhotoCollectionSource>(source: T, files: File[]) {
  const currentPhotoUrls = Array.isArray(source.photoUrls) ? [...source.photoUrls] : []
  const currentFiles = Array.isArray(source.files) ? [...source.files] : []
  const currentPhotoIds = normalizePhotoIdentityList(source)
  const currentSelected = getImplicitSelectedPhotoIndices(source)
  const previewUrls = files.map((file) => URL.createObjectURL(file))
  const startIndex = currentPhotoUrls.length
  const newIndices = previewUrls.map((_, index) => startIndex + index)
  const newPhotoIds = files.map(
    (file, index) => buildRuntimePhotoId(`${file.name}:${file.size}:${file.lastModified}`, startIndex + index)
  )
  const nextTotal = startIndex + files.length

  reportBookingEvent('info', {
    event: 'booking.photo_added',
    context: {
      phase: 'selection',
      status: 'added',
      service: 'details_page_collection',
      addedCount: files.length,
      previousCount: startIndex,
      nextCount: nextTotal,
      newIndices,
    },
  })

  return {
    nextCollection: {
      ...source,
      photoIds: [...currentPhotoIds, ...newPhotoIds],
      photoUrls: [...currentPhotoUrls, ...previewUrls],
      files: [...currentFiles, ...files],
      selectedIndices: normalizePhotoIndices([...currentSelected, ...newIndices], nextTotal),
    } as T,
    previewUrls,
    newIndices,
  }
}

export function togglePhotoSelectionInCollection<T extends PhotoCollectionSource>(source: T, photoIndex: number) {
  const total = Array.isArray(source.photoUrls) ? source.photoUrls.length : 0
  if (photoIndex < 0 || photoIndex >= total) return source

  const currentSelected = getImplicitSelectedPhotoIndices(source)
  const nextSelected = currentSelected.includes(photoIndex)
    ? currentSelected.filter((index) => index !== photoIndex)
    : [...currentSelected, photoIndex]

  return {
    ...source,
    photoIds: normalizePhotoIdentityList(source),
    selectedIndices: normalizePhotoIndices(nextSelected, total),
  } as T
}

export function removePhotoFromCollection<T extends PhotoCollectionSource>(source: T, photoIndex: number) {
  const currentPhotoUrls = Array.isArray(source.photoUrls) ? source.photoUrls : []
  const currentPhotoIds = normalizePhotoIdentityList(source)
  if (photoIndex < 0 || photoIndex >= currentPhotoUrls.length) return source
  const invalidatedAnalysis = Array.isArray(source.analyzedIndices) && source.analyzedIndices.includes(photoIndex)
  const removedSelectedPhoto = Array.isArray(source.selectedIndices)
    ? source.selectedIndices.includes(photoIndex)
    : true

  const normalizeAfterRemoval = (indices?: number[]) =>
    Array.isArray(indices)
      ? indices
          .filter((index) => index !== photoIndex)
          .map((index) => (index > photoIndex ? index - 1 : index))
      : undefined

  reportBookingEvent('info', {
    event: 'booking.photo_removed',
    context: {
      phase: invalidatedAnalysis ? 'invalidation' : 'selection',
      status: 'removed',
      service: 'details_page_collection',
      photoIndex,
      previousCount: currentPhotoUrls.length,
      nextCount: currentPhotoUrls.length - 1,
      invalidatedAnalysis,
      removedSelectedPhoto,
    },
  })

  return {
    ...source,
    photoIds: currentPhotoIds.filter((_, index) => index !== photoIndex),
    photoUrls: currentPhotoUrls.filter((_, index) => index !== photoIndex),
    files: Array.isArray(source.files) ? source.files.filter((_, index) => index !== photoIndex) : source.files,
    selectedIndices: normalizeAfterRemoval(source.selectedIndices),
    analyzedIndices: normalizeAfterRemoval(source.analyzedIndices),
  } as T
}

export function createEmptyHedgeFaceCollection(): HedgeFaceCollection {
  return {
    photoIds: [],
    photoUrls: [],
    files: [],
    selectedIndices: [],
    analyzedIndices: [],
  }
}

export function normalizeHedgeZonePhotoCollections<T extends HedgeZonePhotoCollections>(zone: T): T & {
  faceA: HedgeFaceCollection
  faceB: HedgeFaceCollection
} {
  const legacyUrls = Array.isArray(zone.photoUrls) ? zone.photoUrls : []
  const legacySelected = Array.isArray(zone.selectedIndices)
    ? normalizePhotoIndices(zone.selectedIndices, legacyUrls.length)
    : legacyUrls.map((_, index) => index)
  const legacyAnalyzed = Array.isArray(zone.analyzedIndices)
    ? normalizePhotoIndices(zone.analyzedIndices, legacyUrls.length)
    : []

  const faceABaseSource: HedgeFaceCollection = {
    photoUrls: Array.isArray(zone.faceA?.photoUrls) ? [...zone.faceA.photoUrls] : [...legacyUrls],
    files: Array.isArray(zone.faceA?.files) ? [...zone.faceA.files] : [],
  }
  const faceBBaseSource: HedgeFaceCollection = {
    photoUrls: Array.isArray(zone.faceB?.photoUrls) ? [...zone.faceB.photoUrls] : [],
    files: Array.isArray(zone.faceB?.files) ? [...zone.faceB.files] : [],
  }

  const faceA: HedgeFaceCollection = {
    ...createEmptyHedgeFaceCollection(),
    ...(zone.faceA || {}),
    photoIds: normalizePhotoIdentityList(zone.faceA || faceABaseSource),
    photoUrls: faceABaseSource.photoUrls,
    files: faceABaseSource.files,
    selectedIndices: Array.isArray(zone.faceA?.selectedIndices)
      ? [...zone.faceA.selectedIndices]
      : [...legacySelected],
    analyzedIndices: Array.isArray(zone.faceA?.analyzedIndices)
      ? [...zone.faceA.analyzedIndices]
      : [...legacyAnalyzed],
  }

  const faceB: HedgeFaceCollection = {
    ...createEmptyHedgeFaceCollection(),
    ...(zone.faceB || {}),
    photoIds: normalizePhotoIdentityList(zone.faceB || faceBBaseSource),
    photoUrls: faceBBaseSource.photoUrls,
    files: faceBBaseSource.files,
    selectedIndices: Array.isArray(zone.faceB?.selectedIndices) ? [...zone.faceB.selectedIndices] : [],
    analyzedIndices: Array.isArray(zone.faceB?.analyzedIndices) ? [...zone.faceB.analyzedIndices] : [],
  }

  return {
    ...zone,
    faceA,
    faceB,
    hasBackFaceTrim: zone.hasBackFaceTrim ?? ((faceB.photoUrls?.length || 0) > 0),
  }
}

export function syncLegacyHedgeZonePhotoCollections<T extends HedgeZonePhotoCollections>(zone: T): T & {
  faceA: HedgeFaceCollection
  faceB: HedgeFaceCollection
} {
  const normalized = normalizeHedgeZonePhotoCollections(zone)
  const faceAUrls = normalized.faceA.photoUrls || []
  const faceBUrls = normalized.faceB.photoUrls || []
  const faceASelected = normalized.faceA.selectedIndices || []
  const faceBSelected = normalized.faceB.selectedIndices || []
  const faceAAnalyzed = normalized.faceA.analyzedIndices || []
  const faceBAnalyzed = normalized.faceB.analyzedIndices || []
  const offset = faceAUrls.length

  return {
    ...normalized,
    hasBackFaceTrim: faceBUrls.length > 0,
    photoIds: [...normalizePhotoIdentityList(normalized.faceA), ...normalizePhotoIdentityList(normalized.faceB)],
    photoUrls: [...faceAUrls, ...faceBUrls],
    files: [],
    selectedIndices: [...faceASelected, ...faceBSelected.map((index) => index + offset)],
    analyzedIndices: [...faceAAnalyzed, ...faceBAnalyzed.map((index) => index + offset)],
  }
}

export function toggleHedgeFacePhotoSelection<T extends HedgeZonePhotoCollections>(
  zone: T,
  faceKey: HedgeFaceKey,
  photoIndex: number,
) {
  const normalized = normalizeHedgeZonePhotoCollections(zone)
  const nextFace = togglePhotoSelectionInCollection(normalized[faceKey], photoIndex)
  return syncLegacyHedgeZonePhotoCollections({
    ...normalized,
    [faceKey]: nextFace,
  } as T)
}

export function appendFilesToHedgeFaceCollection<T extends HedgeZonePhotoCollections>(
  zone: T,
  faceKey: HedgeFaceKey,
  files: File[],
) {
  const normalized = normalizeHedgeZonePhotoCollections(zone)
  const { nextCollection, previewUrls, newIndices } = appendFilesToPhotoCollection(normalized[faceKey], files)

  return {
    zone: syncLegacyHedgeZonePhotoCollections({
      ...normalized,
      [faceKey]: nextCollection,
    } as T),
    previewUrls,
    newIndices,
  }
}

export function removePhotoFromHedgeFaceCollection<T extends HedgeZonePhotoCollections>(
  zone: T,
  faceKey: HedgeFaceKey,
  photoIndex: number,
) {
  const normalized = normalizeHedgeZonePhotoCollections(zone)
  const nextFace = removePhotoFromCollection(normalized[faceKey], photoIndex)
  return syncLegacyHedgeZonePhotoCollections({
    ...normalized,
    [faceKey]: nextFace,
  } as T)
}

function dedupeCanonicalContractItemsByUrl(items: Array<{
  id: string
  url?: string
  storageBucket?: string
  storagePath?: string
}>) {
  const storageBackedUrls = new Set(
    items
      .filter((item) => item.url && item.storageBucket && item.storagePath)
      .map((item) => item.url as string)
  )

  return items.filter((item) => {
    if (!item.url) return true
    if (item.storageBucket && item.storagePath) return true
    return !storageBackedUrls.has(item.url)
  })
}

export function buildDetailsPageBookingPatch<T extends MainPhotoSource & Record<string, any>>(
  baseData: T,
  patch: Partial<T>,
  contractSeed = baseData.bookingPhotoContract
) {
  const mergedData = { ...baseData, ...patch }
  const activePhotoSources = {
    ...mergedData,
    bookingPhotoContract: undefined,
  }
  const activePhotoUrls = new Set(
    extractBookingPhotoUrls(buildBookingPhotoContract(activePhotoSources))
  )
  const preservedItems = (buildBookingPhotoContract(contractSeed).items || []).filter(
    (item) => !item.url || activePhotoUrls.has(item.url)
  )
  const bookingPhotoContract = buildBookingPhotoContract(
    {
      schemaVersion: BOOKING_PHOTO_CONTRACT_VERSION,
      items: preservedItems,
    },
    activePhotoSources
  )
  bookingPhotoContract.items = dedupeCanonicalContractItemsByUrl(bookingPhotoContract.items)

  return {
    ...patch,
    bookingPhotoContract,
    uploadedPhotoUrls: extractPreferredBookingPhotoUrls(
      bookingPhotoContract,
      Array.isArray(mergedData.uploadedPhotoUrls) ? mergedData.uploadedPhotoUrls : []
    ),
  }
}

export function createDebugInfo(
  overrides: Partial<AnalysisDebugInfo> & Pick<AnalysisDebugInfo, 'service' | 'model' | 'promptInputs'>
): AnalysisDebugInfo {
  return {
    service: overrides.service,
    model: overrides.model,
    promptInputs: overrides.promptInputs,
    rawResponse: overrides.rawResponse ?? null,
    parsedResponse: overrides.parsedResponse ?? null,
    finalAnalysisData: overrides.finalAnalysisData ?? {},
    errors: overrides.errors ?? [],
    timestamp: overrides.timestamp ?? new Date().toISOString(),
  }
}

export function appendDebugError(debugInfo: AnalysisDebugInfo | null | undefined, error: unknown): AnalysisDebugInfo {
  return {
    ...(debugInfo || createDebugInfo({ service: 'unknown', model: 'unknown', promptInputs: {} })),
    errors: [...(debugInfo?.errors || []), error],
  }
}

export function reportDetailsPageIssue(params: {
  event: string
  service: string
  error: unknown
  serviceId?: string
  zoneId?: string
  scope?: string
  photoCount?: number
}) {
  reportBookingEvent('warn', {
    event: params.event,
    context: {
      service: params.service,
      serviceId: params.serviceId || 'unknown',
      zoneId: params.zoneId,
      scope: params.scope,
      photoCount: params.photoCount,
      message: normalizeErrorMessage(params.error),
    },
  })
}

export function normalizeTreeSizeBand(value: unknown): TreeSizeBand | null {
  const normalized = String(value || '').toLowerCase().trim()
  if (normalized === 'small' || normalized === 'medium' || normalized === 'large' || normalized === 'over_9') {
    return normalized
  }
  return null
}

export function treeSizeBandToLegacyMeters(band: TreeSizeBand): number {
  return TREE_SIZE_BAND_FALLBACK_METERS[band]
}

export function toPhytosanitaryMetricNumber(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return 0
  return Math.max(0, parsed)
}

export function normalizePhytosanitaryPlantasSize(value: unknown): PhytosanitaryPlantasSize {
  const normalized = String(value || '').toLowerCase().trim()
  if (normalized.includes('grande')) return 'grandes'
  if (normalized.includes('mediana')) return 'medianas'
  if (normalized.includes('peque')) return 'pequenas'
  return null
}

export function sumPhytosanitaryMetrics(metrics: PhytosanitaryAnalysisMetrics) {
  return PHYTOSANITARY_METRIC_KEYS.reduce(
    (total, key) => total + Number(metrics[key] || 0),
    0
  )
}

export function buildAnalysisFailureFields(params: {
  serviceName: AnalysisService
  selectedIndices?: number[] | null
  totalPhotoCount: number
}) {
  return buildAnalysisCommonFields({
    analysis: buildTechnicalFailureAnalysis(params.serviceName, params.totalPhotoCount),
    analyzedIndices: [],
    selectedIndices: params.selectedIndices || [],
    totalPhotoCount: params.totalPhotoCount,
  })
}

export function extractLawnLegacyTasks(response: {
  tareas?: unknown[]
  rawResponse?: unknown
}): Record<string, any>[] {
  if (Array.isArray(response.tareas) && response.tareas.length > 0) return response.tareas as Record<string, any>[]
  const raw = response.rawResponse as any
  if (Array.isArray(raw?.tareas) && raw.tareas.length > 0) return raw.tareas
  if (raw?.tareas && typeof raw.tareas === 'object') return [raw.tareas]
  if (raw?.tarea && typeof raw.tarea === 'object') return [raw.tarea]
  return []
}

export function adaptLawnAnalysisResult(params: {
  analysis?: AnalysisV2Envelope | null
  legacyTask?: Record<string, any> | null
  selectedIndices: number[]
  totalPhotoCount: number
}) {
  const legacyTask = params.legacyTask || {}
  const lawnMetrics = params.analysis?.service === 'Corte de césped' ? params.analysis.service_metrics as any : null

  const rawLawnState = String(lawnMetrics?.estado_jardin || legacyTask.estado_jardin || '').toLowerCase()
  const lawnState = rawLawnState.includes('muy')
    ? 'muy descuidado'
    : rawLawnState.includes('descuidad')
      ? 'descuidado'
      : 'normal'
  const toLawnConfidence = (value: unknown): number | null => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return null
    return Math.min(1, Math.max(0, parsed))
  }

  return {
    species: 'Césped general',
    state: lawnState,
    // La IA PROPONE el estado; el recargo solo se consolida cuando el cliente lo confirma.
    stateProposedByAI: lawnState !== 'normal',
    superficieConfidence: toLawnConfidence(lawnMetrics?.superficie_confidence ?? legacyTask.superficie_confidence),
    estadoConfidence: toLawnConfidence(lawnMetrics?.estado_confidence ?? legacyTask.estado_confidence),
    quantity: Number(lawnMetrics?.superficie_m2 ?? legacyTask.superficie_m2 ?? 0),
    ...buildAnalysisCommonFields({
      analysis: params.analysis,
      analysisLevel: legacyTask.nivel_analisis,
      observations: legacyTask.observaciones,
      analyzedIndices: params.selectedIndices,
      selectedIndices: params.selectedIndices,
      totalPhotoCount: params.totalPhotoCount,
    }),
  }
}

export function adaptTreeAnalysisResult(params: {
  analysis?: AnalysisV2Envelope | null
  legacyTree?: Record<string, any> | null
  selectedIndices: number[]
  totalPhotoCount: number
  difficultyHigh?: boolean
}) {
  const legacyTree = params.legacyTree || {}
  const treeMetrics = params.analysis?.service === 'Poda de árboles' ? params.analysis.service_metrics as any : null
  const canonicalTree = treeMetrics?.arboles?.[0]
  const sizeBand = normalizeTreeSizeBand(canonicalTree?.size_band ?? legacyTree.size_band)
  const aiHeight = Number(canonicalTree?.altura_m ?? legacyTree.altura_m)
  const toConfidence = (value: unknown): number | null => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return null
    return Math.min(1, Math.max(0, parsed))
  }

  return {
    aiSizeBand: sizeBand ?? undefined,
    // Altura real estimada por la IA; el valor legacy por banda queda como fallback.
    aiHeightMeters: Number.isFinite(aiHeight) && aiHeight > 0
      ? aiHeight
      : (sizeBand ? treeSizeBandToLegacyMeters(sizeBand) : 0),
    sizeBandConfidence: toConfidence(canonicalTree?.size_band_confidence ?? legacyTree.size_band_confidence),
    alturaConfidence: toConfidence(canonicalTree?.altura_confidence ?? legacyTree.altura_confidence),
    difficultyHigh: typeof params.difficultyHigh === 'boolean' ? params.difficultyHigh : undefined,
    ...buildAnalysisCommonFields({
      analysis: params.analysis,
      analysisLevel: legacyTree.nivel_analisis,
      observations: legacyTree.observaciones,
      analyzedIndices: params.selectedIndices,
      selectedIndices: params.selectedIndices,
      totalPhotoCount: params.totalPhotoCount,
    }),
  }
}

export function adaptShrubAnalysisResult(params: {
  analysis?: AnalysisV2Envelope | null
  legacyTask?: Record<string, any> | null
  selectedIndices: number[]
  totalPhotoCount: number
}) {
  const legacyTask = params.legacyTask || {}
  const shrubMetrics =
    params.analysis?.service === 'Poda de plantas y arbustos' ? params.analysis.service_metrics as any : null

  let size: 'pequeñas' | 'medianas' | 'grandes' = 'pequeñas'
  const aiSize = String(shrubMetrics?.tamano_dominante || legacyTask.tamano_dominante || '').toLowerCase()
  if (aiSize.includes('grandes')) size = 'grandes'
  else if (aiSize.includes('medianas')) size = 'medianas'

  const legacyTotal = Number(legacyTask.tamano_total_jardin_m2 || 0)
  const legacyPercent = Number(legacyTask.porcentaje_superficie_plantas || 0)
  const fallbackM2 =
    Number.isFinite(legacyTotal) && Number.isFinite(legacyPercent)
      ? Math.max(0, Math.round(legacyTotal * (legacyPercent / 100)))
      : 0

  const rawState = String(shrubMetrics?.estado_plantas || legacyTask.estado_plantas || '').toLowerCase()
  const state: 'normal' | 'descuidado' | 'muy_descuidado' = rawState.includes('muy')
    ? 'muy_descuidado'
    : rawState.includes('descuidad')
      ? 'descuidado'
      : 'normal'
  const toConfidence = (value: unknown): number | null => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return null
    return Math.min(1, Math.max(0, parsed))
  }

  return {
    area: Math.max(0, Number(shrubMetrics?.superficie_m2 ?? legacyTask.superficie_m2 ?? fallbackM2 ?? 0)),
    size,
    state,
    stateProposedByAI: state !== 'normal',
    superficieConfidence: toConfidence(shrubMetrics?.superficie_confidence ?? legacyTask.superficie_confidence),
    tamanoConfidence: toConfidence(shrubMetrics?.tamano_confidence ?? legacyTask.tamano_confidence),
    estadoConfidence: toConfidence(shrubMetrics?.estado_confidence ?? legacyTask.estado_confidence),
    ...buildAnalysisCommonFields({
      analysis: params.analysis,
      analysisLevel: legacyTask.nivel_analisis,
      observations: legacyTask.observaciones,
      analyzedIndices: params.selectedIndices,
      selectedIndices: params.selectedIndices,
      totalPhotoCount: params.totalPhotoCount,
    }),
  }
}

export function adaptPhytosanitaryAnalysisResult(params: {
  analysis?: AnalysisV2Envelope | null
  legacyTask?: Record<string, any> | null
  legacyMetrics?: Record<string, any> | null
  selectedIndices: number[]
  totalPhotoCount: number
}) {
  const legacyTask = params.legacyTask || {}
  const legacyMetrics = params.legacyMetrics || {}
  const canonicalMetrics =
    params.analysis?.service === 'Servicios fitosanitarios' ? params.analysis.service_metrics as any : null
  const commonFields = buildAnalysisCommonFields({
    analysis: params.analysis,
    analysisLevel: legacyTask.nivel_analisis,
    observations: legacyTask.observaciones,
    analyzedIndices: params.selectedIndices,
    selectedIndices: params.selectedIndices,
    totalPhotoCount: params.totalPhotoCount,
  })

  const metrics: PhytosanitaryAnalysisMetrics = {
    ...EMPTY_PHYTOSANITARY_ANALYSIS_METRICS,
    ...Object.fromEntries(
      PHYTOSANITARY_METRIC_KEYS.map((key) => [
        key,
        toPhytosanitaryMetricNumber(canonicalMetrics?.[key] ?? legacyMetrics?.[key] ?? 0),
      ])
    ),
    plantas_tamano_dominante: normalizePhytosanitaryPlantasSize(
      canonicalMetrics?.plantas_tamano_dominante ?? legacyMetrics?.plantas_tamano_dominante
    ),
    observaciones_ia: commonFields.observations,
  }

  return {
    analysisMetrics: metrics,
    area: Math.max(0, sumPhytosanitaryMetrics(metrics)),
    ...commonFields,
  }
}
