import type { BookingData } from '../../contexts/BookingContext'

export type DetailsServiceFlags = {
  normalizedName: string
  isLawn: boolean
  isHedge: boolean
  isTree: boolean
  isPalm: boolean
  isShrub: boolean
  isPhytosanitary: boolean
  isWeeding: boolean
  showsPhotoCounter: boolean
  showsGlobalAnalyzeButton: boolean
}

type ContinueStateParams = {
  bookingData: BookingData
  serviceFlags: DetailsServiceFlags
  weedingManualConfirmed: boolean
  getPhytosanitaryValidation: (zone: unknown) => { issues: string[] }
  isPhytosanitaryZoneAnalyzed: (zone: unknown) => boolean
}

const normalizeServiceName = (value: string) => value.trim().toLowerCase()

export function getDetailsServiceFlags(serviceName: string): DetailsServiceFlags {
  const normalizedName = normalizeServiceName(serviceName)
  const isLawn =
    normalizedName.includes('corte de cesped') ||
    normalizedName.includes('corte de césped') ||
    normalizedName.includes('cesped') ||
    normalizedName.includes('césped')
  const isHedge = normalizedName.includes('seto')
  const isTree = normalizedName.includes('arbol') || normalizedName.includes('árbol')
  const isPalm = normalizedName.includes('palmera')
  const isPhytosanitary = normalizedName.includes('fitosanit')
  const isWeeding = normalizedName.includes('desbroce') || normalizedName.includes('malas hierbas')
  const isShrub =
    normalizedName.includes('poda de plantas') ||
    (normalizedName.includes('poda') && !isTree && !isPalm)

  return {
    normalizedName,
    isLawn,
    isHedge,
    isTree,
    isPalm,
    isShrub,
    isPhytosanitary,
    isWeeding,
    showsPhotoCounter: !isLawn && !isWeeding,
    showsGlobalAnalyzeButton: !isLawn && !isHedge && !isWeeding,
  }
}

export function getDetailsContinueDisabled(params: ContinueStateParams): boolean {
  const {
    bookingData,
    serviceFlags,
    weedingManualConfirmed,
    getPhytosanitaryValidation,
    isPhytosanitaryZoneAnalyzed,
  } = params

  if (serviceFlags.isPalm && (!bookingData.estimatedHours || bookingData.estimatedHours <= 0)) {
    return true
  }

  if (serviceFlags.isPhytosanitary) {
    const zones = bookingData.phytosanitaryZones || []
    return (
      zones.length === 0 ||
      zones.some((zone) => getPhytosanitaryValidation(zone).issues.length > 0 || !isPhytosanitaryZoneAnalyzed(zone))
    )
  }

  if (serviceFlags.isWeeding) {
    const zone = bookingData.weedingZones?.[0]
    const hasValidArea = Number(zone?.area || 0) > 0
    const hasValidState =
      zone?.state === 'normal' ||
      zone?.state === 'dificultad_media' ||
      zone?.state === 'dificultad_alta'

    return !zone || !hasValidArea || !hasValidState || !weedingManualConfirmed
  }

  return false
}

export function getDetailsContinueLabel(bookingData: BookingData, serviceFlags: DetailsServiceFlags): string {
  if (serviceFlags.isPhytosanitary) {
    const analyzedZones = (bookingData.phytosanitaryZones || []).filter((zone) => zone.analysisLevel === 2).length
    return analyzedZones > 0 ? `Continuar con ${analyzedZones} zona${analyzedZones === 1 ? '' : 's'}` : 'Continuar'
  }

  if (serviceFlags.isLawn) {
    const zoneCount = (bookingData.lawnZones || []).filter((zone) => zone.analysisLevel === 1 || zone.analysisLevel === 2).length
    return zoneCount > 0 ? `Continuar con ${zoneCount} zona${zoneCount === 1 ? '' : 's'}` : 'Continuar'
  }

  if (serviceFlags.isHedge) {
    const zoneCount = (bookingData.hedgeZones || []).filter((zone) => zone.analysisLevel === 1 || zone.analysisLevel === 2).length
    return zoneCount > 0 ? `Continuar con ${zoneCount} zona${zoneCount === 1 ? '' : 's'}` : 'Continuar'
  }

  const validTreeCount = (bookingData.treeGroups || []).filter((group) => !((group as any).isFailed === true || group.analysisLevel === 3)).length
  return validTreeCount > 0 ? `Continuar con ${validTreeCount} árboles` : 'Continuar'
}

export type SelectedInputMode = 'photos' | 'manual'

type InputModeSource = Partial<Pick<
  BookingData,
  | 'dataInputMode'
  | 'photos'
  | 'uploadedPhotoUrls'
  | 'bookingPhotoContract'
  | 'lawnZones'
  | 'hedgeZones'
  | 'treeGroups'
  | 'palmGroups'
  | 'shrubGroups'
  | 'phytosanitaryZones'
>>

const hasEntries = (value: unknown) => Array.isArray(value) && value.length > 0

/**
 * Modo de entrada que el cliente YA ha elegido para el servicio activo, o `null` si aún no.
 *
 * «Detalles» abre con las dos opciones (fotos / a mano) sin ninguna marcada y no enseña ningún
 * formulario hasta que el cliente elige. Los borradores anteriores a esta elección explícita no
 * guardaban `dataInputMode` en el modo fotos (era el modo por defecto): si ya traen fotos o
 * zonas, venían de ahí y se reabren en fotos, sin volver a preguntar. Las zonas cuentan también
 * al repetir una reserva hecha con fotos (se conservan los resultados, no las fotos). El modo a
 * mano siempre queda guardado explícitamente al elegirlo.
 */
export function resolveSelectedInputMode(data: InputModeSource): SelectedInputMode | null {
  if (data.dataInputMode === 'manual' || data.dataInputMode === 'photos') return data.dataInputMode
  const hasPhotoFlowProgress =
    hasEntries(data.photos) ||
    hasEntries(data.uploadedPhotoUrls) ||
    hasEntries(data.bookingPhotoContract?.items) ||
    hasEntries(data.lawnZones) ||
    hasEntries(data.hedgeZones) ||
    hasEntries(data.treeGroups) ||
    hasEntries(data.palmGroups) ||
    hasEntries(data.shrubGroups) ||
    hasEntries(data.phytosanitaryZones)
  return hasPhotoFlowProgress ? 'photos' : null
}
