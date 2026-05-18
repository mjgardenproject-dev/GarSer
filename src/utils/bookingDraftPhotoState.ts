type PhotoCollectionLike = {
  photoIds?: unknown
  photoUrls?: unknown
  files?: unknown
  selectedIndices?: unknown
  analyzedIndices?: unknown
}

export interface DraftPhotoRestoreResult<T> {
  restoredData: T
  restoredCount: number
  missingPaths: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value)) as T
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => (typeof item === 'string' ? item : '')).filter(Boolean)
}

function normalizeFileArray(value: unknown): File[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is File => typeof File !== 'undefined' && item instanceof File)
}

function normalizeIndexArray(value: unknown, total: number) {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(value.filter((item) => Number.isInteger(item) && item >= 0 && item < total) as number[])
  ).sort((a, b) => a - b)
}

function buildFallbackPhotoId(seed: string, index: number) {
  return `booking-photo:${seed}:${index}`
}

function normalizePhotoIds(collection: PhotoCollectionLike) {
  const existingIds = Array.isArray(collection.photoIds)
    ? collection.photoIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
  const urls = normalizeStringArray(collection.photoUrls)
  const files = normalizeFileArray(collection.files)
  const total = Math.max(existingIds.length, urls.length, files.length)

  return Array.from({ length: total }, (_, index) => {
    const existing = existingIds[index]
    if (existing) return existing

    const url = urls[index]
    if (url) return buildFallbackPhotoId(url, index)

    const file = files[index]
    if (file instanceof File) {
      return buildFallbackPhotoId(`${file.name}:${file.size}:${file.lastModified}`, index)
    }

    return buildFallbackPhotoId('unknown', index)
  })
}

function isRestorablePhotoCollection(value: unknown): value is Record<string, unknown> & PhotoCollectionLike {
  if (!isRecord(value)) return false
  return (
    Array.isArray(value.photoIds) ||
    Array.isArray(value.photoUrls) ||
    Array.isArray(value.files)
  )
}

function isPersistentPhotoUrl(value: unknown) {
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return Boolean(normalized) && !normalized.startsWith('blob:') && !normalized.startsWith('data:')
}

function rewriteIndices(indices: number[], indexMap: Map<number, number>) {
  return Array.from(
    new Set(
      indices
        .map((index) => indexMap.get(index))
        .filter((index): index is number => Number.isInteger(index) && index >= 0)
    )
  ).sort((a, b) => a - b)
}

function visitMutablePhotoCollections(
  value: unknown,
  visitor: (collection: Record<string, unknown> & PhotoCollectionLike, path: string) => Promise<void> | void,
  path = '',
  visited = new WeakSet<object>(),
): Promise<void> | void {
  if (Array.isArray(value)) {
    const tasks = value.map((item, index) =>
      visitMutablePhotoCollections(item, visitor, `${path}[${index}]`, visited)
    )
    if (tasks.some((task) => task instanceof Promise)) {
      return Promise.all(tasks).then(() => undefined)
    }
    return
  }

  if (!isRecord(value)) return
  if (visited.has(value)) return
  visited.add(value)

  const tasks: Array<Promise<void> | void> = []
  if (isRestorablePhotoCollection(value)) {
    tasks.push(visitor(value, path))
  }

  Object.entries(value).forEach(([key, nested]) => {
    if (typeof File !== 'undefined' && nested instanceof File) return
    const nextPath = path ? `${path}.${key}` : key
    tasks.push(visitMutablePhotoCollections(nested, visitor, nextPath, visited))
  })

  if (tasks.some((task) => task instanceof Promise)) {
    return Promise.all(tasks).then(() => undefined)
  }
}

export function collectDraftPhotoFilesFromBookingData(data: unknown) {
  const collected = new Map<string, File>()

  visitMutablePhotoCollections(data, (collection) => {
    const photoIds = normalizePhotoIds(collection)
    const files = normalizeFileArray(collection.files)

    photoIds.forEach((photoId, index) => {
      const file = files[index]
      if (photoId && file instanceof File) {
        collected.set(photoId, file)
      }
    })
  })

  return collected
}

export async function restoreDraftPhotoFilesInBookingData<T>(
  data: T,
  resolver: (photoId: string) => Promise<File | null>,
): Promise<DraftPhotoRestoreResult<T>> {
  const restoredData = cloneValue(data)
  let restoredCount = 0
  const missingPaths: string[] = []

  await visitMutablePhotoCollections(restoredData, async (collection, path) => {
    const photoIds = normalizePhotoIds(collection)
    if (photoIds.length === 0) return

    const currentUrls = normalizeStringArray(collection.photoUrls)
    const currentFiles = normalizeFileArray(collection.files)
    const nextPhotoIds: string[] = []
    const nextPhotoUrls: string[] = []
    const nextFiles: File[] = []
    const indexMap = new Map<number, number>()

    for (let index = 0; index < photoIds.length; index += 1) {
      const photoId = photoIds[index]
      const currentUrl = currentUrls[index]
      const currentFile = currentFiles[index]

      if (isPersistentPhotoUrl(currentUrl)) {
        indexMap.set(index, nextPhotoIds.length)
        nextPhotoIds.push(photoId)
        nextPhotoUrls.push(currentUrl)
        if (currentFile instanceof File) nextFiles.push(currentFile)
        continue
      }

      const file = currentFile instanceof File ? currentFile : await resolver(photoId)
      if (file instanceof File) {
        indexMap.set(index, nextPhotoIds.length)
        nextPhotoIds.push(photoId)
        nextPhotoUrls.push(URL.createObjectURL(file))
        nextFiles.push(file)
        if (!(currentFile instanceof File)) {
          restoredCount += 1
        }
        continue
      }

      missingPaths.push(path ? `${path}.photoIds[${index}]` : `photoIds[${index}]`)
    }

    const total = photoIds.length
    collection.photoIds = nextPhotoIds
    collection.photoUrls = nextPhotoUrls
    collection.files = nextFiles
    collection.selectedIndices = rewriteIndices(normalizeIndexArray(collection.selectedIndices, total), indexMap)
    collection.analyzedIndices = rewriteIndices(normalizeIndexArray(collection.analyzedIndices, total), indexMap)
  })

  return {
    restoredData,
    restoredCount,
    missingPaths,
  }
}
